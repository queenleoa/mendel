import {
  AbiCoder,
  Contract,
  ContractFactory,
  concat,
  keccak256,
  solidityPacked,
  toUtf8Bytes,
} from 'ethers'
import type { JsonRpcSigner } from 'ethers'
import MendelAgentArtifact from '../contracts/MendelAgent.json'
import MendelBreederArtifact from '../contracts/MendelBreeder.json'
import {
  blobHash,
  decryptGenome,
  deriveGenomeKey,
  deriveKeyCommitment,
  downloadGenome,
  encryptGenome,
  mendelianRecombine,
  sealKey,
  uploadGenome,
  type Genome,
} from './genome'

// =====================================================================
//                          Address handling
// =====================================================================

const AGENT_KEY = 'mendel.agentAddress'
const BREEDER_KEY = 'mendel.breederAddress'

const isAddress = (v: string | null | undefined): v is string =>
  !!v && v.startsWith('0x') && v.length === 42

function resolveAddress(envValue: string | undefined, storageKey: string) {
  if (isAddress(envValue)) return envValue!
  if (typeof window === 'undefined') return null
  const stored = window.localStorage.getItem(storageKey)
  return isAddress(stored) ? stored : null
}

/** Resolve the MendelAgent address from env or localStorage cache. */
export function getMendelAgentAddress(): string | null {
  return resolveAddress(
    import.meta.env.VITE_MENDEL_AGENT_ADDRESS as string | undefined,
    AGENT_KEY,
  )
}

export function setMendelAgentAddress(address: string): void {
  window.localStorage.setItem(AGENT_KEY, address)
}

export function clearMendelAgentAddress(): void {
  window.localStorage.removeItem(AGENT_KEY)
}

/** Resolve the MendelBreeder address from env or localStorage cache. */
export function getMendelBreederAddress(): string | null {
  return resolveAddress(
    import.meta.env.VITE_MENDEL_BREEDER_ADDRESS as string | undefined,
    BREEDER_KEY,
  )
}

export function setMendelBreederAddress(address: string): void {
  window.localStorage.setItem(BREEDER_KEY, address)
}

export function clearMendelBreederAddress(): void {
  window.localStorage.removeItem(BREEDER_KEY)
}

// =====================================================================
//                          Contract factory
// =====================================================================

/**
 * Deploy a fresh MendelAgent contract from the connected wallet. Caches
 * the resulting address in localStorage so subsequent page loads find it.
 */
export async function deployMendelAgent(
  signer: JsonRpcSigner,
): Promise<{ address: string; txHash: string }> {
  const owner = await signer.getAddress()
  const factory = new ContractFactory(
    MendelAgentArtifact.abi,
    MendelAgentArtifact.bytecode,
    signer,
  )
  const contract = await factory.deploy(owner)
  const tx = contract.deploymentTransaction()
  await contract.waitForDeployment()
  const address = await contract.getAddress()
  setMendelAgentAddress(address)
  return { address, txHash: tx?.hash ?? '' }
}

/** Build an ethers Contract bound to the resolved MendelAgent address. */
export function getMendelAgent(signer: JsonRpcSigner): Contract {
  const address = getMendelAgentAddress()
  if (!address) {
    throw new Error(
      'MendelAgent address not configured. Deploy from the Mint tab or set VITE_MENDEL_AGENT_ADDRESS.',
    )
  }
  return new Contract(address, MendelAgentArtifact.abi, signer)
}

/**
 * Deploy MendelBreeder against an existing MendelAgent and wire it up via
 * `agent.setBreeder()`. The signer must be the agent's Ownable owner.
 */
