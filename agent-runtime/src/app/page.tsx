export default function Home() {
  return (
    <main style={{ maxWidth: 720 }}>
      <h1 style={{ fontFamily: 'Georgia, serif' }}>Mendel Agent Runtime</h1>
      <p>
        Headless backend that runs autonomous trading cycles for activated
        Mendel iNFTs. Drives a single Vercel Cron tick that fans out across
        every <code>active</code> agent in the database.
      </p>
      <h2>Endpoints</h2>
      <ul style={{ fontFamily: 'monospace', fontSize: 14 }}>
        <li>GET /api/health</li>
        <li>GET /api/agents</li>
        <li>POST /api/agents/activate</li>
        <li>POST /api/agents/[tokenId]/tick</li>
        <li>GET /api/agents/[tokenId]/cycles</li>
        <li>GET /api/cron/tick (Vercel Cron only)</li>
      </ul>
    </main>
  )
}
