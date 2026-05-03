// Server-side Uniswap V3 executor on Base Sepolia.
//
// Swaps the agent wallet's USDC ↔ WETH at a fixed trade size (default
// 0.01 WETH per leg, override via TRADE_SIZE_ETH env). All swaps go
// through SwapRouter02's `exactInputSingle` against the 0.3 % pool —
// the only Base Sepolia ETH/USDC tier with measurable depth.
//
// Pool prices on testnet diverge wildly from mainnet (e.g. ~$162/ETH
// vs Binance's ~$2,300 today) because liquidity is sparse. We still
// execute the real swap so there's an on-chain tx for proof-of-action,
// but the cycle's PnL math runs against the Binance reference price
// passed in by the caller — the strategy never "sees" the testnet
// price, so its decisions and accounting stay realistic.
//
// On any failure (no liquidity, balance shortfall, RPC blip, slippage
// breach) we return `{ isPaper: true }` and the caller paper-trades
// against the Binance ref. Demo-safe: a flaky pool can't break the
// position state machine.

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

const SWAP_ROUTER_02 = '0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4'
const QUOTER_V2 = '0xC5290058841028F1614F3A6F0F5816cAd0df5E27'
const WETH = '0x4200000000000000000000000000000000000006'

// USDC test token on Base Sepolia (Circle's official test address). The
// only USDC variant we found with a real Uniswap V3 pool. Override with
// USDC_BASE_SEPOLIA if a future deployment uses a different address.
const USDC =
  process.env.USDC_BASE_SEPOLIA ??
  '0x036CbD53842c5426634e7929541eC2318f3dCF7e'

const POOL_FEE = Number(process.env.UNISWAP_POOL_FEE ?? 3000)

// Trade size per swap leg, denominated in ETH. 0.01 ≈ $23 at mainnet
// price; on testnet pool's depressed ~$162/ETH that's ~1.62 USDC of
// inventory cycling per trade. Plenty of demo runtime per top-up.
export const TRADE_SIZE_ETH = Number(process.env.TRADE_SIZE_ETH ?? 0.01)

// 5 % slippage tolerance versus Uniswap's *own* quote — not against
// Binance. The pool's price relative to mainnet is its own concern;
// what we guard against is the pool moving between our quote and our
// swap (which is the actual definition of slippage).
const SLIPPAGE_BPS = 500

const BASE_SEPOLIA_RPC =
  process.env.BASE_SEPOLIA_RPC ?? 'https://sepolia.base.org'

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
  'function decimals() view returns (uint8)',
] as const

// =====================================================================
//                          Wallet + approval cache
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

// SwapRouter02 needs ERC20 approval for the input token before each
// swap. We approve `MaxUint256` once per server lifetime and cache the
// result so subsequent swaps don't re-approve. Resets on cold start.
const approvedTokens = new Set<string>()

async function ensureApproval(tokenAddr: string): Promise<void> {
  if (approvedTokens.has(tokenAddr.toLowerCase())) return
  const wallet = getWallet()
  const token = new Contract(tokenAddr, ERC20_ABI, wallet)
  const current: bigint = await token.allowance(
    wallet.address,
    SWAP_ROUTER_02,
  )
  // Only re-approve if currently below a generous threshold. Many
  // tokens initialize allowance to 0; some return MaxUint256 when
  // already-approved-once.
  if (current >= parseEther('1000000')) {
    approvedTokens.add(tokenAddr.toLowerCase())
    return
  }
  const tx = await token.approve(SWAP_ROUTER_02, MaxUint256)
  await tx.wait()
  approvedTokens.add(tokenAddr.toLowerCase())
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
 * Open a long position by buying `TRADE_SIZE_ETH` worth of WETH with
 * USDC. Sizing is computed from the Binance reference price (so we
 * spend ~the right USDC notional) and then routed through the testnet
 * pool, which may fill at a meaningfully different price.
 */
export async function tryOpenLong(
  binancePrice: number,
): Promise<TradeAttempt> {
  const ethSize = TRADE_SIZE_ETH
  const usdcAmount = parseUnits(
    (ethSize * binancePrice).toFixed(6),
    6, // USDC has 6 decimals
  )
  try {
    const wallet = getWallet()
    const quoter = new Contract(QUOTER_V2, QUOTER_ABI, wallet.provider!)
    const [quotedWethOut] = (await quoter.quoteExactInputSingle.staticCall({
      tokenIn: USDC,
      tokenOut: WETH,
      amountIn: usdcAmount,
      fee: POOL_FEE,
      sqrtPriceLimitX96: 0,
    })) as [bigint, bigint, number, bigint]
    if (quotedWethOut === 0n) {
      return paperTrade('open_long', ethSize, binancePrice, 'pool returned 0 — no liquidity')
    }

    await ensureApproval(USDC)
    const router = new Contract(SWAP_ROUTER_02, ROUTER_ABI, wallet)
    const minOut =
      (quotedWethOut * BigInt(10_000 - SLIPPAGE_BPS)) / 10_000n
    const tx = await router.exactInputSingle({
      tokenIn: USDC,
      tokenOut: WETH,
      fee: POOL_FEE,
      recipient: wallet.address,
      amountIn: usdcAmount,
      amountOutMinimum: minOut,
      sqrtPriceLimitX96: 0,
    })
    await tx.wait()

    const wethOut = Number(formatUnits(quotedWethOut, 18))
    const usdcSpent = Number(formatUnits(usdcAmount, 6))
    const uniswapPrice = wethOut > 0 ? usdcSpent / wethOut : null

    return {
      action: 'open_long',
      ethSize,
      uniswapPrice,
      binancePrice,
      txHash: tx.hash,
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
    const quoter = new Contract(QUOTER_V2, QUOTER_ABI, wallet.provider!)
    const [quotedUsdcOut] = (await quoter.quoteExactInputSingle.staticCall({
      tokenIn: WETH,
      tokenOut: USDC,
      amountIn: wethAmount,
      fee: POOL_FEE,
      sqrtPriceLimitX96: 0,
    })) as [bigint, bigint, number, bigint]
    if (quotedUsdcOut === 0n) {
      return paperTrade('close_long', positionEth, binancePrice, 'pool returned 0 — no liquidity')
    }

    await ensureApproval(WETH)
    const router = new Contract(SWAP_ROUTER_02, ROUTER_ABI, wallet)
    const minOut =
      (quotedUsdcOut * BigInt(10_000 - SLIPPAGE_BPS)) / 10_000n
    const tx = await router.exactInputSingle({
      tokenIn: WETH,
      tokenOut: USDC,
      fee: POOL_FEE,
      recipient: wallet.address,
      amountIn: wethAmount,
      amountOutMinimum: minOut,
      sqrtPriceLimitX96: 0,
    })
    await tx.wait()

    const usdcOut = Number(formatUnits(quotedUsdcOut, 6))
    const uniswapPrice = positionEth > 0 ? usdcOut / positionEth : null

    return {
      action: 'close_long',
      ethSize: positionEth,
      uniswapPrice,
      binancePrice,
      txHash: tx.hash,
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