export async function deployMendelBreeder(
  signer: JsonRpcSigner,
): Promise<{
  breederAddress: string
  deployTxHash: string
  setBreederTxHash: string
}> {
  const agentAddress = getMendelAgentAddress()
  if (!agentAddress) {
    throw new Error('Deploy MendelAgent first.')
  }

  const factory = new ContractFactory(
    MendelBreederArtifact.abi,
    MendelBreederArtifact.bytecode,
    signer,
  )
  const contract = await factory.deploy(agentAddress)
  const deployTx = contract.deploymentTransaction()
  await contract.waitForDeployment()
  const breederAddress = await contract.getAddress()

  const agent = new Contract(agentAddress, MendelAgentArtifact.abi, signer)
  const setTx = await agent.setBreeder(breederAddress)
  await setTx.wait()

  setMendelBreederAddress(breederAddress)

  return {
    breederAddress,
    deployTxHash: deployTx?.hash ?? '',
    setBreederTxHash: setTx.hash,
  }
}

/** Build an ethers Contract bound to the resolved MendelBreeder address. */
export function getMendelBreeder(signer: JsonRpcSigner): Contract {
  const address = getMendelBreederAddress()
  if (!address) {
    throw new Error(
      'MendelBreeder address not configured. Deploy from the Mint tab or set VITE_MENDEL_BREEDER_ADDRESS.',
    )
  }
  return new Contract(address, MendelBreederArtifact.abi, signer)
}

/** Read the agent's currently-authorized breeder. */
export async function readAgentBreederLink(
  signer: JsonRpcSigner,
): Promise<string> {
  const agent = getMendelAgent(signer)
  return (await agent.breeder()) as string
}

// =====================================================================
//                          Breed: request
// =====================================================================

export type RequestBreedingResult = {
  requestId: number
  seed: string
  txHash: string
}

export async function requestBreeding(
  parentATokenId: number,
  parentBTokenId: number,
  signer: JsonRpcSigner,
): Promise<RequestBreedingResult> {
  const breeder = getMendelBreeder(signer)
  const owner = await signer.getAddress()
  // authHash is an opaque commitment; not validated on-chain in v1.
  const authHash = keccak256(
    solidityPacked(
      ['address', 'uint256', 'uint256', 'uint256'],
      [owner, parentATokenId, parentBTokenId, BigInt(Date.now())],
    ),
  )
  const tx = await breeder.breed(parentATokenId, parentBTokenId, authHash)
  const receipt = await tx.wait()
  if (!receipt) throw new Error('requestBreeding: tx not mined')

  let requestId = 0
  let seed = ''
  for (const log of receipt.logs as readonly { topics: string[]; data: string }[]) {
    try {
      const parsed = breeder.interface.parseLog({
        topics: [...log.topics],
        data: log.data,
      })
      if (parsed?.name === 'BreedingRequested') {
        requestId = Number(parsed.args.requestId)
        seed = parsed.args.seed as string
        break
      }
    } catch {
      // not the breeder event we want; skip
    }
  }
  if (!requestId || !seed) {
    throw new Error('requestBreeding: BreedingRequested event not found')
  }
  return { requestId, seed, txHash: tx.hash }
}

// =====================================================================
//                          Breed: fulfill
// =====================================================================

export type ChildPayload = {
  encryptedURI: string
  blobHash: string
  metadataHash: string
  keyCommitment: string
}

export type FulfillBreedingResult = {
  childTokenIds: number[]
  txHash: string
}

/**
 * Build the EIP-712 typed data, sign with the user's wallet, and submit
 * `fulfillBreeding`. Hash construction must mirror the Solidity:
 *
 *   encryptedURIsHash    = keccak256(abi.encode(string[] uris))
 *   blobHashesHash       = keccak256(abi.encodePacked(bytes32[] blobs))
 *   metadataHashesHash   = keccak256(abi.encodePacked(bytes32[] metas))
 *   keyCommitmentsHash   = keccak256(abi.encodePacked(bytes32[] keys))
 */
