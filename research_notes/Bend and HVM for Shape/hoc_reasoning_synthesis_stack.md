# HOC's reasoning and synthesis stack (Kind, Bend 2, SUP nodes, SupGen/NeoGen, HVM3/HVM4): state as of October 2026

Scope note: these notes cover Higher Order Company (HOC, Victor Taelin) proof, type and synthesis work. Every claim is dated. "HOC claim" means a statement by Taelin or HOC that I found no independent check of. "Independent" means a third party ran, read, or measured something. Research date: 2026-10-24.

Headline (for the report writer):
- Kind is dormant. Its last commit was 2024-12-09. Its role as HOC's proof language passed to **Bend 2**, released 2026-09-17.
- Bend 2 does have dependent types, a proof checker, and a Lean-verified kernel (`--verdict`). It also dropped interaction nets and HVM entirely. Its runtime (BendRT) gives up optimal sharing, and it ships with **no proof search and no tactics**.
- The superposition-based synthesizer (SupGen, also called NeoGen in 2025) has **not been released as a product**. Its claimed results are unpublished and have no named baselines. The headline claim fell from "up to 1000x" in Jan 2025 to "10x or so" in Sep 2026.
- The one commercial outlet, the "Bender"/"BendAI" proving agent, says itself that today it is "a thin harness around models from Anthropic, OpenAI and others", and that SupGen will "ship in future updates".

---

## 1. Kind: status, type theory, soundness, what it has proven, tooling, checker performance

### Takeaway
Kind (the Haskell rewrite at HigherOrderCO/Kind) has had no commits since 2024-12-09, even though its README still says "actively developed". HOC's 2025 plans folded Kind's role (a dependently typed proof checker with holes and search) into "Bend2", and Bend 2 now fills that role. I found no consistency proof, no notable formalized results, and no independent performance evaluation for any Kind generation.

