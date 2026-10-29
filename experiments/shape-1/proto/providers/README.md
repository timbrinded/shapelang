# shape1-providers: evidence providers for the Shape 1.0 prototype (interface)

Root: `experiments/shape-1/proto/providers/`. Bun 1.4.2. Run every command from the repo root.

Records are built with the core library: `makeStatement`, then `signStatement` with ed25519 DSSE. Each record is self-validated against RJ01–RJ14 before it is written, and rejected records are listed in the report. Output is JSON lines, one statement or DSSE envelope per line, which `shape1 check --evidence` reads directly.

## Soundness declared by each provider

| Provider | Produces | Declaration | Soundness |
|---|---|---|---|
| laws | test (Test Result v0.1) | `decides template T…`, `trusts bun@1.4.2` | presence: a counterexample is a replayable input that fails at the cited code; never absence |
| observe-ts effects | observation | `observes effect(<resource code>)…` | presence and absence on entries marked `complete` |
| observe-ts calls | observation | `observes call(ts)` | none by default (`--sound-presence` opts in to presence) |
| trust | manifest overlay; Lean proofs | overlay: Bend and Lean identities with markers; `lean`: `produces proof`, `decides statements lean`, `trusts lean@v` | overlay: presence and absence at hatch-complete identities; lean proofs: presence |
| teeth | meta-evidence (`shape.teeth.v1`; optional SCAI `SHAPE_TEETH` statement) | none: not a checker record | kill sets are exact for the closed form; differentially checked against `derive` |

## CLI: `bun experiments/shape-1/proto/providers/cli.ts <provider> <command> [flags]`

**Common flags**
- **Manifest:** `--root <dir>`, or `--git <repo> --rev <ref>`, or `--manifest <statement.json>`. Add `--revision <hex>` to set the revision.
- **Shape:** `--source <shape1.json>`, or `--model <dir>` with `[--sidecar f] [--maintainer login]… [--no-rewrite]`.
- **Output:** `--time <rfc3339>`, `--out <file|dir/|->`, `--report <file>`, `--no-typescript`.

`--time` defaults to the wall clock. It must not be after the check's `now*`, or the record is rejected as RJ06; for reproducible runs, pass it explicitly. An unknown provider or subcommand is named on stderr and exits with code 2.

### laws (tested)
`laws run --provider <Q> [--decides "template T"]… [--law <file>]… [--bind <claim>=<file>]… [--seed <hex>] [--mutants <n>] [--deps-complete] [--impl <glob>]…`; `laws declare` prints the declaration.

**Law files** use `providers/laws/pbt.ts`:
- `law("<claim id | c:hex>", gen.int(0, 9) | gen.tuple(...) …, prop, {runs, seed})`
- `law.check(claim, fn)`
- Generators are integer-only, so records stay float-free.
- When `SHAPE_LAWS_OUT` is set, each law appends one JSON line: `{claim, name, file, result, runs, seed, counterexample?, error?}`.
- `--bind` turns a plain bun:test file into a claim: pass gives `supports`, fail gives `inconclusive`.

**Record** (one per claim), `predicate.shape`:
- `kind: test`; `result: supports | contradicts | inconclusive`; `claim {id, fp, nf}`.
- `code` = Req(c) from the head manifest: a unit law cites (bind, unit); a component law cites the units at `unit` and the files at `own`.
- `deps` = the relative-import module closure.
- `harness` = the law files and their local imports.
- `bound {runs, seed, laws, domain?, mutants? {total, killed}}`.
- `counterexample {law, input, error?}`, only on `contradicts`.

**Report:** `shape.laws.report.v1` `{files[], claims[{id, fp, result, runs, laws, record, mutants{total, killed, survivors}}], unknown[], rejected[]}`.

