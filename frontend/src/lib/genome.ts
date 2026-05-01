import {
  keccak256,
  getBytes,
  solidityPackedKeccak256,
  hexlify,
  solidityPacked,
} from 'ethers'
import type { JsonRpcSigner } from 'ethers'
import { Indexer, MemData } from '@0gfoundation/0g-storage-ts-sdk'

// =====================================================================
//                              Constants
// =====================================================================

export const STORAGE_INDEXER_URL =
  'https://indexer-storage-testnet-turbo.0g.ai'
export const STORAGE_GATEWAY_URL = STORAGE_INDEXER_URL
export const ZERO_G_RPC = 'https://evmrpc-testnet.0g.ai'

// =====================================================================
//                                 Types
// =====================================================================

export type Allele =
  | { type: 'momentum'; lookback: number; threshold: number }
  | { type: 'reversion'; window: number; zThreshold: number }
  | { type: 'volatility-narrow'; min: number; max: number }
  | { type: 'volatility-wide'; min: number; max: number }

export type Locus<T extends Allele> = {
  locusId: string
  alleles: T[]
  dominance: T['type']
}

export type Genome = {
  trigger: Locus<Extract<Allele, { type: 'momentum' | 'reversion' }>>
  filter: Locus<Extract<Allele, { type: `volatility-${string}` }>>
  parents: number[]
  generation: number
  createdAt: string
}

// =====================================================================
//                          Session key cache
// =====================================================================

// Per-session cache of derived genome keys, keyed by tokenId.
// Map<tokenId, 32-byte Uint8Array>. Cleared on page reload.
const keyCache = new Map<number, Uint8Array>()

export function clearGenomeKeyCache(): void {
  keyCache.clear()
}

// =====================================================================
//                          Key derivation
// =====================================================================

/**
 * Derive a 32-byte AES key for a given tokenId from the user's wallet
 * signature. Same wallet + same tokenId always yields the same key.
 *
 * Cached in-memory for the session so the user only sees one MetaMask
 * popup per token per page load.
 */
export async function deriveGenomeKey(
  signer: JsonRpcSigner,
  tokenId: number,
): Promise<Uint8Array> {
  const cached = keyCache.get(tokenId)
  if (cached) return cached

  const message = `Mendel genome key\nTokenId: ${tokenId}\nApp: mendel-v1`
  const signature = await signer.signMessage(message)
  const key = getBytes(keccak256(signature))
  keyCache.set(tokenId, key)
  return key
}

/**
 * Public commitment to the key-derivation input. Stored on-chain in
 * `MendelAgent.keyCommitments` and verifiable by anyone with the
 * (owner, tokenId) tuple.
 *
 * @returns 32-byte hex (`0x...`) — bytes32.
 */
export function deriveKeyCommitment(
  walletAddress: string,
  tokenId: number,
): string {
  return solidityPackedKeccak256(
    ['address', 'uint256'],
    [walletAddress, tokenId],
  )
}

/**
 * v1 stand-in for proper key sealing. Returns a deterministic
 * commitment to the encryption key for a specific owner.
 *
 * NOT cryptographic sealing — anyone with `rawKey` and `ownerAddress`
 * can recompute this. The on-chain `metadataHash` field expects this
 * commitment so the genome owner can later prove "I know the key".
 *
 * v2 will replace this with receiver-pubkey encryption per the
 * ERC-7857 sealedKey semantics.
 *
 * @returns 32-byte hex (`0x...`) — bytes32.
 */
export function sealKey(rawKey: Uint8Array, ownerAddress: string): string {
  return solidityPackedKeccak256(
    ['bytes32', 'address'],
    [hexlify(rawKey), ownerAddress],
  )
}

/**
 * Storage integrity hash for the encrypted blob.
 * @returns 32-byte hex (`0x...`).
 */
export function blobHash(encryptedBytes: Uint8Array): string {
  return keccak256(encryptedBytes)
}

