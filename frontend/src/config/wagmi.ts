import { createConfig, http } from 'wagmi'
import { defineChain } from 'viem'
import { metaMask, injected, coinbaseWallet } from 'wagmi/connectors'

export const zeroGGalileo = defineChain({
  id: 16601,
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

export const config = createConfig({
  chains: [zeroGGalileo],
  connectors: [
    metaMask({ dappMetadata: { name: 'Mendel' } }),
    injected({ shimDisconnect: true }),
    coinbaseWallet({ appName: 'Mendel' }),
  ],
  transports: {
    [zeroGGalileo.id]: http(),
  },
})
