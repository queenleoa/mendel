import { BrowserProvider, formatEther, parseEther } from 'ethers'
import type { JsonRpcSigner } from 'ethers'
import type { Account, Chain, Transport, WalletClient } from 'viem'
import { createZGComputeNetworkBroker } from '@0glabs/0g-serving-broker'

export type StatusCallback = (msg: string) => void

export type InferenceResult = {
  answer: string
  model: string
  providerAddress: string
}

const ZERO_G_GALILEO_CHAIN_ID = 16602n
// 0G testnet RPC sometimes hands MetaMask a near-zero gas estimate, leaving
// txs stuck in the mempool with no priority. Pin a generous explicit price.
// Units: neuron (= wei). 50 gwei = 50_000_000_000.
const TX_GAS_PRICE = 50_000_000_000

const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`

/**
 * Convert a wagmi v2 walletClient (viem) into an ethers v6 JsonRpcSigner.
 * This routes signing through the wagmi-managed connector (MetaMask in our
 * config) instead of `window.ethereum`, so the user's already-connected
 * wallet is the one used.
 */
export async function walletClientToSigner(
  walletClient: WalletClient<Transport, Chain, Account>,
): Promise<JsonRpcSigner> {
  const { account, chain, transport } = walletClient
  const network = {
    chainId: chain.id,
    name: chain.name,
  }
  const provider = new BrowserProvider(transport as never, network)
  return provider.getSigner(account.address)
}

export async function runInference(
  question: string,
  signer: JsonRpcSigner,
  onStatus: StatusCallback,
): Promise<InferenceResult> {
  onStatus('Verifying network…')
  const network = await signer.provider.getNetwork()
  if (network.chainId !== ZERO_G_GALILEO_CHAIN_ID) {
    throw new Error(
      `Wallet is on chain ${network.chainId}, expected ${ZERO_G_GALILEO_CHAIN_ID} (0G Galileo Testnet). ` +
        `In MetaMask: open Settings → Networks, delete any old "0G Galileo" entry, then reconnect from this app.`,
    )
  }

  onStatus('Initializing 0G compute broker…')
  const broker = await createZGComputeNetworkBroker(signer as never)

  onStatus('Discovering chatbot providers…')
  const services = await broker.inference.listService()
  const chatbots = (services as unknown as unknown[][]).filter(
    (s) => s[1] === 'chatbot',
  )
  if (chatbots.length === 0) {
    throw new Error('No chatbot providers available on 0G right now')
  }
  // Prefer TEE-verified providers when available.
  const selected = chatbots.find((s) => s[10] === true) ?? chatbots[0]
  const providerAddress = selected[0] as string
  const model = selected[6] as string
  onStatus(`Using provider ${shortAddr(providerAddress)} (${model})…`)

  onStatus('Checking compute ledger balance…')
  let ledgerAvailable = 0
  let ledgerExists = false
  try {
    const account = await broker.ledger.getLedger()
    ledgerAvailable = parseFloat(formatEther(account[2] as bigint))
    ledgerExists = true
  } catch {
    ledgerExists = false
  }

  if (!ledgerExists) {
    onStatus('Creating 0G compute ledger with 3 OG (one-time, approve in MetaMask)…')
    const ledgerApi = broker.ledger as unknown as {
      addLedger?: (n: number, gasPrice?: number) => Promise<unknown>
    }
    if (ledgerApi.addLedger) {
      await ledgerApi.addLedger(3, TX_GAS_PRICE)
    } else {
      await broker.ledger.depositFund(3, TX_GAS_PRICE)
    }
  } else {
    onStatus(`Ledger already exists (available: ${ledgerAvailable.toFixed(4)} OG) — skipping creation.`)
    if (ledgerAvailable < 0.5) {
      onStatus('Topping up ledger with 1 OG (approve in MetaMask)…')
      await broker.ledger.depositFund(1, TX_GAS_PRICE)
    }
  }

  onStatus('Checking provider sub-account…')
  let subBalance = 0
  let subExists = false
  try {
    const sub = (await broker.inference.getAccount(
      providerAddress,
    )) as unknown as { balance?: bigint } & bigint[]
    const rawBalance = sub[2] ?? sub.balance ?? 0n
    subBalance = parseFloat(formatEther(rawBalance as bigint))
    subExists = true
  } catch {
    subExists = false
  }

  if (!subExists || subBalance < 0.1) {
    onStatus(
      subExists
        ? `Sub-account low (${subBalance.toFixed(4)} OG) — topping up 1 OG…`
        : 'Funding provider sub-account with 1 OG (one-time, approve in MetaMask)…',
    )
    await broker.ledger.transferFund(
      providerAddress,
      'inference',
      parseEther('1'),
      TX_GAS_PRICE,
    )
  } else {
    onStatus(`Sub-account already funded (${subBalance.toFixed(4)} OG) — skipping transfer.`)
  }

  onStatus('Checking provider acknowledgement…')
  let isAcked = false
  try {
    isAcked = await broker.inference.acknowledged(providerAddress)
  } catch (err) {
    console.warn('acknowledged() check failed:', err)
  }

  if (!isAcked) {
    onStatus('Acknowledging provider (one-time, approve in MetaMask)…')
    try {
      await broker.inference.acknowledgeProviderSigner(
        providerAddress,
        TX_GAS_PRICE,
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (!/already|acknowledged/i.test(msg)) throw err
    }
  } else {
    onStatus('Provider already acknowledged — skipping.')
  }

  onStatus('Fetching service metadata…')
  const { endpoint, model: serviceModel } =
    await broker.inference.getServiceMetadata(providerAddress)

  onStatus('Generating signed request headers…')
  const headers = await broker.inference.getRequestHeaders(providerAddress)

  onStatus('Calling 0G inference endpoint…')
  const messages = [{ role: 'user', content: question }]
  const res = await fetch(`${endpoint}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(headers as unknown as Record<string, string>),
    },
    body: JSON.stringify({ messages, model: serviceModel }),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Inference HTTP ${res.status}: ${text.slice(0, 300)}`)
  }

  const data = await res.json()
  const answer: string =
    data?.choices?.[0]?.message?.content ?? '(empty response)'

  onStatus('Settling fees on 0G chain…')
  let chatID =
    res.headers.get('ZG-Res-Key') || res.headers.get('zg-res-key') || data?.id
  await broker.inference.processResponse(
    providerAddress,
    chatID ?? undefined,
    JSON.stringify(data?.usage ?? {}),
  )

  onStatus('Done.')
  return { answer, model: serviceModel, providerAddress }
}