### Cited Findings
- Kind's repo README says: "Kind is a minimal Proof Checker. This repository is a full rewrite of Kind from the old JS implementation to Haskell. It is being actively developed." It points to KindBook for examples and says "We will write a proper README later". The repo is MIT-licensed, created 2018-07-13, with 279 commits and 3,764 stars. — [HigherOrderCO/Kind](https://github.com/HigherOrderCO/Kind)
- The newest commit on Kind's master branch is dated **2024-12-09**: "Merge pull request #617 from HigherOrderCO/small-changes-for-bend". Commits from Nov to Dec 2024 add syntax sugar and IO functions. The page shows no archive or deprecation banner. — [Kind commit history](https://github.com/HigherOrderCO/Kind/commits/master)
- HOC's company website still lists "Kind: A parallel proof checker. Coming soon" (undated, launch-era wording). — [higherorderco.com](https://higherorderco.com/)
- Kind2 was an earlier generation, written in Rust on HVM (crate kind2 0.3.10, released "over 3 years ago"). It claimed "its type-checker outperforms every alternative proof assistant by a far margin", and that its programs "can offer exponential speedups over Haskell's GHC". These are launch-era HOC claims; I found no independent replication. — [crates.io kind2](https://crates.io/crates/kind2); [docs.rs kind2 README](https://docs.rs/crate/kind2/latest/source/README.md)
- Formality, Kind's predecessor, built its datatypes from **self types**: "a type that can depend or be a proposition on it's own value". Datatype syntax desugared to Formality-Core λ-encodings. — [John Burnham, "A Taxonomy of Self Types" (gist)](https://gist.github.com/johnchandlerburnham/1ac8ee3690917a144b69667359afd6a7)
- On 2026-09-18 (HN), Taelin said that "inference, unification, or program search ... Kind had these, 5 years ago." — [HN: Bend 2 and the Vibe-Coding Trap](https://news.ycombinator.com/item?id=49753179)
- On 2025-08-19, Taelin said HOC's merged plan was to put **NeoGen** (superposed search) into Bend: "you can put a 'hole' anywhere in the program, and the compiler will fill that hole for you ... To make that possible, Bend must have dependent types, and its checker must work efficiently inside HVM and under superposed search." The launch was planned for Halloween 2025. — [Taelin on X, 2025-08-19](https://x.com/VictorTaelin/status/1957775213053022614)
- On 2025-01-31, HOC's Wefunder raise was titled "Bend2: The AI Programming Language". The same post listed "HVM, Kind, Bend, SupGen" as HOC IP. — [HOC on X, 2025-01-31](https://x.com/higherordercomp/status/1885319917932605501); [Taelin on X, 2025-01-31](https://x.com/VictorTaelin/status/1885328571410853951)

### Inferences
- In practice, Kind is superseded by Bend 2 as HOC's proof language. The dependent type checker, holes and proof idioms moved to Bend 2, but its search features did not ship there (see section 2). The README's "actively developed" is stale by about 22 months.
- Kind generations (Formality/Kind1 in JS, Kind2 in Rust/HVM, Kind in Haskell) have repeatedly been rewritten. None has a body of formalized results that Shape could reuse.

### Gaps
- I found no primary document stating the core type theory of the Haskell Kind (for example whether it has Type:Type, self types, or a termination/positivity check), and no statement of its soundness. I could not confirm whether it is consistent.
- I found no explicit HOC announcement that Kind is deprecated or merged. The "superseded" reading is inferred from commit inactivity plus the Bend2 plans and release.
- No independent benchmark of any Kind checker was found.

---

## 2. Bend 2: dependent types, proofs, type checker, relation to Kind, release status

### Takeaway
Bend 2 has been public since **2026-09-17** (Apache-2.0, repo moved to `bendlang/bend`). It is a dependently typed, affine-by-default language with Python-like syntax. Its type checker is a proof checker. `bend --verdict` re-checks proofs in a small kernel (BendTT) whose consistency is mechanized in Lean, and since 2.0.32 (2026-09-27) the code that runs is the code that was verified, with a $10k bounty for a proof of `Empty`.

It has no tactics, no proof search and almost no inference. Its compiler is "99% AI-written and not yet fully audited", and the parser and translation into the kernel are unproven. Its runtime no longer uses interaction nets. Independent readers say the kernel and its consistency argument are real, and that the checker-speed comparison with Lean and other assistants is not apples to apples.

### Cited Findings
**Release and provenance**
- Taelin, 2026-09-17: "Bend 2 is here! It is a new programming language that blocks AI mistakes via *proof checking* - the same technique big AI labs used to solve open math problems, like Navier-Stokes. It is also very fast, and runs on GPUs." — [Taelin on X, 2026-09-17](https://x.com/VictorTaelin/status/2100681226143092875)
- HigherOrderCO/Bend2 was created on 2026-09-16 as a one-commit redirect to `github.com/bendlang/bend`. Bend 1 is now "HigherOrderCO/Bend1 ... superseded". — [HigherOrderCO/Bend2](https://github.com/HigherOrderCO/Bend2); [HigherOrderCO org](https://github.com/HigherOrderCO)
- The 2.0.4 source revision went public on 2026-09-17. "Twenty-eight more releases followed in ten days", including 2.0.32 on 2026-09-27. — [bend2.dev "Is Bend2 released?" (third-party explainer site, updated 2026-09-28)](https://bend2.dev/notes/bend2-release-date). The official site later showed v2.0.35 and then v2.0.38. — [bend-lang.com](https://www.bend-lang.com/); [bend-lang.org](https://www.bend-lang.org/)
- In the README limitations, HOC says: "Bend 2 is a new language. Bend 1 programs and HVM do not carry over." — [bendlang/bend README](https://github.com/bendlang/bend)

**What the language and checker are**
- Proofs are ordinary definitions. For example, a `law add_zero: for x: Nat {Nat.add(x, 0n) == x : Nat}` is proven by a same-named `def` doing induction with explicit rewrites (`%`). The `LAWS.bend`/`PROOF.bend` workflow is "`AGENTS.md` backed by proof". — [bendlang/bend README](https://github.com/bendlang/bend)
- Limitations HOC lists itself (README, Sep to Oct 2026):
  - "Everything is annotated and nothing is inferred".
  - "Bend has no tactics or proof search; proving theorems takes extra effort".
  - "Values are affine: closures and arrays cannot be shared".
  - "Recursion must terminate; `@unsafe` ... turns the check off".
  - "Numbers are Nat, U32 and F32 only".
  - "F32 is axiomatic".
  - "Strings are linked lists".
  - "The compiler (not kernel) is 99% AI-written and not yet fully audited".
  - "The checker has no proof and may have bugs; `--verdict` uses a proven kernel".
  - "`--verdict` checks the translated terms, the parser and translation into the kernel are not proven".
  - "We don't have as many benchmarks as we'd like yet, especially for the checker".

  — [bendlang/bend README](https://github.com/bendlang/bend)
- HOC's core theory paper is "BendTT: An Affine Dependent Type Theory". A Lean file `bend2/bendtt.lean` is described as "the kernel of `--verdict` and its proofs, in Lean". — [bendlang/bend README](https://github.com/bendlang/bend); [bend-lang.com](https://www.bend-lang.com/)
- Independent reading by ai.thesatyajit.com (code at the 2026-09-18 commits):
  - BendTT has one universe (`Type : Type`), no universe hierarchy and no positivity restriction. Consistency comes from affinity: a `+` binder (reusable) is only legal over `Data`, and "no function type is ever `Data`", so Girard- and Curry-style self-application cannot be built.
  - The paper's related work says that among linear/graded dependent theories, "none uses the absence of contraction *for* consistency".
  - Checker file `bend.ts` is 3,734 lines, including the parser.
  - The Lean model `bend.lean` is about 21,000 lines with zero `sorry`. It proves confluence, subject reduction, progress, weak normalization and consistency.
  - At that date the Lean model "does not yet fully match the shipped checker".

  — [ai.thesatyajit.com, "Bend 2: proof-checked, and no longer an interaction net"](https://ai.thesatyajit.com/articles/bend-2)
- Taelin on HN (around 2026-09-18): "We just use QTT-like linear types to fully prohibit runtime closures. So, paradoxes like Russel's and Girard's are blocked. In exchange, functions like List.map are not expressive (without templates). So it is not a research breakthrough." — [HN: Bend – a language that blocks AI mistakes via proof](https://news.ycombinator.com/item?id=49746163)
- Taelin, 2026-09-27: "Bend 2.0.32: formalization sync done! ... `bend file.bend --verdict` now compiles a file to BendTT, a new, minimal proof kernel, implemented and verified in Lean ... the kernel that runs is the same code that is proven ... We offer $10k to anyone who proves a falsehood in Bend." He noted that some idioms (axiomatic F32, a few templates) are not yet accepted by `--verdict`. — [Taelin on X, 2026-09-27](https://x.com/VictorTaelin/status/2104240438127288652); bounty rules: a file with one import (Base) and `def Foo() -> Empty` that prints "ALL PROOFS CHECK" under `--verdict` on 2.0.32. — [Taelin on X, 2026-09-28](https://x.com/VictorTaelin/status/2104702762566963636)
- Earlier HOC claim, 2026-08-21 (before release): "Is proven consistent (no 'oh no there's a kernel bug') ... Checks millions of files 100x faster than Lean ... The WHOLE THING (core+compiler+runtime) fits in 100K context". — [Taelin on X, 2026-08-21](https://x.com/VictorTaelin/status/2090834923766555061)

**Post-release bug reports (independent probing)**
- Issue #1182 (2026-09-29, open): Bend 2.0.32's everyday checker accepts a definition that `--verdict` cannot validate ("TypeScript/BendTT mismatch"). The kernel rejects it; the reporter does not claim a soundness exploit. — [bendlang/bend#1182](https://github.com/bendlang/bend/issues/1182)
- Issue #1482 (2026-10-11, closed as not planned): `--verdict` reported ALL PROOFS CHECK for source that *reads* as a false equality. One cause was `3n * 0n+0n + 5n` parsing as `3*(0+(0+5))`; another was a misindented `case`.
  - Maintainers: "Neither case is unsound: in both, Bend proves a true fact about the program as it was parsed ... a readability problem ... not a false theorem."
  - They clarified that the bounty also counts mistranslation by `safe.ts` or silently dropped definitions, if the result is a proof of `Empty`.

  — [bendlang/bend#1482](https://github.com/bendlang/bend/issues/1482)

**Checker performance claims and their critique**
- HOC claims the checker is "a proof checker, as in Lean and Rocq. Those can take minutes on a mid-sized codebase. Bend takes a second at most", and sets a target to "outperform every proof assistant by several OOMs". — [bend-lang.com](https://www.bend-lang.com/); [bendlang/bend README](https://github.com/bendlang/bend)
- HOC's own fixture `defs_12800` (12,800 definitions, Apple M4 Max, pinned 2026-09-17) measured:

  | Checker | Wall-clock |
  | --- | --- |
  | Bend | 0.295 s |
  | Rocq | 5.985 s |
  | Lean | 36.177 s |
  | Isabelle | 40 s or more (axis cap) |
  | Agda | 40 s or more (axis cap) |

  — [ai.thesatyajit.com](https://ai.thesatyajit.com/articles/bend-2)
- Critique (HN user Nezk, Sep 2026): the benchmark compares "Bend's checker to the other systems' elaborators + kernels rather than their kernels". Bend has no unification, typeclass resolution or tactics; "the latter would be a fairer comparison, and in this area the other systems are already fast". — [HN item 49746163](https://news.ycombinator.com/item?id=49746163)
- Taelin's rationale (HN, Sep 2026): "a good proof language should be fully explicit, because this reduces proof-checking time significantly ... proofs will eventually become a layer nobody looks at, just like generated assembly." He argues that caching does not help when "you change a deeply nested constant". — [HN: Bend 2 and the Vibe-Coding Trap](https://news.ycombinator.com/item?id=49753179)

**Proof effort and evidence in practice**
- The game demo's proof (12×8 grid) is "roughly 300 lines of hand-written induction". — [ai.thesatyajit.com](https://ai.thesatyajit.com/articles/bend-2)
- An HN user quoting a write-up: "Base ships one arithmetic law, U32.add_comm. There is no order theory. About 60 of PROOF.bend's 163 lines are cmp_refl, and_false, and_comm, le_max_l ... facts you'd assume exist." — [HN item 49746163](https://news.ycombinator.com/item?id=49746163)
- Independent run by hackyourworld.com: the checked-in insertion-sort proof returned "All terms check." on Bend 2.0.5, and again on 2026-10-10 at commit `e6676b0`. The author "did not reproduce" the benchmarks and did not verify the compiler. Their framing: "A proof closes the gap between implementation and formal statement; it cannot close the gap between the formal statement and human intent." — [hackyourworld.com, 2026-09-18 (updated 2026-10-10)](https://hackyourworld.com/bend-proof-ai-code-limitations/)
- Taelin on spec adequacy (HN): "'you can't win' is grossly under-specified. The goal of the demo is just to show that laws can't be broken ... they only protect what you remember to write." — [HN item 49746163](https://news.ycombinator.com/item?id=49746163)

**Runtime no longer interaction nets**
- The BendRT paper, as quoted by an independent reader: "BendRT keeps the goals and drops the mechanism: affinity gives unique ownership directly, so the graph and its duplication machinery become unnecessary. Lost is optimal reduction of shared redexes; gained are native-speed sequential code, flat memory and a cost model a programmer can read." — [ai.thesatyajit.com](https://ai.thesatyajit.com/articles/bend-2)
- The same reader found one newer benchmark (hashmap) where single-core Bend is 4.4x slower than its C twin, outside the paper's claimed 0.8 to 1.5x band. — [ai.thesatyajit.com](https://ai.thesatyajit.com/articles/bend-2)

**Proof automation product**
- "Bender" (also served as "BendAI") is "our own proprietary agent ... pairs public AI models with our own technology (dedicated models, an optimized proving harness, and SupGen, a symbolic theorem prover)".
  - Its own status: "Today Bender is a thin harness around models from Anthropic, OpenAI and others. The specialized models and SupGen ship in future updates."
  - Credits are sold at a "founder price: 50% off", and "the API opens within the coming days" (page undated, observed Oct 2026).

  — [bend-lang.com/bender](https://bend-lang.com/bender); [bend-lang.com/bendai](https://bend-lang.com/bendai)

### Inferences
- Bend 2 is the real successor to Kind as a proof checker. Compared with the plan in Aug 2025, it shipped **without** the parts tied to interaction nets and superposition: there is no HVM runtime and no hole-filling by superposed search. The planned "checker [that] must work efficiently inside HVM and under superposed search" did not ship.
- The trusted path is: the parser (unproven), then the Bend-to-BendTT translation (unproven), then the BendTT kernel (Lean-verified). For a deterministic checker like Shape, issue #1482 is a relevant lesson. A kernel can be sound while a reviewer still misreads the surface syntax, so an unambiguous surface syntax is part of the assurance story.
- The "100x faster than Lean" claim is real for HOC's fixture. But it measures a fully explicit checker against elaborating systems, not kernel against kernel. No third-party checker benchmark exists yet, and HOC says so itself.

### Gaps
- I did not read the BendTT or BendRT PDFs directly; their content here is quoted from an independent reader and from HOC's README.
- I did not establish whether anyone has claimed the $10k bounty as of 2026-10-24. I found no claim.
- I found no large verified development in Bend 2 beyond demos (sort, game, order state machines), and no peer review of BendTT.

---

## 3. Superposition (SUP/DUP), SupGen/NeoGen: mechanism, results, limitations, availability

### Takeaway
SUP nodes let one evaluation carry many alternative values. Under labels, DUP/SUP pairs either project or form cross products. As a result, evaluating a superposition of all candidate programs against tests can share work across candidates, and "collapse" reads back the survivors.

HOC's only reproducible public evidence is small, template-guided demos with interaction-count speedups against a naive generate-and-test baseline. One example is ADD-CARRY, 65,536 candidates in 36k interactions versus about 262M brute force. Everything after that is unpublished:
- the 2025 SupGen and NeoGen results (for example "sort() in 0.004s from 4 examples"),
- the claims of beating other synthesizers ("up to 1000x" in Jan 2025, then "10x or so" in Sep 2026),
- the ARC goal.

None comes with named baselines or benchmark suites. SupGen runs on the public but pre-launch HVM4; no SupGen product is available.

### Cited Findings
**Mechanism**
- HVM4 Interaction Calculus doc: "Duplications: allow a single value to exist in multiple locations; Superpositions: allow multiple values to exist in a single location".
  - DUP meeting SUP with the *same* label annihilates, like a pair projection. With *different* labels they commute, giving all combinations. Example: `(&A{1,2} + &B{10,20})` reduces to `&A{&B{11,21}, &B{12,22}}`.
  - There are four core rules: APP-LAM, DUP-SUP, APP-SUP and DUP-LAM. "Collapse" converts a superposed result back into ordinary λ-terms.

  — [HVM4 docs/theory/interaction_calculus.md](https://github.com/HigherOrderCO/HVM4/blob/main/docs/theory/interaction_calculus.md)
- Taelin (gist, about Aug 2024): "instead of trying each candidate separately, we can create a superposition of all possible functions. Then, we can apply them all to some test cases. Finally, we can collapse the result". "To get an asymptotical speedup, SUPs must be first-class, deeply ingrained into the runtime". — [Gist: Fast Discrete Program Search with HVM Superpositions (ADD-CARRY)](https://gist.github.com/VictorTaelin/d5c318348aaee7033eb3d18b0b0ace34)

**Published demo numbers (HOC, 2024)**
- ADD-CARRY: a fixed recursive template with 16 unknown bits (65,536 candidates). One `add` call is about 4k interactions, so brute force is about 262M interactions. The SUP version "returns in just 36k interactions! That's a ridiculous 7277x speedup ... sub-1 interactions per guess".
  - Caveats in the same text: "this version is greatly simplified, as I provided a template". "Even with all these tricks, the general problem is still exponential".
  - Source policy in the same text: "We'll not release the full source", plus a promised API ("EOY?" 2024).

  — [ADD-CARRY gist](https://gist.github.com/VictorTaelin/d5c318348aaee7033eb3d18b0b0ace34)
- XOR-XNOR over a tiny bit-string DSL: "Using the Omega Monad, Haskell takes about 2.8s ... while HVM takes 0.0085s". Taelin also wrote: "Obviously, this approach is dumb, exponential and computationally prohibitive". — [Gist: Accelerating Discrete Program Search with SUP Nodes](https://gist.github.com/VictorTaelin/7fe49a99ebca42e5721aa1a3bb32e278)
- Stack Overflow, 2024-08-07, Taelin as MaiaVictor: "Haskell searcher, using the Omega Monad, takes 47m guesses, or about 2.8s. Meanwhile, the HVM searcher ... takes just 1.7m interactions ... 0.03 interactions per guess ... it is very likely I'm doing something dumb ... I'd like to ask for validation." — [SO 78843195](https://stackoverflow.com/questions/78843195/can-this-discrete-program-search-have-improved-asymptotics-in-haskell)
- Independent comment on that question (Daniel Wagner): the Haskell baseline does not prune. "All terms of shape `Mat (MkO ...) ...` are clearly not going to pass `test_not`. But I think you consider all of them individually anyway. If you were able to suspend the superpositions, and throw away `Mat (MkO (Sup ... ...)) (Sup ... ...)`, instead, you'd be losing a huge chunk of the search space relatively cheaply." — [SO 78843195](https://stackoverflow.com/questions/78843195/can-this-discrete-program-search-have-improved-asymptotics-in-haskell)
- Taelin on X, 2024-08-06: "In some cases, HVM took milliseconds, versus minutes in Haskell ... Yet, I still didn't test on larger or relevant problems, so, I'll still assume there is some flaw on my reasoning and the whole thing won't scale that well." — [Taelin on X, 2024-08-06](https://x.com/VictorTaelin/status/1820662946839564343)

**SupGen and NeoGen claims (2025–2026)**
- 2025-01-20 SupGen demo: "There is no model, there is no pre-training. You just give it some examples, and it gives you a program. It runs locally, in a single-core CPU. Oh, and it can also prove theorems." It was a video only. — [Taelin on X, 2025-01-20](https://x.com/VictorTaelin/status/1881392823246729640); [YouTube demo](https://www.youtube.com/watch?v=GddkKIhDE2c). The Show HN got 21 points and no substantive technical evaluation. — [HN 42771885](https://news.ycombinator.com/item?id=42771885)
- In the hoc_thesis gist (about early 2025), HOC wrote: "SupGen, our program synthesizer that outperformed existing solutions by up to 1000x".
  - Funding: "With around $1 million remaining, we're dedicating the next two years, until the end of 2026, to this research".
  - Hardware: "$300,000 in 256 Apple M4 processors ... for running SupGen".

  — [hoc_thesis.md gist](https://gist.github.com/VictorTaelin/5d42e97684ff81f7e507aa5c149b2a64)
- On 2025-01-31, the post-seed raise (US$4M at a $100M valuation) was meant "to build a dataset with the shortest possible solution (in BLC length) for each ARC Prize instance, and use it to tune SupGen. Our immediate goal is to achieve 85% at <$1 per task ... attempt to tackle ARC AGI by EOY 2025 ... like any research, it could fail". — [Taelin on X, 2025-01-31](https://x.com/VictorTaelin/status/1885328571410853951)
- 2025-04-03: "NeoGen can now discover sort() in 0.004s in a single core CPU! No pre-training, no model ... given just 4 examples, generates a valid algorithm on its own." In a follow-up, Taelin had LLMs guess what the synthesized program does: some said "identity" or "addition", others "sort". — [Taelin on X, 2025-04-04](https://x.com/VictorTaelin/status/1908014912737096078)
- 2025-06-13: "NeoGen is awesome, but, how to ship it? We could launch a standalone 'proof synthesis' API, but ... who would use it? ... Instead, we'll train/fine-tune a *model* to use NeoGen internally ... the first coding model that is integrated with a supercharged automated theorem prover". — [Taelin on X, 2025-06-13](https://x.com/VictorTaelin/status/1933548397899739371)
- 2025-08-19: "NeoGen is a 'program miner' that exploits HVM's optimality to reduce the time it takes to evaluate each program. It is still exponential, but with a constant speedup large enough to find certain programs that were previously intractable, like a O(n*log(n)) sort." It was to be integrated into Bend2 with a Halloween 2025 launch. — [Taelin on X, 2025-08-19](https://x.com/VictorTaelin/status/1957775213053022614)
- 2025-09-28: "SupGen is now natively integrated on HVM4. Fast program/proof verifier/miner on interaction nets". A reply asked: "Are you still planning on beating the ARC-AGI benchmark or getting some demo out with automatic proofs?" — [Taelin on X, 2025-09-28](https://x.com/VictorTaelin/status/1972292868292378821)
- 2025-11-03: "HVM4 now includes a general method to compile Interaction Calculus functions to zero-overhead machine code, including functions with superpositions ... The field is all but nonexistent, there are no papers, no conventions, no community." — [Taelin on X, 2025-11-03](https://x.com/VictorTaelin/status/1985320306001477783)
- 2026-01-19: "HVM4 is mostly complete and being tested ... basically a ultra polished version of HVM1". — [Taelin on X, 2026-01-19](https://x.com/VictorTaelin/status/2013242387095597338)
- On 2026-09-18 (HN), Taelin said: "I built SupGen, which overperforms every published symbolic program synthesizer in the literature by 10x or so. This is unpublished yet". — [HN: Bend 2 and the Vibe-Coding Trap](https://news.ycombinator.com/item?id=49753179)

**Availability**
- HVM4 repo: public, created 2025-11-08, 560 commits, README "NOTE: you're here before launch. Use at your own risk." It has a collapse flag (`-C10` "collapses and flattens superpositions"). — [HigherOrderCO/HVM4](https://github.com/HigherOrderCO/HVM4)
- Independent reading of HVM4 (stillbrook.dev, 2026-07-12, updated 2026-10-18):
  - The runtime is "one 6,435-line C file" with 61 interactions.
  - Search-oriented primitives: an `ANY` wildcard ("a hole a search can fill"), stuck names, an equality node, a priority wrapper that "steers which branches the collapser visits first", and runtime-computed labels.
  - A SupGen-style benchmark in the repo outputs a program.
  - But "the word compile appears nowhere in this repository — so the public HVM4 is a very fast interpreter, and the compiler lives somewhere I cannot read yet."

  — [stillbrook.dev, "The collapse flag"](https://stillbrook.dev/articles/the-collapse-flag)
- HVM5 was announced around 2026-06-06 as about 5x faster than HVM4 and "keeps SupGen happy". It is not public: `HigherOrderCO/HVM5` returns 404. In the announcement's benchmark screenshot, some workloads (for example regex-match) are slower than on HVM4. — [stillbrook.dev, "The nodes HVM5 skips"](https://stillbrook.dev/articles/the-fifth-rewrite)
- Taelin, 2026-06-01: the new HVM approach was implemented by Opus in "about 3k lines of C". He then spent a day auditing it and found the AI "completely misunderstood how function arities work". — [Taelin on X, 2026-06-01](https://x.com/VictorTaelin/status/2061552922488398109)
- SupGen as a product: Bender/BendAI says "SupGen ... ship[s] in future updates". — [bend-lang.com/bender](https://bend-lang.com/bender)

**Known limitations of the substrate (HOC-acknowledged and from the literature)**
- HVM1 docs: HVM does not support the full λ-calculus, for example `(λx.(x x) λf.λx.(f (f x)))`, because it implements the "bookkeeping-free" (oracle-free) abstract algorithm. They also note "quadratic asymptotics for certain functions that GHC computes in linear time". — [hvm 1.0.3 docs](https://docs.rs/crate/hvm/1.0.3)
- HVM2 paper (2024-08): the source language must ensure "A higher-order lambda that clones its variable can not be cloned". — [HVM2 paper](https://raw.githubusercontent.com/HigherOrderCO/HVM/main/paper/HVM2.pdf)
- Taelin, "Truly Optimal Evaluation with Unordered Superpositions" (gist, 2024–25):
  - Redundant DUP nodes accumulate, causing quadratic slowdowns. One example: pseudo-unification by superposing all Nats is quadratic ("To fully copy the Peano Nat 1000, we would need about 1 million interactions").
  - An experimental HVM3 "unordered superposition" fix made the example linear. But Taelin says "HVM3 is not a faithful implementation of unordered superpositions". Duplicating lambdas with unordered DUPs yields "entangled" lambdas with swapped bodies, "devoid of any meaning or sense", so "unordered dups can't really be used to emulate logic-based programming with λ-encodings".

  — [Gist: Truly Optimal Evaluation with Unordered Superpositions](https://gist.github.com/VictorTaelin/93c327e5b4e752b744d7798687977f8a)
- Theory: the cost of optimal reduction's duplication can be non-elementary. "There is no elementary function in the number of shared beta steps bounding the number of duplication steps of the optimal reducer" (Asperti and Mairson). — [ACM/IC, "(Optimal) duplication is not elementary recursive"](https://dl.acm.org/doi/10.1016/j.ic.2004.05.001). For elementary and light linear logic, the sharing overhead is at most quadratic compared with proof-net reduction. — [Guerrini et al., FSCD 2017](https://drops.dagstuhl.de/entities/document/10.4230/LIPIcs.FSCD.2017.17)
- An independent reader on why HVM5 keeps duplication nodes: "Re-evaluating the closure independently would discard the sharing discipline that keeps Interaction Calculus from exploding on precisely the search programs HVM is built to run." — [stillbrook.dev](https://stillbrook.dev/articles/the-fifth-rewrite)

### Inferences
- The speedup mechanism is sharing of common prefixes and sub-computations across candidates, combined with lazy evaluation that abandons failing branches early. Classical enumerators get similar effects through memoization, observational-equivalence pruning or top-down pruning (see section 5). HOC's public comparison is against a non-pruning Omega-monad enumerator, so "7277x" and "trillions to under a million" are not evidence of an advantage over state-of-the-art synthesizers.
- The claims trend downward: "up to 1000x" (Jan 2025) became "10x or so" (Sep 2026). The planned delivery vehicles also moved: a DPS API (EOY 2024), then the ARC "Symbolic Transformer" (EOY 2025), then NeoGen inside a model (Jun 2025), then holes in Bend2 (Halloween 2025), then a future Bender update (Sep 2026). None has shipped.
- Superposition's benefit depends on the problem's structure. The documented failure modes are:
  - label discipline: same versus different labels decides whether choices pair up or multiply;
  - duplication of higher-order functions, which is restricted or incorrect;
  - quadratic overhead from accumulated DUP nodes;
  - non-elementary duplication cost in the worst case;
  - an underlying search that stays exponential, which HOC states repeatedly.

### Gaps
- No public SupGen/NeoGen source, benchmark suite, named baselines (for example Myth, Smyth, Burst, MagicHaskeller, SyGuS solvers or λ²), or success rates were found. The "1000x" and "10x" claims cannot be checked.
- No ARC-AGI score from HOC was found. The ARC Prize 2025 results (top Kaggle score 24% on ARC-AGI-2) show no HOC entry in what I saw, but I did not exhaustively check every leaderboard. — [ARC Prize 2025 results](https://arcprize.org/blog/arc-prize-2025-results-analysis?full=1)
- I could not read the Stack Overflow answers (fetch blocked). Only comments were extracted, so I do not know whether an answer matched HVM's asymptotics with a smarter Haskell enumerator.
- The HVM4 repository license was not visible in what I fetched.

---

## 4. HOC's 2025–2026 claims about theorem proving, program search and AI products, and independent evidence

### Takeaway
HOC's AI positioning moved through three stages:
1. Jan 2025: symbolic AI and the ARC Prize, with SupGen as a "Symbolic Transformer".
2. Mid-2025: NeoGen as an "automated theorem prover" inside a coding model.
3. Sep 2026: Bend 2 as a proof gate for LLM-written code, plus a paid proving agent.

Only the third stage has shipped artifacts. Its proof checker has been independently exercised and read. The search and synthesis component has no independent evidence beyond HOC's own posts and small public demos.

### Cited Findings
- HOC thesis: "Our ambitious goal is to create a purely symbolic AI architecture that replaces computationally heavy operations—like matrix multiplications and gradient" descent. Also: "potentially enabling us to offer an alternative to services like ChatGPT". — [hoc_thesis.md gist](https://gist.github.com/VictorTaelin/5d42e97684ff81f7e507aa5c149b2a64)
- ARC target, 2025-01-31: "85% at <$1 per task ... by EOY 2025". — [Taelin on X](https://x.com/VictorTaelin/status/1885328571410853951)
- NeoGen product plan, 2025-06-13: fine-tune a model to use NeoGen "as its 'brain'" — a "reasoning calculator". — [Taelin on X](https://x.com/VictorTaelin/status/1933548397899739371)
- Bend 2 launch rhetoric, 2026-09-17: proof checking is "the same technique big AI labs used to solve open math problems, like Navier-Stokes". An independent reader: "Bend's checker did not touch the Navier-Stokes proof ... and Taelin's post doesn't claim otherwise". The analogy is to Lean-checked AI proofs. — [Taelin on X](https://x.com/VictorTaelin/status/2100681226143092875); [ai.thesatyajit.com](https://ai.thesatyajit.com/articles/bend-2)
- Bender/BendAI: a proprietary proving agent sold in credits. It is today "a thin harness around models from Anthropic, OpenAI and others". — [bend-lang.com/bender](https://bend-lang.com/bender)
- Independent critique of claims (HN, Sep 2026):
  - "it reads as though the language ... is equipowerful to state of the art proof assistants while being orders of magnitude more performant. That is a huge claim that has not yet been substantiated".
  - On an earlier Taelin theory repo: "no proofs that it works, no measurements, and no proper citations".
  - Taelin's Google Scholar profile was cited as evidence of no academic publication record. Other commenters pointed to his long public track record in the area.

  — [HN item 49746163](https://news.ycombinator.com/item?id=49746163); [HN item 49753179](https://news.ycombinator.com/item?id=49753179)
- Trust controversy: one HN commenter said the author "nuked their commit history while simultaneously pointing to a (Fable-written) paper which referenced the commit history in benchmarks". — [HN item 49753179](https://news.ycombinator.com/item?id=49753179) (single-commenter claim; not independently verified by me)

### Inferences
- For decision-making, treat SupGen/NeoGen/Bender-with-SupGen as **vapor until released**. Treat the Bend 2 checker as a **real, young, single-vendor artifact** with an unusually candid list of limitations.
- HOC is a small, low-runway company: about $1M left in early 2025 to fund research through the end of 2026, per its own thesis. That creates continuity risk for any dependency.

### Gaps
- No public statement was found on whether the Jan 2025 post-seed closed, or on HOC's current funding.
- No third-party evaluation of Bender/BendAI's proving success rate was found.

---

## 5. Academic and independent evaluations of superposition-based search or optimal-reduction-based enumeration

### Takeaway
I found **no peer-reviewed or independent empirical evaluation** of SupGen, NeoGen or SUP-node program search. HOC itself says "there are no papers" (2025-11-03). The relevant literature has three parts:
- older theory on the cost of optimal reduction;
- mainstream enumerative synthesis, which already gets sharing and pruning by other means;
- a separate, unrelated line of "superposition"-calculus synthesis in first-order provers, which is a name collision to watch for.

### Cited Findings
- Taelin, 2025-11-03: "there are no papers, no conventions, no community" in interaction-net search. — [Taelin on X](https://x.com/VictorTaelin/status/1985320306001477783)
- Name collision: "Completeness of Synthesis under Realizability Assumptions using Superposition" (arXiv 2605.19683, 2026-05-19). It extends the **superposition calculus** of first-order theorem proving (Vampire) to synthesize recursion-free programs, and proves soundness and completeness. It has nothing to do with HVM SUP nodes. — [arXiv 2605.19683](https://arxiv.org/abs/2605.19683); earlier work: [Hozzová, Kovács, Voronkov, "Towards Synthesis in Superposition" (2022)](https://2www.easychair.org/publications/preprint/FCSW); FSCD 2026 invited talk on saturation-guided inductive synthesis: [LIPIcs vol. 378](https://drops.dagstuhl.de/entities/volume/LIPIcs-volume-378)
- Mainstream enumerative synthesis already exploits redundancy:
  - "a number of synthesizers, e.g., the enumerative SyGuS solver, prune the search space using observational equivalence", and equivalence reduction can be built into bottom-up and top-down search. — [Smith and Albarghouthi, "Program Synthesis with Equivalence Reduction", VMCAI 2019](https://pages.cs.wisc.edu/~aws/papers/vmcai19.pdf)
  - Bottom-up enumerators that enumerate "based on the program size (with sharing)" (DryadSynth, among others). — [Oriented Metrics for Bottom-Up Enumerative Synthesis, PACMPL 2026](https://dl.acm.org/doi/full/10.1145/3776717)
- MagicHaskeller, a type-directed exhaustive synthesizer and the closest classical analogue to SupGen's type- and example-directed search, "synthesizes functional Haskell programs through an exhaustive search of programs with the correct type signatures" and removes semantically equivalent programs. Benchmarking inductive synthesis across systems is acknowledged to be difficult. — [On the Difficulty of Benchmarking Inductive Program Synthesis Methods (GECCO 2017)](http://www.cmap.polytechnique.fr/~nikolaus.hansen/proceedings/2017/GECCO/companion/companion_files/wksp217s1-file1.pdf)
- On formal SyGuS benchmarks, "GPT-3.5 as a stand-alone tool for formal synthesis is easily outperformed by state-of-the-art formal synthesis algorithms". LLM-guided enumeration beats both the LLM alone and pure enumeration. — [Guiding Enumerative Program Synthesis with LLMs (arXiv 2403.03997)](https://arxiv.org/html/2403.03997v1)
- Optimal-reduction cost theory: non-elementary duplication in the worst case ([Asperti and Mairson](https://dl.acm.org/doi/10.1016/j.ic.2004.05.001)); quadratic overhead bound for elementary and light logics ([FSCD 2017](https://drops.dagstuhl.de/entities/document/10.4230/LIPIcs.FSCD.2017.17)); EAL type inference to make terms optimally reducible ([Coppola and Martini, arXiv cs/0305011](https://arxiv.org/pdf/cs/0305011)).
- ARC context: "Until 2024, all top ARC-AGI approaches relied on discrete program search", starting with icecuber's 2020 brute-force entry. The 2024 state of the art was driven by "deep learning-guided program synthesis and test-time training". — [ARC Prize 2024 Technical Report](https://arxiv.org/html/2412.04604). The 2025 theme was "refinement loops". — [ARC Prize 2025 results](https://arcprize.org/blog/arc-prize-2025-results-analysis?full=1)
- Independent but non-empirical: stillbrook.dev's readings of HVM4 and HVM5 source and announcements (2026-07-12, updated 2026-10-18) confirm the search primitives exist in public code. They do not measure synthesis quality. — [stillbrook.dev](https://stillbrook.dev/articles/the-collapse-flag)

### Inferences
- The novelty claim is narrow: sharing *runtime evaluation* of candidates through first-class SUP nodes in an optimal-reduction engine. Background knowledge, not sourced in this research: version space algebras, e-graphs and observational-equivalence enumeration also share candidate *representations* and prune equivalent ones. A fair evaluation would compare SupGen against such tools on a public suite (SyGuS, the Myth/Smyth benchmarks, or ARC). No such comparison exists.
- A reviewer must not conflate "superposition-based synthesis" in the theorem-proving literature with HOC's SUP nodes.

### Gaps
- No independent replication, benchmark or peer-reviewed paper on SUP-node synthesis was found.
- I did not locate academic citations of HVM/Interaction Calculus search work (none surfaced in searches).

---

## 6. Relevance to Shape's candidate uses (searching many model variants, synthesizing rules/specs, proving properties of a checker)

### Takeaway
- **Model and counterexample search:** SUP-style shared evaluation is an interesting idea, but today it is usable only by rewriting Shape's checker in HVM4's pre-launch Interaction Calculus dialect, with no released search frontend and documented sharing pathologies. Mature SAT/SMT/enumeration tooling is lower risk.
- **Spec synthesis:** SupGen/NeoGen is not available, and HOC's own synthesis product is currently an LLM harness.
- **Proving the checker:** Bend 2 is a real option for proving properties of a *reimplementation* of Shape's checker logic in Bend, with a Lean-backed kernel. It does not verify Rust code, has no automation, and is weeks old.

### Cited Findings
- To use SUP search, the evaluated function must run inside HVM; per Taelin, SUPs "must be first-class, deeply ingrained into the runtime". — [ADD-CARRY gist](https://gist.github.com/VictorTaelin/d5c318348aaee7033eb3d18b0b0ace34). HVM4 is "before launch. Use at your own risk". — [HVM4](https://github.com/HigherOrderCO/HVM4)
- Collapse yields enumerated answers (`-C10`), and HVM4 includes `ANY` holes, an equality node and a priority wrapper for steering search. These are the building blocks for "evaluate many model mutants, keep the ones that violate or satisfy a property". — [stillbrook.dev](https://stillbrook.dev/articles/the-collapse-flag)
- Sharing fails or degrades in known cases: cloning higher-order closures, accumulated DUP nodes, and the restriction that "a higher-order lambda that clones its variable can not be cloned". — [Unordered superpositions gist](https://gist.github.com/VictorTaelin/93c327e5b4e752b744d7798687977f8a); [HVM2 paper](https://raw.githubusercontent.com/HigherOrderCO/HVM/main/paper/HVM2.pdf)
- Bend 2 proves properties of Bend programs only. Its laws are "proven about Bend's semantics", and the "backends can still differ". It has Nat/U32/F32 only and no tactics. — [bendlang/bend README](https://github.com/bendlang/bend)
- Bend 2's `LAWS.bend` workflow (a human-reviewed law file, agent-written proofs, and a proof gate in CI) is explicitly framed as moving review to the specification. Independent commentators say "a perfect proof of the wrong law is still wrong software", and recommend protecting the law file with ownership rules and human review. — [hackyourworld.com](https://hackyourworld.com/bend-proof-ai-code-limitations/)
- Parsing and readability gaps can make a proven statement differ from what a reviewer believes it says (#1482). — [bendlang/bend#1482](https://github.com/bendlang/bend/issues/1482)

### Inferences
- **Searching many variants of a model:** this is the most natural fit conceptually. Mutants of a model that share most structure are exactly the case where shared evaluation helps. But the practical cost is high:
  - porting the checker semantics into the Interaction Calculus;
  - managing labels so choices multiply as intended;
  - avoiding higher-order duplication.

  The evidence of a speedup over a pruning enumerator is missing. A small experiment would be cheap to scope: encode a toy Shape-like rule evaluation over superposed mutants in HVM4 and compare against a memoizing Rust enumerator. Until then, treat it as speculative.
- **Synthesizing rules or specs from code:** nothing usable is released. Bender's current behavior (an LLM harness) adds nothing over calling LLMs directly.
- **Proving properties of a checker:** Bend 2's design (explicit proofs, a fast checker, a small Lean-verified kernel, and agent-written proofs gated in CI) matches the "deterministic checker plus reviewed claims" philosophy. However:
  - Shape is pursuing Verus for Rust, and Bend cannot verify the Rust implementation.
  - A Bend model of the checker would be a second artifact whose correspondence to the Rust code is itself unproven.
  - Bend 2 is about five weeks old, with a 99% AI-written compiler (irrelevant if only the checker is used) and one main vendor.

  The ideas (affinity for consistency, explicit-proof fast kernels, `LAWS` files as review surfaces) are more transferable than the tools.

### Gaps
- No public evidence shows Bend 2 or HVM being used to verify a non-trivial checker or interpreter.
- No interoperability path from Bend to Rust/Verus (or vice versa) was found.
