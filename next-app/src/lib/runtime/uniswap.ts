// Server-side Uniswap executor on Base Sepolia.
//
// Two swap paths, tried in order:
//
//   1. Direct router  — call SwapRouter02.exactInputSingle on the
//      0.3 % USDC/WETH pool we know has liquidity. Demo-reliable on
//      Base Sepolia where Trading-API testnet routing is sparse.
//
//   2. Uniswap Trading API — POST /v1/quote → optional Permit2 EIP-712
//      sign → POST /v1/swap → broadcast. Gives smart routing across
//      V2/V3/V4 + UniswapX on mainnet; on Base Sepolia it usually 404s
//      with "No quotes available" because the routing indexer doesn't
//      know about the testnet pool. Kept as a fallback so the same
//      code runs on mainnet without a rewrite.
//
// Sizing: $10 USDC per leg by default (override TRADE_SIZE_USDC, or
// TRADE_SIZE_ETH for legacy ETH-fixed sizing). Pool prices on Base
// Sepolia diverge wildly from mainnet (sparse liquidity), so PnL
// accounting always runs against the Binance reference price the
// caller passes in — the on-chain swap is proof-of-action, not the
// price source.
//
// On any failure of *both* paths (no liquidity, balance shortfall, RPC
// blip, slippage breach, API down) we return `{ isPaper: true }` and
// the caller paper-trades against the Binance ref. Demo-safe: a flaky
// pool or API can't break the position state machine.

import 'server-only'

import {
  Contract,
  JsonRpcProvider,
  MaxUint256,
  Wallet,
  formatUnits,
  parseEther,
  parseUnits,
} from 'ethers'

// =====================================================================
//                              Constants
// =====================================================================

// Direct router path
const SWAP_ROUTER_02 = '0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4'
const QUOTER_V2 = '0xC5290058841028F1614F3A6F0F5816cAd0df5E27'

// Trading API path
const UNISWAP_API_BASE = 'https://trade-api.gateway.uniswap.org/v1'
// Permit2 — canonical singleton, same address on every chain. The
// Trading API spends ERC20s through it.
const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3'

const WETH = '0x4200000000000000000000000000000000000006'

// USDC test token on Base Sepolia (Circle's official test address). The
// only USDC variant we found with a real Uniswap V3 pool. Override with
// USDC_BASE_SEPOLIA if a future deployment uses a different address.
const USDC =
  process.env.USDC_BASE_SEPOLIA ??
  '0x036CbD53842c5426634e7929541eC2318f3dCF7e'

const POOL_FEE = Number(process.env.UNISWAP_POOL_FEE ?? 3000)
const BASE_SEPOLIA_CHAIN_ID = 84532

// 5 % slippage tolerance versus Uniswap's *own* quote — not against
// Binance. The pool's price relative to mainnet is its own concern;
// what we guard against is the pool moving between our quote and our
// swap (which is the actual definition of slippage).
const SLIPPAGE_BPS = 500
// Trading API takes percent (0–100), not bps. Same number, different unit.
const SLIPPAGE_PCT = 5

// Trade size — preferred unit is USDC notional, since on Base Sepolia
// the USDC test faucet is the scarce side (10 USDC per claim) while ETH
// faucets are generous. Default $10 per leg → 4-5 round-trip cycles
// from a single 50 USDC claim.
//
// Env precedence: TRADE_SIZE_USDC takes priority. TRADE_SIZE_ETH is
// honored only when USDC isn't set (legacy / advanced override).
const TRADE_SIZE_USDC_ENV = process.env.TRADE_SIZE_USDC
const TRADE_SIZE_ETH_ENV = process.env.TRADE_SIZE_ETH
const DEFAULT_TRADE_SIZE_USDC = 10

const BASE_SEPOLIA_RPC =
  process.env.BASE_SEPOLIA_RPC ?? 'https://sepolia.base.org'

/**
 * Return the trade size for an `open_long` leg, expressed both as the
 * USDC amount we'll spend (driven by env or default $10) and the
 * implied ETH size at the current Binance reference price. Position
 * tracking uses the ETH side so the state machine stays
 * price-invariant; the USDC side controls actual swap input.
 */
