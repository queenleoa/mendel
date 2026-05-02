// Public address of the server-side hot wallet that runs the autonomous
// trade loop. Same address on every EVM chain we touch (0G Galileo for
// the LLM gatekeeper, Base Sepolia for Uniswap swaps).
//
// The corresponding private key lives only on the server as the
// AGENT_PRIVATE_KEY env var — never imported into browser code.
//
// Override at deploy time with NEXT_PUBLIC_AGENT_ADDRESS if you
// rotate to a different hot wallet.

export const AGENT_WALLET_ADDRESS: `0x${string}` =
  (process.env.NEXT_PUBLIC_AGENT_ADDRESS as `0x${string}` | undefined) ??
  '0xE22874bD023b98Ce9c77df0E2988020b16E299f6'

export const shortAgentAddress = (): string =>
  `${AGENT_WALLET_ADDRESS.slice(0, 6)}…${AGENT_WALLET_ADDRESS.slice(-4)}`