export async function fulfillBreedingTx(
  requestId: number,
  children: ChildPayload[],
  signer: JsonRpcSigner,
): Promise<FulfillBreedingResult> {
  const breeder = getMendelBreeder(signer)
  const breederAddress = await breeder.getAddress()

  const network = await signer.provider.getNetwork()
  const chainId = Number(network.chainId)

  const uris = children.map((c) => c.encryptedURI)
  const blobs = children.map((c) => c.blobHash)
  const metas = children.map((c) => c.metadataHash)
  const keys = children.map((c) => c.keyCommitment)

  const abi = AbiCoder.defaultAbiCoder()
  const encryptedURIsHash = keccak256(abi.encode(['string[]'], [uris]))
  const blobHashesHash = keccak256(concat(blobs))
  const metadataHashesHash = keccak256(concat(metas))
  const keyCommitmentsHash = keccak256(concat(keys))

  const domain = {
    name: 'Mendel',
    version: '1',
    chainId,
    verifyingContract: breederAddress,
  }
  const types = {
    BreedingFulfillment: [
      { name: 'requestId', type: 'uint256' },
      { name: 'encryptedURIsHash', type: 'bytes32' },
      { name: 'blobHashesHash', type: 'bytes32' },
      { name: 'metadataHashesHash', type: 'bytes32' },
      { name: 'keyCommitmentsHash', type: 'bytes32' },
    ],
  }
  const value = {
    requestId: BigInt(requestId),
    encryptedURIsHash,
    blobHashesHash,
    metadataHashesHash,
    keyCommitmentsHash,
  }

  const signature = await signer.signTypedData(domain, types, value)

  const tx = await breeder.fulfillBreeding(
    requestId,
    uris,
    blobs,
    metas,
    keys,
    signature,
  )
  const receipt = await tx.wait()
  if (!receipt) throw new Error('fulfillBreeding: tx not mined')

  let childTokenIds: number[] = []
  for (const log of receipt.logs as readonly { topics: string[]; data: string }[]) {
    try {
      const parsed = breeder.interface.parseLog({
        topics: [...log.topics],
        data: log.data,
      })
      if (parsed?.name === 'BreedingFulfilled') {
        const ids = parsed.args.childTokenIds as bigint[]
        childTokenIds = ids.map((b) => Number(b))
        break
      }
    } catch {
      // skip unknown logs
    }
  }
  if (childTokenIds.length === 0) {
    throw new Error('fulfillBreeding: BreedingFulfilled event not found')
  }
  return { childTokenIds, txHash: tx.hash }
}

// =====================================================================
//                          Breed: orchestrator
// =====================================================================

export type ChildResult = {
  tokenId: number
  predictedTokenId: number
  genome: Genome
  encryptedURI: string
  rootHash: string
  blobHash: string
  metadataHash: string
  keyCommitment: string
  uploadTxHash: string
}

export type BreedFlowResult = {
  requestId: number
  seed: string
  requestTxHash: string
  fulfillTxHash: string
  parentAGenome: Genome
  parentBGenome: Genome
  children: ChildResult[]
}

export type BreedFlowEvent =
  | { type: 'log'; message: string }
  | {
      type: 'parents-decrypted'
      parentAGenome: Genome
      parentBGenome: Genome
    }
  | {
      type: 'request-registered'
      requestId: number
      seed: string
      txHash: string
    }
  | { type: 'recombined'; childGenomes: Genome[] }
  | { type: 'child-uploaded'; index: number; child: ChildResult }
  | { type: 'fulfilled'; childTokenIds: number[]; txHash: string }

export type BreedFlowEmit = (event: BreedFlowEvent) => void

/**
 * Full client-side breeding flow. No oracle, no TEE. Orchestrates:
 *   a. Decrypt both parent genomes locally.
 *   b. Submit breed() to register a request and obtain the on-chain seed.
 *   c. Sample 9 children deterministically from (genomeA, genomeB, seed).
 *   d. Encrypt + upload each child to 0G Storage. Token-id-bound encryption
 *      keys are derived using a pre-mint prediction (totalMinted + i + 1).
 *   e. Sign the EIP-712 BreedingFulfillment over the children's hashes
 *      and submit fulfillBreeding(); the breeder mints all 9 children.
 *   f. Return the full result with confirmed tokenIds.
 */