function getOpenLongSize(binancePrice: number): {
  ethSize: number
  usdcAmount: bigint
} {
  let usdcNotional: number
  if (TRADE_SIZE_USDC_ENV) {
    usdcNotional = Number(TRADE_SIZE_USDC_ENV)
  } else if (TRADE_SIZE_ETH_ENV) {
    const ethFixed = Number(TRADE_SIZE_ETH_ENV)
    usdcNotional = ethFixed * binancePrice
  } else {
    usdcNotional = DEFAULT_TRADE_SIZE_USDC
  }
  const ethSize = binancePrice > 0 ? usdcNotional / binancePrice : 0
  return {
    ethSize,
    usdcAmount: parseUnits(usdcNotional.toFixed(6), 6),
  }
}

// =====================================================================
//                              ABIs (minimal)
// =====================================================================

const QUOTER_ABI = [
  'function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)',
] as const

const ROUTER_ABI = [
  'function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) external payable returns (uint256 amountOut)',
] as const

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
] as const

// =====================================================================
//                       Wallet + approval caches
// =====================================================================

let cachedWallet: Wallet | null = null

function getWallet(): Wallet {
  if (cachedWallet) return cachedWallet
  const pk = process.env.AGENT_PRIVATE_KEY
  if (!pk) throw new Error('AGENT_PRIVATE_KEY not set')
  const provider = new JsonRpcProvider(BASE_SEPOLIA_RPC)
  cachedWallet = new Wallet(pk, provider)
  return cachedWallet
}

// Two separate caches — the direct path approves SwapRouter02; the
// Trading API path approves Permit2. Tracked independently so we don't
// re-approve a spender that's already been topped up this server life.
const approvedRouter = new Set<string>()
const approvedPermit2 = new Set<string>()

async function ensureApproval(
  tokenAddr: string,
  spender: string,
  cache: Set<string>,
): Promise<void> {
  if (cache.has(tokenAddr.toLowerCase())) return
  const wallet = getWallet()
  const token = new Contract(tokenAddr, ERC20_ABI, wallet)
  const current: bigint = await token.allowance(wallet.address, spender)
  if (current >= parseEther('1000000')) {
    cache.add(tokenAddr.toLowerCase())
    return
  }
  const tx = await token.approve(spender, MaxUint256)
  await tx.wait()
  cache.add(tokenAddr.toLowerCase())
}

// =====================================================================
//                         Path 1: Direct router
// =====================================================================

type SwapResult = { txHash: string; amountOutRaw: bigint }

async function directRouterSwap(
  tokenIn: string,
  tokenOut: string,
  amountInRaw: bigint,
): Promise<SwapResult> {
  const wallet = getWallet()
  const quoter = new Contract(QUOTER_V2, QUOTER_ABI, wallet.provider!)
  const [quotedOut] = (await quoter.quoteExactInputSingle.staticCall({
    tokenIn,
    tokenOut,
    amountIn: amountInRaw,
    fee: POOL_FEE,
    sqrtPriceLimitX96: 0,
  })) as [bigint, bigint, number, bigint]
  if (quotedOut === 0n) {
    throw new Error('pool returned 0 — no liquidity')
  }

  await ensureApproval(tokenIn, SWAP_ROUTER_02, approvedRouter)
  const router = new Contract(SWAP_ROUTER_02, ROUTER_ABI, wallet)
  const minOut = (quotedOut * BigInt(10_000 - SLIPPAGE_BPS)) / 10_000n
  const tx = await router.exactInputSingle({
    tokenIn,
    tokenOut,
    fee: POOL_FEE,
    recipient: wallet.address,
    amountIn: amountInRaw,
    amountOutMinimum: minOut,
    sqrtPriceLimitX96: 0,
  })
  await tx.wait()
  return { txHash: tx.hash, amountOutRaw: quotedOut }
}

// =====================================================================
//                       Path 2: Uniswap Trading API
// =====================================================================
//
// Tried as a fallback when the direct router path errors. On Base
// Sepolia this usually 404s ("No quotes available") because the
// Trading API's routing indexer doesn't track our testnet pool — but
// the same code is what would carry a mainnet deploy, so it's worth
// keeping wired up. If UNISWAP_API_KEY is unset, this path is skipped.