### observe-ts (observed)
`observe-ts run [--effects-provider <Q>] [--calls-provider <Q>] [--channel <resource code>]… [--channels-from-shape] [--paths <glob>]… [--effects-seed <hex>] [--calls-seed <hex>] [--sound-presence]`; `observe-ts declare` prints the declarations.

**Scope.** File identities are cited at `file`, symbols at `unit`, each with `complete` and `deps: []`. The scope root is computed with `scopeRoot`. The harness is the tsconfig.

**Facts.** Raw facts, which the shape's resource bindings lift:
- `{type: effect, at, verb, resource}`: resource is `ts.call("<api>")` for platform APIs (Date, Date.now, performance.now, process.*, fs.*, child_process, network, Bun.*, console, Math.random, crypto random) or `pg.table("<t>")` for literal embedded SQL.
- `{type: call, at, to}`, where `to` is a repo identity: direct calls, `new C()`, and functions passed as arguments.
- An optional `n` counts sites.

**Completeness.** An effects entry is complete only when every route in its span, descendants included, to a watched API yields a fact. Each incompleteness has a reason:

| Reason | Cause |
|---|---|
| `dynamic:<root>[]` | dynamic member of a root, e.g. `globalThis[k]` |
| `dynamic:eval` | eval or Function |
| `dynamic:constructor` | a function's `.constructor` |
| `dynamic:import`, `dynamic:require` | dynamic import or require |
| `dynamic:sql` | interpolated table name |
| `dynamic:new Date(...)` | `new Date` with spread arguments |
| `alias:<root>` | a root value supplied elsewhere: argument, return, property, `extends`, rebindable binding, `x \|\| Date`, `Date.bind`, `Date.call` as a value |
| `alias-type:<root>` | a typed read: a watched member, or call/apply/bind of a callable root, read from a value typed as the root (by member access, binding pattern, assignment pattern or for-of pattern); a call of a value typed as the root, including member callees such as `o.clock()`; a value typed as the root passed as an argument |
| `unresolved:untyped-receiver` | untyped receiver of a watched member, including untyped members of the global object such as `(globalThis as any).myDate()` |
| `unresolved:untyped-callee` | untyped callee: `f()` with f: any, `o.f()` with f: any, an undeclared global |
| `external:<pkg>` | call into, or handoff of, an opaque external package |
| `unparsed` | the file did not parse |
| `child:<id>` | a descendant entry is incomplete |

Exact routes yield facts:
- `Date.call(null)`, `Date.apply(x, [])` and `globalThis.Date.call()` give the `ts.call("Date")` fact.
- `globalThis["Date"].now()`, `const g = globalThis; g.Date.now()`, `global.Date.now()` and `self.performance.now()` give their facts, as do destructuring from the root (`const { now } = Date`), barrels and `require` / `await import`.
- `Date.prototype.constructor` resolves to Date, and a Date instance's `.constructor` is Date.

Typing is nominal: a structurally typed clock (`{ now(): number }`) stays complete, and the root is flagged where it escapes into it.

**Report:** `shape.observe-ts.report.v1` `{revision, channels, stats{files, identities, effectSites, callSites, callbackRefs, externalCalls, unresolvedCalls, ms}, entries, effectsComplete, callsComplete, effectFacts, callFacts, reasons{effects, calls}, records, rejected}`.

**Library:**
- `runObserveTs({man, root, time, effects?: {info, channels, signer}, calls?: {info, signer}, tsconfig?}) → {records, report, scan}`
- `effectsProvider({q, channels, identity?, implementation?, sound?})`
- `callsProvider({q, identity?, sound?})`
- `channelsFromShape(source)`: the `ts.call` and `pg.table` codes the shape binds.

### trust (observed)
Commands:
- `trust report [--print-axioms <file>] [--lean-version v]`
- `trust manifest`: prints the overlaid manifest statement.
- `trust overlay --input <check-input.json> [--base-root <dir>]`
- `trust lean-proofs --provider <Q> --print-axioms <file> [--built] [--seed]`
- `trust rust-audit`: per .rs file, the vprobe-semantics markers against the manifest's.
- `trust replay [--per-commit <file.json.gz>]…`: the H5 replay.

