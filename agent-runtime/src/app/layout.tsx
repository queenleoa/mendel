import type { ReactNode } from 'react'

export const metadata = {
  title: 'Mendel Agent Runtime',
  description: 'Autonomous agent runtime for Mendel iNFT strategies',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: 'system-ui, sans-serif',
          margin: 0,
          padding: '2rem',
          color: '#1a2620',
          background: '#f8f4f1',
        }}
      >
        {children}
      </body>
    </html>
  )
}
