# Bend and HVM: engineering state as of October 2026

Research date: 2026-10-24. Repository facts marked "(git, 2026-10-24)" come from cloning the public repos on that date (`bendlang/bend`, plus `HigherOrderCO/{Bend,HVM,HVM2,HVM3,HVM4,Kind}`) and reading history, tags, and files. The GitHub REST API was not reachable from this session, so star counts and open-issue counts come from the web pages, not the API. Labels used below: **[VENDOR]** means a claim by HOC or Victor Taelin. **[INDEPENDENT]** means a third party. **[2024-ERA]** means launch-era material that no longer describes the current product.

The most important fact for the reader: **"Bend" today means Bend 2**, a from-scratch rewrite released on 2026-09-17. It does **not** run on HVM. It is a dependently typed, proof-checking language with a TypeScript/Bun compiler that emits C (BendRT runtime, CPU, CUDA and Metal) or JavaScript. Most of what was written about Bend in 2024–2025 (HVM2, interaction nets, automatic parallelism, u24 numbers) describes Bend 1, a different and now-superseded language.

---

## 1. Which versions exist, what changed between them, and what is maintained?

### Takeaway
There are two Bend languages. Bend 1 ran on HVM2: launched May 2024, last release 0.2.38 on 2025-02-23, now superseded. Bend 2 is a rewrite. It was committed into the same repo on 2026-08-13, released 2026-09-17, and reached v2.0.39 on 2026-10-23. It uses a new runtime (BendRT) that has nothing to do with HVM. The HVM line (HVM1, HVM2, HVM3, HVM4) is a separate research track. HVM1 and HVM2 have been dormant since 2024, HVM3 since 2025, and HVM4 has been "pre-launch" with no commits since 2026-05-29. Of everything here, only Bend 2 is under active development.

### Cited Findings

