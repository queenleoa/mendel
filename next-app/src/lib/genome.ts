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

// Upload reliability knobs. The 0G storage indexer/nodes occasionally hang
// (no response) or fail with a transient "Network Error" from axios; the
// SDK does not surface a timeout. Without this wrapper the breed flow
// freezes on the first stuck child and never returns. Total worst-case
// wall time = MAX_ATTEMPTS * TIMEOUT_MS + cumulative backoff.
const UPLOAD_TIMEOUT_MS = 90_000
const UPLOAD_MAX_ATTEMPTS = 3
const UPLOAD_BACKOFF_MS = 2_000

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label}: timed out after ${Math.round(ms / 1000)}s`)),
      ms,
    )
    p.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      },
    )
  })
}

async function uploadOnce(
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
    // this exact blob is already pinned. Crucially this is also what we
    // hit when a previous attempt did make it through but appeared to
    // fail client-side, so retry-on-timeout is idempotent.
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
 * Upload encrypted bytes to 0G Storage. Returns the root hash (storage
 * pointer) and the chain tx hash (the on-chain submission record).
 *
 * The signer's wallet pays for the upload submission tx. Wraps the SDK
 * call with a per-attempt timeout + bounded retry — a single hung node
 * would otherwise freeze the breed flow indefinitely.
 *
 * `onProgress` (optional) receives a human-readable status string for
 * each retry attempt and each failure, so callers can surface progress
 * in the UI log.
 */
export async function uploadGenome(
  encrypted: Uint8Array,
  signer: JsonRpcSigner,
  onProgress?: (msg: string) => void,
): Promise<UploadResult> {
  let lastErr: Error | null = null
  for (let attempt = 1; attempt <= UPLOAD_MAX_ATTEMPTS; attempt++) {
    if (attempt > 1) {
      onProgress?.(
        `retrying upload (attempt ${attempt}/${UPLOAD_MAX_ATTEMPTS})…`,
      )
    }
    try {
      return await withTimeout(
        uploadOnce(encrypted, signer),
        UPLOAD_TIMEOUT_MS,
        'uploadGenome',
      )
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e))
      const willRetry = attempt < UPLOAD_MAX_ATTEMPTS
      onProgress?.(
        `upload attempt ${attempt}/${UPLOAD_MAX_ATTEMPTS} failed: ${lastErr.message}${
          willRetry ? ' — will retry' : ''
        }`,
      )
      if (willRetry) {
        await sleep(UPLOAD_BACKOFF_MS * attempt) // 2s, then 4s
      }
    }
  }
  throw new Error(
    `uploadGenome: failed after ${UPLOAD_MAX_ATTEMPTS} attempts — ${lastErr?.message ?? 'unknown'}`,
  )
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
 * Pure deterministic recombination. Folds two generations of meiosis into
 * a single breed call so a P × P cross of homozygous founders yields a
 * properly segregating F2 generation in one shot — Mendel's "9:3:3:1"
 * second filial generation, not a uniform F1 hybrid.
 *
 * Algorithm (per child, per locus, twice — once for each haplotype):
 *   1. Sample one allele from parent A's pool          ─┐
 *   2. Sample one allele from parent B's pool          ─┴ → F1 hybrid {a, b}
 *   3. Sample one of those two alleles                  → F2 gamete
 *
 * For F1 = [M,M] × F2-founder = [R,R], step 3 yields M with p=½ and R
 * with p=½ at each haplotype, so child genotype probabilities at the
 * trigger locus are MM ¼, MR ½, RR ¼ — phenotype 3:1 momentum:reversion.
 * Loci segregate independently, giving the canonical 9:3:3:1 over both.
 *
 * Same `seed` + same parents → same children, byte-for-byte, in any
 * implementation — the property that lets us run recombination in plain
 * JS without a TEE.
 *
 * Note: this is intentionally biased for P × P (founder) crosses where
 * skipping a generation is the whole point. For later F2 × F2 → F3
 * breedings the same routine still works, but introduces an extra layer
 * of meiotic shuffling vs textbook single-generation Mendelian sampling.
 * Acceptable for the demo; revisit if breed-of-breed becomes common.
 */

function f2Gamete<T extends Allele>(
  prng: ReturnType<typeof makeSeededPrng>,
  parentAAlleles: readonly T[],
  parentBAlleles: readonly T[],
): T {
  // F1 hybrid intermediate: one allele from each P parent.
  const f1HaplotypeFromA = prng.sampleOne(parentAAlleles)
  const f1HaplotypeFromB = prng.sampleOne(parentBAlleles)
  // Meiosis on the F1 → one of the two haplotypes is passed to the F2 child.
  return prng.sampleOne([f1HaplotypeFromA, f1HaplotypeFromB])
}

// =====================================================================
// Demo guarantee: at least one child per phenotype combo
// =====================================================================
//
// Pure Mendelian sampling produces zero double-recessive children in
// ~57% of 9-child breeds (probability (15/16)^9). Empirically valid
// but bad for a hackathon demo where users expect to see all four
// 9:3:3:1 corners on screen.
//
// Strategy: run the natural F2 sampling for all `count` children, then
// scan for missing phenotype combos. For each missing combo, replace a
// duplicate child slot (i.e. a phenotype that appeared more than once)
// with one constructed to express the missing combo. The natural draw
// is preserved on the ~43% of breeds where it already covers all four
// phenotypes.

type GuaranteedPhenotype = {
  trigger: 'momentum' | 'reversion'
  filter: 'volatility-narrow' | 'volatility-wide'
}

const ALL_PHENOTYPES: readonly GuaranteedPhenotype[] = [
  { trigger: 'momentum', filter: 'volatility-narrow' },
  { trigger: 'momentum', filter: 'volatility-wide' },
  { trigger: 'reversion', filter: 'volatility-narrow' },
  { trigger: 'reversion', filter: 'volatility-wide' },
]

const phenoKey = (g: Genome): string =>
  `${g.trigger.dominance}|${g.filter.dominance}`

/**
 * Produce a haplotype pair that expresses `targetType` at this locus.
 *   - For a *recessive* phenotype, both haplotypes must carry the
 *     recessive allele (otherwise the dominant one would express).
 *   - For a *dominant* phenotype, prefer heterozygous (one matching,
 *     one of the alternative) so the rescued child still shows
 *     genotypic variety on the chromosome viz; fall back to homozygous
 *     dominant if the parent pool doesn't include the alternative.
 *
 * Allele *instances* are sampled from the combined parent pool — same
 * pool the natural f2Gamete draws from — so the rescued child reads as
 * genuinely descended from the founders rather than synthesised.
 */
function buildAllelesForPhenotype<T extends Allele>(
  prng: ReturnType<typeof makeSeededPrng>,
  parentAAlleles: readonly T[],
  parentBAlleles: readonly T[],
  targetType: string,
  isDominant: boolean,
): [T, T] {
  const pool = [...parentAAlleles, ...parentBAlleles]
  const matching = pool.filter((a) => a.type === targetType)
  const other = pool.filter((a) => a.type !== targetType)

  if (matching.length === 0) {
    // Parents don't carry this allele type — can't produce the phenotype.
    // Fall back to natural draw on this locus; calling code accepts that
    // the rescue may not perfectly hit its target.
    return [prng.sampleOne(pool), prng.sampleOne(pool)]
  }
  if (!isDominant || other.length === 0) {
    return [prng.sampleOne(matching), prng.sampleOne(matching)]
  }
  // Heterozygous dominant — keeps two distinct allele types on the child.
  return [prng.sampleOne(matching), prng.sampleOne(other)]
}

function buildChildForPhenotype(
  prng: ReturnType<typeof makeSeededPrng>,
  parentA: Genome,
  parentB: Genome,
  pheno: GuaranteedPhenotype,
  parentATokenId: number,
  parentBTokenId: number,
  createdAt: string,
): Genome {
  const triggerAlleles = buildAllelesForPhenotype(
    prng,
    parentA.trigger.alleles,
    parentB.trigger.alleles,
    pheno.trigger,
    pheno.trigger === DOMINANT_TYPES.trigger,
  )
  const filterAlleles = buildAllelesForPhenotype(
    prng,
    parentA.filter.alleles,
    parentB.filter.alleles,
    pheno.filter,
    pheno.filter === DOMINANT_TYPES.filter,
  )
  return {
    trigger: {
      locusId: 'I',
      alleles: triggerAlleles,
      dominance: pheno.trigger as Genome['trigger']['dominance'],
    },
    filter: {
      locusId: 'II',
      alleles: filterAlleles,
      dominance: pheno.filter as Genome['filter']['dominance'],
    },
    parents: [parentATokenId, parentBTokenId],
    generation: 2,
    createdAt,
  }
}

function buildRandomF2Child(
  prng: ReturnType<typeof makeSeededPrng>,
  parentA: Genome,
  parentB: Genome,
  parentATokenId: number,
  parentBTokenId: number,
  createdAt: string,
): Genome {
  const tx = f2Gamete(prng, parentA.trigger.alleles, parentB.trigger.alleles)
  const ty = f2Gamete(prng, parentA.trigger.alleles, parentB.trigger.alleles)
  const fx = f2Gamete(prng, parentA.filter.alleles, parentB.filter.alleles)
  const fy = f2Gamete(prng, parentA.filter.alleles, parentB.filter.alleles)
  return {
    trigger: {
      locusId: 'I',
      alleles: [tx, ty],
      dominance: pickDominance('trigger', tx, ty) as Genome['trigger']['dominance'],
    },
    filter: {
      locusId: 'II',
      alleles: [fx, fy],
      dominance: pickDominance('filter', fx, fy) as Genome['filter']['dominance'],
    },
    parents: [parentATokenId, parentBTokenId],
    generation: 2,
    createdAt,
  }
}

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

  // Phase 1 — natural F2 sampling for all `count` children.
  const children: Genome[] = []
  for (let i = 0; i < count; i++) {
    children.push(
      buildRandomF2Child(
        prng,
        parentA,
        parentB,
        parentATokenId,
        parentBTokenId,
        createdAt,
      ),
    )
  }

  // Phase 2 — guarantee one-of-each only when the natural draw missed
  // a phenotype. With 4 distinct phenotypes and >=4 children we always
  // have enough "duplicate" slots to cover at most 3 missing combos.
  if (count >= ALL_PHENOTYPES.length) {
    const present = new Set(children.map(phenoKey))
    const missing = ALL_PHENOTYPES.filter(
      (p) => !present.has(`${p.trigger}|${p.filter}`),
    )
    if (missing.length > 0) {
      // Walk children in index order, keeping the first occurrence of
      // each phenotype intact. Subsequent occurrences are eligible for
      // replacement — preserves the leftmost natural draw of each combo.
      const seen = new Set<string>()
      const replaceable: number[] = []
      for (let i = 0; i < children.length; i++) {
        const key = phenoKey(children[i])
        if (seen.has(key)) replaceable.push(i)
        else seen.add(key)
      }
      for (const pheno of missing) {
        const idx = replaceable.shift()
        if (idx === undefined) break
        children[idx] = buildChildForPhenotype(
          prng,
          parentA,
          parentB,
          pheno,
          parentATokenId,
          parentBTokenId,
          createdAt,
        )
      }
    }
  }

  return children
}
