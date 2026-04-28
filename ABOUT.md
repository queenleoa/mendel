# AI in trading: Understanding Mendel 

Think of intelligence in two complementary axes. 

**1. Individuals can adapt during their lifetime** through learning — updating their beliefs, skills, and policies based on experience. AI agents do this in several ways: accumulating context, storing memories, fine-tuning weights, or in some cases doing real-time policy updates through reinforcement learning.

**2. Populations adapt across generations** through inheritance and selection. Templates that worked well get passed on; templates that didn't get filtered out. New variants emerge through recombination of parent templates. This is what genetic algorithms model, and what biology has been doing for billions of years.

Most current AI systems focus exclusively on the first axis. They're agents that learn (or appear to learn) during deployment, but they don't have any mechanism for templates to compete, breed, and inherit at the population level. Mendel adds the second axis — strategies as templates that compete, the best ones breed, the population's gene pool evolves.

The ideal future version composes both axes: agents that learn during their lifetimes operating with templates that themselves evolve. 

Artificial Intelligence (AI)
│
├── Machine Learning (ML)
│   ├── Deep Learning (DL)
│   │   ├── Neural Networks
│   │   │   ├── RNN
│   │   │   │   └── LSTM
│   │   │   └── Transformers
│   │   └── (CNNs, etc.)
│   │
│   └── Reinforcement Learning (RL)
│
└── Evolutionary Algorithms (EA)
    └── Genetic Algorithms (GA)
        ├── Haploid Genetic Algorithms
        └── Diploid Genetic Algorithms

## The three layers of any AI trading system

Every complete AI trading system has three layers, regardless of which techniques it uses.

**Layer 1 — Signal extraction.** Given current and recent market data, what's the predictive feature? Outputs are numbers like "momentum is +2.3% over 24 hours" or "volatility is in the 80th percentile." This layer turns raw data into structured features.

**Layer 2 — Strategy logic.** Given a predictive signal, what's the trading rule? "Buy when momentum exceeds 2% and z-score is below -2, with 5% of capital, holding until signal reverses." This layer combines signals into actionable, parameterized rules.

**Layer 3 — Execution.** Given a target trade, how do you fill it efficiently? "Slice this 0.5 ETH order over 60 seconds with these microparameters to minimize market impact." This layer handles the mechanics of getting orders filled at good prices.

A complete trading system uses all three layers. Different techniques are appropriate at each.

---

## The major techniques, what they are, and which layer they fit

### Deep learning (general)

A class of machine learning methods using neural networks with many layers. Excels at extracting patterns from high-dimensional data. Famous for image recognition, language modeling, game playing.

**Layer fit:** Primarily Layer 1. Deep networks can extract subtle predictive patterns from price, volume, order book, and on-chain data that classical signals miss.