Hatch facts come only from manifests (an observation carrying one is rejected as RJ14), so the overlay adds two registry entries.

**Bend:** identities `bend:<path>#<name>`. Markers, never counted in comments or strings:
- `unsafe`: `@unsafe` or `def f?`; the std hatch kind;
- `foreign`: an import-only body;
- `hole`: `?TODO`;
- `open_law`: a law no def of the project fills.

**Lean:** identities `lean:<path>#<Full.Name>`. Markers: sorry, admit, native_decide, axiom, implemented_by, extern, unsafe. Files defining macros are not hatch-complete. The schemes are `lean.{file,own,unit,closure}.syn1`.

**Lean `#print axioms` mapped to proof-record assumptions:**
- propext, Quot.sound and Classical.choice become a `tool` assumption, `lean@v`;
- sorryAx and the compiler axioms become `hatch` assumptions at the cone identities;
- user axioms become `<id>/axiom` hatch assumptions, or `named`.

**Rust/Verus:** markers stay the core manifest's; `rust-audit` compares them with vprobe's `tcb_scan` semantics.

**Replay:** commits are counted by adoption shape: B3 (E9's per-file diff), S0 (hatches only), S1 (S0 plus `ReviewedSurface`) and S2 (maintained boundaries).

### teeth (meta-evidence)
`teeth run [--evidence <file|dir>]… [--validate <n per operator>] [--statement] [--seed <hex>]`.

Closed-form kill sets over the elaborated head and its world (W_decl plus usable observed facts):
- **W1:** add an effect fact;
- **W2:** add a type-correct edge;
- **P1:** grant a destructive verb and perform it at K.*;
- **M2:** remove a grant.

**Report:** `shape.teeth.v1` `{basis, operators[{op, mutants, killed}], claims[], vacuous[], redundant[], sources[], unusedGrants[], gaps{W1, W2[], P1{resources, uncaught, caught}}, laws[{fp, id, mutants, verdict: vacuous|weak|teeth|unassessed}], notAssessed[]}`.

`--validate n` realises n mutants per operator as real inputs and reports `derive` agreement. `--statement` wraps the report in an in-toto SCAI `SHAPE_TEETH` statement.

## Measured (this pass)

| Provider | Input | Result |
|---|---|---|
| observe-ts | Shape at 39bd692 | 220 files, 1,613 entries; effects complete 1,529, calls complete 1,464; 5 effect facts, 2,516 call facts; byte-identical to the pre-repair records |
| laws | strings example | 3 supports; mutants 7/12, 4/5, 11/11 |
| trust replay | Verus per-commit data | 2,202 commits; B3 84.7%, S0 52.2%, S1 60.8% of 1,073 events; growth 586: B3 586, S0 560, S1 586 |
| teeth | Shape model | W1 108,338/110,251; W2 1,528/4,028; P1 3,231/5,607; M2 179/181 |

## Build status

- **Gate:** passed.
- **Tests:** 183 passed, 0 failed.

**Commands**

- `bun test experiments/shape-1/proto/providers/test/`
- `bun test experiments/shape-1/proto/test/`
- `bun run typecheck && bun run lint`
- `bun experiments/shape-1/proto/providers/cli.ts observe-ts run --root . --git . --rev 39bd692 --effects-provider tooling::tsClockScan --calls-provider tooling::tsCallGraph --channel 'ts.call("Date")' --channel 'ts.call("Date.now")' --channel 'ts.call("performance.now")' --channel 'ts.call("process.hrtime")' --time 2026-10-25T10:00:00Z --out /tmp/claude-0/-home-user-shapelang/83ff80bc-0161-572f-9e5a-9075cccad6d0/scratchpad/shape1work/repair3/obs-after.jsonl --report /tmp/claude-0/-home-user-shapelang/83ff80bc-0161-572f-9e5a-9075cccad6d0/scratchpad/shape1work/repair3/obs-after-report.json && cmp /tmp/claude-0/-home-user-shapelang/83ff80bc-0161-572f-9e5a-9075cccad6d0/scratchpad/shape1work/repair3/obs-before.jsonl /tmp/claude-0/-home-user-shapelang/83ff80bc-0161-572f-9e5a-9075cccad6d0/scratchpad/shape1work/repair3/obs-after.jsonl`
- `G=/tmp/claude-0/-home-user-shapelang/83ff80bc-0161-572f-9e5a-9075cccad6d0/scratchpad/shape1work/gate-prov2 R=/tmp/claude-0/-home-user-shapelang/83ff80bc-0161-572f-9e5a-9075cccad6d0/scratchpad/shape1work/repair3; bun experiments/shape-1/proto/providers/cli.ts observe-ts run --root $G/fxown --source $G/fxown/shape1.json --channels-from-shape --effects-provider fx::effects --effects-seed 5a5a --time 2026-10-25T10:00:00Z --out $R/fxown-records.jsonl --report $R/fxown-report.json && bun experiments/shape-1/proto/src/cli.ts check --model $G/fxown --mode audit --evidence $R/fxown-records.jsonl --now 2026-10-25T12:00:00Z --json > $R/fxown-check.json   # exit 1, 3 sound blocking contradictions (A, B, C)`
- `bun /tmp/claude-0/-home-user-shapelang/83ff80bc-0161-572f-9e5a-9075cccad6d0/scratchpad/shape1work/gate-prov2/scripts/probe-run.ts /tmp/claude-0/-home-user-shapelang/83ff80bc-0161-572f-9e5a-9075cccad6d0/scratchpad/shape1work/gate-prov2/probe4`
- `bun /tmp/claude-0/-home-user-shapelang/83ff80bc-0161-572f-9e5a-9075cccad6d0/scratchpad/shape1work/gate-prov2/scripts/probe-run.ts /tmp/claude-0/-home-user-shapelang/83ff80bc-0161-572f-9e5a-9075cccad6d0/scratchpad/shape1work/repair3/p5`
- `W=/tmp/claude-0/-home-user-shapelang/83ff80bc-0161-572f-9e5a-9075cccad6d0/scratchpad/shape1work; bun $W/repair-ts/dog2.ts $W/prov/frozen-dogfood.source.json $W/repair3/dog-observe.jsonl && bun $W/repair3/factdiff.ts $W/repair-ts/dog-observe-new.jsonl $W/repair3/dog-observe.jsonl`
- `bun experiments/shape-1/proto/providers/cli.ts laws run --root . --source experiments/shape-1/proto/providers/examples/strings.source.json --provider strings::bunLaws --law experiments/shape-1/proto/providers/examples/strings.law.ts --mutants 50 --time 2026-10-25T10:00:00Z --out /tmp/claude-0/-home-user-shapelang/83ff80bc-0161-572f-9e5a-9075cccad6d0/scratchpad/shape1work/repair3/strings-records.jsonl --report /tmp/claude-0/-home-user-shapelang/83ff80bc-0161-572f-9e5a-9075cccad6d0/scratchpad/shape1work/repair3/strings-report.json`
- `bun experiments/shape-1/proto/providers/cli.ts trust replay --out /tmp/claude-0/-home-user-shapelang/83ff80bc-0161-572f-9e5a-9075cccad6d0/scratchpad/shape1work/repair3/replay.json`
- `bun experiments/shape-1/proto/providers/cli.ts teeth run --root . --git . --rev 39bd692 --source /tmp/claude-0/-home-user-shapelang/83ff80bc-0161-572f-9e5a-9075cccad6d0/scratchpad/shape1work/prov/shape-source.json --time 2026-10-25T12:00:00Z --out /tmp/claude-0/-home-user-shapelang/83ff80bc-0161-572f-9e5a-9075cccad6d0/scratchpad/shape1work/repair3/teeth-shape.json   # add --validate 100 for the derive differential check`

**Open problems**

- observe-ts absence soundness rests on TypeScript's types and on nominal typing. Three gaps remain. (1) A root retyped structurally is flagged only where it escapes, not where it is used. (2) An `any`-typed value passed as an argument is not flagged; only untyped receivers and callees are. (3) A root reaching code through a type the checker gets wrong, such as a wrong `.d.ts` or `@ts-ignore`, is not detected. These are heuristic limits of a type-based scan, not proved soundness.
- Typed-read checks cover only roots whose declared type the scan can resolve (rootTypes): Date, performance, process, console, Math, crypto, Bun, fetch and the global object, when a channel watches them. A shadowed or locally redeclared root type is skipped.
- The repair changed nothing on Shape's own code: the 39bd692 records are byte-identical. The new routes are covered by unit tests and synthetic probes only, with no real-code occurrences to measure against.
- HEAD moved during this pass (WIP commit 7a8e27b tracks experiments/shape-1). Directory-walk runs (`--root .`) now include the prototype's own code, which changes entry and fact totals: the dogfood run has 2,596 entries and 47 facts. Like-for-like comparisons need `--git . --rev 39bd692` or an explicit path filter.
- Unchanged from the earlier build: the calls provider is heuristic (sound none by default); laws tests sample and give no absence; the teeth closed form does not assess lower bounds (additions only).

**Spec feedback from the build** (folded into the final spec; see [RFC.md](../../RFC.md))

- A.5.2 absence soundness is defined only for the entry that supplies resource code ('including effects callees perform on resource code the entry supplies'). It says nothing about an entry that receives a root, e.g. a parameter typed `() => string` that is called with Date. observe-ts marks the supplier incomplete (alias:<root>) and also any reader that types the value as the root (alias-type). A structurally typed receiver stays complete, so absence at the receiver depends on attributing the effect to the supplier. The spec should either state that this attribution satisfies absence, or require receivers to be incomplete. The second option is probably infeasible for callback-heavy code.
- The ts.call resource-code registry entry (A.12) should say which invocation forms count as calling a callable root. observe-ts counts these as Date() facts: `X.call(...)`, `X.apply(...)`, a tagged template and `Date.prototype.constructor(...)`. It counts these as supplies: `Reflect.apply(X, ...)`, `X.bind(...)` and `X.call` read as a value. Different providers will otherwise disagree on the same code.
- Record `time` versus RJ06: providers stamp the wall clock by default. Re-running a recorded check with a fixed `--now` earlier than the provider run silently rejects the evidence (RJ06), and the verdict can flip from blocked to pass. The gate's own fxown repro does exactly this when re-run a day later without `--time`. The contract could require CI providers to take `time` from the same source as the checker's `now`, or the checker could report RJ06 rejections more prominently.
- Hatch facts come only from manifests (A.3.4.4, RJ14), so the trust provider's evidence for Bend and Lean is a manifest overlay, not a record. The spec has no record kind or provider declaration for registry extensions. The core manifest builder also lacks Bend and Lean registry entries, so the overlay has to be applied to the check input (`trust overlay`).
- The spec does not say how Lean `#print axioms` entries map onto assumption kinds. The provider maps the standard axioms (propext, Quot.sound, Classical.choice) to the tool assumption lean@v, sorryAx and the compiler axioms to hatch assumptions at the cone identities, and user axioms to `<id>/axiom` (hatch) or named. A.5.4 should fix this mapping.
- Teeth meta-evidence (A.10.5) has no record kind. The teeth provider emits `shape.teeth.v1` and optionally wraps it in a SCAI SHAPE_TEETH statement, which the checker ignores.