export async function breedFlow(
  parentATokenId: number,
  parentBTokenId: number,
  signer: JsonRpcSigner,
  emit: BreedFlowEmit = () => {},
): Promise<BreedFlowResult> {
  const owner = await signer.getAddress()
  const log = (message: string) => emit({ type: 'log', message })

  // ---- a. Decrypt parents ------------------------------------------------
  log(`Reading parents #${parentATokenId} and #${parentBTokenId} from chain…`)
  const [snapA, snapB] = await Promise.all([
    readTokenFromChain(parentATokenId, signer),
    readTokenFromChain(parentBTokenId, signer),
  ])

  log('Downloading parent genomes from 0G Storage…')
  const [blobA, blobB] = await Promise.all([
    downloadGenome(parseRootHashFromUri(snapA.encryptedURI)),
    downloadGenome(parseRootHashFromUri(snapB.encryptedURI)),
  ])

  log(`Deriving genome keys for both parents (sign in MetaMask if not cached)…`)
  const keyA = await deriveGenomeKey(signer, parentATokenId)
  const keyB = await deriveGenomeKey(signer, parentBTokenId)

  log('Decrypting parent genomes…')
  const [genomeA, genomeB] = await Promise.all([
    decryptGenome(blobA, keyA),
    decryptGenome(blobB, keyB),
  ])
  log('Parents decrypted. ✓')
  emit({ type: 'parents-decrypted', parentAGenome: genomeA, parentBGenome: genomeB })

  // ---- b. Request breeding ----------------------------------------------
  log('Submitting breed() request (approve in MetaMask)…')
  const { requestId, seed, txHash: requestTxHash } = await requestBreeding(
    parentATokenId,
    parentBTokenId,
    signer,
  )
  log(`Request #${requestId} registered. seed=${seed.slice(0, 14)}…`)
  emit({ type: 'request-registered', requestId, seed, txHash: requestTxHash })

  // ---- c. Recombine in JS -----------------------------------------------
  log('Recombining alleles in browser (deterministic from seed)…')
  const childGenomes = mendelianRecombine(
    genomeA,
    genomeB,
    parentATokenId,
    parentBTokenId,
    seed,
    9,
  )
  emit({ type: 'recombined', childGenomes })

  // ---- d. Predict tokenIds, encrypt, upload -----------------------------
  const agent = getMendelAgent(signer)
  const totalBefore = Number((await agent.totalMinted()) as bigint)
  const predictedIds = childGenomes.map((_, i) => totalBefore + i + 1)
  log(
    `Predicted child tokenIds: #${predictedIds[0]}–#${predictedIds[predictedIds.length - 1]}`,
  )

  const childPayloads: ChildResult[] = []
  for (let i = 0; i < childGenomes.length; i++) {
    const predictedId = predictedIds[i]
    log(`Child ${i + 1}/9 → deriving key for predicted tokenId #${predictedId}…`)
    const childKey = await deriveGenomeKey(signer, predictedId)

    const encrypted = await encryptGenome(childGenomes[i], childKey)
    const childBlobH = blobHash(encrypted)
    const sealed = sealKey(childKey, owner)
    const childMetaH = keccak256(sealed)
    const childKeyCommit = deriveKeyCommitment(owner, predictedId)

    log(`Child ${i + 1}/9 → uploading to 0G Storage (approve in MetaMask)…`)
    const upload = await uploadGenome(encrypted, signer)

    const child: ChildResult = {
      tokenId: 0, // filled in after fulfill
      predictedTokenId: predictedId,
      genome: childGenomes[i],
      encryptedURI: `0g://${upload.rootHash}`,
      rootHash: upload.rootHash,
      blobHash: childBlobH,
      metadataHash: childMetaH,
      keyCommitment: childKeyCommit,
      uploadTxHash: upload.txHash,
    }
    childPayloads.push(child)
    emit({ type: 'child-uploaded', index: i, child })
  }

  // ---- e. Fulfill -------------------------------------------------------
  log(
    'Signing EIP-712 BreedingFulfillment + submitting fulfillBreeding (approve in MetaMask)…',
  )
  const { childTokenIds, txHash: fulfillTxHash } = await fulfillBreedingTx(
    requestId,
    childPayloads.map((c) => ({
      encryptedURI: c.encryptedURI,
      blobHash: c.blobHash,
      metadataHash: c.metadataHash,
      keyCommitment: c.keyCommitment,
    })),
    signer,
  )

  // ---- f. Match actual ids back to genotypes ----------------------------
  for (let i = 0; i < childPayloads.length; i++) {
    childPayloads[i].tokenId = childTokenIds[i]
    if (childTokenIds[i] !== childPayloads[i].predictedTokenId) {
      log(
        `WARN: child ${i + 1} predicted #${childPayloads[i].predictedTokenId} but contract assigned #${childTokenIds[i]}. Decryption will fail for this token.`,
      )
    }
  }
  log(`Minted ${childTokenIds.length} children. ✓`)
  emit({ type: 'fulfilled', childTokenIds, txHash: fulfillTxHash })

  return {
    requestId,
    seed,
    requestTxHash,
    fulfillTxHash,
    parentAGenome: genomeA,
    parentBGenome: genomeB,
    children: childPayloads,
  }
}

