# Interaction-net theory behind Bend/HVM, and whether it fits a Shape-style checking workload

Scope: the theory (interaction nets, interaction combinators, Lamping/Lévy optimal reduction, the Interaction Calculus, sharing and superposition), the evidence on which workloads it speeds up or slows down, any use in analysis, search or verification, how it compares with established techniques, and whether its results are deterministic. Current as of 2026-10-24. Shape's codebase is not evaluated here. Applicability is judged against the workload in the brief: hundreds of declarations; lowering to facts; effect, grant and forbid rules; graph rules (forbidden paths, cycles or hypercycles over typed relations); coverage against changed files; and occasional runs over tens of thousands of mutated model variants.

Sources are labelled by kind. Peer-reviewed sources are marked (peer-reviewed). Vendor sources, meaning Higher Order Company (HOC) or Victor Taelin, are marked (vendor). Blogs and secondary write-ups are marked (secondary).

---

## Q1. What are interaction nets, interaction combinators and optimal reduction? What are sharing and superposition? What is the oracle/bookkeeping problem, how does HVM avoid it, and what does that cost?

### Takeaway
Interaction nets are a graph-rewriting model of computation. Every rewrite is local: it acts only on two nodes joined by their main ("principal") ports, and the order of rewrites does not change the result or the number of steps. Lafont's interaction combinators show that three node types and six rules can encode any interaction-net system. Lamping (1990) used this kind of graph rewriting to build λ-calculus evaluators that are "optimal" in Lévy's sense: they never duplicate a redex (a reducible expression) that could have been shared. Getting this right for the full λ-calculus needs extra "oracle" or "bookkeeping" nodes, and those can dominate the cost.

HVM avoids the bookkeeping entirely. In exchange, it is unsound for programs that clone a higher-order lambda which itself clones its argument. The HVM2 author estimates that adding bookkeeping back would make it about 10× slower. The Interaction Calculus exposes the duplicator and fan nodes as first-class "duplications" (one value used in two places) and "superpositions" (two values held in one place). Superpositions are the feature HOC later used for search.

### Cited Findings

