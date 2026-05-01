# Mendel Agent Runtime

Headless Next.js backend that drives autonomous trading cycles for activated Mendel iNFTs. Fan-out from a single Vercel Cron hit per tick.

## Phase 1 (current)

- Frontend POSTs `(tokenId, owner, decrypted genome, lineage)` to `/api/agents/activate`.
- Cycle (`POST /api/agents/[tokenId]/tick` for manual, `GET /api/cron/tick` for Vercel Cron) does:
  1. Fetch ETH/USDT spot, funding, fear/greed from Binance + alternative.me.
  2. Evaluate the genome against the snapshot — momentum or mean-reversion gated by the volatility filter.
  3. **Stub** gatekeeper (regime sanity check). Phase 2: real 0G Compute LLM JSON prompt.
  4. **Stub** trade (paper PnL bookkeeping at the Binance mid). Phase 2: real Uniswap V3 swap on Base Sepolia.
  5. Persist a row to Postgres `cycles`.
  6. Roll the agent's position forward in `agents`.

## Setup

```sh
cp .env.example .env.local
# fill DATABASE_URL with a Neon connection string
npm install
npm run db:setup     # creates tables
npm run dev          # http://localhost:3001
```

## Cron

`vercel.json` registers a single Vercel Cron at `*/5 * * * *` (every 5 minutes), hitting `/api/cron/tick`. Pro tier required (Hobby restricts cron to daily). Vercel auto-injects `Authorization: Bearer <CRON_SECRET>` for cron-triggered hits — set `CRON_SECRET` in the project's env vars and the route enforces it.

## Endpoints

| Method | Path | Body / params | Returns |
|---|---|---|---|
| GET | `/api/health` | — | service heartbeat |
| GET | `/api/agents` | — | all active agents |
| POST | `/api/agents/activate` | `{tokenId, ownerAddress, genome, lineage}` | upserted agent |
| POST | `/api/agents/[tokenId]/tick` | — | newly inserted cycle |
| GET | `/api/agents/[tokenId]/cycles` | `?limit=50` | recent cycles desc |
| GET | `/api/cron/tick` | — | per-agent run results |

## Phase 2 (next iterations)

- Real 0G Compute LLM gatekeeper (JSON-mode prompt, parse `accept|reject` + reason). Server-side `ethers.Wallet` from `AGENT_PRIVATE_KEY`.
- Real Uniswap V3 swap on Base Sepolia via `SwapRouter02` at `0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4`. Quotes via `QuoterV2` at `0xC5290058841028F1614F3A6F0F5816cAd0df5E27`. WETH `0x4200…0006`. Agent wallet pre-funded with WETH + USDC.
- Per-cycle decision JSON uploaded to 0G Storage; rootHash stored in `cycles.decision_log_root_hash`.
- Periodic `MendelAgent.updateFitness(tokenId, pnlBps, trades, sig)` from the runtime wallet (must be set via `setFitnessUpdater`).