/**
 * Re-derive a child's encryption key by its actual on-chain tokenId,
 * download the ciphertext, and decrypt. The most important post-flight
 * check: it confirms the (predicted == actual) assumption held and that
 * the key/commitment/seal logic is consistent end-to-end.
 *
 * Uses the per-session key cache from genome.ts, so for tokenIds the
 * caller has already derived during the breed flow this is popup-free.
 */
export async function verifyChildDecryption(
  child: ChildResult,
  signer: JsonRpcSigner,
): Promise<{ ok: true; decoded: Genome } | { ok: false; error: string }> {
  try {
    const encrypted = await downloadGenome(child.rootHash)
    const key = await deriveGenomeKey(signer, child.tokenId)
    const decoded = await decryptGenome(encrypted, key)
    return { ok: true, decoded }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    }
  }
}

// =====================================================================
//                          Lineage hashing
// =====================================================================

export type LineageParams = {
  asset: string
  venue: string
  barInterval: string
  hasGrid: boolean
  loci: string[]
}

export function computeLineageHash(params: LineageParams): string {
  return keccak256(toUtf8Bytes(JSON.stringify(params)))
}

// =====================================================================
//                          Mint flow
// =====================================================================

export type MintFounderResult = {
  tokenId: number
  predictedTokenId: number
  txHash: string
  encryptedURI: string
  metadataHash: string
  blobHash: string
  keyCommitment: string
  lineageHash: string
  rootHash: string
  uploadTxHash: string
}

export type MintFounderOnStatus = (msg: string) => void

/**
 * Encrypt + upload + mint a founder iNFT. Returns every commitment value
 * that was written on-chain so the UI can echo them back.
 *
 * Note: we predict tokenId = totalMinted + 1 to derive the encryption
 * key BEFORE the mint tx lands. On a fresh contract with serial mints
 * this always matches; for v2 with concurrent mints we'd want a
 * commit-reveal.
 */
