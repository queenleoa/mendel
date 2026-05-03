# Mendel
-----
▸ The Problem
-----
Two brains can reason and learn from each other, or reach a consensus on decisions together, but it's difficult to combine two brains to create a new and improved brain. But what you can do is create a new offspring by recombining DNA that belongs to the two brains.

The same analogy can be used for AI trading agents. You can't meaningfully recombine ML model weights either — half of one trained network plus half of another is just noise. This causes two problems:

⚫️ Low adaptability — DeFi markets rapidly change and are highly volatile, irregular (non-stationary) functions. ML models valid for a certain regime and trained over a particular type of conditions do not adapt well when conditions change.

⚫️ No composability — Two trading models cannot be verifiably and reliably combined. This also poses a problem for strategy privacy because different parties cannot combine strategies without revealing the original.

-----
▸ Our Solution
-----
✅ Mendel is a no-code AI quant-bot builder where the best strategies breed and evolve like DNA over multiple generations for DeFi-native, non-stationary alpha optimisation.

✅ Mendel is like a little lab that offers an intuitive visual interface to drag-and-drop strategy blocks, backtest, forward test and mint agents.

✅ The Mendel agents, guided by your alpha, decide on trades and monitor market conditions, all while you sleep... and then, the top performers *auto-breed* to rapidly adapt to changing market regimes.

✅ Using iNFTs, Mendel connects the missing pieces required to create *real* composable AI-trading-agent marketplaces for DeFi. Our demo shows a 2x2 cross limited to alpha signals; the same concept of composability demonstrated by our quant bots can be extended to a multitude of other custom parameters like proprietary AI models, backtesting techniques, etc.

-----
▸ Setup
-----
```bash
cd next-app
cp .env.local.example .env.local
npm install
npm run db:setup
npm run dev
```

| Env var | Purpose |
|---|---|
| `DATABASE_URL` | Neon Postgres connection string. Schema applied via `npm run db:setup`. |
| `AGENT_PRIVATE_KEY` | Hot-wallet private key used server-side to sign autonomous compute calls (0G Galileo) and Uniswap V3 swaps (Base Sepolia). This is for ease of demo interaction. |
| `AGENT_ADDRESS` | Public address of the hot wallet above. Surfaced to the UI so users can top up the agent runtime from MetaMask. |
| `UNISWAP_API_KEY` _(optional)_ | Uniswap Trading API key is the default smart-routing path on mainnet. On testnet, The cycle hits the V3 router directly first (demo-reliable on Base Sepolia); the API path is tried as a fallback (`/v1/quote` → Permit2 sign → `/v1/swap`) |

-----
▸ Important Mechanisms:
-----

⚫️ Diploid Genetic Algorithms (GAs)

If you remember middle school biology, Gregor Mendel was a monk who discovered the laws of inheritance while mating pea plants. Complex species always carry two copies of a gene.

Dominant traits get expressed while recessive traits get hidden.

But why 2 copies?

🌱 It's because this redundancy is what keeps populations robust.

🌱 It ensures that harmful mutations don't propagate, and useful diversity survives even when it isn't currently winning.

🪎 We can extend this concept to crypto trading strategies too. 🪎

Crypto markets are highly volatile and irregular, with rapidly changing *optima* and unreliable/higher alpha execution costs. Such charts are called non-stationary functions, and mathematically modelling predictive outcomes for these functions is more challenging. Therefore, special techniques need to be used to optimise trading in non-stationary environments.

🌳 Using two copies of signals was not well-explored in traditional markets and basic quant bots, so only a single alpha signal used to be mutated (like simple organisms).

🌳 But it turns out that having two copies of alpha signal parameters can give an important advantage to autonomously reasoning AI agents for crypto strategy evolutions (like complex organisms).

🌳 And this is because having 2 copies allows the AI agents to adapt to new optima more rapidly and reliably. (Goldberg & Smith, 1987; Ng & Wong, 1995)

-----

⚫️ iNFTs

We use iNFTs to give identity to agentic strategies. This proof-of-concept brings together multiple components of the 0G stack to show the potential for reliable commodification and sale of alpha iNFTs.

Proof-of-storage, proof-of-compute, and embedded intelligence hashes are used on-chain to confirm that correct recombinations of agent alpha are taking place without revealing original strategies, and that agents are scored fairly and transparently for their performance.

In the demo, we cross-breed strategies using a breeder contract on 0G and deploy live autonomous agents that swap on Uniswap V3 (direct router on Base Sepolia, with the Uniswap Trading API as a fallback for smart routing on mainnet) to carry out live ETH/USDC trades — the signal acts as the trigger, and the LLM reasons on whether to proceed with the trade or not based on other market inputs supplied to it. All logs are stored in 0g storage. All decryption takes place only on the user's frontend, so the strategy is hidden from storage providers too.

