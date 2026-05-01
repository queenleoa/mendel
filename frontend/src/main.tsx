import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { installZgProxyFetch } from './lib/zgProxy'
import './index.css'
import App from './App.tsx'

// Install the HTTPS proxy shim for 0G storage nodes BEFORE the app
// boots, so the SDK's first fetch goes through the proxy.
installZgProxyFetch()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