export async function mintFounder(
  genome: Genome,
  lineageParams: LineageParams,
  signer: JsonRpcSigner,
  onStatus: MintFounderOnStatus = () => {},
): Promise<MintFounderResult> {
  const agent = getMendelAgent(signer)
  const ownerAddress = await signer.getAddress()

  onStatus('Predicting tokenId from totalMinted()…')
  const totalMintedBig = (await agent.totalMinted()) as bigint
  const predictedTokenId = Number(totalMintedBig) + 1

  onStatus(`Deriving genome key for tokenId ${predictedTokenId} (sign in MetaMask)…`)
  const rawKey = await deriveGenomeKey(signer, predictedTokenId)

  onStatus('Encrypting genome (AES-256-GCM)…')
  const encrypted = await encryptGenome(genome, rawKey)

  const blobH = blobHash(encrypted)
  const sealed = sealKey(rawKey, ownerAddress)
  const metadataH = keccak256(sealed)
  const keyCommitmentH = deriveKeyCommitment(ownerAddress, predictedTokenId)
  const lineageH = computeLineageHash(lineageParams)

  onStatus('Uploading ciphertext to 0G Storage (approve in MetaMask)…')
  const upload = await uploadGenome(encrypted, signer)
  const encryptedURI = `0g://${upload.rootHash}`

  onStatus('Calling MendelAgent.mintFounder() (approve in MetaMask)…')
  const tx = await agent.mintFounder(
    ownerAddress,
    encryptedURI,
    metadataH,
    blobH,
    keyCommitmentH,
    lineageH,
  )

  onStatus(`Waiting for receipt of ${tx.hash.slice(0, 10)}…`)
  const receipt = await tx.wait()
  if (!receipt) throw new Error('mintFounder: transaction was not mined')

  // Parse FounderMinted event for the actual tokenId.
  let actualTokenId = predictedTokenId
  for (const log of receipt.logs as readonly { topics: string[]; data: string }[]) {
    try {
      const parsed = agent.interface.parseLog({
        topics: [...log.topics],
        data: log.data,
      })
      if (parsed?.name === 'FounderMinted') {
        actualTokenId = Number(parsed.args[0])
        break
      }
    } catch {
      // not our event; ignore
    }
  }

  if (actualTokenId !== predictedTokenId) {
    // Key was derived for the wrong tokenId. The user can still decrypt
    // via the cached key in genome.ts (keyed by tokenId 999 or whatever
    // we predicted), but on a fresh load they wouldn't be able to.
    onStatus(
      `WARN: predicted tokenId ${predictedTokenId} but contract emitted ${actualTokenId}. ` +
        `Re-encryption pass not implemented in v1.`,
    )
  } else {
    onStatus('Done.')
  }

  return {
    tokenId: actualTokenId,
    predictedTokenId,
    txHash: tx.hash,
    encryptedURI,
    metadataHash: metadataH,
    blobHash: blobH,
    keyCommitment: keyCommitmentH,
    lineageHash: lineageH,
    rootHash: upload.rootHash,
    uploadTxHash: upload.txHash,
  }
}

// =====================================================================
//                          Read-back for verification
// =====================================================================

export type OnChainTokenSnapshot = {
  encryptedURI: string
  metadataHash: string
  blobHash: string
  keyCommitment: string
  lineageHash: string
  generation: number
  parentA: number
  parentB: number
  owner: string
}

export function parseRootHashFromUri(uri: string): string {
  if (uri.startsWith('0g://')) return uri.slice('0g://'.length)
  return uri
}

export async function readTokenFromChain(
  tokenId: number,
  signer: JsonRpcSigner,
): Promise<OnChainTokenSnapshot> {
  const agent = getMendelAgent(signer)
  const [
    encryptedURI,
    metadataHash,
    blobH,
    keyCommitment,
    lineageHash,
    generation,
    parentsTuple,
    owner,
  ] = await Promise.all([
    agent.encryptedURIs(tokenId) as Promise<string>,
    agent.metadataHashes(tokenId) as Promise<string>,
    agent.blobHashes(tokenId) as Promise<string>,
    agent.keyCommitments(tokenId) as Promise<string>,
    agent.lineageHash(tokenId) as Promise<string>,
    agent.generation(tokenId) as Promise<bigint>,
    agent.parents(tokenId) as Promise<[bigint, bigint]>,
    agent.ownerOf(tokenId) as Promise<string>,
  ])
  return {
    encryptedURI,
    metadataHash,
    blobHash: blobH,
    keyCommitment,
    lineageHash,
    generation: Number(generation),
    parentA: Number(parentsTuple[0]),
    parentB: Number(parentsTuple[1]),
    owner,
  }
}