// =====================================================================
//                       AES-256-GCM encryption
// =====================================================================
//
//   Output layout (binary):
//     [ salt (16) | iv (12) | ciphertext + auth tag (variable) ]
//
//   Web Crypto's AES-GCM appends the 16-byte auth tag to the ciphertext
//   automatically, so the final 16 bytes of the output are the tag.
//
//   The `salt` is consumed by an HKDF step that derives the actual
//   AES-256 key from `rawKey`. Re-encrypting the same plaintext under
//   the same `rawKey` yields different ciphertext (new salt + new iv).
//

async function deriveAesKey(
  rawKey: Uint8Array,
  salt: Uint8Array,
  usage: 'encrypt' | 'decrypt',
): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    rawKey as BufferSource,
    'HKDF',
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: salt as BufferSource,
      info: new TextEncoder().encode('mendel-v1-genome'),
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    [usage],
  )
}

export async function encryptGenome(
  genome: Genome,
  key: Uint8Array,
): Promise<Uint8Array> {
  if (key.length !== 32) {
    throw new Error(`encryptGenome: key must be 32 bytes, got ${key.length}`)
  }
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))

  const aesKey = await deriveAesKey(key, salt, 'encrypt')
  const plaintext = new TextEncoder().encode(JSON.stringify(genome))

  const ciphertextWithTag = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      aesKey,
      plaintext,
    ),
  )

  const out = new Uint8Array(salt.length + iv.length + ciphertextWithTag.length)
  out.set(salt, 0)
  out.set(iv, salt.length)
  out.set(ciphertextWithTag, salt.length + iv.length)
  return out
}

export async function decryptGenome(
  encrypted: Uint8Array,
  key: Uint8Array,
): Promise<Genome> {
  if (key.length !== 32) {
    throw new Error(`decryptGenome: key must be 32 bytes, got ${key.length}`)
  }
  if (encrypted.length < 16 + 12 + 16) {
    throw new Error('decryptGenome: ciphertext too short')
  }
  const salt = encrypted.slice(0, 16)
  const iv = encrypted.slice(16, 28)
  const ct = encrypted.slice(28)

  const aesKey = await deriveAesKey(key, salt, 'decrypt')
  const plaintext = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      aesKey,
      ct,
    ),
  )
  return JSON.parse(new TextDecoder().decode(plaintext)) as Genome
}

// =====================================================================
//                          0G Storage I/O
// =====================================================================

export type UploadResult = { rootHash: string; txHash: string }

/**
 * Upload encrypted bytes to 0G Storage. Returns the root hash (storage
 * pointer) and the chain tx hash (the on-chain submission record).
 *
 * The signer's wallet pays for the upload submission tx. Both balance
 * on the wallet's account and acknowledgement of the storage indexer
 * are required.
 */
export async function uploadGenome(
  encrypted: Uint8Array,
  signer: JsonRpcSigner,
): Promise<UploadResult> {
  const memData = new MemData(encrypted)

  const [tree, treeErr] = await memData.merkleTree()
  if (treeErr || !tree) {
    throw new Error(`merkleTree: ${treeErr?.message ?? 'unknown error'}`)
  }
  const rootHash = tree.rootHash()
  if (!rootHash) throw new Error('merkleTree: empty root hash')

  const indexer = new Indexer(STORAGE_INDEXER_URL)
  const [tx, uploadErr] = await indexer.upload(
    memData,
    ZERO_G_RPC,
    signer as never,
  )
  if (uploadErr) {
    // Treat "data already uploaded" as success — same root hash means
    // this exact blob is already pinned.
    if (/already.*upload/i.test(uploadErr.message)) {
      const txHash = tx && 'txHash' in tx ? tx.txHash : ''
      return { rootHash, txHash }
    }
    throw new Error(`upload: ${uploadErr.message}`)
  }
  // Result is either single ({txHash, rootHash, txSeq}) or multi-fragment
  // ({txHashes, rootHashes, txSeqs}); MemData yields the single shape.
  const txHash = 'txHash' in tx ? tx.txHash : tx.txHashes[0]
  return { rootHash, txHash }
}

