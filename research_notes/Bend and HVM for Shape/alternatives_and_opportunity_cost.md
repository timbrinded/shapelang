# Alternatives to Bend/HVM for Shape's jobs, and the opportunity cost of choosing Bend

Scope: for each job people hope Bend/HVM would do for Shape (rule evaluation, incremental re-checking, many-variant exploration, spec/model synthesis, proving the checker, parallel speedups), the strongest established alternatives, their maturity, embedding story (TypeScript/WASM/Rust), determinism, and use in comparable tools. Bend internals are out of scope (another researcher covers them); Bend appears only for comparison. Current as of 2026-10-24. Vendor and author claims are labelled as such.

Local context used throughout (from this repository):
- Production rules are direct TypeScript checks over typed indexes, decided 2026-07-26 (issue #39). A Datalog spike (`packages/shp-checker/src/experiments/datalog-rule-engine-spike.ts`) reproduced `missing_grant` with one anti-join rule but was not adopted. Listed reasons: the fact stream is not a complete rule database, precedence and canonical witness selection live in control flow, and Shape would have to own stratification, indexing and proof selection. The decision is reopened only if (a) several rules duplicate the same multi-relation join, (b) profiling shows rule evaluation is a meaningful bottleneck, or (c) incremental checking needs dependency-tracked derived facts — [Rule Evaluation doc](../../docs-site/src/content/docs/inside-shape/rule-evaluation.md)
- The E10 mutation run of Shape's own model used `shp check` as the oracle over 222 files: 79,415 M1 + 181 M2 + 502 M3 + 1,876 M4 mutants plus probes (about 82,000 in total). Reruns were byte-identical. M1 "is predicted exactly by one fact: a mutant survives iff its component already grants that effect." Batched M1 runs agreed with 80/80 single runs — [E10 report](../../experiments/verus-probes/e10/REPORT.md)

## Q1. Rule evaluation and graph queries: embeddable Datalog engines and who uses them

### Takeaway
Mature, deterministic Datalog engines exist in C++ (Soufflé) and as Rust embeddings (Ascent, Crepe, datafrog). Large-fact-base analysis platforms use them (CodeQL, Glean, Doop, DDisasm). Small-graph architecture checkers do not: ArchUnit and dependency-cruiser use direct code over an in-memory graph, which is what Shape already does. None of Shape's rule workloads needs Bend: the strongest alternative to the current design is a Rust Datalog crate compiled to WASM, and Shape has already judged even that not worth its cost today.

### Cited Findings
**Engines (maturity, embedding)**
- Soufflé synthesizes a native parallel C++ program from a Datalog specification. It was designed at Oracle Labs for large-scale static analysis such as points-to, taint and security checks, and supports records/ADTs, a component model, and an interpreter mode (PLDI'21) as well as compilation (CAV'16, CC'16). License UPL-1.0 — [Soufflé GitHub](https://github.com/souffle-lang/souffle); [Soufflé docs](https://souffle-lang.github.io/docs.html)
- Soufflé 2.5 was released 2025-03-25 (previous release 2.4 in March 2023), so releases are slow but ongoing — [Soufflé feed](https://souffle-lang.github.io/feed.xml)
- Soufflé provenance (`-t explain`) yields proof trees of minimal height. It is lazy: proof trees are built only on query, from per-tuple annotations (the producing rule and the minimal proof height) recorded during evaluation — [Soufflé provenance docs](https://souffle-lang.github.io/provenance)
- Ascent is Datalog embedded in Rust via macros. crates.io shows v0.8.0, released "over 1 year ago" as of this check, with a `wasm-bindgen` feature for WASM environments — [crates.io ascent](https://crates.io/crates/ascent)
- Ascent paper (CC 2022, author benchmarks): performance is "comparable to Datafrog and Soufflé" and about two orders of magnitude faster than Flix (56×–172×). On clique-finding, Ascent vs single-threaded Soufflé ranged from 0.8× to 1.6×. Datafrog was up to ~4× faster on the Polonius borrow-check benchmarks. At publication Ascent's generated code was single-threaded while Soufflé could generate multi-threaded code — [Ascent CC'22 paper](https://s-arash.github.io/ascent/cc22main-p95-seamless-deductive-inference-via-macros.pdf)
- Crepe: a Datalog compiler embedded in Rust as a procedural macro, with semi-naive evaluation, stratified negation, automatic index generation and calls to Rust functions from rules — [Crepe GitHub](https://github.com/ekzhang/crepe)
- datafrog: "a lightweight Datalog engine intended to be embedded in other Rust programs". It has no runtime, so the user builds and repeatedly applies update rules. Hosted in the rust-lang org (~900 stars) — [datafrog GitHub](https://github.com/rust-lang/datafrog)
- DDlog (Differential Datalog) compiles to a Rust library for incremental computation. The repository now sits under the `vmware-archive` GitHub organization — [DDlog GitHub](https://github.com/vmware-archive/differential-datalog)
- CozoDB (Datalog DB with WASM, Node, Python and Rust bindings) is tagged "Abandoned" by the Database of Databases (last commit Dec 2024). A Dec 2025 GitHub issue asks whether it is still maintained — [DBDB CozoDB](https://dbdb.io/db/cozodb); [cozo issue #301](https://github.com/cozodb/cozo/issues/301); [cozo GitHub](https://github.com/cozodb/cozo)
- Nemo (TU Dresden) is a Rust Datalog engine with stratified negation, datatypes, aggregates and existential rules. It is available as the `nmo` CLI, through language bindings, and as a browser web app. Its README says it "is in heavy development and the current releases should still be considered unstable" — [Nemo GitHub](https://github.com/knowsys/nemo); [ICCL Nemo page](https://iccl.inf.tu-dresden.de/web/Nemo/en); [Dagstuhl artifact, Oct 2025](https://drops.dagstuhl.de/entities/artifact/10.4230/artifacts.25064)
- JavaScript-side options are mostly Datomic-style query engines rather than analysis engines, e.g. DataScript ("Immutable database and Datalog query engine for Clojure, ClojureScript and JS") — [Roam-Research GitHub listing](https://github.com/Roam-Research)
- Z3 ships an official WebAssembly build with TypeScript bindings on npm (`z3-solver`). The package "requires threads", i.e. an environment that supports `SharedArrayBuffer` — [z3-solver npm](https://www.npmjs.com/package/z3-solver); [Z3 JS API docs](https://z3prover.github.io/api/html/js/index.html)
- egglog unifies Datalog and equality saturation: incremental execution, lattice-based reasoning, term rewriting and congruence closure (PLDI 2023) — [egglog paper](https://dl.acm.org/doi/10.1145/3591239)

**Use in comparable tools**
- CodeQL: a QL program "is compiled into a variant of … Datalog", optimized, then evaluated bottom-up to sets of tuples — [CodeQL evaluation docs](https://codeql.github.com/docs/ql-language-reference/evaluation-of-ql-programs); QL's own paper describes its translation to Datalog (Semmle, ECOOP 2016) — [QL ECOOP'16](https://drops.dagstuhl.de/storage/00lipics/lipics-vol056-ecoop2016/LIPIcs.ECOOP.2016.2/LIPIcs.ECOOP.2016.2.pdf)
- Glean (Meta) stores typed, schema-defined facts about code in RocksDB and queries them with Angle, "a logic language with similarities to Datalog" that can derive new facts by rules — [Glean intro](https://glean.software/docs/introduction); [Glean home](https://glean.software/)
- Doop (Java points-to), GrammaTech's DDisasm (disassembler) and EVM lifters are written in Soufflé — [Soufflé applications](https://souffle-lang.github.io/applications)
- ArchUnit is a plain Java library. It imports bytecode into a Java structure and checks layer, slice and cycle rules through a fluent Java DSL, not a logic engine; latest news shows v1.4.2 (Apr 2026) — [ArchUnit user guide](https://www.archunit.org/userguide/html/000_Index.html); [ArchUnit site](https://www.archunit.org/)
- dependency-cruiser expresses forbidden/required rules as JSON over the module graph, with `circular`, `reachable` and `via`/`viaOnly` cycle filters, and reports the cycle path in results. These are direct graph rules, not Datalog — [dependency-cruiser rules reference](https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md); [cruise-result schema](https://raw.githubusercontent.com/sverweij/dependency-cruiser/main/src/schema/cruise-result.schema.json)

### Inferences
- The industry pattern splits by scale. Datalog engines appear where fact bases have millions to billions of tuples and rule sets are large and user-extensible (CodeQL, Glean, Doop). Architecture-rule checkers over small graphs (ArchUnit, dependency-cruiser) use direct code. Shape's model (24 components, 79 resources, 73 relations in E10) is firmly in the small-graph class, which supports the #39 decision.
- If Shape ever reopens #39, the lowest-friction path consistent with its existing Rust/WASM kernel prototype is Ascent or Crepe compiled to WASM (or datafrog for a few hand-written joins), not Soufflé (C++ toolchain, no official WASM story found) and not CozoDB (abandoned). Nemo is attractive because it pairs with a verified Lean checker (Q5), but it self-describes as unstable.
- Shape's canonical shortest-witness rules (BFS with codepoint-ordered tie-breaking, Tarjan SCC) are not plain Datalog. Soufflé's "minimal height" proof trees are the nearest analogue but do not specify Shape's tie-break order, so any engine would still need a specialized witness step, as the #39 parity requirements already note.
- Bend offers nothing here that these engines lack. Rule evaluation is set-at-a-time relational work where indexes and semi-naive evaluation matter. Bend's selling point is automatic parallel reduction of functional programs, and the rules themselves are ~2% of check time (Q6).

### Gaps
- No primary source found on Soufflé running in WASM or in Bun, or on Ascent's current parallel-evaluation support (the CC'22 paper says single-threaded; later versions may differ).
- No primary source retrieved on Z3's μZ/Spacer fixedpoint engine status.
- Polonius's current relationship to datafrog (whether the in-tree implementation still uses it) was not verified.

## Q2. Incremental re-checking: salsa, Adapton, differential dataflow/DBSP, incremental Datalog

### Takeaway
Incremental computation is a solved, production-proven problem for developer tools. salsa backs rust-analyzer and Astral's ty, and DBSP/Feldera and differential dataflow offer general incremental view maintenance with a correctness theory. Several incremental Datalog solvers exist for static analysis. These directly target "re-check after a small change" with a determinism contract, which Bend does not offer.

### Cited Findings
- salsa: "define your program as a set of queries"; results are memoized and re-used when inputs change. It "assumes that `your_program` is a purely deterministic function of its inputs" and uses a red-green algorithm with revisions and a "durability" optimization. It is "inspired by adapton, glimmer, and rustc's query system" — [salsa overview](https://salsa-rs.github.io/salsa/overview.html); [salsa algorithm](https://salsa-rs.github.io/salsa/reference/algorithm.html); [salsa GitHub](https://github.com/salsa-rs/salsa)
- rust-analyzer uses salsa to avoid recomputing analysis after each change, "tak[ing] advantage of the fact that most of the changes are small" — [rust-analyzer guide](https://rust-analyzer.github.io/book/contributing/guide.html); the rustc dev guide notes salsa is used "extensively in rust-analyzer" with "no medium or long-term concrete plans to integrate it into the compiler" — [rustc-dev-guide](https://rustc-dev-guide.rust-lang.org/queries/salsa.html)
- Astral's ty (Python type checker, Beta 2025-12-16): "The entire ty architecture is built around 'incrementality'". Its contributing guide says "We use the Salsa library for incremental computation" — [Astral ty blog](https://astral.sh/blog/ty); [ty CONTRIBUTING](https://github.com/astral-sh/ruff/blob/main/crates/ty/CONTRIBUTING.md)
- Adapton (PLDI 2014): demand-driven incremental computation with OCaml and Rust implementations; academic — [Adapton paper page](http://matthewhammer.org/adapton); [Adapton home](https://plum-umd.github.io/adapton/)
- DBSP (VLDB 2023, Budiu, Chajed, McSherry et al.; journal version in VLDB Journal 2025) gives an algorithm that converts any DBSP program into an incremental one and shows that "SQL and Datalog can be directly implemented on top of DBSP" — [DBSP PVLDB'23](https://www.vldb.org/pvldb/vol16/p1601-budiu.pdf); [DBSP VLDB Journal 2025](https://link.springer.com/article/10.1007/s00778-025-00922-y)
- The `dbsp` Rust crate "implements it incrementally, meaning that changes to the data set run in time proportional to the size of the change rather than the size of the data set" — [dbsp crate](https://crates.io/crates/dbsp). Feldera (the company behind it) claims the theory is "formally verified" and won VLDB'23 Best Paper; that is a vendor claim — [Feldera overview](https://www.feldera.com/overview); [Feldera GitHub](https://github.com/feldera/feldera)
- LADDDER (PLDI 2021), an incremental Datalog solver with lattices, provides "up-to-date points-to, constant propagation, and interval information in milliseconds" on real-world Java (author evaluation) — [ACM DL](https://dl.acm.org/doi/10.1145/3453483.3454026)
- Soufflé "elastic incrementalization" (PPDP 2021) switches between full recomputation for high-impact changes and incremental update for low-impact ones — [Soufflé PPDP'21](https://souffle-lang.github.io/ppdp21.html). A 2025 TPLP paper extends incremental Soufflé with incremental provenance for fault localization and rollback in CI-style evolving inputs (Doop on DaCapo) — [TPLP 2025](https://www.cambridge.org/core/journals/theory-and-practice-of-logic-programming/article/provenance-guided-rollback-suggestions/B95F33BD5A3D55E58F8B4A68F4437595)
- TypeScript 7 keeps determinism under parallelism by construction: type-checking workers "may end up duplicating some common work, but given the same input files, they will always divide them identically and produce the same results" — [TypeScript 7.0 announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0)
- Shape's checker already has a coarse incremental cache. It keys cached results on, among other inputs, the base model's attestation keys and attestation-free texts and the repository file list — [Rule Evaluation doc](../../docs-site/src/content/docs/inside-shape/rule-evaluation.md)

### Inferences
- Per-file parsing dominates Shape's check time (Q6), so the highest-value incremental step is a salsa-style query split: parse per file, keyed on file text, then lower and run rules. This can be done in TypeScript with a memo table keyed by content hash, without adopting any engine. Lowering and rules are cheap enough to rerun whole.
- DBSP/differential dataflow would matter only if Shape moves rule logic into relations (#39 trigger c). Even then the model is small enough that full recomputation of rules (~2% of a 0.75 s run) is cheaper than maintaining incremental state.
- Bend has no incremental-computation model. Its "superposition" sharing is a different mechanism: optimal sharing inside one evaluation, not memoization across runs. It is therefore not a substitute for salsa or DBSP for this job.

### Gaps
- No independent benchmark found comparing salsa, DBSP and hand-rolled memoization on small inputs (hundreds of files), the regime Shape is in.

## Q3. Many-variant exploration (mutation testing, counterfactual model edits)

### Takeaway
The established ways to share work across many variants are mutant schemata and split-stream execution, coverage-based test selection, equivalence and duplicate pruning, lifted/variability-aware analysis (including lifted Datalog), provenance and deletion propagation, BDDs and SAT model finding, and predictive models. They report speedups from about 2× to orders of magnitude without new runtimes. For Shape's E10 the biggest win is analytic: the 79,415-mutant M1 operator is predicted exactly by one join. The graph-edge mutants can likewise be answered from base-graph reachability in one pass. "Superposition" is not needed to share work across Shape's mutants.

### Cited Findings
**Mutation-testing cost reduction**
- Mutant schemata compile all mutants into one executable. In AccMut's replication, schemata were on average 9.62× faster than plain mutation analysis, split-stream execution was 3.49× faster than schemata (consistent with Tokumoto et al. 2016), and AccMut (equivalence modulo states) was 2.56× faster than split-stream and 8.95× faster than schemata — [AccMut arXiv](https://arxiv.org/pdf/1702.06689); [ISSTA'17](https://dl.acm.org/doi/10.1145/3092703.3092714)
- MuVM (ICST 2016) combines metamutation, mutation on a VM (compile once, invoke one process), higher-order split-stream execution and online adaptation — [MuVM](https://www.computer.org/csdl/proceedings-article/icst/2016/1827a320/12OmNBOUxiL)
- Clang-front-end optimisations (STVR 2024) cite schemata giving "an order of magnitude improvement" in prior studies and split-stream reducing overhead by roughly 2× — [Vercammen et al. STVR 2024](https://onlinelibrary.wiley.com/doi/full/10.1002/stvr.1865); [arXiv](https://arxiv.org/pdf/2210.17215v1)
- StrykerJS (the JS/TS mutation tool) adopted mutation switching (schemata) in v4.0 ("20% to 70% speed increase") and per-test coverage analysis ("40% and 60%"). v6 added "hot reload": load tests once and switch the active mutant between runs — [Stryker 4.0 announcement](https://angular.love/announcing-stryker-4-0-mutation-switching); [StrykerJS v6 blog](https://stryker-mutator.io/blog/stryker-js-v6-expeditious-superior-mutations)
- Trivial Compiler Equivalence (ICSE 2015) discards >7% of mutants as equivalent and 21% as duplicates by comparing compiled binaries — [TCE ICSE'15](https://dl.acm.org/doi/abs/10.5555/2818754.2818867); [TCE TSE 2018](https://www.computer.org/csdl/journal/ts/2018/04/07882714/13rRUxBa5ty)
- Predictive Mutation Testing (ISSTA 2016/TSE) predicts kill/survive without executing mutants: "up to 151.4X" efficiency with small accuracy loss, AUC above 0.80 for most of 163 projects — [PMT ISSTA'16](https://dl.acm.org/doi/10.1145/2931037.2931038); [PMT TSE](https://ieeexplore.ieee.org/document/8304576)
- Subsuming-mutant selection removes redundant mutants (definition and survey in TOSEM 2022) — [Mutant Reduction Evaluation, TOSEM](https://dl.acm.org/doi/10.1145/3522578). A 2025 seminar reports that strongly subsuming second-order mutants "do not seem to contribute to any further reduction" beyond subsuming first-order mutants (slides, not peer-reviewed) — [LabSoft 2025 slides](https://labsoft-ufmg.github.io/seminars/2025/lasse2025diniz.pdf)

**Lifted / variability-aware analysis (the closest established analogue to "superposition")**
- Variability-aware Datalog: a modified Soufflé takes facts annotated with presence conditions and computes the presence conditions of derived facts (PADL 2020) — [Shahin & Chechik PADL'20](https://link.springer.com/content/pdf/10.1007/978-3-030-39197-3_14.pdf)
- Lifted Datalog analyses (ESEC/FSE 2019; TSE 2023) report "billions of times faster on one of the benchmarks" than brute-force per-product analysis; for BerkeleyDB, lifted context-insensitive analysis is "about 7.4 billion times faster than brute-force". The baseline enumerates an exponential number of products — [FSE'19](https://dl.acm.org/doi/10.1145/3338906.3338928); [arXiv](https://arxiv.org/html/1907.02192v2); [TSE 2023](https://dl.acm.org/doi/10.1109/TSE.2022.3175752)
- Other lifted analyses: VarAlyzer (C product lines, IFDS/IDE) is on average 7.5× faster than compile-and-analyze per variant — [VarAlyzer, ASE journal 2022](https://link.springer.com/article/10.1007/s10515-022-00333-1); SPLlift lifts any IFDS analysis via BDD presence conditions (Dagstuhl 13091 report) — [Dagstuhl report](https://drops.dagstuhl.de/storage/04dagstuhl-reports/volume03/issue02/13091/DagRep.3.2.144/DagRep.3.2.144.pdf); Kästner et al. give an empirical study of variability-aware analysis at scale — [TOSEM 2018](https://www.cs.cmu.edu/~ckaestne/pdf/tosem18.pdf)

**Provenance and deletion propagation (evaluate once, answer many removal variants)**
- Provenance semirings (PODS 2007) unify why-provenance, incomplete and probabilistic databases, and extend to Datalog — [Green et al.](https://dl.acm.org/doi/10.1145/1265530.1265535); Datalog provenance circuits define and support the *deletion propagation* problem (evaluate the program after deleting given tuples) — [Deutch et al. ICDT'14](https://www.math.tau.ac.il/~milo/projects/bpq/papers/icdt14b.pdf); deletion as a provenance property — [Revisiting Semiring Provenance for Datalog, KR 2022](https://arxiv.org/html/2202.10766v2)
- Cost caveat: why-provenance for recursive Datalog is computationally hard "even if the recursion is limited to be linear" (PODS 2024), and SAT solvers can enumerate explanations one at a time (AAAI 2024) — [Complexity of Why-Provenance](https://dl.acm.org/doi/10.1145/3651146); [SAT-based why-provenance](https://ojs.aaai.org/index.php/AAAI/article/view/28914)
- Scallop (Datalog with provenance-semiring tags) is a working implementation of tag propagation — [Scallop book](https://www.scallop-lang.org/doc/probabilistic/provenance.html)

**BDDs, e-graphs, SAT model finding**
- bddbddb (APLAS 2005) represents Datalog relations as BDDs. Its context-insensitive points-to analysis was "about twice as fast as a carefully hand-tuned version" — [bddbddb paper](https://link.springer.com/chapter/10.1007/11575467_8); [bddbddb site](https://bddbddb.sourceforge.net/)
- E-graphs: egg (POPL 2021) makes equality saturation fast and extensible, used for "rewrite-driven compiler optimizations and program synthesizers" — [egg](https://dl.acm.org/doi/10.1145/3434304). Cranelift's acyclic e-graph mid-end is in production in Wasmtime for untrusted WebAssembly — [Fallin, Apr 2026](https://cfallin.org/blog/2026/04/09/aegraph/); [EGRAPHS'23 talk](https://pldi23.sigplan.org/details/egraphs-2023-papers/2/-graphs-Acyclic-E-graphs-for-Efficient-Optimization-in-a-Production-Compiler); [Cranelift](https://cranelift.dev/). Herbie adopted egglog for floating-point rewriting — [EGRAPHS'23](https://pldi23.sigplan.org/details/egraphs-2023-papers/7/egglog-In-Practice-Automatically-Improving-Floating-point-Error)
- Alloy is a relational model finder: Kodkod/Pardinus reduce bounded relational logic to SAT and search for counterexamples. It ships as a self-contained Java jar usable as an API — [Practical Alloy: model finding](https://practicalalloy.github.io/chapters/structural-topics/topics/model-finding/index.html); [Alloy docs](https://alloytools.org/documentation.html); [Alloy FAQ](https://alloytools.org/faq/what_kind_of_analysis_does_the_alloy_analyzer_do.html)

**Shape-specific evidence**
- E10: M1 (79,415 add-effect mutants) survives iff the component already grants the effect; all 1,027 survivors are intra-component spread. M3 (502 add-`calls` mutants) and M4 (1,876 add-`provides` mutants) are killed only by `forbid path`, `forbid hypercycle` and `forbid provides`. Kill sets for path clauses nest (40 ⊂ 48 ⊂ 68) — [E10 report](../../experiments/verus-probes/e10/REPORT.md)

### Inferences
- For Shape's mutation operators, the cheapest "work sharing" is closed-form, not a new runtime:
  - M1/M2 reduce to a join of effects against grants, which is the anti-join the #39 Datalog spike already expresses.
  - For edge additions, adding `u → v` creates a forbidden `s → t` path iff `s` reaches `u` and `v` reaches `t` in the base graph. It creates a cycle iff `v` reaches `u`.
  - One transitive closure of a ~24-node component graph therefore answers all 502 M3 mutants at once. Witnesses still need Shape's canonical BFS, but only for killed mutants.
- Per-mutant costs are dominated by re-parsing (Q6). A schemata-style harness (parse and lower once, apply each mutation to the lowered model, rerun only the rule registry) would remove most of the per-mutant cost. This is the direct analogue of Stryker's mutation switching and hot reload, and it needs no new runtime.
- Lifted/presence-condition Datalog is the established technique closest to HVM "superposition" (evaluate all variants in one pass, sharing common derivations). It has peer-reviewed evidence at scale; superposition-based sharing has none for this workload.
- Alloy or Z3 (WASM) would be the established tools for the inverse question, "find any model edit that passes all rules yet violates property P", which enumeration over mutants cannot answer exhaustively.

### Gaps
- E10 does not record wall-clock time or the batching factor, so the actual cost of the 82,000-mutant run, and the speedup a schemata harness would give, is not measured.
- No published application of lifted Datalog, provenance or deletion propagation to architecture-model mutation testing was found. The mapping above is an inference.

## Q4. Program/spec synthesis: LLM-based drafting vs enumerative/SyGuS/e-graph synthesis

### Takeaway
In 2025–2026 the evidence-backed route is LLM generation checked by a verifier. AutoVerus proves 91% of Verus-Bench tasks given specs, and repo-level Verus proof success is about 50%. Spec *generation* is much weaker than proof generation: a 2026-10 study finds only 42.3% of verifier-accepted Verus contracts pass semantic checks. LLM architecture-view generation is "practically viable for specific use cases" but fails often. I found no evidence that enumerative or superposition-based synthesis (e.g., HVM's SupGen) produces specs or architecture models from code at useful scale.

### Cited Findings
**Verus/Dafny proof and spec synthesis**
- AutoVerus (OOPSLA 2025/PACMPL) generates Verus proof annotations given Rust code *and* specs: 137/150 (91.3%) on Verus-Bench; more than half within 30 s or 3 LLM calls — [AutoVerus](https://dl.acm.org/doi/10.1145/3763174)
- SAFE (ICLR 2025) self-evolves specification and proof generation. From 45,395 Rust functions with no specs it synthesized 19,017 formal specs and 9,706 verified functions, filtering specs with a quantitative quality metric — [SAFE paper](https://proceedings.iclr.cc/paper_files/paper/2025/file/b2e20d7402c9985eae4ba924c65370a8-Paper-Conference.pdf); [arXiv](https://arxiv.org/html/2410.15756v3)
- Vericoding benchmark (Sep 2025; under TMLR review 2026): 12,504 specs (Dafny 3,029, Verus 2,334, Lean 7,141). Off-the-shelf LLM success is 27% Lean, 44% Verus, 82% Dafny. Pure Dafny verification rose from 68% to 96% (v1) or 97% (revision) in a year — [arXiv 2509.22908](https://arxiv.org/abs/2509.22908); [OpenReview](https://openreview.net/forum?id=Zgh5kpGAm8)
- KVerus (2026): 51.0% (183/359) on repository-level Verus benchmarks with cross-file dependencies vs 4.5% for multi-round prompting; 80.2% on single-file benchmarks (Claude Sonnet 4) — [KVerus arXiv](https://arxiv.org/html/2605.03822v2)
- VeruSyn (2026): 6.9M synthesized verified Rust programs. A fine-tuned 32B model reached 83% vs Claude Sonnet 4.5's 76% on VerusBench, and 49% vs 54% on VeruSAGE-Bench (800+ programs from real Rust systems) — [arXiv 2602.04910](https://arxiv.org/html/2602.04910v3)
- VerusEval (2026-10-19): across 13,716 artifacts from 4 workflows and 5 LLMs on 762 tasks, "only 42.3% of the accepted artifacts complete all three semantic checks without a flag", and higher acceptance does not consistently mean more correct contracts — [arXiv 2610.26464](https://arxiv.org/abs/2610.26464)
- DafnyComp: on compositional spec generation, 13 models reach 99% syntax correctness but 7% verification success — [DafnyComp](https://dafnycomp.github.io/)
- DafnyPro (Dafny 2026 workshop at POPL): 86% on DafnyBench with Claude Sonnet 3.5 plus a diff-checker, invariant pruner and hints — [DafnyPro](https://popl26.sigplan.org/details/dafny-2026-papers/12/DafnyPro-LLM-Assisted-Automated-Verification-for-Dafny-Programs)
- StarVerus (KDD 2026): a multi-agent framework generating *all* specifications for industrial Rust code, using call graphs for context — [StarVerus](https://dl.acm.org/doi/10.1145/3770855.3818485)

**Architecture models from code**
- ICSA 2026 empirical study: 340 repositories, 13 configurations, 4,137 generated views. The best custom agent still had a 22.6% clarity-failure rate and 50% level-of-detail success. The authors conclude LLM view generation "has reached practical viability for specific use cases" — [ICSA 2026](https://www.computer.org/csdl/proceedings-article/icsa/2026/574000a245/2inK9lrACC4); [arXiv](https://arxiv.org/html/2603.21178v1)
- CIAO (ICSA 2026): 22 developers rated LLM-generated system-level architecture docs for their own repos as generally valuable and "broadly accurate", with noted gaps — [CIAO](https://www.computer.org/csdl/proceedings-article/icsa/2026/574000a201/2inK9dpqBkQ)
- Hybrid knowledge-graph plus LLM recovery evaluated on cJSON, SQLite and Bash against reference architectures (COMPSAC 2026) — [COMPSAC 2026](https://www.computer.org/csdl/proceedings-article/compsac/2026/449700a493/2j6zgSNNhyU); ArchAgent (Jan 2026) combines static analysis with LLM synthesis — [arXiv 2601.13007](https://arxiv.org/abs/2601.13007); LLM extraction of architecture component names: F1 0.86 vs TransArC 0.87 (ICSA 2025) — [ICSA 2025](https://conf.researchr.org/details/icsa-2025/icsa-2025-papers/2/Enabling-Architecture-Traceability-by-LLM-based-Architecture-Component-Name-Extractio)
- E-graphs are an established synthesis substrate ("rewrite-driven compiler optimizations and program synthesizers") — [egg](https://dl.acm.org/doi/10.1145/3434304)

### Inferences
- For Shape, "synthesis" in practice means LLM drafting of `.shape` claims and Verus contracts, followed by deterministic checking. The bottleneck shown by VerusEval and DafnyComp is *judging* whether a drafted spec is right, not producing candidates. Shape's own mutation (vacuity) checks and solver-decided contract equivalence are the kind of semantic checks VerusEval argues acceptance lacks. That is a stronger investment than a faster candidate generator.
- Superposition-based enumeration could only help where the target is a small term in a closed DSL with a cheap exact oracle. Shape claims are not of that kind: their correctness is defined against human intent and code evidence.

### Gaps
- I did not retrieve a current primary source on cvc5's SyGuS solver status or on SyGuS applied to specifications or architecture models.
- No independent (non-HigherOrderCO) evaluation of HVM/Bend-based program synthesis was found.

## Q5. Proving properties of a checker: Lean 4, Coq/Rocq, Isabelle, Verus, F*, Dafny, CakeML

### Takeaway
Two established patterns exist: verify the evaluator, or keep the evaluator untrusted and verify a small certificate checker. The certificate pattern has production precedent (CakeML's cake_lpr audits SAT-competition results) and a Datalog-specific instance (a Lean 4 verified checker for Nemo/Soufflé proof trees, ITP 2025). Verus is proven at kernel scale for Rust. Dafny can emit JavaScript. These are the mature options for a verified Shape rule kernel. Bend 2 claims fast proof checking but has no tactics or proof search, and no independent evidence was found.

### Cited Findings
- Verified Datalog certificate checking: a Lean 4 checker for Datalog proof trees and DAG proofs, "verif[ied] … against direct formalizations of the Datalog semantics", validating results from engines "such as Nemo or Soufflé"; JSON proof encodings (ITP 2025; KR 2025 extended abstract) — [ITP 2025 paper](https://drops.dagstuhl.de/entities/document/10.4230/LIPIcs.ITP.2025.36); [CertifyingDatalog GitHub](https://github.com/knowsys/CertifyingDatalog); [KR 2025 version](https://iccl.inf.tu-dresden.de/w/images/8/82/KR-2025-Camera-Ready-389.pdf)
- Isabelle: first formalization of stratified Datalog with least-solution existence, used to prove four bit-vector analyses correct (SAC 2024) — [Schlichtkrull et al.](https://dl.acm.org/doi/10.1145/3605098.3636091)
- Coq/MathComp: certified Datalog optimizations building on the Datalogcert formalization (CPP 2021) — [Bégay et al. CPP'21](https://dl.acm.org/doi/10.1145/3437992.3439913); [PDF](http://www-verimag.imag.fr/~monin/Publis/Docs/datalog-cpp21.pdf)
- CakeML: cake_lpr is verified "down to the level of its x64 machine code". cake_lpr and cake_pb "are used to audit solver outputs in the annual international SAT solving competitions" — [CakeML checkers](https://cakeml.org/checkers.html); [cake_lpr SAT 2025 description](https://satcompetition.github.io/2025/downloads/checkers/cakelpr.pdf). Lean core ships a verified LRAT checker usable by reflection (LRAT-Catcher, 2026) — [arXiv 2607.00815](https://arxiv.org/html/2607.00815v1)
- Verus (SOSP 2024, Distinguished Artifact): case studies totalling 6.1K lines of implementation and 31K lines of proof; "verifies code 3–61x faster" than prior state of the art — [Verus SOSP'24](https://dl.acm.org/doi/abs/10.1145/3694715.3695952); [MSR page](https://www.microsoft.com/en-us/research/publication/verus-a-practical-foundation-for-systems-verification). Atmosphere (SOSP 2025) is a full-featured microkernel proved functionally correct in Verus — [Atmosphere](https://dl.acm.org/doi/10.1145/3731569.3764821)
- Dafny compiles to JavaScript (`dafny build --target:js`) — [Dafny JS integration](https://dafny.org/v3.10.0/DafnyRef/integration-js/IntegrationJS). A HOL4 verified VCG and compiler for a Dafny subset (Dec 2025) notes that "soundness bugs have been found" in both Dafny's compiler and verifier — [arXiv 2512.05262](https://arxiv.org/abs/2512.05262)
- Bend 2 (bendlang/bend README) markets itself as "a fast language that blocks AI mistakes via proof". It states "Target: outperform every proof assistant by several OOMs" and "Bend has no tactics or proof search; proving theorems takes extra effort". These are vendor targets, not independent results — [Bend GitHub](https://github.com/HigherOrderCO/bend)

### Inferences
- The best fit for Shape is the certificate pattern. The TypeScript checker (or a Rust/WASM kernel) emits witnesses; a small verified checker, in Lean 4, Verus or Dafny-to-JS, validates them.
  - Positive diagnostics are easy to certify: a `forbidden_path` witness is a list of edges to check for membership, and a `missing_grant` is an effect with no matching grant.
  - Absence claims ("no forbidden path exists", "check passes") need either a completeness proof of the kernel or a checkable certificate of non-reachability, such as a closed set containing the source and excluding the target.
- Verus fits the existing Rust/WASM kernel prototype and the Verus integration work. The Lean Datalog checker fits only if rules move to Datalog with proof-tree output.
- Choosing Bend as the proof substrate would trade mature ecosystems (Lean/mathlib, Verus, CakeML), with published verified checkers in production use, for an unbenchmarked target.

### Gaps
- No verified *graph-rule* checker (verified reachability/SCC witness checking with canonical tie-breaking) specific to architecture tools was found; the mapping is inference.
- F* was not researched in this pass.

## Q6. Parallel speedups for small inputs: does parallelism matter at ~1 s on ~200 files?

### Takeaway
For Shape today it barely matters, and when it does, ordinary per-file parallel parsing is the lever. A CPU profile of `shp check` on this repository (~0.75 s wall) puts about 57% of samples in Langium/Chevrotain parsing and CST building, about 4–6% in lowering and under 2% in the rule modules. Bun startup is about 7 ms. External evidence agrees: TypeScript 7's "10×" is mostly native code (3–4×), and parallelism adds 1.4–2× that "grows with the codebase". A small monorepo saw ~3×, not 10×.

### Cited Findings
- Local measurement (2026-10-24, this container, 4 vCPUs, Bun 1.4.2, `bun shp check` on the repo's own `shape/` model): three runs took 0.81 s, 0.77 s and 0.73 s wall; `bun -e 0` took 0.007 s. The repository has 246 `.shape` files; E10 notes default discovery checks 222 — [package.json `shp` script](../../package.json); [E10 report](../../experiments/verus-probes/e10/REPORT.md)
- Local CPU profile (`bun --cpu-prof`, single run, 472 samples, bucketed by script URL):
  - Langium/Chevrotain parser, lexer and CST builder: ~57% (`cst-node-builder.js` 13.8%, `langium-parser.js` 9.1%, Chevrotain lexer 5.1%).
  - Lowering: ~4–6% (`checker/lowering/*`).
  - Rule modules: ~1.7% (`checker/rules/*`).
  - The remainder is native builtins, GC and other checker code.
  - Caveats: a single sampled run that includes module load and JIT warm-up; bucketing is by file path.
- TypeScript 7.0 (released 2026-07-08) reports 8×–12× speedups on full builds from "native code speed, shared memory multithreading, and a number of new optimizations" — [TS 7.0 announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0); the VS Code full build fell from 125.7 s to 10.6 s (11.9×) — [InfoQ, Aug 2026](https://www.infoq.com/news/2026/08/typescript-7-released)
- Independent decomposition (third-party blog, Sep 2026): with all parallelism off, TS 7 was 3.1–3.9× faster than TS 6 (the "native code" share). The default 4 checkers added 1.4–2×, "and it grows with the codebase". The smallest project went 0.84 s → 0.23 s single-threaded → 0.12 s — [stevenpg.com](https://stevenpg.com/posts/typescript-7-go-compiler-benchmark/)
- Anecdotal user report: on a small monorepo, tsc 6.7 s → tsgo 2.1 s (~3.2×); "When a project is small or already optimized, the multiplier shrinks" — [dev.to report](https://dev.to/curioustore_48788631d0e2e/i-ran-typescript-7s-native-compiler-tsgo-on-our-monorepo-4d6)
- TS 7: parsing and emitting "can mostly be done independently across files", so parallelization "scales well with larger codebases"; type-checking has more complex cross-file dependencies — [TS 7.0 Beta](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0-beta/); [TS 7.0 RC](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0-rc/)
- Bend/HVM single-core status, for comparison:
  - HVM2 paper: 400 MIPS on one M3 Max thread, 5,200 MIPS on 16 threads, 74,000 MIPS on an RTX 4090, but "not nearly as fast as state-of-art alternatives" single-core — [HVM2 paper](https://raw.githubusercontent.com/HigherOrderCO/HVM2/main/paper/HVM2.pdf)
  - Bend 1 README: "may have lower single-core performance"; "still working to support Windows" — [Bend 1 README](https://github.com/HigherOrderCo/Bend)
  - LWN (Mar 2025): Bend "do[es] not yet have competitive performance compared to … Haskell or OCaml" — [LWN](https://lwn.net/Articles/1011803/)
  - bend-lang 0.2.11 docs call single-core performance "still extremely sub-par" — [docs.rs bend-lang](https://docs.rs/crate/bend-lang/0.2.11)

### Inferences
- Amdahl bound: even infinitely parallel rule evaluation saves under 2% of a Shape check. Parallelizing lowering adds at most ~5%. The only material share is per-file parsing, which is embarrassingly parallel and can use Bun workers today, as TS 7 parallelizes parsing.
- At 0.75 s the fixed costs (process start, module load, JIT warm-up) are a noticeable fraction. A long-lived process (LSP, watch mode, or a batch harness that parses once) beats any parallel runtime for interactive and mutation workloads.
- The only Shape workload with real parallel volume is batch exploration (82,000 mutants). That is embarrassingly parallel across processes, so plain process or worker pools on CPU suffice. Q3's analytic and schemata techniques shrink it far more than parallel hardware would.
- Bend's own published numbers show its advantage appears only with very high core counts or GPUs on large, divisible workloads, starting from weak single-core speed. Shape's workloads are small and latency-bound, and Shape ships Windows binaries.

### Gaps
- The profile is a single run on one machine; a repeated, warmed profile with phase timers (parse/link vs lower vs rules vs render) would make the split more precise.
- No published study of "where time goes" in small architecture-rule checkers (ArchUnit, dependency-cruiser) was found; TypeScript 7 is the closest well-documented analogue.

## Q7. Which job, if any, would Bend/HVM be uniquely good at for Shape?

### Takeaway
On the evidence gathered, none of Shape's current jobs. Each has an established, more mature alternative with better embedding (TS/WASM/Rust) and documented use in comparable tools. The only niche where Bend/HVM is plausibly *distinctive* is brute-force evaluation of very large numbers of pure functional variants with heavy structural sharing on many cores or a GPU, possibly including superposition-based enumeration. Shape's workloads are not in that regime, and the distinctive claims are vendor-only.

### Cited Findings
- Rule evaluation: direct TS checks (the current design) or Datalog in Rust/WASM (Ascent, Crepe, datafrog), with CodeQL/Glean/Doop precedent at large scale and ArchUnit/dependency-cruiser precedent at small scale — see Q1 sources: [CodeQL](https://codeql.github.com/docs/ql-language-reference/evaluation-of-ql-programs), [Glean](https://glean.software/docs/introduction), [ArchUnit](https://www.archunit.org/userguide/html/000_Index.html), [dependency-cruiser](https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md)
- Incremental: salsa (rust-analyzer, ty), DBSP/Feldera, incremental Soufflé, LADDDER — see Q2: [salsa](https://salsa-rs.github.io/salsa/overview.html), [ty](https://astral.sh/blog/ty), [DBSP](https://www.vldb.org/pvldb/vol16/p1601-budiu.pdf)
- Many variants: mutant schemata, split-stream, Stryker mutation switching, PMT, TCE, lifted Datalog, provenance — see Q3: [AccMut](https://arxiv.org/pdf/1702.06689), [StrykerJS v6](https://stryker-mutator.io/blog/stryker-js-v6-expeditious-superior-mutations), [lifted Datalog](https://dl.acm.org/doi/10.1145/3338906.3338928)
- Synthesis: LLM plus verifier loops (AutoVerus, SAFE, KVerus) with spec-quality evaluation (VerusEval) — see Q4: [AutoVerus](https://dl.acm.org/doi/10.1145/3763174), [VerusEval](https://arxiv.org/abs/2610.26464)
- Proofs: Lean 4 certified Datalog checker, CakeML verified checkers, Verus — see Q5: [Lean Datalog checker](https://drops.dagstuhl.de/entities/document/10.4230/LIPIcs.ITP.2025.36), [CakeML](https://cakeml.org/checkers.html), [Verus](https://dl.acm.org/doi/abs/10.1145/3694715.3695952)
- Bend's own positioning is speed that scales with cores and GPUs ("as fast as CUDA on the GPU"), and in Bend 2 fast proof checking. These are stated as targets in the README — [Bend GitHub](https://github.com/HigherOrderCO/bend); HVM2 shows near-linear scaling to 16,384 cores on suitable workloads — [HVM2 paper](https://paper.higherorderco.com/)

### Inferences
- **Opportunity cost by job** (comparing the strongest alternative with Bend):
  - Rule evaluation: direct TS (current) or Ascent→WASM, against an unproven rewrite with no ecosystem precedent. Value of Bend: none.
  - Incremental re-check: a per-file parse cache in TS, or salsa if the kernel moves to Rust; Bend has no incremental model. Value: none.
  - Mutation testing and counterfactuals: closed-form joins/reachability, a parse-once schemata harness, and lifted or provenance Datalog are orders-of-magnitude levers with published evidence. Bend gives parallel brute force, which is the least efficient of these strategies. Value: at most marginal.
  - Spec/model synthesis: LLM drafting plus deterministic semantic checks; superposition enumeration has no published evidence on specs. Value: speculative.
  - Proving the checker: Lean/Verus/CakeML certificate checkers with production precedent, against Bend 2's unbenchmarked proof-checking target with no tactics. Value: speculative and risky.
  - Speed: Shape is parse-bound at ~0.75 s, where native code and per-file parallelism are the known levers (TS 7). Bend's single-core weakness makes it worse for latency-bound runs. Value: negative today.
- Engineering time spent on a Bend port would come out of: (a) a parse cache or worker-parallel parsing (largest measured share); (b) a schemata-style mutation harness plus closed-form M1/M3/M4 analysis; (c) a small verified witness checker in Verus or Lean; (d) the semantic spec-evaluation work Verus integration needs.
- A Bend experiment would be justified only for a future workload with massive variant counts (millions or more), pure functional structure, little exploitable relational or incremental structure, and a GPU available. None of Shape's documented workloads fit.

### Gaps
- No independent, peer-reviewed evaluation of HVM superposition (e.g., SupGen) for program search or of Bend 2's proof-checking speed was found in this pass. The other researcher's notes on Bend internals should be checked for one.
- Bend 2's current platform support (Windows) and embedding story (WASM/TS) were not verified here. A `bend2-ts` repository is referenced by HigherOrderCO's benchmark repo — [HigherOrderCO/bench](https://github.com/HigherOrderCO/bench) — which suggests a TypeScript implementation exists, but its status is unknown.
