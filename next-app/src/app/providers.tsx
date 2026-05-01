'use client'

import { useEffect, useState } from 'react'
import { WagmiProvider } from 'wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { config } from '../config/wagmi'
import { installZgProxyFetch } from '../lib/zgProxy'

export default function Providers({ children }: { children: React.ReactNode }) {
  // QueryClient must be stable across renders but constructed lazily so it
  // isn't shared between server-rendered requests.
  const [queryClient] = useState(() => new QueryClient())

  // Install the HTTPS proxy shim for 0G storage nodes once on mount, before
  // any storage SDK call could run.
  useEffect(() => {
    installZgProxyFetch()
  }, [])

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  )
}