**Interaction nets and combinators**
- Interaction nets were introduced by Lafont (POPL 1990). Mazza describes them as "a model of distributed deterministic computation", inspired by the proof nets of linear logic — [Mazza, MSCS 2007 (peer-reviewed)](https://www-lipn.univ-paris13.fr/~mazza/papers/CombSem-MSCS.pdf); POPL 1990 citation as given in [Mackie, IFL 2008](https://link.springer.com/chapter/10.1007/978-3-642-24452-0_3).
- Interaction combinators: "a very simple system of interaction combinators, with only three symbols and six rules, is a universal model of distributed computation". The symbols are a constructor and a duplicator (both of arity 2) and an eraser (arity 0). "Universal" means every other interaction system can be translated into it — [Lafont, Information and Computation 137 (1997) (peer-reviewed)](https://doi.org/10.1006/inco.1997.2643); rule details from a [PDF mirror of the paper](https://chorasimilarity.wordpress.com/wp-content/uploads/2024/01/ic-lafont-1.pdf).
- Rewrite rules must have exactly two nodes on the left-hand side and must be local, never touching any other part of the graph — [Mackie & Sato, ECEASST 2016 (peer-reviewed)](https://eceasst.org/index.php/eceasst/article/download/2205/2376/2387).
- The symmetric interaction combinators are a variant with "a weaker universality property … but are equally expressive". Mackie and Pinto's encoding of linear logic and the λ-calculus is an example application — [Mazza 2007](https://www-lipn.univ-paris13.fr/~mazza/papers/CombSem-MSCS.pdf); [Mackie & Pinto, Information and Computation 176 (2002) (peer-reviewed)](https://dl.acm.org/doi/abs/10.1006/inco.2002.3163).

**Optimal reduction (Lévy, Lamping)**
- Lamping (POPL 1990) gives "an algorithm for lambda expression reduction that avoids any copying that could later cause duplication of work. It is optimal in the sense defined by Lévy". It consists of "a fixed set of local graph rewrite rules" and is "well suited to parallel implementations" — [Lamping, POPL 1990 (peer-reviewed)](https://dl.acm.org/doi/10.1145/96709.96711).
- In Lévy's notion of optimal evaluation, "similar redexes are contracted in one step via so-called parallel β-reduction" — [Asperti & Mairson, POPL 1998 (peer-reviewed)](https://dl.acm.org/doi/10.1145/268946.268971).

**The oracle/bookkeeping problem and its cost**
- The core problem is "matching fans": knowing which duplicator nodes should cancel each other. Existing solutions add an "oracle", implemented as bracket and croissant agents in BOHM and as delimiter agents in Lambdascope — [Salikhmetov, arXiv:1701.04691 (2017) (preprint)](https://arxiv.org/abs/1701.04691v2).
- Lawall & Mairson (ICFP 1996) studied the sharing graphs of Lamping, of Gonthier, Abadi and Lévy, and of Asperti. Some terms normalize in O(n) time with Θ(n) fan interactions but need Ω(2ⁿ) bookkeeping steps. Sharing graphs can also do Ω(2ⁿ) work through fan interactions alone on graphs that contain no β-redexes. Their conclusion is that these graphs do not give a reasonable cost model — [Lawall & Mairson, ICFP 1996 (peer-reviewed)](https://dl.acm.org/doi/10.1145/232627.232639).
- Asperti & Mairson: the cost of implementing a sequence of n parallel β-steps "is not bounded by any Kalmár-elementary recursive function". This is a lower bound for "any technology that implements Lévy's notion of optimal reduction" — [POPL 1998](https://dl.acm.org/doi/10.1145/268946.268971); journal version in [Information and Computation 170(1), 2001](https://doi.org/10.1006/inco.2001.2869).
- Asperti (2017) argues that the non-elementary cost comes from duplication work that is apparently unavoidable, not from bookkeeping. He says "It is conjectured that bookkeeping only adds a polynomial overhead … but there is no proof". He also notes that, per Asperti & Chroboczek (1997), carelessly managed brackets "can easily accumulate, resulting in an exponential overhead" — [Asperti, arXiv:1701.04240](https://arxiv.org/abs/1701.04240).
- Guerrini & Solieri (FSCD 2017) remove the oracle to get the "abstract algorithm". They prove its overhead is "quadratically bounded" relative to naive proof-net reduction, and that "the price of sharing is negligible" on reductions that need a lot of duplication — [Guerrini & Solieri, FSCD 2017 (peer-reviewed)](https://drops.dagstuhl.de/entities/document/10.4230/LIPIcs.FSCD.2017.17).
- Mackie (1998): "efficient implementations of optimal reduction have had to break away from the interaction net paradigm". His YALE evaluator is "not optimal, but overcomes the inefficiencies caused by the bookkeeping operations" — [Mackie, YALE, ICFP 1998 (peer-reviewed)](https://dl.acm.org/doi/10.1145/291251.289434).
- Optiscope (2025–26) is a heavily optimized Lambdascope-style reducer. Its author reports that scope management (bookkeeping) "accounts for most of the work in an unoptimized implementation" — [Optiscope README (secondary, open-source implementation)](https://github.com/etiamz/optiscope).

**How HVM sidesteps bookkeeping, and the price**
- HVM2 has no oracle. Its paper states: "a source language must use either a type system or similar mechanism to verify that the following invariant holds: *A higher-order lambda that clones its variable can not be cloned.*" Breaking the invariant "can lead to **unsound reductions**" — [Taelin, HVM2 paper, 2024 (vendor)](https://raw.githubusercontent.com/HigherOrderCO/HVM/main/paper/HVM2.pdf).
- The paper adds that "this limitation only applies to cloning higher-order functions … can still clone data types with no restrictions … HVM is Turing Complete … functional languages with some restrictions". On adding bookkeeping: "Adding bookkeeping to HVM should be easy. Sadly, this has the consequence of bringing a constant-time overhead, decreasing performance by about 10x" — [HVM2 paper (vendor)](https://raw.githubusercontent.com/HigherOrderCO/HVM/main/paper/HVM2.pdf).
- HVM2 was presented at the FProPer 2024 workshop at ICFP 2024 — [ICFP 2024 FProPer listing](https://icfp24.sigplan.org/details/fproper-2024-papers/6/HVM2-Iteraction-Combinator-Evaluator).

**Interaction Calculus, sharing and superposition**
- The Interaction Calculus (IC) has affine variables (each used at most once) with global scope, plus first-class *superpositions* (SUP) and *duplications* (DUP). It has four core rules: APP-LAM, DUP-SUP, APP-SUP and DUP-LAM. It can express call/cc, O(1) queues and linear HOAS, but it is "unable to express others (like `λx.(x x)`)" — [Interaction-Calculus repo (vendor)](https://github.com/VictorTaelin/Interaction-Calculus).
- HOC's HVM4 documentation states the goals: "work is never duplicated, even inside lambdas". "Duplications allow a single value to exist in multiple locations; superpositions allow multiple values to exist in a single location." These correspond to Lafont's fan nodes with opposite polarities — [HVM4 Interaction Calculus doc (vendor)](https://github.com/HigherOrderCO/HVM4/blob/main/docs/theory/interaction_calculus.md).
- Labels control how superpositions combine. A DUP and a SUP with the same label annihilate, pairing branches pointwise: `&A{1,2} + &A{10,20}` gives `&A{11,22}`. With different labels they commute, giving all combinations: `&A{1,2} + &B{10,20}` gives `&A{&B{11,21},&B{12,22}}`. A separate "collapse" step turns a superposed result back into a tree of ordinary λ-terms — [HVM4 IC doc](https://github.com/HigherOrderCO/HVM4/blob/main/docs/theory/interaction_calculus.md); [IC repo](https://github.com/VictorTaelin/Interaction-Calculus).
- Applying a function to a superposition maps it over both branches: `F({X Y})` gives `{F(X) F(Y)}`. Sub-computations that do not depend on the superposed input are shared rather than recomputed — [Taelin, "Solving SAT via interaction net superpositions" gist (vendor)](https://gist.github.com/VictorTaelin/9061306220929f04e7e6980f23ade615).
- An important limit of optimal sharing: "Optiscope cannot detect when two syntactically identical configurations occur at run-time; that is, the avoidance of redex duplication is relative to the initial term, not to the computational pattern exhibited by the term" — [Optiscope README](https://github.com/etiamz/optiscope).
- Δ-Nets (2025, single author, not peer-reviewed) claims an oracle-free model for optimal *parallel* λ-reduction. It argues that in earlier systems "delimiters accumulate during reduction until delimiter interactions completely overwhelm fan interactions" — [Salvadori, arXiv:2505.20314 (preprint)](https://arxiv.org/abs/2505.20314).

### Inferences
- "Optimal" means Lévy-optimal: no *duplication of shared redexes* that come from the same origin in the source term. It does not mean memoization, hash-consing or minimal wall-clock time. Two independently built but identical sub-computations, such as the same reachability query issued in two places, are not deduplicated (per the Optiscope limitation above, which follows from the definition).
- HVM keeps the fast part of optimal reduction (the "abstract algorithm") and gives up full λ-calculus soundness in one corner: cloning lambdas that clone their argument. In practice it is safe for first-order data processing and recursion, which is what a fact-and-rule checker would use. That means the "optimal higher-order sharing" advantage mostly would not apply to Shape anyway.

### Gaps
- No formal proof of HVM2's soundness for programs that satisfy the invariant was found. The HVM2 paper is a self-published workshop preprint, and its IO, Benchmarks and Translations sections were still "TODO" in the version read (dated 2024-08) — [HVM2 paper](https://raw.githubusercontent.com/HigherOrderCO/HVM/main/paper/HVM2.pdf).
- Whether Δ-Nets or other 2025–26 preprints hold up under peer review is unknown.

---

## Q2. Which workload shapes benefit, and which do not (sequential, IO-bound, small inputs, mutation-heavy, graph traversal with visited sets)?

### Takeaway
There is evidence of benefit in three narrow regimes:
1. Highly shared higher-order terms such as Church-numeral towers, where the asymptotic gains are real.
2. Large, *balanced*, recursive divide-and-conquer with enough parallel work to fill many cores or a GPU. Here near-linear speedups are reported, but from a slow single-thread baseline.
3. Brute-force search over structured, redundant candidate spaces using superpositions, with vendor-reported constant-factor or larger speedups.

The evidence is consistently negative elsewhere: sequential code, numeric loops, mutable arrays, small inputs, and irregular or divergent parallel work. Interaction-net evaluation is 5–100× slower than GHC on one thread, and optimal reducers can be 70× slower than unoptimized Haskell on ordinary list code. HOC's own released Bend 2 (Sept–Oct 2026) dropped interaction nets for a conventional fork/join runtime.

### Cited Findings

**Throughput and parallel scaling (vendor-reported)**
- HVM2 throughput: 400 million interactions per second (MIPS) on an Apple M3 Max with one thread, 5,200 MIPS with 16 threads, and 74,000 MIPS on an RTX 4090 with 32,768 threads. These figures are for "non-sequential programs" — [HVM2 paper (vendor)](https://raw.githubusercontent.com/HigherOrderCO/HVM/main/paper/HVM2.pdf).
- Single-core penalty: "In single-thread CPU evaluation, HVM2, is, baseline, still about 5x slower than GHC, and this number can grow to 100x on programs that involve loops and mutable arrays, since HVM2 doesn't feature these yet." The paper also says a single-core C program summing numbers "will easily outperform an HVM2 one that uses thousands of threads, given the C version is doing no allocation" — [HVM2 paper (vendor)](https://raw.githubusercontent.com/HigherOrderCO/HVM/main/paper/HVM2.pdf).
- HVM2 is 32-bit: about 500 million nodes (about 4 GB) can be addressed, and numbers are limited to 24 bits — [HVM2 paper](https://raw.githubusercontent.com/HigherOrderCO/HVM/main/paper/HVM2.pdf).
- On GPUs, irregular recursion such as bitonic sort (O(n log n)) caused "misaligned" redexes and warp divergence, "producing sequentialism in the GPU architecture". This required a special task-sharing scheme — [HVM2 paper](https://raw.githubusercontent.com/HigherOrderCO/HVM/main/paper/HVM2.pdf).
- Example in the Bend 1 README: 3.5 minutes on one thread, 10.26 s on 16 threads, and 1.88 s on an RTX 4090, a "111x speedup". The speedup is measured against Bend's own single thread, not against C — [Bend 1 README via docs.rs (vendor)](https://docs.rs/crate/bend-lang/0.2.6/source/README.md).

**Which nets parallelize at all (peer-reviewed)**
- Mackie & Sato found that "some nets cannot benefit from parallelism (they are sequential)". Unary addition has exactly one active pair at any time. Fibonacci and bubble sort go from exponential or quadratic sequential steps to quadratic or linear parallel steps. Ackermann with integers showed "no significant difference" — [Mackie & Sato, CEUR Vol-1403 (2015) (peer-reviewed workshop)](https://ceur-ws.org/Vol-1403/paper5.pdf).
- In wall-clock terms, SML/NJ ran fib 34 in 0.12 s, against 1.67 s for the Inpla interaction-net interpreter on one thread and 0.68 s on four. "Agents … are consumed and reproduced repeatedly during computation", which makes interaction nets slower than function-call execution — [Mackie & Sato 2015](https://ceur-ws.org/Vol-1403/paper5.pdf).

**Optimal reducers on ordinary code**
- Optiscope took about 45 s to insertion-sort a Scott-encoded list of 10,000 elements, against 0.5 s for *unoptimized* Haskell. Even without bookkeeping the projection is about 35 s, roughly 70× slower. Its conclusion is that optimal reduction "is still well behind industrial-strength runtimes … the well-known exceptions (e.g., Church towers) compensate the bookkeeping with asymptotic improvements" — [Optiscope README](https://github.com/etiamz/optiscope).
- The same README quotes Asperti & Guerrini's book: BOHM "works perfectly well for pure λ-calculus" but on "real world" programs is "about one order of magnitude worse than typical call-by-value implementations" — [Optiscope README](https://github.com/etiamz/optiscope).
- Asperti (2017) reports that on pure λ-terms BOHM beat Caml Light and Haskell, "while remaining competitive on typical symbolic computations". On numerical computations Caml Light was "up to one order of magnitude" faster — [Asperti, arXiv:1701.04240](https://arxiv.org/abs/1701.04240).
- An optimal machine is in tension with parallelism. Per Asperti & Guerrini, Section 5.6 (as quoted by Optiscope), "a truly optimal machine must necessarily be sequential, because otherwise, the machine risks at working on unneeded interactions" — [Optiscope README](https://github.com/etiamz/optiscope).

**Superposition speedups (all vendor-reported or informal)**
- SAT: a "brute-force algorithm takes 3 minutes to solve a random instance with 32 variables in Rust. In HVM, the same instance is solved in 1 second by using superpositions". The author adds: "I know little about how this algorithm behaves asymptotically" — [SAT gist (vendor)](https://gist.github.com/VictorTaelin/9061306220929f04e7e6980f23ade615).
- ADD-CARRY search: about 262 million interactions expected by enumeration, about 36 thousand with SUP nodes ("7277x") — [ADD-CARRY gist (vendor)](https://gist.github.com/VictorTaelin/d5c318348aaee7033eb3d18b0b0ace34).
- Program search: 2.8 s in Haskell with an Omega monad against 0.0085 s in HVM for an XOR-XNOR function. The run needed a special HVM1 branch — [DPS gist (vendor)](https://gist.github.com/VictorTaelin/7fe49a99ebca42e5721aa1a3bb32e278).
- HVM3 pitch benchmarks: enumerating Binary Lambda Calculus (BLC) strings took 0.992 s in Haskell, 0.026 s with superposed BLC strings in HVM, and 0.0011 s with superposed λ-terms. HOC notes the speedup "isn't related to parallelism … merely due to optimal looping (via superposition nodes)" — [HVM pitch gist (vendor)](https://gist.github.com/VictorTaelin/47a1379a4ad2729417e2dc0210f79cf4).
- Taelin on NeoGen (Aug 2025): "It is still exponential, but with a constant speedup large enough to find certain programs that were previously intractable" — [Taelin on X (vendor)](https://x.com/VictorTaelin/status/1957775213053022614).

**Independent benchmarks**
- A 2024 blog benchmark found Bend's parallel version slower than its single-threaded one on one test. At 11×11, Bend took about 2 hours single-threaded and about 20 minutes multi-core, against 22 s for single-threaded Go — [speedfox blog (secondary, single author)](https://blog.speedfox.co.uk/).
- LWN (2025) reports that "some of Bend's benchmarks do demonstrate an asymptotic speedup compared to the same algorithm written in Haskell" — [LWN (secondary)](https://lwn.net/Articles/1011803/).

**Where the HVM line stands as of October 2026**
- Generations: HVM2 (2024, Rust/C/CUDA); HVM3 (repository created 2024-11, Haskell + C, "Work In Progress"); HVM4 (repository created 2025-11, C, README warns "you're here before launch. Use at your own risk") — [HVM3 repo](https://github.com/HigherOrderCO/HVM3); [HVM4 repo](https://github.com/HigherOrderCO/hvm4).
- The BendRT paper (Bend 2's runtime, dated about 2026-10) says: "Readers of the author's earlier runtimes may expect interaction nets here; there are none". Of HVM it says: "BendRT keeps the goals and drops the mechanism" — [BendRT paper, Taelin et al. (vendor)](https://raw.githubusercontent.com/bendlang/bend/main/paper/BendRT.pdf).
- BendRT details from the same paper. Values are affine and the program must split work into equal parts at each fork. Single-threaded it runs within 0.8–1.5× of hand-written C; 16 threads give 8.8–12.1×; the GPU gives 52–67× on uniform work. "Divergent and skewed work loses to sixteen threads (n-queens, symbolic regression)", and "a skewed program silently loses its parallelism".
- Bend 2's own limitations list includes: "Values are affine: closures and arrays cannot be shared", "Parallelism requires balanced calls", "Strings are linked lists of characters, so text processing is slow", "Bend 1 programs and HVM do not carry over" — [bendlang/bend README (vendor)](https://github.com/bendlang/bend).
- Release reportedly around 2026-09-18, version 2.0.5 — [oflight article (secondary)](https://www.oflight.co.jp/en/columns/bend2-gpu-dependent-types-proofs-2026). The site bend2.dev also states that "Released Bend 2 uses the separate BendRT runtime, which does not execute interaction nets", and that Bend 2 does not expose superpositions — [bend2.dev note (provenance unverified; the core claim is confirmed by the BendRT paper)](https://bend2.dev/notes/hvm4-explained).

### Inferences
These map the evidence onto Shape's workload.

- **Parsing hundreds of declarations.** This is sequential and string-heavy, and the inputs are tiny. Every source shows interaction-net runtimes losing on this shape: single-core penalty, linked-list strings, no parallel work available. **Poor fit.**
- **Lowering to facts, and effect/grant/forbid rules.** These are small relational joins. With hundreds of declarations, the total work is plausibly microseconds to milliseconds in conventional code (an estimate, not measured). There is too little work to fill even 16 threads, let alone a GPU. **No benefit expected.**
- **Graph rules: forbidden paths, cycles, hypercycles over typed relations.** These need visited or memo sets, which are shared mutable state, and fixpoint iteration. Interaction nets are affine and HVM2 has no mutable arrays, which is the 100× case in its own paper. Sharing in the optimal-reduction sense is not memoization, so repeated reachability sub-queries are not deduplicated. Tarjan's SCC algorithm or semi-naive transitive closure at this size is cheap and well understood. **Poor fit; no evidence base.**
- **Coverage against changed files.** This is set intersection, trivially cheap. **No benefit.**
- **Tens of thousands of mutation variants.** This is the only part whose *shape* resembles what superpositions target: many variants sharing most of their computation. However:
  - The evidence is vendor-reported toy benchmarks (16–32-variable SAT, tiny bit-string functions).
  - HOC itself says the search is "still exponential".
  - Each independent mutation point needs its own label, and collapsing the results recovers per-variant answers.
  - Graph algorithms with visited sets break sharing.
  - BendRT reports that symbolic-regression-style divergent work does badly on GPUs.
  - Rough estimate, not measured: at about 1–10 ms per check, 10⁴ variants is about 10–100 s on one thread. Plain process or thread parallelism over 16 cores gives about 1–10 s with no new runtime. Incremental or delta techniques (Q4) would cut this further.
  - **Plausible in principle, unproven in practice, and not the cheapest route.**
- **Toolchain.** The interaction-net runtime line (HVM2→HVM3→HVM4) has been rewritten four times since 2022, and HOC's shipped language no longer uses it. Depending on it for a deterministic checker would add significant platform risk.

### Gaps
- No independent, peer-reviewed benchmark of HVM2, HVM3 or HVM4 against conventional runtimes on realistic, non-numeric workloads was found.
- No measurements exist of interaction nets on small inputs (hundreds of elements) with startup and translation overhead included.
- HVM4's current single-core throughput is known only from vendor posts on X: 130–190 million interactions per second on a SupGen benchmark — [Taelin on X, 2025-11-28 (vendor)](https://x.com/VictorTaelin/status/1994370663516115444).

---

## Q3. Has interaction-net or optimal-reduction evaluation been used for fixpoint/Datalog evaluation, graph reachability or cycle detection, SAT/SMT-style search, model checking, abstract interpretation, program equivalence, or exploring many program variants with shared work?

### Takeaway
No peer-reviewed evidence was found of interaction nets or optimal reduction serving as the *engine* for Datalog or fixpoint evaluation, graph reachability or cycle detection, model checking, or abstract interpretation. The only "search" applications are HOC's informal, self-reported superposition experiments (SAT, discrete program search, SupGen/NeoGen). Program-equivalence work on interaction nets is about the theory of equivalence *between nets*, not about tools.

The established ways to share work across many program variants are split-stream execution, equivalence-modulo-states and state-infection techniques in mutation analysis, and family-based analysis with presence conditions. They are mature and do not use interaction nets.

### Cited Findings

**Search and SAT (informal, vendor)**
- SAT through superposed booleans, with instances of 16 and 32 variables; no asymptotic analysis — [SAT gist (vendor)](https://gist.github.com/VictorTaelin/9061306220929f04e7e6980f23ade615).
- Taelin also describes "Emulating Logic Programming with Superpositions" and representing unknown terms (metavariables) as superpositions of all terms of a type, then collapsing — [Taelin, "Truly Optimal Evaluation with Unordered Superpositions" gist (vendor)](https://gist.github.com/VictorTaelin/93c327e5b4e752b744d7798687977f8a).

**Program synthesis and variant exploration (vendor, plus one third-party toy)**
- Discrete program search: "create a superposition of all possible functions … apply them all to some test cases … collapse the result" — [Taelin on X, 2024-08 (vendor)](https://x.com/VictorTaelin/status/1819774880130158663); [DPS gist](https://gist.github.com/VictorTaelin/7fe49a99ebca42e5721aa1a3bb32e278).
- SupGen was built into HVM4 by September 2025, with a type system "running directly on interaction nets" — [Taelin on X, 2025-09-26 (vendor)](https://x.com/VictorTaelin/status/1971591584916393984).
- NeoGen is called a "program miner" that is "still exponential" — [Taelin on X, 2025-08-19](https://x.com/VictorTaelin/status/1957775213053022614).
- A third-party blog reproduced superposition-based enumeration on toy examples — [Molina, Aug 2025 (secondary)](https://dmolinad.com/projects/sym_knack/hvm_knack_circc/).
- Released Bend 2 "has no tactics or proof search" — [bendlang/bend README](https://github.com/bendlang/bend). The proof-search and SupGen features announced for Bend 2 in 2025 therefore did not ship in the released language.

**Abstract interpretation and flow analysis**
- Mackie (ESOP 1996) derived a flow-analysis framework from the Geometry of Interaction (GoI) abstract machine for linear-logic proof nets, using standard abstract-interpretation methods to obtain strictness, control-flow and usage information. This analyses *higher-order programs* with GoI ideas; it does not use interaction nets as a solver for general analyses — [Mackie, ESOP 1996 (peer-reviewed)](https://researchportal.ip-paris.fr/en/publications/flow-analysis-in-the-geometry-of-interaction/).

**Program equivalence**
- An LMCS paper defines observational equivalences for the symmetric interaction combinators, analogous to normal-form and head-normal-form equivalence in the λ-calculus — [LMCS (peer-reviewed)](https://lmcs.episciences.org/1150/pdf). This is semantics, not a decision procedure. Equivalence of arbitrary nets is undecidable in general because the model is Turing-complete.

**Verifiable traces (tangential)**
- Interaction-net execution traces have been encoded as Halo 2 zero-knowledge circuits, because "evaluation for interaction combinators is linear" and checking a trace is a syntactic check on a hypergraph — [IACR ePrint 2022/1211 (preprint)](https://eprint.iacr.org/2022/1211.pdf).

**Established techniques for many variants with shared work**
- Split-stream execution runs all mutants as one process and forks at the first mutated statement. MuVM (ICST 2016) applies this to higher-order mutants: "executing common parts of the mutants together and splitting the execution at a seeded fault" — [MuVM, ICST 2016 (peer-reviewed)](https://www.computer.org/csdl/proceedings-article/icst/2016/1827a320/12OmNBOUxiL).
- AccMut (ISSTA 2017) goes past the first mutated statement. It groups mutants that are "equivalent modulo the current state" and runs one process per group — [AccMut, arXiv:1702.06689 / ISSTA 2017 (peer-reviewed)](https://arxiv.org/abs/1702.06689).
- State infection and propagation (ISSTA 2014) uses one execution of the original program to decide which mutants can lead to a different state, and skips the rest — [Just, Ernst & Fraser, ISSTA 2014 (peer-reviewed)](https://homes.cs.washington.edu/~rjust/publ/state_infection_issta_2014.pdf).
- Mutant schemata compile all mutants into one program — [Vercammen et al., STVR 2024 (peer-reviewed)](https://onlinelibrary.wiley.com/doi/full/10.1002/stvr.1865).
- Family-based analysis for product lines: reachability graphs for Petri-net product lines are computed once with feature annotations, using "on-the-fly merging of equivalent symbolic states" — [arXiv:2604.05657 (2026, preprint)](https://arxiv.org/html/2604.05657v1).

**Model checking and reachability with established tools**
- SMT-based reachability checking for Petri nets, for example SMPT — [SMPT](https://github.com/nicolasAmat/SMPT).
- Datalog expresses transitive closure and cycle detection ("is there a station reachable in one or more stops from itself?") directly — [Abiteboul, Hull & Vianu, *Foundations of Databases*, ch. 12](http://webdam.inria.fr/Alice/pdfs/Chapter-12.pdf).

### Inferences
- For Shape's mutation-testing use case, the closest established analogue to "superposition" is split-stream execution or family-based analysis: run the shared prefix once and fork or annotate where variants differ. These are documented, peer-reviewed and implementable in an ordinary language with deterministic output.
- Applying interaction nets to Datalog-style or graph rules would be original research, not adoption of known practice.

### Gaps
- No paper was found that applies interaction nets to Datalog or semi-naive evaluation, BDD-like symbolic sets, model checking, or cycle detection. Absence after targeted searches is a meaningful signal but not proof.
- No independent replication of the superposition SAT or program-search speedups, and no comparison against a modern CDCL SAT solver, was found. The SAT gist compares only with naive brute force.
- Primary sources for variational execution (for example VarexJ) were not retrieved, so it is not cited here.

---

## Q4. How does this compare, in principle, with established techniques for the same jobs: semi-naive Datalog, BDDs, e-graphs and equality saturation, incremental computation, SAT/SMT?

### Takeaway
Each established technique targets exactly the redundancy that matters for a rule and graph checker:
- semi-naive Datalog avoids re-deriving facts across fixpoint iterations;
- BDDs share structure across huge sets of assignments or relations;
- e-graphs share and *deduplicate* many equivalent programs;
- differential dataflow and incremental Datalog re-do work in proportion to the size of a change.

Interaction-net sharing is narrower: it shares by syntactic origin, without deduplication or delta propagation. It has no published results on these tasks.

### Cited Findings

**Semi-naive Datalog**
- Semi-naive evaluation "keeps track of the delta between the successive states of the IDBs and applies the datalog rules as a function of these deltas" (IDBs are the derived relations). It is "one of the major optimization techniques for evaluating datalog" — [Khamis et al., "Convergence of Datalog over (Pre-)Semirings", JACM 2024 (peer-reviewed)](https://dl.acm.org/doi/10.1145/3643027).
- egglog reports that semi-naive evaluation gives a large speedup ("9.27×" in one experiment), and that egglog beats Soufflé-based baselines on its benchmarks — [Zhang et al., "Better Together: Unifying Datalog and Equality Saturation", PLDI 2023 (arXiv:2304.04332)](https://arxiv.org/pdf/2304.04332).

**BDDs**
- bddbddb implements Datalog over BDDs: "BDD operations take time proportional to the size of the data structure, not the number of tuples in a relation". Its context-insensitive points-to analysis was "about twice as fast as a carefully hand-tuned version", and BDDs made context-sensitive pointer analysis feasible for large programs — [Whaley, Avots, Carbin & Lam, APLAS 2005 (peer-reviewed)](https://suif.stanford.edu/papers/aplas05.pdf).

**E-graphs and equality saturation**
- An e-graph "compactly represents many equivalent programs". egg adds amortized "rebuilding", which gives asymptotic speedups in practice, and "e-class analyses" for domain-specific facts — [Willsey et al., egg, POPL 2021 (peer-reviewed, Distinguished Paper)](https://dl.acm.org/doi/10.1145/3434304); [egg project site](https://egraphs-good.github.io/).

**Incremental computation**
- Differential dataflow maintains *collections of differences* and supports arbitrarily nested iteration. The approach "is reminiscent of semi-naïve Datalog evaluation, and indeed incremental computation can be used to evaluate Datalog programs" — [McSherry et al., CIDR 2013 (peer-reviewed)](https://www.cidrdb.org/cidr2013/Papers/CIDR13_Paper111.pdf).
- IncA compiles program analyses (control flow, points-to, DSL well-formedness checks, 10 FindBugs checks) to incremental graph patterns, for real-time IDE feedback — [Szabó, Erdweg & Voelter, ASE 2016 (peer-reviewed)](https://dl.acm.org/doi/abs/10.1145/2970276.2970298).
- LADDDER builds incremental whole-program lattice-based Datalog analysis on differential dataflow — [Szabó et al., PLDI 2021 (peer-reviewed)](https://dl.acm.org/doi/10.1145/3453483.3454026).

**SAT/SMT**
- SMT-based reachability checking for Petri nets is an established tool category, for example [SMPT](https://github.com/nicolasAmat/SMPT). The only interaction-net SAT evidence compares against naive brute force — [SAT gist](https://gist.github.com/VictorTaelin/9061306220929f04e7e6980f23ade615).

**The relevant limit of interaction-net sharing**
- Sharing is "relative to the initial term, not to the computational pattern exhibited by the term" — [Optiscope README](https://github.com/etiamz/optiscope).

### Inferences
Comparison by job for Shape:

| Job in Shape | Established technique | What it shares or avoids | Interaction nets / HVM |
|---|---|---|---|
| Rule evaluation to a fixpoint (grant/forbid, derived relations) | Semi-naive Datalog (Soufflé, egglog, hand-written) | Re-derivation across iterations | No delta mechanism; no published Datalog engine |
| Forbidden paths, cycles, hypercycles | Tarjan SCC / DFS with visited set; Datalog transitive closure | Revisiting nodes | Affine model fights shared visited sets; no mutable arrays in HVM2 |
| Many model variants (mutation) | Split-stream, AccMut, family-based analysis; incremental (differential dataflow) | Shared prefix or unchanged parts; work proportional to the delta | Superpositions share work by origin; toy, vendor-only evidence; "still exponential" |
| Symbolic sets of variants or configurations | BDDs (bddbddb) | Canonical shared structure; operations scale with BDD size | No canonicalization or deduplication |
| Many equivalent forms | E-graphs (egg, egglog) | Explicit deduplication via congruence closure | No deduplication |
| Constraint search | CDCL SAT / SMT | Learned clauses, propagation | Superposed brute force, compared only with naive enumeration |

- For the mutation workload, incremental re-evaluation with differential dataflow or salsa-style memoization (a single mutation is a small delta to the base facts) attacks the same redundancy superposition targets. It also deduplicates identical sub-results and has peer-reviewed results in static analysis (IncA, LADDDER).
- Superposition might add value only where the *computation itself* is higher-order and shared in ways that delta-propagation cannot capture. Nothing in Shape's described workload has that shape.

### Gaps
- Primary sources for Adapton (PLDI 2014) and salsa (the rust-analyzer framework) were not retrieved in this pass.
- No head-to-head study of interaction nets against any of these techniques exists that I could find.

---

## Q5. Determinism: is interaction-net reduction deterministic (confluent), and is its cost model predictable?

### Takeaway
Yes on the result, mostly yes on the count. Interaction nets are strongly confluent (they have the one-step diamond property): every reduction order reaches the same normal form in the same number of interactions. HVM2 keeps this, with a small carve-out to keep interaction counts deterministic.

The *wall-clock* cost is not predictable from the interaction count: allocation, scheduling and GPU divergence dominate. For optimal reduction in general, the count of Lévy-parallel β-steps is not a reasonable cost model, because Lévy-optimal evaluation has proven non-elementary overhead. Conventional deterministic code gives Shape the same determinism guarantee without these costs.

### Cited Findings

**Confluence**
- Lafont's strong confluence: "if a net reduces to an irreducible net in n steps, then any reduction starting from [it] eventually [reaches it in n steps]" — [Lafont 1997 (mirror)](https://chorasimilarity.wordpress.com/wp-content/uploads/2024/01/ic-lafont-1.pdf); [DOI](https://doi.org/10.1006/inco.1997.2643).
- One-step reduction has the diamond property: a diverging pair of one-step reductions can always be joined in one step — [Sinot & Mackie, "Macros for Interaction Nets" (peer-reviewed workshop)](https://lsv.ens-paris-saclay.fr/Publis/PAPERS/PDF/SM-tg04.pdf).
- "The order of rewriting is not important, and all sequences of rewrites are of the same length (in fact they are permutations)" — [Mackie & Sato 2015](https://ceur-ws.org/Vol-1403/paper5.pdf).

**HVM2's version of the guarantee**
- HVM2 keeps "the *strong confluence* that Lafont's Interaction Combinators do … the number of reductions is invariant to the order in which interaction rules are applied … without any risk of complexity blowups". Also: "the total work done is independent of the order that redexes are computed" — [HVM2 paper](https://raw.githubusercontent.com/HigherOrderCO/HVM/main/paper/HVM2.pdf).
- Carve-outs in HVM2:
  - "when counting the number interactions, operate 2 is not counted, as this would cause the number of interactions to be non-deterministic";
  - only programs without "vicious circles" (deadlocked cycles) are considered;
  - concurrent linking can leave chains of indirect links that are "semantically the same result" but temporarily use more memory.

  All three are in the [HVM2 paper](https://raw.githubusercontent.com/HigherOrderCO/HVM/main/paper/HVM2.pdf).
- Violating the lambda-cloning invariant yields "unsound reductions", meaning a *wrong* result rather than a non-deterministic one — [HVM2 paper](https://raw.githubusercontent.com/HigherOrderCO/HVM/main/paper/HVM2.pdf).
- On the limits of confluence: "Allocation and scheduling remain costs of an implementation; confluence alone does not prove a runtime's speed" — [bend2.dev note (provenance unverified)](https://bend2.dev/notes/hvm4-explained).

**Cost models**
- Optimal sharing graphs are not a reasonable cost model for the λ-calculus: there are Ω(2ⁿ) bookkeeping steps against Θ(n) fan interactions — [Lawall & Mairson 1996](https://dl.acm.org/doi/10.1145/232627.232639).
- Parallel β-steps are not unit-cost, and their cost is non-elementary — [Asperti & Mairson 1998](https://dl.acm.org/doi/10.1145/268946.268971).
- By contrast, the number of leftmost-outermost β-steps *is* an invariant (reasonable) cost model for the λ-calculus, polynomially related to Turing machines — [Accattoli & Dal Lago, CSL-LICS 2014 / arXiv:1405.3311 (peer-reviewed)](https://arxiv.org/abs/1405.3311).
- Without the oracle, the abstract algorithm's overhead is at most quadratic relative to proof-net reduction — [Guerrini & Solieri 2017](https://drops.dagstuhl.de/entities/document/10.4230/LIPIcs.FSCD.2017.17).

**Wall-clock unpredictability in practice**
- On GPUs, warp divergence turned parallel work sequential for irregular recursion — [HVM2 paper](https://raw.githubusercontent.com/HigherOrderCO/HVM/main/paper/HVM2.pdf).
- BendRT's GPU results are "bimodal", and "a skewed program silently loses its parallelism" — [BendRT paper](https://raw.githubusercontent.com/bendlang/bend/main/paper/BendRT.pdf).

### Inferences
- For Shape, the determinism property that matters is identical output for identical input. Interaction nets guarantee this structurally, but a conventional implementation guarantees it too: sorted iteration, no dependence on hash ordering, single-threaded or deterministic parallel merge. Determinism is therefore not a reason to choose interaction nets.
- Interaction counts are deterministic and order-independent, so they could serve as a stable work metric, for example in regression tests of checker cost. But that metric does not translate to time, and only HVM-family runtimes provide it.
- Superposition outputs need a collapse or enumeration step. Which solution comes out "first" depends on the collapse strategy (priority queue or diagonalization in the DPS gist), so deterministic reporting needs an explicit canonical ordering — [DPS gist](https://gist.github.com/VictorTaelin/7fe49a99ebca42e5721aa1a3bb32e278). This is an inference from the code shown, not a documented guarantee.

### Gaps
- No formal statement was found of whether HVM3/HVM4 (the lazy, Interaction-Calculus-based runtimes) keep HVM2's strong-confluence and count-invariance claims once their native extensions (numbers, I/O) are included.
- No formal treatment was found of superposition labels and collapse that guarantees a canonical output order.