/**
 * Download an encrypted blob from 0G Storage by root hash. Browser-friendly
 * — `Indexer.downloadToBlob` selects nodes from the indexer and returns a
 * Blob assembled from segment downloads.
 */
export async function downloadGenome(rootHash: string): Promise<Uint8Array> {
  const indexer = new Indexer(STORAGE_INDEXER_URL)
  const [blob, err] = await indexer.downloadToBlob(rootHash)
  if (err || !blob) {
    throw new Error(`downloadGenome: ${err?.message ?? 'unknown error'}`)
  }
  return new Uint8Array(await blob.arrayBuffer())
}

// =====================================================================
//                       Mendelian recombination
// =====================================================================
//
//  The breeding contract emits a `seed` (bytes32) at request time. We
//  use it as the entropy source for a deterministic hash-chain PRNG —
//  any party with the same seed reproduces the same children byte-for-byte.
//  This is what replaces the TEE in the v1 architecture: a public,
//  deterministic algorithm running on private inputs.

/** Hash-chain PRNG keyed by a bytes32 seed. */
function makeSeededPrng(seed: string) {
  let counter = 0
  function nextU32(): number {
    const h = keccak256(
      solidityPacked(['bytes32', 'uint256'], [seed, counter++]),
    )
    return parseInt(h.slice(2, 10), 16) // first 32 bits
  }
  function sampleOne<T>(arr: readonly T[]): T {
    if (arr.length === 0) throw new Error('sampleOne: empty array')
    return arr[nextU32() % arr.length]
  }
  return { nextU32, sampleOne }
}

// Per-locus dominance rule. The "dominant" type wins iff at least one
// allele in the child carries it; otherwise the genotype is homozygous
// recessive and the recessive type expresses.
const DOMINANT_TYPES = {
  trigger: 'momentum',
  filter: 'volatility-narrow',
} as const

function pickDominance(
  locus: 'trigger' | 'filter',
  alleleA: Allele,
  alleleB: Allele,
): string {
  const dom = DOMINANT_TYPES[locus]
  if (alleleA.type === dom || alleleB.type === dom) return dom
  return alleleA.type
}

/**
 * Pure deterministic Mendelian sampling. For each child, sample one allele
 * from each parent at each locus; the child genotype is heterozygous over
 * those two alleles.
 *
 * Same `seed` + same parents → same children, every time, in every
 * implementation. This is the property that lets us run recombination in
 * plain JS without needing a TEE: anyone with the inputs can verify the
 * outputs by re-running.
 */
export function mendelianRecombine(
  parentA: Genome,
  parentB: Genome,
  parentATokenId: number,
  parentBTokenId: number,
  seed: string,
  count = 9,
): Genome[] {
  const prng = makeSeededPrng(seed)
  const createdAt = new Date().toISOString()
  const children: Genome[] = []

  for (let i = 0; i < count; i++) {
    const triggerFromA = prng.sampleOne(parentA.trigger.alleles)
    const triggerFromB = prng.sampleOne(parentB.trigger.alleles)
    const filterFromA = prng.sampleOne(parentA.filter.alleles)
    const filterFromB = prng.sampleOne(parentB.filter.alleles)

    const triggerDominance = pickDominance('trigger', triggerFromA, triggerFromB)
    const filterDominance = pickDominance('filter', filterFromA, filterFromB)

    children.push({
      trigger: {
        locusId: 'I',
        alleles: [triggerFromA, triggerFromB],
        dominance:
          triggerDominance as Genome['trigger']['dominance'],
      },
      filter: {
        locusId: 'II',
        alleles: [filterFromA, filterFromB],
        dominance:
          filterDominance as Genome['filter']['dominance'],
      },
      parents: [parentATokenId, parentBTokenId],
      // Per spec: skip F1 visually so children read as F2 in the family tree.
      generation: 2,
      createdAt,
    })
  }

  return children
}