**Empirical record in trading:** Mixed at best. Many papers claim strong predictive results; few replicate in production. The structural problem: markets are non-stationary (training distribution doesn't match deployment distribution) and deep models overfit easily. Lopez de Prado and Bailey have published extensively on why most deep-learning-for-finance papers don't hold up out-of-sample.

### LSTM (Long Short-Term Memory)

A specific neural network architecture designed for sequential data. Introduced by Hochreiter and Schmidhuber in 1997. Standard recurrent networks forgot too quickly across long sequences; LSTM added a "cell state" that can carry information forward across many timesteps with learnable gates for what to remember, forget, or output.

**Layer fit:** Layer 1. LSTM is specifically a sequence model — it processes time series and outputs predictions or features. Trained on historical price data, an LSTM might output a predicted return or a learned representation of recent price action.

**Empirical record in trading:** LSTM-for-trading was a major research wave from roughly 2015 to 2020. Hundreds of papers claimed predictive accuracy on stock returns, crypto returns, forex movements. Most didn't replicate. LSTM has been largely superseded in modern ML by transformer architectures (below) which handle sequences better, train faster on GPUs, and generally outperform on most sequence tasks.

### Transformers

The current dominant neural network architecture for sequence modeling, introduced in the "Attention Is All You Need" paper (Vaswani et al., 2017). The architecture behind GPT, Claude, and most modern language models. Uses attention mechanisms instead of recurrence to process sequences, which trains more efficiently and captures long-range dependencies more naturally than LSTM.

**Layer fit:** Layer 1. Same role as LSTM — a sequence model that processes time series and outputs predictions or features. Temporal Fusion Transformers and similar architectures are the modern equivalent of LSTM for trading.

**Empirical record in trading:** Same fundamental problem as LSTM. Better architecture doesn't fix the underlying issue that markets are non-stationary and training data is finite. Some recent results are stronger than LSTM equivalents, but production deployment is still rare and replication still unreliable.

### Reinforcement learning (RL)

A class of methods where an agent learns a policy — a function from states to actions — by interacting with an environment and receiving rewards. The agent's parameters update over time so actions that led to high rewards become more likely in similar states. Famous for AlphaGo, Atari game-playing agents, and robotics.

**Layer fit:** Strongest at Layer 3 (execution). Some applications at Layer 2 (strategy selection in continuous action spaces). The classic RL win in trading is order execution — given a target trade, learn the optimal slicing policy. JP Morgan's LOXM is rumored to be RL-driven. Market making is another strong fit.

**Empirical record in trading:** Real but narrow. Most successful applications are at the execution and microstructure layer, where the action space is continuous, the state space is rich, and the reward signal is clear. "Use RL to decide what strategy to deploy" has a much weaker track record. Crypto-quant shops experimented heavily with deep RL in 2018-2020 and most quietly went back to simpler methods for production strategy selection.

### Genetic algorithms (GAs)

A class of evolutionary methods where a population of candidate solutions is iteratively improved through selection, crossover (breeding), and mutation. Inspired by biological evolution. Foundational work by Holland, Goldberg, and others through the 1980s and 1990s.

**Layer fit:** Layer 2. GAs are best for searching combinatorial or parameterized spaces — choosing which strategy template to use, picking parameter values, selecting from a finite menu of behaviors. They handle non-differentiable, noisy, or discontinuous objective functions naturally because they don't need gradients.

**Empirical record in trading:** Allen & Karjalainen (1999) was the first major application, finding GA-discovered S&P 500 trading rules don't beat buy-and-hold after costs. The field continued through the 2000s and 2010s with mixed published results, settling into a niche where GAs are useful for parameter optimization of fixed strategy templates. CGA-Agent (2025) is the most recent serious crypto application — they use a haploid GA to tune four parameters of a dual-RSI strategy.

### Diploid genetic algorithms

A specific variant of genetic algorithms where each candidate solution carries two copies of every gene (locus), only one of which is expressed at a time. The unexpressed copy persists as "recessive memory." Foundational work by Goldberg & Smith (1987) and Ng & Wong (1995).

**Layer fit:** Same as standard GAs (Layer 2), with a specific advantage in non-stationary environments. The recessive copies preserve alternative strategies that re-emerge when conditions shift, without requiring renewed search from scratch.

**Empirical record:** Strong for non-stationary optimization in CS literature on abstract benchmarks (knapsack with shifting constraints, dynamic bit-matching). Goldberg-Smith demonstrated diploid GAs dramatically outperform haploid GAs when the environment switches. Lewis-Hart-Ritchie (1998) showed the advantage requires dominance change mechanisms or it weakens. **No published applications to trading** — Mendel is the first system bridging this CS literature to autonomous trading agents.

---

## The capability matchup — which technique wins in which situation

| Situation | Deep Learning | LSTM/Transformers | RL | Diploid GA |
|---|---|---|---|---|
| Extracting subtle features from raw data | ✓ | ✓ | | |
| Modeling sequential time series | | ✓ | | |
| Learning continuous action policies | | | ✓ | |
| Optimizing order execution | | | ✓ | |
| Market making | | | ✓ | |
| Searching discrete strategy templates | | | | ✓ |
| Combinatorial parameter spaces | | | | ✓ |
| Non-differentiable objective functions | | | partial | ✓ |
| Non-stationary environments | weak | weak | weak | ✓ (diploid specific) |
| Interpretable decisions for investors | weak | weak | weak | ✓ |
| Strategies as inheritable, recombinable assets | | | | ✓ (only one) |
| Stable training environment available | ✓ | ✓ | ✓ | |
| Can train on millions of interactions | ✓ | ✓ | ✓ | |
| Need to ship in days not months | | | | ✓ |

The pattern is clear: each technique has its niche. Mendel's specific niche — searching strategy templates that breed inheritably under non-stationarity — has no real competitor in the deep learning paradigm because deep learning doesn't naturally produce inheritable, recombinable strategy units.

---

## Why diploid GAs specifically for Mendel's initial design space?

Three properties of diploid GAs map onto Mendel's specific problem in ways no other technique does:

**Property 1: Inheritable, recombinable representation.** Two parent genomes produce a child genome via Mendelian crossover. Half the alleles from each parent. This is the core mechanic that makes "strategies as breeding NFTs" work as a product. Neural network weights don't recombine sensibly — average two trained neural networks and you get gibberish. Allele/parameter genomes recombine cleanly because each locus has independent semantic meaning.

**Property 2: Recessive memory under non-stationarity.** Diploid representation preserves alternative strategies as recessive alleles even while a different strategy is expressed and being selected for. When the regime shifts, the recessive becomes useful and re-emerges. Goldberg-Smith proved this property mathematically in 1987. Crypto markets are textbook non-stationary environments — momentum regimes flip to mean-reversion, bull turns bear in days. Diploid memory matters here in a way it doesn't for stable training environments.

**Property 3: Interpretable, inspectable strategies.** Each agent's genome reads as a sentence: "Momentum at 24-hour lookback with 2% threshold, plus Kelly sizing at 0.5 fraction." An investor or auditor can read this and understand what the agent does. A neural network strategy is millions of weights with no human-readable structure. For a product where strategies are tradeable assets, interpretability matters because buyers want to understand what they're buying.

These three properties together are why Mendel uses diploid GAs and not deep learning, LSTMs, transformers, or RL. The other techniques are powerful for what they're designed for, but they don't produce inheritable, regime-resilient, interpretable strategy units.

---

## Where the other techniques could fit in Mendel's roadmap

Mendel's architecture is composable with the other techniques. Each fits at a specific layer:

**v2 enhancement: LSTM/Transformer for Layer 1.** Replace classical signal computation (momentum, mean reversion) with a deep learning model that extracts predictive features from raw price/volume/order book data. The genome would then encode "use the LSTM-extracted feature with threshold X" instead of "use 24-hour price momentum with threshold X." The LSTM lives below the genome.

**v2 enhancement: RL for Layer 3.** When a Mendel agent decides "buy 0.5 ETH at this signal," route the decision through an RL-trained execution policy that decides exactly how to slice the order. The RL agent lives above the Uniswap router and below the Mendel agent.

**v2 enhancement: Deep RL for meta-evolution.** Use RL to learn the meta-parameters of the GA itself — mutation rate, selection pressure, generation length, dominance rules. The RL agent learns "how to evolve" while Mendel's GA does the evolving. This is sometimes called "learning to evolve."

In each case, Mendel's diploid GA is the strategy-template layer; other techniques can be added at adjacent layers. They compose; they don't compete.

---
