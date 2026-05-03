

▸ The Problem

Two brains can reason and learn from each other, or reach a consensus on decisions together, but it's difficult to combine two brains to create a new and improved brain. But what you can do is create a new offspring by recombining DNA that belongs to the two brains.

The same analogy can be used for AI trading agents. You can't meaningfully recombine ML model weights either — half of one trained network plus half of another is just noise. This causes two problems:

⚫️ Low adaptability — DeFi markets rapidly change and are highly volatile, irregular (non-stationary) functions. ML models valid for a certain regime and trained over a particular type of conditions do not adapt well when conditions change.

⚫️ No composability — Two trading models cannot be verifiably and reliably combined. This also poses a problem for strategy privacy because different parties cannot combine strategies without revealing the original.

-----
▸ Our Solution

✅ Mendel is a no-code AI quant-bot builder where the best strategies breed and evolve like DNA over multiple generations for DeFi-native, non-stationary alpha optimisation.

✅ Mendel is like a little lab that offers an intuitive visual interface to drag-and-drop strategy blocks, backtest, forward test and mint agents.

✅ The Mendel agents, guided by your alpha, decide on trades and monitor market conditions, all while you sleep... and then, the top performers *auto-breed* to rapidly adapt to changing market regimes. 

✅ Using iNFTs, Mendel connects the missing pieces required to create *real* composable AI-trading-agent marketplaces for DeFi. Our demo shows a 2x2 cross limited to alpha signals; the same concept of composability demonstrated by our quant bots can be extended to a multitude of other custom parameters like proprietary AI models, backtesting techniques, etc. 


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

In the demo, we cross-breed strategies using a breeder contract on 0G and deploy live autonomous agents that utilise the Uniswap API to carry out live trades (ETH/USDC on Base Sepolia) — the signal acts as the trigger, and the LLM reasons on whether to proceed with the trade or not based on other market inputs supplied to it. All logs are stored in 0g storage. All decryption takes place only on the user’s frontend, so the strategy is hidden from storage providers too.

----- *** -----