**Bend 2 (current)**
- [VENDOR] Taelin announced "Bend 2 is here!" on X on 2026-09-17, describing "a new programming language that blocks AI mistakes via *proof checking*… It is also very fast, and runs on GPUs." — [X post, 2026-09-17](https://x.com/VictorTaelin/status/2100681226143092875)
- (git, 2026-10-24) The canonical repo is now `github.com/bendlang/bend`. `github.com/HigherOrderCO/Bend` resolves to the same repository: both clones give HEAD `295e996`, dated 2026-10-23, with 3,366 commits. History starts 2023-08-29 ("Initial commit of hvm-lang"). The Bend 2 rewrite commit is "Bend 2: a rewrite from scratch", dated 2026-08-13, by Victor Taelin. — [bendlang/bend](https://github.com/bendlang/bend); [HigherOrderCO/Bend](https://github.com/HigherOrderCO/Bend)
- (git, 2026-10-24) There are 32 release tags, v2.0.8 to v2.0.39. The first public tags are dated 2026-09-18 and the latest are v2.0.37 (2026-10-13), v2.0.38 (2026-10-20) and v2.0.39 (2026-10-23). — [bendlang/bend releases](https://github.com/bendlang/bend/releases)
- [INDEPENDENT, community site] bend2.dev says the 2.0.4 source revision was public on 2026-09-17 and that "twenty-eight more releases followed in ten days", with 2.0.32 published 2026-09-27. — [bend2.dev: Is Bend2 released?](https://bend2.dev/notes/bend2-release-date)
- (git) Commit activity by month: 90 in 2026-08, 880 in 2026-09, 262 in 2026-10 up to the 23rd. There were 567 commits from 2026-09-17 to 2026-10-23 and 1,233 commits in 2026 in total. — [bendlang/bend commits](https://github.com/bendlang/bend/commits/main)
- [VENDOR] The README says "Bend 2 is a new language. Bend 1 programs and HVM do not carry over." — [bendlang/bend README, Limitations](https://github.com/bendlang/bend#limitations)
- [INDEPENDENT] gihyo.jp (2026-09-18) reports, citing Taelin's pre-launch post, that Bend 2 does not use interaction nets at runtime. The reason given is that handling the graph structure got in the way of generating efficient machine code. Taelin also claimed up to 100x speed over Bend 1 and a memory ceiling raised from 2 GB to 8 TB, without stating measurement conditions. — [gihyo.jp](https://gihyo.jp/article/2026/09/bend-2)

**Bend 1 (superseded) [2024-ERA]**
- (git) Bend 1's last version is 0.2.38, from 2025-02-23. 0.2.37 shipped 2024-10-18. Release activity was dense in May–June 2024, with 0.2.6 to 0.2.35 between 2024-05-17 and 2024-06-06. Between 2024-09 and 2026-07 the repo saw only about 25 commits. — [Bend 1 CHANGELOG at 58372e05](https://github.com/bendlang/bend/blob/58372e05/CHANGELOG.md)
- [VENDOR] Release day was 2024-05-16 or 17 (Taelin: "RELEASE DAY", 2024-05-16). — [X, quoted in the 2026-09-17 thread](https://x.com/VictorTaelin/status/2100681226143092875)

**HVM line**
- (git) `HigherOrderCO/HVM` and `HigherOrderCO/HVM1` resolve to the same HEAD (`7365a56`). The code is HVM1: crate `hvm1` 1.0.12, MIT license, last commit 2024-02-07. Note that Bend 1's README still links "higherorderco/hvm" as HVM2. — [HigherOrderCO/HVM](https://github.com/HigherOrderCO/HVM)
- (git) `HigherOrderCO/HVM2` holds crate `hvm` 2.0.22, Apache-2.0. Its last commit is 2024-08-21. Its README calls it "a massively parallel Interaction Combinator evaluator" with a compiler to C and CUDA. — [HigherOrderCO/HVM2](https://github.com/HigherOrderCO/HVM2)
- (git) `HigherOrderCO/HVM3` is "HVM3 - Work In Progress", written in Haskell and C, MIT license. It has 385 commits from 2024-11-06 to 2026-01-29. Activity fell from 52 commits in 2025-01 to 4 in 2025-09 and 1 in 2026. Its README said it "aims to be the main compile target of Bend". — [HigherOrderCO/HVM3](https://github.com/HigherOrderCO/HVM3)
- (git) `HigherOrderCO/HVM4` is a C evaluator for the Interaction Calculus. It has 560 commits from 2025-10-26 to 2026-05-29, about 400 of them in Nov–Dec 2025, then 12, 11 and 6 per month in Mar–May 2026, and none since 2026-05-29. The README says "**NOTE: you're here before launch. Use at your own risk.**" There is **no LICENSE file anywhere in its history**. — [HigherOrderCO/HVM4](https://github.com/HigherOrderCO/HVM4)
- [VENDOR] Taelin, 2025-11-03: "HVM4 now includes a general method to compile Interaction Calculus functions to zero-overhead machine code, including functions with superpositions… HVM2 (which Bend used originally) always relied on an interpreter… HVM3 compiled Haskell-like functions only." — [X, 2025-11-03](https://x.com/VictorTaelin/status/1985320306001477783)
- [INDEPENDENT, community site] "HVM4 is Higher Order Company's C evaluator for the Interaction Calculus. Released Bend 2 uses the separate BendRT runtime, which does not execute interaction nets." It also says the generations "cannot be substituted for the released Bend 2 compiler". — [bend2.dev: HVM4, explained (updated 2026-10-09)](https://bend2.dev/notes/hvm4-explained)
- (git) `HigherOrderCO/Kind` is a Haskell proof checker, last commit 2024-12-09. `HigherOrderCO/SupGen` is not publicly clonable: git asked for credentials, so the repo is private or does not exist. — [HigherOrderCO/Kind](https://github.com/HigherOrderCO/Kind)
- [VENDOR] Taelin explained the pivot on 2025-11-03: "throw HVM2 away… go back to the HVM1 roots… resulting on HVM3, a prototype written in Haskell… Now, we're … implementing the runtime / compiler in raw C". He expected "to launch Bend2 / HVM4 this year or Q1 2026". — [X, 2025-11-03](https://x.com/VictorTaelin/status/1985423273304473788)

### Inferences
- What shipped differs a lot from the Nov-2025 plan. The plan was Bend2 on HVM4 with a lazy/optimal mode, 16/32/64-bit numbers, C interop "like Zig", no CUDA, and SupGen integration. What shipped in Sept 2026 is Bend 2 on BendRT: no interaction nets, U32/F32/Nat only, CUDA and Metal, and proof checking with a paid AI proof service instead of SupGen. HVM4 has had no commits since. HVM is no longer on Bend's critical path.
- Releases are frequent and include breaking changes. 2.0.38 changed the runtime flag syntax and the JS host interop inside a patch series. So the "2.0.x" numbers do not signal semver stability.
- Any integration that targets "HVM" today means picking an unmaintained or unlicensed artifact. Integrating "Bend" means Bend 2.

### Gaps
- GitHub star, fork and contributor counts could not be pulled from the API. The web excerpt (crawl date unknown) showed about 19.8k stars for HigherOrderCO/Bend, and thenewway.ai (2026-09-18) said "21,000-star".
- No official statement says HVM4 is abandoned. It is only inactive since 2026-05-29.
- A pre-launch landing page at victortaelin.github.io/bend2-landing links to `HigherOrderCO/bend4`. Its status is unclear and it was not cloned.

---

## 2. Language features, and what is notably missing

### Takeaway
Bend 2 is a pure, affine, dependently typed language with Python-shaped syntax. It has `law`/proof declarations, a Haskell-style IO monad with `do` blocks, fork/join parallel calls (`a b = f(x) g(y)`, plus `f!(x)` for the GPU), file-based modules, and content-hashed packages. The vendor's own limitations list is long. Notable gaps: only Nat, U32 and F32 numbers; strings are linked lists; no type inference, type classes or traits; no tactics; no HTTP, TLS, JSON or regex; no test framework, REPL or debugger. Bend 1's `fold`/`bend` constructs and its Haskell-like "Fun" syntax belong to the old language.

### Cited Findings

**Bend 2 (current, 2026-09/10)**
- [VENDOR] "Bend's syntax is Python-shaped, but its semantics are closer to Haskell / Lean, while being resource-aware like Rust… Bend is a *pure language*, with effects denoted via a Haskell-inspired IO Monad… the user can extend them with foreign C and JS imports." — [GUIDE.md](https://github.com/bendlang/bend/blob/main/guide/GUIDE.md)
- [VENDOR] Variables are affine by default and are used at most once. Quantities are `-A` (erased), `n` (affine) and `+x` (reusable, Data types only). Closures are affine. — [GUIDE.md: Quantities, Closures](https://github.com/bendlang/bend/blob/main/guide/GUIDE.md)
- [VENDOR] A `law` declares a property and a same-named `def` supplies the proof. `bend PROOF.bend` is intended as a commit gate. — [README](https://github.com/bendlang/bend); [GUIDE.md: Laws and Proofs](https://github.com/bendlang/bend/blob/main/guide/GUIDE.md)
- [VENDOR] Parallelism is the explicit parallel-call notation `a b = pow2(p) pow2(p)`, and `pow2!(20n)` runs on the GPU. "Bend's current scheduler is a contention-free, binary fork-join machine: every task is handed to a core exactly once and never moved afterwards… you must keep the workload balanced." — [GUIDE.md: Parallelism](https://github.com/bendlang/bend/blob/main/guide/GUIDE.md)
- [VENDOR] IO uses `do IO<T>:` blocks. Fallible effects return a `Result`. Concurrency comes from `IO.fork`/`IO.join` and channels on a single Node-like event loop. Effects include files, TCP, UDP, timers, `Process.run`, windows and audio. — [GUIDE.md: IO and Concurrency](https://github.com/bendlang/bend/blob/main/guide/GUIDE.md)
- [VENDOR] A module is a file: `import ./math.bend as M`. Packages are imported by content hash (`import 0x<hash>/main.bend as P`) or by `name@version` from BendHub, and are published with `bend --publish`. — [GUIDE.md: Modules](https://github.com/bendlang/bend/blob/main/guide/GUIDE.md)
- [VENDOR] Base library: `Nat`, `U32`, `F32`, `Bool`, `Cmp`, `Maybe`, `Result`, `List`, `Array`, a string-keyed `Map`, `Set`, `Equal` lemmas and effects. "Base is small." — [GUIDE.md: The Base Library](https://github.com/bendlang/bend/blob/main/guide/GUIDE.md)
- [VENDOR] Selected entries from the README's Limitations list:
  - "Everything is annotated and nothing is inferred, so code is verbose."
  - "No type classes, no traits, and no macros beyond compile-time templates."
  - "Bend has no tactics or proof search."
  - "Values are affine: closures and arrays cannot be shared."
  - "Recursion must terminate; `@unsafe` or `def f?(..)` turns the check off."
  - "Computed matches (`match f(x)`) aren't supported."
  - "There is no syntax for if-then-else."
  - "Numbers are Nat, U32 and F32 only: no U64, I64 or F64."
  - "F32 is axiomatic: nothing about floating point can be proven."
  - "Strings are linked lists of characters, so text processing is slow."
  - "No TLS, HTTP library, JSON or regex for now."
  - "Error messages are terse; no debugger, profiler or REPL."
  - "No test framework and no documentation beyond the guide."

  — [README: Limitations](https://github.com/bendlang/bend#limitations)
- [VENDOR] WONTFIX.txt lists design limits:
  - No common-subexpression elimination: "Two calls of `f(p)` run twice."
  - The checker "is not optimal: some terms are exponential or overflow… Do not open an issue per exponential or overflow."
  - "Allocation failure fail-stops the runtime."

  — [WONTFIX.txt](https://github.com/bendlang/bend/blob/main/WONTFIX.txt)
- [INDEPENDENT] An HN user who tried proofs (2026-09) wrote: "Base ships one arithmetic law, U32.add_comm. There is no order theory. About 60 of PROOF.bend's 163 lines are cmp_refl, and_false… facts you'd assume exist." Taelin replied: "the stdlib is very small so proving even simple theorems still takes a lot more effort (for the AI) than in Lean. We need a mathlib!" — [HN 49746163](https://news.ycombinator.com/item?id=49746163)

**Bend 1 [2024-ERA]**
- (git) Bend 1's guide covers "Folds and Bends": `fold` consumes recursive datatypes and `bend` generates them. Built-in numbers were `u24`, `i24` and `f24`, and strings were lists of `u24`. — [Bend 1 GUIDE.md at 58372e05](https://github.com/bendlang/bend/blob/58372e05/GUIDE.md)
- (git) Bend 1's 0.2.37 (2024-10-18) added a type system, an import system, and FFI via dynamic libraries (`IO/DyLib/open`, `IO/DyLib/call`). 0.2.36 (2024-07-04) added file IO, `IO/print` and `IO/input`. Bend 1 docs include `syntax.md` (Python-like "imp" and Haskell-like "fun" syntaxes), `ffi.md`, `dups-and-sups.md` and `type-checking.md`. — [Bend 1 CHANGELOG](https://github.com/bendlang/bend/blob/58372e05/CHANGELOG.md); [Bend 1 docs/](https://github.com/bendlang/bend/tree/58372e05/docs)
- [VENDOR, retrospective] Taelin (2025-11-03) listed Bend 1's "big practical limitations (int24, no IO, no packages)". He added that "despite Python syntax, it was still hard to use", that "most devs can't think recursively", and that it was "incompatible with lazy evaluation (not β-optimal!!)". On HN (2026-09) he added "2 GB memory limit, pervasive strictness (if-then-else executed both branches)". — [X, 2025-11-03](https://x.com/VictorTaelin/status/1985423273304473788); [HN 49746163](https://news.ycombinator.com/item?id=49746163)

### Inferences
- Bend 2 behaves much more like a proof assistant with a native code generator than like the "Python that runs on GPUs" of 2024. Being fully explicit about annotations is a deliberate design choice (see section 4), and it makes hand-written code costly.
- Text-heavy workloads, such as parsing source files or manipulating YAML/JSON, work against Bend 2's string representation and missing JSON and regex support.

### Gaps
- No vendor roadmap dates were found for 64-bit numbers, flexible (work-stealing) parallelism, or the planned Lua/Luau/Python targets. The README only says "Most of these limitations are being addressed."

---

## 3. Runtimes, backends, platforms, shipping, and embedding

### Takeaway
The Bend 2 compiler is a TypeScript program of about 14k lines in its core files. Its `main.ts` runs under Bun, and doubles as a Bun plugin and Node import hook. The compiler emits a single C file (clang only) that serves as the CPU program and is also compiled for Metal (macOS) or CUDA 12/13 (Linux). It can also emit sequential JavaScript or an ES module of pure definitions that JS/TS can import. Linux and macOS are supported on x64 and arm64. Windows is supported only via WSL, and there is no WASM target. There is no documented C ABI or library mode for embedding native BendRT in another process; embedder issues are open. For a TS/Bun host, the realistic embedding path is the JS/ESM backend, which is single-core.

### Cited Findings
- (git) The `bend2/` directory holds `bend.ts` (3,882 lines, checker), `comp.ts` (6,563, compiler), `main.ts` (1,129, CLI and loader), `safe.ts` (1,702), `base.bend`, and `bendtt.lean` (the Lean kernel). The whole `bend2/` tree is about 34k lines including JS and C effect files. — [bendlang/bend/bend2](https://github.com/bendlang/bend/tree/main/bend2)
- [VENDOR] The `main.ts` header comment reads: "Run, this file is the CLI. Imported, it is the loader that makes `import Game from "./x.bend"` work: a bun plugin (preload it in bunfig.toml…) and a node hook (node --import). A .bend module exports every filled, non-base, non-IO def… a constructor is {$: "Name", field: value, ...}, a closure is a function, Nat is a number, Bool, String and U32 are native." — [bend2/main.ts](https://github.com/bendlang/bend/blob/main/bend2/main.ts)
- [VENDOR] The tooling commands:
  - `bend file.bend -o file`: native binary (clang 14+; 19+ when `!` is used)
  - `-o file.c`: C source
  - `-o file.js`: JS
  - `-o f.mjs`: "an ES module of its non-IO defs, for JS to import"
  - `bend page.html -o dist`: bundle a web page
  - `--verdict`: recheck with the proven kernel

  — [GUIDE.md: Tooling](https://github.com/bendlang/bend/blob/main/guide/GUIDE.md)
- [VENDOR] "A JS file may `import Game from "./game.bend"` (with `bend2/main.ts` preloaded), or from the `./game.mjs`… and call every non-IO def… A value crosses without a copy: an `Array` argument is the caller's own array, updated in place." — [GUIDE.md: IO and Concurrency](https://github.com/bendlang/bend/blob/main/guide/GUIDE.md)
- [VENDOR] Custom effects: "Every effect in Base is a def whose body is `import "./x.js"` plus a `.c` twin, implemented by a host function… Only the event loop runs them, so proofs, termination and the GPU never touch host code." — [GUIDE.md](https://github.com/bendlang/bend/blob/main/guide/GUIDE.md)
- [VENDOR] Internals: "Bend's compiler emits one C file, and that file is both the CPU program and the GPU kernel… A term is one 64-bit word… There is no garbage collector… no C stack either: each def compiles to a segment of a flat state machine." — [GUIDE.md: Under the Hood](https://github.com/bendlang/bend/blob/main/guide/GUIDE.md); [BendRT paper](https://github.com/bendlang/bend/blob/main/paper/BendRT.pdf)
- [VENDOR] Platform and build limits from the README:
  - "Targets are C, Metal, CUDA and JavaScript; Lua, Luau and Python are planned."
  - "The JavaScript target runs on one core."
  - "One C file per program: no separate compilation, no incremental builds."
  - "Compiling to native is slow… For fast development, use JS."
  - "No Windows (WSL works)."
  - "A binary needs clang 14+; ! needs 19+, Metal or CUDA 12."
  - "One GPU per program, one event loop."

  WONTFIX adds that the C compiler is clang only, with no gcc. — [README: Limitations](https://github.com/bendlang/bend#limitations); [WONTFIX.txt](https://github.com/bendlang/bend/blob/main/WONTFIX.txt)
- (fetched 2026-10-24) `bend-lang.com/install.sh` downloads prebuilt `bend-$VER-{darwin,linux}-{arm64,x64}.tar.gz` from GitHub releases and checks a SHA-256. It refuses Windows shells ("Bend needs Linux, macOS or WSL") and Android/Termux (glibc required). — [install.sh](https://bend-lang.com/install.sh)
- [VENDOR] A binary using `!` also produces `file.gpu`, "which must stay beside it". On Linux a program with a Window needs `libx11-dev` and one with Audio needs `libasound2-dev`. Native `Process.run` needs glibc 2.34+. — [GUIDE.md: Tooling, IO](https://github.com/bendlang/bend/blob/main/guide/GUIDE.md)
- [VENDOR] Breaking changes for JS hosts in 2.0.38 (2026-10-20):
  - "a constructor's JS tag is its name in the file that declares it"
  - imported export keys keep their `:`
  - runtime options moved between `+RTS … -RTS`

  2.0.29 (2026-09-26) states that a Nat in the JS lane "is a double, exact below the 2^48 - 1 cap the C lane shares". — [CHANGELOG 2.0.38](https://github.com/bendlang/bend/blob/main/CHANGELOG.md); [Release 2.0.29](https://github.com/bendlang/bend/releases/tag/v2.0.29)
- [INDEPENDENT] Open embedding issues on bendlang/bend as of 2026-10-23:
  - #1624 "err_fail's _exit and stdio leave an embedder no fatal path"
  - #1594 "Freestanding C builds: a BEND_HOST hook that replaces the runtime's OS host" (enhancement)
  - #1598 "wasm32/Emscripten CPU-only build mode for generated C?"
  - #1827 "Python target: a first pass"

  — [bendlang/bend issues](https://github.com/bendlang/bend/issues)
- [INDEPENDENT] AkitaOnRails (2026-09-19, v2.0.16) ported a Rust CLI. The Bend binary was 1.4 MB versus 6.8 MB for Rust, and a TUI clock was 115 KB versus 6.7 MB. The clean build took 62 s, of which "0.1s of checking; the rest is clang -O3 on the generated C". He dropped a third project because "there's no way to embed that in the Rust binary". — [akitaonrails.com](https://akitaonrails.com/en/2026/09/19/new-ai-language-just-released-bend-2)
- [2024-ERA] Bend 1 had a Rust compiler (`cargo install hvm`, `cargo install bend-lang`). It offered `run-rs` (sequential Rust interpreter), `run-c` (parallel C) and `run-cu` (CUDA), plus `gen-c`/`gen-cu` for standalone C/CUDA. It supported NVIDIA GPUs only and no Windows (WSL only). — [Bend 1 README at 58372e05](https://github.com/bendlang/bend/blob/58372e05/README.md)

### Inferences
- For a TypeScript/Bun project, Bend 2 is unusually close at hand. Its compiler is TS on Bun, and pure Bend definitions can be imported as ES modules through the Bun plugin or compiled `.mjs`. But that path is sequential JS only. The native, parallel and GPU paths need clang 14–19+ at build time and ship as a separate executable. The JS-host interop surface broke in a patch release (2.0.38), so it should be treated as unstable.
- Native BendRT is a whole-program executable model with its own event loop, `_exit` on fatal errors, and no separate compilation. It is not a linkable library today. There is no Rust binding and no WASM target.

### Gaps
- It is not confirmed whether the prebuilt `bend` binary is a `bun build --compile` executable. The README's note that `bend` "ignores a project's bunfig.toml and .env" suggests it is.
- There is no documented size for the JS runtime emitted by `-o f.mjs`, and no cold-start latency figure.

---

## 4. Performance reality: vendor claims vs independent evidence

### Takeaway
On HOC's own pinned Apple M4 Max benchmarks (2026-09-17), single-core Bend 2 runs from about 0.7x to 4.4x the time of the C baselines, typically 1.1–1.5x. It beats the TypeScript and Lean baselines on most workloads. Parallel CPU runs reach about 10–12x on 16 cores. The GPU wins big on uniform numeric work (around 100x on Game of Life, n-body and Mandelbrot) and loses on divergent work. Independent measurements of Bend 2 runtime speed are still scarce. The one independent port found showed no speed advantage over Rust. Community issues document 4x–200x GPU pathologies, and critics say the checker-speed claims compare unlike workloads. Bend 1's 2024 performance was widely criticised as very slow single-threaded, and HOC later conceded this.

### Cited Findings

**Bend 2: vendor claims**
- [VENDOR] Homepage, Apple M4 Max, Game of Life:

  | Run | Time |
  |---|---|
  | TypeScript | 18.8 s |
  | Lean | 13.8 s |
  | C | 6.78 s |
  | Bend, 1 core | 7.80 s |
  | Bend, 16 cores | 0.65 s (12x) |
  | Bend, GPU | 0.06 s (124x) |

  On checking, the homepage claims "3,200 generic instantiations": Isabelle >5 min, Agda >5 min, Lean 19.2 s, Rocq 6.04 s, Bend 0.38 s. — [bend-lang.com](https://bend-lang.com/)
- (git) Runtime pin `bench/runtime/_pin_/apple_m4_max.txt` (2026-09-17), in seconds. Bend columns are SEQ-CPU, PAR-CPU and PAR-GPU, compared with C, TS and Lean:

  | Workload | Bend SEQ-CPU | Bend PAR-CPU | Bend PAR-GPU | C | TS | Lean |
  |---|---|---|---|---|---|---|
  | hashmap | 2.741 | 0.238 | 0.521 | 0.622 | 0.892 | 1.526 |
  | lexer | 2.144 | 0.198 | 1.075 | 1.036 | 3.543 | 4.487 |
  | queens | 5.406 | 0.455 | 0.933 | 3.599 | 6.979 | 7.704 |
  | tree-matmul | 2.064 | | | 2.964 | | |
  | nbody | 5.758 | 0.516 | 0.059 | 5.126 | 5.332 | 5.387 |
  | symreg | 3.014 | 0.266 | 0.529 | 2.208 | 5.924 | 2.457 |

  Across the 16 workloads, SEQ-CPU/C ranges from 0.70x (tree-matmul) to 4.4x (hashmap). — [apple_m4_max.txt](https://github.com/bendlang/bend/blob/main/bench/runtime/_pin_/apple_m4_max.txt)
- (git) The non-Max Apple M4 pin (2026-10-08) shows the GPU slower than parallel CPU on 10 of 17 workloads (on the M4 Max pin it is 5 of 16: hashmap, lexer, queens, symreg, tree-matmul). Examples: lexer 3.923 s GPU vs 0.427 s CPU, hashmap 1.543 vs 0.509, queens 2.701 vs 0.770. Compile times are about 0.55–1.5 s per benchmark. — [apple_m4.txt](https://github.com/bendlang/bend/blob/main/bench/runtime/_pin_/apple_m4.txt)
- [VENDOR] "The GPU shines on uniform numeric work like mandelbrot or nbody; divergent work like n-queens stays faster on the CPU… a `+` value read by every lane costs an atomic per read." — [GUIDE.md: Parallelism](https://github.com/bendlang/bend/blob/main/guide/GUIDE.md)
- [VENDOR] "The compiler is young and has blind spots (unusually slow programs)… We don't have as many benchmarks as we'd like yet." — [README](https://github.com/bendlang/bend#limitations)
- [INDEPENDENT, community site] bend2.dev notes that the upstream benchmarks "compare Bend execution modes, with no optimized CUDA implementation in this comparison". It also says the scheduler "does not move work from a slow branch to idle workers", so skewed inputs should be benchmarked. — [bend2.dev: What is Bend2?](https://bend2.dev/notes/what-is-bend2/)

**Bend 2: independent evidence**
- [INDEPENDENT] AkitaOnRails, porting Rust CLIs (v2.0.16, 2026-09-19): "No number here shows Bend faster than Rust on the same work." Idle CPU use for the TUI clock was 9 ms vs 333 ms for Rust, but the author warns the table "lies" because the workloads differ. — [akitaonrails.com](https://akitaonrails.com/en/2026/09/19/new-ai-language-just-released-bend-2)
- [INDEPENDENT] Community-filed open issues, 2026-10:
  - #1781 "A tiled matmul in Bend runs about 4x slower than the same kernel handwritten in CUDA"
  - #1776 "CUDA: the error poll in every flat loop… tight loops run up to 20x slower"
  - #1790 "Device lane spill… (~200x slower)"
  - #1778 "CUDA: `Array.new` inside a bang fills the new block in one loop on one lane"
  - #1720 "Buffered Chan receives scale quadratically on the Node host"
  - #1648 "C backend: a memory-bound loop's speed depends on unrelated code"

  — [bendlang/bend issues](https://github.com/bendlang/bend/issues)
- [INDEPENDENT] Nezk's gist argues the checker benchmarks are misleading: "the main reason Bend 2's typechecker is fast is simply that it doesn't do the work that modern proof assistants are designed to do". It points to no unification, no implicit arguments and no type classes, and says Lean and Rocq kernels checking fully elaborated terms are the fair comparison. — [Nezk gist](https://gist.github.com/Nezk/dda0511c492cf9bd673885f0341dca0e)
- [VENDOR rebuttal] Taelin on HN (2026-09): "So, why is Bend verbose??? Because it makes it fast. It is intentional… a good proof language should be fully explicit, because this reduces proof-checking time significantly." — [HN 49753179](https://news.ycombinator.com/item?id=49753179)
- [INDEPENDENT] Liam Powell (2026-09-18) notes that the homepage demo needs 58 lines of laws and 442 lines of proof. He re-did it in SPARK, where GNATprove reported "all checks proved (12 checks)" automatically. An HN user reported the live demo "would spend >100k tokens in a loop of 'laws broken'" when asked to add a simple feature. — [Liam Powell blog](https://blog.liampwll.com/posts/bend_vibe_coding/); [HN 49746163](https://news.ycombinator.com/item?id=49746163)

**Bend 1 / HVM2 [2024-ERA]**
- [VENDOR] The Bend 1 README advertised the bitonic sorter at 12.15 s with `run-rs` and 0.96 s with `run-c` (M3 Max), and 0.21 s with `run-cu` (RTX 4090). It also stated that "the current version may have lower single-core performance". — [Bend 1 README](https://github.com/bendlang/bend/blob/58372e05/README.md)
- [VENDOR, quoted on HN] "In single-thread CPU evaluation, HVM2, is, baseline, still about 5x slower than GHC, and this number can grow to 100x on programs that involve loops and mutable arrays." — [HN 40390287 (May 2024)](https://news.ycombinator.com/item?id=40390287)
- [INDEPENDENT] Users in HN 40390287 (May 2024) reported a sum example running much slower than Python 3.12 (Python took 1m42s). One user wrote: "The bend single-threaded version has been running for 42 minutes… consuming 6GB of memory, and still hasn't finished." — [HN 40390287](https://news.ycombinator.com/item?id=40390287)
- [INDEPENDENT] "Breaking Bend: Benchmarking the HVM" (2024-09-03) found "the parallel version was actually slower than the single threaded version" in one test. Sambhav G. found multithreading a map implementation "actually slows it down". On Lobsters, one commenter said "Bend is extremely slow… running on an expensive GPU is slower than on a cheap CPU in a different language." — [speedfox blog](https://blog.speedfox.co.uk/); [sambhavg blog](https://sambhavg.github.io/blog/bend); [Lobsters](https://lobste.rs/s/2cbh68/bend_high_level_language_runs_on_gpus_via)
- [INDEPENDENT] Julia Discourse (2024-05-19) noted that the "57x speedup" was partly due to a very slow baseline. — [Julia Discourse](https://discourse.julialang.org/t/bend-a-new-gpu-native-language/114440)
- [VENDOR, retrospective] Taelin (2025-11-03) on Bend 1: "interpretation overhead still significant - full RTX 4090 to beat 1-core OCaml / JavaScript / etc." — [X](https://x.com/VictorTaelin/status/1985423273304473788)

### Inferences
- Bend 2's architecture (compiled C, affine ownership, no interaction nets) addresses the 2024 single-thread criticism. On vendor numbers, one-core speed is now in C's neighbourhood for numeric and tree workloads. The remaining slow spots are hash maps and text, the latter because strings are lists.
- The GPU numbers are self-comparisons: Bend on GPU vs Bend on one core. No vendor benchmark compares against optimized CUDA, and the one community comparison found a 4x gap.
- Taken together, the checker-speed claims and the critiques suggest the speed comes from explicitness: no inference or elaboration work, with that work pushed onto whoever writes the proof (an AI, or the paid BendAI service).
- Memory pathologies of the 2024 kind (HVM2 duplication blow-ups, 2 GB heap) are architecturally gone in Bend 2. The new failure modes are documented instead: exponential checker terms (WONTFIX), unbalanced forks, GPU lane spill, and atomics on shared `+` values.

### Gaps
- No independent, controlled third-party benchmark of Bend 2 runtime against C, Rust, or JS/Bun on equal workloads was found. Bend 2 is about five weeks old.
- No measurements were found for JS-backend performance versus hand-written TypeScript (beyond the vendor's "2.3x faster JS lane" note in 2.0.29), or for start-up cost.

---

## 5. Determinism, reproducibility, correctness and soundness

### Takeaway
Bend 2 is pure and affine, and parallel calls cannot share mutable state. So program results are designed to be deterministic. This is a vendor design property, not independently verified. Documented divergences are narrow: backends differ on F32 NaN and on `F32.show` tie-rounding, and the checker evaluates lazily while binaries are strict, so cost differs but values do not. The bigger trust issues are elsewhere. The checker in everyday use (TypeScript) is unproven. The theory admits `Type : Type` with no positivity check, which relies on a live/dead separation for consistency. The compiler is "99% AI-written and not yet fully audited". A Lean-verified kernel (`--verdict`, with a $10k bounty) covers proofs, but not the translation into it or the compiler.

### Cited Findings
- [VENDOR] "Since Bend is pure and affine, the first point [calls are independent] always holds." — [GUIDE.md: Parallelism](https://github.com/bendlang/bend/blob/main/guide/GUIDE.md)
- [VENDOR] README limitations:
  - "The compiler (not kernel) is 99% AI-written and not yet fully audited."
  - "The checker has no proof and may have bugs; `--verdict` uses a proven kernel."
  - "Laws are proven about Bend's semantics. The backends can still differ, for example in F32 NaN."
  - "`--verdict` checks the translated terms, the parser and translation into the kernel are not proven."
  - "Atomic arrays shared across threads are experimental and need `@unsafe`."

  — [README: Limitations](https://github.com/bendlang/bend#limitations)
- [VENDOR] WONTFIX entries:
  - "`bend file.bend` runs a pure main lazily; compiled lanes are strict… Same value, different cost."
  - "F32.show's last digit may differ per lane on a decimal tie (C rounds to even, JS away from zero)."
  - "Allocation failure fail-stops the runtime."

  — [WONTFIX.txt](https://github.com/bendlang/bend/blob/main/WONTFIX.txt)
- [VENDOR] "Bend's theory has one universe and no positivity check: `Type : Type` holds… What keeps this consistent is a wall between two checking modes. Code that runs is checked *live*; types, erased arguments and equations are checked *dead*… `bend2/bendtt.lean` is BendTT's kernel in Lean, with a proof that no def it accepts has type `Empty` and that live code halts." — [GUIDE.md: Under the Hood](https://github.com/bendlang/bend/blob/main/guide/GUIDE.md)
- [VENDOR] Taelin, 2026-09-27 (v2.0.32): "Bend's proof kernel, not just its 'theory', is proven correct… We offer $10k to anyone who proves a falsehood in Bend." He added: "Unsafe and FFI aren't / won't be covered… This is about proofs, not the compiler, which is still uncomfortably AI-sloppy, and has bugs." — [X, 2026-09-27](https://x.com/VictorTaelin/status/2104240438127288652)
- [INDEPENDENT] Nezk calls `Type : Type` plus impredicativity "an extremely dangerous foundation", citing Girard's paradox. The gist says the Lean consistency proof exists, but notes that "the actual checker is written in TypeScript (`bend.ts`), and the README explicitly states that there are differences between the code and the Lean model". — [Nezk gist](https://gist.github.com/Nezk/dda0511c492cf9bd673885f0341dca0e)
- [INDEPENDENT, community site] "`--verdict` can run out of fuel on a proof the everyday checker accepts… A correct source proof cannot compensate for a compiler bug that changes the program's meaning." — [bend2.dev: What is Bend2?](https://bend2.dev/notes/what-is-bend2/)
- [INDEPENDENT] gihyo.jp (2026-09-18) reports Taelin's statement that the formal rules and the kernel implementation differ, so at that stage incorrect proofs could be accepted. — [gihyo.jp](https://gihyo.jp/article/2026/09/bend-2)
- [INDEPENDENT] Open issues touching correctness and security, as of 2026-10-23:
  - #1837 "Security: BEND_LIB cache hits skip hash verification — pinned imports load unverified content"
  - #1836 "bend --publish reads and uploads files outside the project directory" (fixed in 2.0.39 per CHANGELOG)
  - #1623 "--verdict rejects a reused proof…"
  - #1609 "F32.from_nat wraps values at 2^32"
  - #1780 "CUDA: the leaves of a balanced fork tree land on threads in an order that changes from run to run" (a scheduling/layout matter, not a result difference)

  — [bendlang/bend issues](https://github.com/bendlang/bend/issues); [CHANGELOG 2.0.39](https://github.com/bendlang/bend/blob/main/CHANGELOG.md)
- [VENDOR] Packages are pinned by content hash ("`import 0x<hash>/main.bend`… fetched from the hub and checked against it"). — [GUIDE.md: Modules](https://github.com/bendlang/bend/blob/main/guide/GUIDE.md)
- [VENDOR] HVM2's README claimed it is "simpler, faster and, most importantly, more correct" than HVM1. HOC "provides long-term support for all features listed on its PAPER". There have been no HVM2 commits since 2024-08-21. — [HVM2 README](https://github.com/HigherOrderCO/HVM2)

### Inferences
- For a deterministic checker use case, Bend 2's pure core gives deterministic values by design. Exceptions are F32 and output that depends on scheduling or IO. Reproducibility across versions is weak, though: 32 releases in 5 weeks, breaking changes in patch versions, and an unaudited, AI-written compiler.
- Proofs checked with `--verdict` are the strongest guarantee on offer. Everyday `bend` checking runs through the unproven TS checker.

### Gaps
- No independent report was found of a consistency bug (a proof of `Empty`) in Bend 2, nor an outcome of the $10k bounty as of 2026-10-24.
- No sources were found specifically on HVM2 result non-determinism or confluence bugs. Interaction-net confluence is a theoretical property, and no HVM2 soundness bug reports were located in this pass.

---

## 6. Licensing, commercial model, funding, team, roadmap and direction

### Takeaway
The Bend 2 compiler and standard library are Apache-2.0. HVM1 and HVM3 are MIT, HVM2 is Apache-2.0, and HVM4 has no license. HOC (legal name "Higher Order Computing Company", a Delaware corporation) raised about $4M of seed funding in 2023. It ran a 2025 post-seed round on WeFunder at a stated $100M valuation, aimed at SupGen and symbolic AI, which had reached $215k by March 2025. An HOC thesis document said about $1M remained, with a runway to end-2026. Revenue now centres on BendAI, a paid, credit-based service in which AI writes Bend proofs, plus BendHub name auctions. Direction has moved from "parallel Python on GPUs" (2024) to symbolic AI and program synthesis (2025) to "a language that blocks AI mistakes via proof" (2026).

### Cited Findings
- (git) LICENSE files at HEAD:
  - bendlang/bend: Apache-2.0
  - HVM2: Apache-2.0 (Cargo `license = "Apache-2.0"`)
  - HVM1: MIT
  - HVM3: MIT
  - HVM4: no LICENSE file in any commit
  - Kind: MIT

  — [bendlang/bend LICENSE](https://github.com/bendlang/bend/blob/main/LICENSE); [HVM4](https://github.com/HigherOrderCO/HVM4); [HVM3](https://github.com/HigherOrderCO/HVM3)
- [VENDOR] Taelin (2024-01-06): "In 2023, the Higher Order Company raised a $4m seed round… we hired a team of ~10 highly talented engineers, giving us a ~3 year runway." — [X, 2024-01-06](https://x.com/VictorTaelin/status/1743751536465903795)
- [INDEPENDENT, data vendor] PitchBook profile: founded 2023, 11 employees, latest deal Seed, $4.5M. The data date is not shown. — [PitchBook](https://pitchbook.com/profiles/company/651706-84)
- [VENDOR] HOC (2025-01-31) announced a "$4m post-seed at $100m valuation" to build an ARC Prize dataset and tune SupGen into a "Symbolic Transformer". The campaign page was titled "Bend2: The AI Programming Language". By 2025-03-03 the WeFunder campaign had "reached $215k", and VC negotiations were "still ongoing". — [X, 2025-01-31](https://x.com/VictorTaelin/status/1885328571410853951); [HOC X, 2025-01-31](https://x.com/higherordercomp/status/1885319917932605501); [X, 2025-03-03](https://x.com/VictorTaelin/status/1896617297663406277)
- [VENDOR] The HOC thesis gist (undated, about early 2025) says: "we've identified the Symbolic AI market as our best opportunity… With around $1 million remaining, we're dedicating the next two years, until the end of 2026, to this research… invested $300,000 in 256 Apple M4 processors." — [hoc_thesis.md gist](https://gist.github.com/VictorTaelin/5d42e97684ff81f7e507aa5c149b2a64)
- [VENDOR] The BendAI Terms define the service: "BendAI takes Bend source files… in which you have stated laws… whose proofs are missing, and returns files in which those proofs have been written by artificial-intelligence models orchestrated by HOC and checked by the Bend type checker." Other points from the terms:
  - It is paid for with prepaid credits, where one credit equals 1 USD.
  - It forbids using outputs to train competing models.
  - BendHub names of under 12 characters are sold "by auction for credits".
  - Packages published without a LICENSE default to MIT-0.

  The contracting party is "Higher Order Computing Company, a Delaware corporation". — [BendAI Terms](https://bend-lang.com/bendai/terms)
- [INDEPENDENT] gihyo.jp (2026-09-18) reports that Taelin announced "Bender", a paid proof-specialised AI agent, with an API due "within days". — [gihyo.jp](https://gihyo.jp/article/2026/09/bend-2)
- [VENDOR] The README frames Bend 2 as follows: "In the post-AGI economy, humans will eventually stop writing and reading code, but we still need an ambiguity-free language to communicate our intents to the AIs… Bend is that language." Its getting-started step 2 is "Tell your agent to use Bend". — [README](https://github.com/bendlang/bend)
- [VENDOR] On SupGen (HN, 2026-09): it "overperforms every published symbolic program synthesizer in the literature by 10x or so. This is unpublished yet." A SupGen demo video was posted 2025-01-20. — [HN 49753179](https://news.ycombinator.com/item?id=49753179); [YouTube](https://www.youtube.com/watch?v=GddkKIhDE2c)
- [VENDOR] Taelin on HN (2026-09) acknowledged "my own failure into making the language actually be used, rather than just a viral moment" (quoted by AkitaOnRails). — [akitaonrails.com](https://akitaonrails.com/en/2026/09/19/new-ai-language-just-released-bend-2)

### Inferences
- HOC is a small, venture-funded team. The vendor said ~10 engineers in 2024, and PitchBook lists 11 employees. On its own 2025 statements, its runway runs to around end-2026, and its monetisation now attaches to AI proof generation rather than to the compiler. That raises continuity risk for anyone who depends on Bend or HVM directly.
- The public roadmap has changed course repeatedly: the HVM2 to HVM3 to HVM4 rewrites, and Bend2-on-HVM4 being replaced by Bend2-on-BendRT. Stated plans have weak predictive value.

### Gaps
- No public 2026 funding announcement was found, and no confirmation that the 2025 post-seed closed beyond the $215k WeFunder figure.
- No published BendAI pricing was retrieved, and no current team roster was found.

---

## 7. Community health, adoption, ecosystem and documentation

### Takeaway
Attention is high (launch threads with hundreds of points, ~20k stars carried over from Bend 1), and post-launch contribution activity is real: 54 author identities committed in 2026, and community-filed issues are detailed. But Bend 2 is about five weeks old. No production adopters were found. The ecosystem is BendHub plus a few community tools, and the docs consist of a single guide that the vendor itself calls the only documentation. Bend 1's 2024 virality did not turn into usage, according to its author.

### Cited Findings
- (git) In 2026, 54 distinct author identities committed to bendlang/bend. Victor Taelin's identities account for about 850 of the 1,233 commits in 2026. Other frequent contributors are Nicolas Abril (HOC), Lorenzo Battistela, Mansurshakh Japarov, and external contributors such as toprameen, viridale, oxura, sebastian-griego and Yi-111-a, credited in CHANGELOG 2.0.39. All-time top authors are Taelin (899), Nicolas Abril (739), imaqtkatt (690) and LunaAmora (329). — [bendlang/bend](https://github.com/bendlang/bend/graphs/contributors); [CHANGELOG](https://github.com/bendlang/bend/blob/main/CHANGELOG.md)
- [INDEPENDENT] The bendlang/bend issues page showed "Open 70" on 2026-10-23. Most recent issues are detailed performance, security and embedding reports from external users. — [bendlang/bend issues](https://github.com/bendlang/bend/issues)
- (git) The repo contains 1,831 test files under `tests/`, plus `gates/` (perf/test gates), `evals/` and `demos/`. — [bendlang/bend](https://github.com/bendlang/bend)
- [INDEPENDENT] HN threads for the 2026 launch:
  - "Bend – a language that blocks AI mistakes via proof and runs on GPUs" (49746163), described by AkitaOnRails as "over 600 points"
  - "Bend 2 and the Vibe-Coding Trap" (49753179): 317 points, 230 comments per Rivestack's mirror

  The 2024 launch thread was 40390287. — [HN 49746163](https://news.ycombinator.com/item?id=49746163); [Rivestack mirror](https://ask.rivestack.io/story/bend-2-and-the-vibe-coding-trap-49753179); [HN 40390287](https://news.ycombinator.com/item?id=40390287)
- [VENDOR] The ecosystem references in the README:
  - bend-fmt-lsp: a formatting-only language server
  - bend-lint: Bun-based, with TS or Bend rules
  - community bend2-lsp: diagnostics and hover
  - a community "Bend 2 pocket workshop"
  - r/bendlang and @bendlang on X

  The README also says: "No test framework and no documentation beyond the guide." — [README](https://github.com/bendlang/bend)
- [INDEPENDENT] bend2.dev is an unofficial community learning site. It describes itself as "Bend by Example" with 43 examples, says "The official website is bend-lang.com", and notes it is "updated 2026-10-20". — [bend2.dev](https://bend2.dev/)
- [VENDOR] `bend guide shaders` and `bend guide effects` are "written by AIs for AIs". The effects note is "to be revised by a human". — [GUIDE.md: Extra](https://github.com/bendlang/bend/blob/main/guide/GUIDE.md)
- [INDEPENDENT] An independent porting experiment found that ghpending's port produced output "byte-for-byte identical" to the Rust binary in tested cases. A proof gate caught an injected off-by-one that three sample-output tests missed. The author also judged all three chosen projects a poor fit (HTTP, JSON, terminal IO, syscalls). — [akitaonrails.com](https://akitaonrails.com/en/2026/09/19/new-ai-language-just-released-bend-2)
- [INDEPENDENT] The 2024 Bend 1 reception: "Almost a thousand points on Hacker News, over 20 thousand GitHub stars, a Fireship video. And then reality hit." — [akitaonrails.com](https://akitaonrails.com/en/2026/09/19/new-ai-language-just-released-bend-2)

### Inferences
- Community activity is in an early burst: many contributors, detailed issues, daily releases. That is typical of a fresh launch and does not yet show sustained adoption. Docs are written mainly for AI agents (`bend guide`, AGENTS.md conventions) rather than for human onboarding.
- No dependent projects of any size, and no corporate users, were identified.

### Gaps
- No data on BendHub package counts or download numbers was found.
- No list of production users of either Bend 1 or Bend 2 was found. Absence of evidence is noted here, not proven absence.
