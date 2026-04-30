import {
  Contract,
  ContractFactory,
  keccak256,
  toUtf8Bytes,
} from 'ethers'
import type { JsonRpcSigner } from 'ethers'
import MendelAgentArtifact from '../contracts/MendelAgent.json'
import {
  blobHash,
  deriveGenomeKey,
  deriveKeyCommitment,
  encryptGenome,
  sealKey,
  uploadGenome,
  type Genome,
} from './genome'

// =====================================================================
//                          Address handling
// =====================================================================

const LOCAL_STORAGE_KEY = 'mendel.agentAddress'

/** Resolve the MendelAgent address from env or localStorage cache. */
export function getMendelAgentAddress(): string | null {
  const fromEnv = import.meta.env.VITE_MENDEL_AGENT_ADDRESS as
    | string
    | undefined
  if (fromEnv && fromEnv.startsWith('0x') && fromEnv.length === 42) {
    return fromEnv
  }
  const fromStorage =
    typeof window !== 'undefined'
      ? window.localStorage.getItem(LOCAL_STORAGE_KEY)
      : null
  if (fromStorage && fromStorage.startsWith('0x') && fromStorage.length === 42) {
    return fromStorage
  }
  return null
}

export function setMendelAgentAddress(address: string): void {
  window.localStorage.setItem(LOCAL_STORAGE_KEY, address)
}

export function clearMendelAgentAddress(): void {
  window.localStorage.removeItem(LOCAL_STORAGE_KEY)
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