async function tradingApiSwap(
  tokenIn: string,
  tokenOut: string,
  amountInRaw: bigint,
): Promise<SwapResult> {
  const apiKey = process.env.UNISWAP_API_KEY
  if (!apiKey) throw new Error('UNISWAP_API_KEY not set — Trading API path skipped')
  const wallet = getWallet()

  // ----- /quote -----
  const quoteRes = await fetch(`${UNISWAP_API_BASE}/quote`, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      type: 'EXACT_INPUT',
      tokenIn,
      tokenOut,
      tokenInChainId: BASE_SEPOLIA_CHAIN_ID,
      tokenOutChainId: BASE_SEPOLIA_CHAIN_ID,
      amount: amountInRaw.toString(),
      swapper: wallet.address,
      slippageTolerance: SLIPPAGE_PCT,
    }),
  })
  if (!quoteRes.ok) {
    const text = await quoteRes.text().catch(() => '')
    throw new Error(`quote HTTP ${quoteRes.status}: ${text.slice(0, 200)}`)
  }
  const quoteJson = (await quoteRes.json()) as {
    quote?: { output?: { amount?: string } }
    permitData?: {
      domain: Record<string, unknown>
      types: Record<string, unknown>
      values: Record<string, unknown>
    } | null
  }
  const { quote, permitData } = quoteJson
  if (!quote) throw new Error('quote response missing `quote` field')

  const amountOutRaw = BigInt(quote.output?.amount ?? '0')
  if (amountOutRaw === 0n) {
    throw new Error('quote returned 0 output — no route / no liquidity')
  }

  // ----- Permit2 signature (only when API hands us permitData) -----
  let signature: string | undefined
  if (permitData) {
    await ensureApproval(tokenIn, PERMIT2_ADDRESS, approvedPermit2)
    const types = { ...(permitData.types as Record<string, unknown>) }
    delete (types as Record<string, unknown>).EIP712Domain
    signature = await wallet.signTypedData(
      permitData.domain as never,
      types as never,
      permitData.values as never,
    )
  }

  // ----- /swap -----
  const swapBody: Record<string, unknown> = { quote }
  if (signature && permitData) {
    swapBody.signature = signature
    swapBody.permitData = permitData
  }
  const swapRes = await fetch(`${UNISWAP_API_BASE}/swap`, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(swapBody),
  })
  if (!swapRes.ok) {
    const text = await swapRes.text().catch(() => '')
    throw new Error(`swap HTTP ${swapRes.status}: ${text.slice(0, 200)}`)
  }
  const swapJson = (await swapRes.json()) as {
    swap?: {
      to?: string
      from?: string
      data?: string
      value?: string
      chainId?: number
      gasLimit?: string
      maxFeePerGas?: string
      maxPriorityFeePerGas?: string
    }
  }
  const txReq = swapJson.swap
  if (!txReq?.data || txReq.data === '0x') {
    throw new Error('swap response missing calldata')
  }

  const tx = await wallet.sendTransaction(txReq as never)
  await tx.wait()
  return { txHash: tx.hash, amountOutRaw }
}

// =====================================================================
//                Orchestrator: try direct, then Trading API
// =====================================================================

async function executeSwap(
  tokenIn: string,
  tokenOut: string,
  amountInRaw: bigint,
): Promise<SwapResult> {
  try {
    return await directRouterSwap(tokenIn, tokenOut, amountInRaw)
  } catch (eDirect) {
    const directMsg =
      eDirect instanceof Error ? eDirect.message : String(eDirect)
    try {
      return await tradingApiSwap(tokenIn, tokenOut, amountInRaw)
    } catch (eApi) {
      const apiMsg = eApi instanceof Error ? eApi.message : String(eApi)
      throw new Error(
        `direct: ${directMsg.slice(0, 120)} | api: ${apiMsg.slice(0, 120)}`,
      )
    }
  }
}

// =====================================================================
//                              Public API
// =====================================================================

export type TradeAttempt = {
  action: 'open_long' | 'close_long'
  // Trade size in ETH terms — fixed across legs.
  ethSize: number
  // Implied USD/ETH price from the Uniswap quote we executed against.
  // Null when paper-traded.
  uniswapPrice: number | null
  // Binance reference price the strategy "sees" — used for PnL math
  // regardless of swap outcome.
  binancePrice: number
  // Hex tx hash, null when paper-traded.
  txHash: string | null
  // True iff the swap was skipped/failed and we fell back to paper.
  isPaper: boolean
  // Free-text explanation when paper-traded.
  paperReason?: string
}