-----
▸ **Deployments**
-----
| | Address / Link |
|---|---|
| **MendelAgent** (0G Galileo) | [`0x98402b35460612A04a50463d1FC220E604B91f2a`](https://chainscan-galileo.0g.ai/address/0x98402b35460612A04a50463d1FC220E604B91f2a) |
| **MendelBreeder** (0G Galileo) |   [`0xE518cC8De4ba8420500d5c60aE324c3C1cE8B13D`](https://chainscan-galileo.0g.ai/address/0xe518cc8de4ba8420500d5c60ae324c3c1ce8b13d) |
| **Agent runtime hot wallet** | `0xE22874bD023b98Ce9c77df0E2988020b16E299f6` |
| **Sample autonomous Uniswap V3 swap** (Base Sepolia) | [`0xb14643cc…cce89919`](https://sepolia.basescan.org/tx/0xb14643cc88fe70296a142e0ed25bbc4c0c5b952c1eac1483c305a709cce89919) |

-----
▸ **Full flow**
-----
**Mint** — strategy genome is built in the browser from the user's drag-dropped alpha cells, encrypted client-side under a wallet-signature-derived AES-256-GCM key, the ciphertext is uploaded to 0G Storage, and the resulting `rootHash` is committed on-chain inside a `MendelAgent.mintFounder` call along with hash commitments. Plaintext never leaves the browser.

![Mint flow](https://raw.githubusercontent.com/queenleoa/mendel/0ca387a497eb2c20e632e27c3f2ac7bcfffdf94d/mendel_mint_flow.svg)

**Breed** — `MendelBreeder.breed` mints a request and emits an unpredictable seed (block-hash-bound). The user's browser downloads both parents' ciphertext from 0G Storage, decrypts them, runs deterministic Mendelian recombination keyed by that seed (with a rescue pass that guarantees all four phenotype combos appear), encrypts each of the 9 children, uploads them, and submits a single EIP-712-signed `fulfillBreeding` that mints the 9 children atomically. Anyone can replay `(seed, parentA, parentB)` and reproduce the same children byte-for-byte — that's what removes the need for a TEE.

![Breed flow](https://raw.githubusercontent.com/queenleoa/mendel/0ca387a497eb2c20e632e27c3f2ac7bcfffdf94d/mendel_breed_flow.svg)

**Live cycle** — every active agent ticks on the Vercel cron (`*/5`). The server pulls live market context, runs the strategy module, asks the LLM gatekeeper on 0G Compute whether to proceed, executes the swap on Uniswap V3 on Base Sepolia (direct router, falling back to the Uniswap Trading API), persists the cycle to Postgres, and a separate cron (`*/10`) bundles unposted cycles into a JSON document and pushes it to 0G Storage so every agent decision is auditable.

![Live cycle](https://raw.githubusercontent.com/queenleoa/mendel/0ca387a497eb2c20e632e27c3f2ac7bcfffdf94d/mendel_live_cycle.svg)

The LLM gatekeeper receives **exactly** these inputs at each cycle:

- **Strategy summary** — trigger type (momentum / mean-reversion), lookback or window in hours, threshold (% or σ).
- **Alpha signal** — `BUY` / `SELL` / `HOLD`, plus the trigger's quantitative reason (e.g. `momentum: 4h 0.21% > +0.07%`).
- **Spot price** — current ETH/USDC mid (Binance reference).
- **24-hour price change** — signed percentage.
- **24-hour realized volatility** — derived from intraday high/low range.
- **Perpetual funding rate** — Binance ETH-USDT perp, in basis points.
- **Fear & Greed Index** — value (0–100) + classification (Fear / Neutral / Greed / etc.) from alternative.me.
- **Last 12 × 5-minute closes** — short trend context for regime sanity.

The LLM returns a one-line JSON `{decision, reason}`. Decision is `accept`, `reject`, or `skip`. PnL is tracked against Binance reference prices regardless of the actual Uniswap fill, since Base Sepolia pool prices diverge from mainnet.

-----
▸ Folder structure
-----
```
mendel/
├── contracts/         # Foundry — MendelAgent (iNFT) + MendelBreeder (recombination + EIP-712 fulfilment)
└── next-app/          # Next.js — frontend + agent runtime in a single Vercel deploy
    ├── db/            # Neon Postgres schema for `agents` and `cycles`
    ├── scripts/       # Throwaway verifications: recombination distribution, backtest sanity, vol-filter calibration
    └── src/
        ├── app/api/   # Agent activate / tick / status, cron jobs (live tick + decision-log upload), 0G storage HTTPS proxy
        ├── components/# React UI — drag-drop alpha builder, breeding visualisation, backtest leaderboard, live agent dashboard
        └── lib/
            ├── genome.ts        # Browser-side AES-256-GCM, key derivation, 0G Storage I/O, Mendelian recombination
            ├── inft.ts          # MendelAgent + MendelBreeder ethers helpers; full mint and breed orchestrators
            ├── alphaCells.ts    # Maps the Alpha-tab strategy grid to founder genomes
            ├── backtest/        # Klines fetch, signal math, paper-trade runner, leaderboard scorer
            └── runtime/         # Server-only cycle: market snapshot → strategy → 0G Compute LLM → Uniswap swap → decision log
```

-----
▸ Contact
-----
- **X**: [@buildwithadrija](https://x.com/buildwithadrija)
- **Telegram**: [@buildwithadrija](https://t.me/buildwithadrija)
