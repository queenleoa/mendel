import { createConfig, http } from 'wagmi'
import { baseSepolia } from 'wagmi/chains'
import { defineChain } from 'viem'
import { metaMask } from 'wagmi/connectors'

export const zeroGGalileo = defineChain({
  id: 16602,
  name: '0G Galileo Testnet',
  nativeCurrency: { name: '0G', symbol: 'OG', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://evmrpc-testnet.0g.ai'] },
  },
  blockExplorers: {
    default: { name: '0G Chainscan', url: 'https://chainscan-galileo.0g.ai' },
  },
  testnet: true,
})

// Re-export baseSepolia so callers don't need a second import path.
export { baseSepolia }

export const config = createConfig({
  chains: [zeroGGalileo, baseSepolia],
  connectors: [metaMask({ dappMetadata: { name: 'Mendel' } })],
  transports: {
    [zeroGGalileo.id]: http(),
    [baseSepolia.id]: http(),
  },
})