/**
 * Open a long position by spending the configured USDC notional
 * (`TRADE_SIZE_USDC`, default $10) on WETH. The implied ETH size at
 * the Binance reference price gets recorded as the position size; the
 * actual amount of WETH the testnet pool returns may differ wildly
 * (pool prices ETH ~$162 vs Binance ~$2,300), but the position-state
 * accounting stays in Binance terms so PnL math doesn't drift.
 */
export async function tryOpenLong(
  binancePrice: number,
): Promise<TradeAttempt> {
  const { ethSize, usdcAmount } = getOpenLongSize(binancePrice)
  try {
    const wallet = getWallet()

    // Pre-flight: confirm the agent has enough USDC to swap. Both swap
    // paths would otherwise fail with opaque router/API errors; catch
    // it here with a clear "fund the agent" hint.
    const usdcContract = new Contract(USDC, ERC20_ABI, wallet)
    const usdcBalance: bigint = await usdcContract.balanceOf(wallet.address)
    if (usdcBalance < usdcAmount) {
      const have = Number(formatUnits(usdcBalance, 6)).toFixed(2)
      const need = Number(formatUnits(usdcAmount, 6)).toFixed(2)
      return paperTrade(
        'open_long',
        ethSize,
        binancePrice,
        `agent USDC balance ${have} < ${need} required — top up the agent at faucet.circle.com (Base Sepolia)`,
      )
    }

    const { txHash, amountOutRaw } = await executeSwap(USDC, WETH, usdcAmount)
    const wethOut = Number(formatUnits(amountOutRaw, 18))
    const usdcSpent = Number(formatUnits(usdcAmount, 6))
    const uniswapPrice = wethOut > 0 ? usdcSpent / wethOut : null

    return {
      action: 'open_long',
      ethSize,
      uniswapPrice,
      binancePrice,
      txHash,
      isPaper: false,
    }
  } catch (e) {
    return paperTrade(
      'open_long',
      ethSize,
      binancePrice,
      e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200),
    )
  }
}

/**
 * Close a long position by selling `positionEth` of WETH back into USDC.
 * `positionEth` is the size we recorded at open_long time (Binance-ref
 * sizing), not whatever the wallet actually holds — keeps the state
 * machine self-consistent even when on-chain inventory drifts.
 */
export async function tryCloseLong(
  binancePrice: number,
  positionEth: number,
): Promise<TradeAttempt> {
  if (positionEth <= 0) {
    return paperTrade('close_long', 0, binancePrice, 'empty position')
  }
  const wethAmount = parseUnits(positionEth.toString(), 18)

  try {
    const wallet = getWallet()

    // Pre-flight: confirm the agent has enough WETH to sell. Mirror of
    // the USDC check in tryOpenLong — close_long after a paper-traded
    // open_long has no on-chain WETH backing, so this catches the
    // "previous open was paper, now we can't really close" case.
    const wethContract = new Contract(WETH, ERC20_ABI, wallet)
    const wethBalance: bigint = await wethContract.balanceOf(wallet.address)
    if (wethBalance < wethAmount) {
      const have = Number(formatUnits(wethBalance, 18)).toFixed(4)
      const need = Number(formatUnits(wethAmount, 18)).toFixed(4)
      return paperTrade(
        'close_long',
        positionEth,
        binancePrice,
        `agent WETH balance ${have} < ${need} required — earlier open_long was likely paper, no on-chain inventory to sell`,
      )
    }

    const { txHash, amountOutRaw } = await executeSwap(WETH, USDC, wethAmount)
    const usdcOut = Number(formatUnits(amountOutRaw, 6))
    const uniswapPrice = positionEth > 0 ? usdcOut / positionEth : null

    return {
      action: 'close_long',
      ethSize: positionEth,
      uniswapPrice,
      binancePrice,
      txHash,
      isPaper: false,
    }
  } catch (e) {
    return paperTrade(
      'close_long',
      positionEth,
      binancePrice,
      e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200),
    )
  }
}

function paperTrade(
  action: 'open_long' | 'close_long',
  ethSize: number,
  binancePrice: number,
  reason: string,
): TradeAttempt {
  return {
    action,
    ethSize,
    uniswapPrice: null,
    binancePrice,
    txHash: null,
    isPaper: true,
    paperReason: reason,
  }
}
