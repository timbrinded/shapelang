# shape1: Shape 1.0 prototype checker (interface)

Root: `experiments/shape-1/proto/`. Bun 1.4.2. Every path below is relative to that root. Run commands from the repo root.

## 1. The library

The checker is one pure function, in `src/derive.ts`:

```ts
import { derive } from "./src/derive.ts";            // derive(input: CheckInput): CheckOutput
import { coreOutput, renderHuman } from "./src/render.ts";
import { EXIT } from "./src/io-types.ts";            // {pass:0, owed:0, blocked:1, invalid:2}
```

`derive` reads only its argument. It never reads the clock, the environment or files.

- Every list in its output is sorted.
- `coreOutput(out)` drops `message`, `causes[].text`, `command`, `snippet` and the prototype extensions. The result is byte-identical under any permutation of order-free input lists (tested).
- `renderHuman(out)` produces diagnostic text with cause chains, dischargers and per-group `shape approve` lines.

Other modules you can call directly:

- **Elaboration** (`src/elaborate.ts`):
  - `elaborate(source, {now, lenient?}) → ESF`, the `shape.elaborated.v1` form: claims with `ids`, `op`, `args`, `nf`, `fp`, `owner`, `tier`, `requirement`.
  - `claimNf(op, args) → {nf, fp}`.
- **Records** (`src/records.ts`):
  - `makeStatement(ShapeRecord)`, `signStatement(stmt, [signer])`, `signerFromSeed(hex)`
  - `parseRecord(x)`, `recordId(stmt)`, `scopeRoot(entries)`, `persistedPath(id)`, `validateRecord(...)`
- **Manifests**:
  - `src/manifest.ts`: `manifestStatement(pred)`, `indexManifest(stmt)`, `gitTreeId(tree)`, `gitBlobId(bytes)`
  - `src/manifest-build.ts`: `buildManifest({repoRoot, revision, files, noTypeScript})`, `filesFromDir(dir)`, `filesFromGit(repo, ref)`, `manifestFromFiles(rev, files, ts|null)`
- **Fingerprints**:
  - `src/fingerprint/ts.ts`: `loadTypeScript(repoRoot)`, `fingerprintTs(path, text, ts|null, {resolve})`
  - `src/fingerprint/rust.ts`: `fingerprintRust(path, text)`
- **Loading and migration**:
  - `src/loader.ts`: `loadModel(dir, {sidecar?, maintainers?, includeGenerated?})`, `runInspect(files, cwd)`, `readEvidence(paths)`, `readPersisted(dir)`, `rewriteAgainst(source, manifest)`
  - `src/migrate.ts`: `migrate(inspectJson, opts)`, `mergeSidecar`, `extractTraits`, `rewriteBinds`
- **Worked examples** (`examples/fixtures.ts`):
  - Inputs: `ex1(v)` with `v ∈ audit | empty-base | A | B | B-weak | Bprime | Bsecond | C | C-answered`; `ex2({exception?, approve?, hostMarkers?})`; `ex3({judgeLine?})`; `ex3s2({harnessEdited?, dropRecord?, seededClock?, removeRefactorSensitive?})`; `ex4({complete?, headDiagnostics?})`.
  - Builders: `manifest(rev, IdSpec[], shapeFiles)`, `signed(record, signers)`, `cite(id, projection, digest)`, `baseInput(...)`, `KEYS`.
  - `examples/sources.ts` holds the example shapes as source documents.

## 2. Checker input (prototype profile of `shape.check.input/v1`)

```jsonc
{ "contract": "shape.check.input/v1",
  "mode": "change" | "audit" | "preview",
  "now": "2026-10-25T12:00:00Z",
  "head": { "revision": "<hex>", "source": <shape.source.v1>, "manifest": <manifest statement>, "treeId": "<40 hex, optional>" },
  "base": { "revision", "source": <shape.source.v1 | null = unreadable, raises L0>, "manifest", "committerTime"?, "treeId"? } | null,   // null only in audit
  "change": { "ids": ["github:acme/audit#57"] },
  "authors": [{ "identity": "github(\"acme-code-agent[bot]\")", "verified": true, "bot": true }],
  "reviews": [{ "identity": "github(\"bob\")", "line": "shape approve bd:8d771e08d86d43b2 ...", "change"?: "<change id>" }],
  "records": [<statement or DSSE envelope>],
  "baseRecords": [...],
  "persisted": { "base": [{ "path", "record" }], "head": [...] },
  "options": { "health": true, "teeth": false } }
```

How this differs from the spec's input contract:

- `files` and `packs` are replaced by `source`. The std 1.0.0 pack is built in (`src/std.ts`).
- `trustRoots` is ignored.
- Commit hashes are not checked. Only an optional `treeId` is compared with the tree rebuilt from the manifest.
- Base `now*` is `max(now, committerTime)`.
- Review lines: `shape approve bd:<≥16 hex>…`, `shape judge <claim id | c:hex>` and `shape reject <claim> <text>`. Without a relay they act in this run only and are listed under health `unauthenticated`.

## 3. The shape as JSON: `shape.source.v1` (src/source.ts)

```jsonc
{ "v": "shape.source.v1",
  "modules": [{ "module": "audit", "imports": ["std"],
                "decls": [ { "decl": "<kind>", "name": "...", ... } ] }] }
```

Each `decl` follows the grammar's keywords. References are resolved against the declaring module, then its imports, then std. Atoms are written `Verb<Resource>`.

**Vocabulary**

- `shape`: `{owner, policy?}`
- `actor`: `{kind: person|team|agent, operator?, identities?: ["github(\"bob\")", "ed25519(\"<pub hex>\")"], members?}`
- `resource`: `{attach?: [{name, args?}], owner?, tier?, was?, bind?: ["pg.table(\"audit_events\")"]}`
- `component`: `{boundary?, attach?, owner?, tier?, was?, paths?: [globs], grants?: [atoms] | "none", relationsComplete?: [kinds], allows?: [hatch kinds], assumes?: [{id, text}], units?: [...]}`
  - Leaving out `grants` means open authority.
  - Each unit is `{name, attach?, owner?, tier?, was?, bind?: "ts(\"src/a.ts#f\")", effects?: {mode: complete|partial|unknown, atoms: [{atom, via?}]}}`.
- `effect`: `{name, implies?}`; `kind`: `{name, from, to}`; `hatch`: `{names, lang}`

**Claims**

- `relation`: `{kind, connects: [A, B, ...], owner?, tier?}`
- `rule`: `{clauses?, when?: [{param, has}], template?: {name, args}, owner?, tier?}`
  - Effect clause: `{forbid: "effect", final?, atom, within?, except?}`
  - Path clause: `{forbid: "path", from, to, over, exceptVia?}`
  - Edge clause: `{forbid: "edge", kind, from, to, exceptFrom?, exceptTo?}`
  - Cycle clause: `{forbid: "cycle", over}`
  - Hatch clause: `{forbid: "hatch", kinds: ["*"]}`
- `law`: `{on: ["unit K.u" | "component K" | "code ts(\"...\")"], statement?: "verus(\"...\")" | informal?: "text" | template?: {...}, evidence?: {level?: declared|tested|proven, orJudged?, judged?, at?: unit|contract|trust, by?: [providers or actors]}, owner?, tier?}`

**Other declarations**

- `template`: `{params: [[name, kind]], body: [clause | {grants} | {law: {on?, informal?, evidence?}} | {requiresNote} | {order: [p, leq|geq|subset|superset|equal]}]}`
- `exception`: `{waives?: [contradiction, unestablished], target: "rule X" | "law X" | "authority K" | "claim <id|c:hex>" | "component K", for?: ["code ts(...)" | unit selectors | "pair A -> B"], owner, expires: "2026-12-15"}`
- `note`: `{kind: rationale|memory|decision, about: [...], owner?, text?, confidence?}`
- `provider`: `{produces: [...], observes?: ["effect(pg.table(\"*\"))", "call(ts)", "edge(k)"], decides?: ["template HistoryPreserved", "statements verus", "equivalence"], sound?: ["presence", "absence"], persist?, depsComplete?, identity?: "ed25519(\"<hex>\")", trusts?: [["z3", "4.12.5"]], implementation?: {paths?, digest?}}`
- `policy`: `{tiers: {low|normal|critical: {floor?, blocks?: [unestablished, coverage, latent-loosening], maxAge?, judges?}}, budget?}`

## 4. Loading a model from disk (CLI and loader)

A model directory has 0.x `shape/**/*.shape` files, a 1.0 sidecar (`shape1.json` or `shape1.yaml` in the directory or in `shape/`, itself a `shape.source.v1` document), or both.

**How the 0.x files are read.**

1. Run `bun packages/shp-cli/src/index.ts inspect --json <files>`. Trait bodies, which inspect omits, are read from the .shape text.
2. `migrate` translates the result:
   - fn → unit, with an explicit `bind` from `source`;
   - prelude AppendOnly → `std::AppendOnly` at tier final;
   - user traits → templates, and `rule … when T has X` instantiates once per bearer;
   - grants → authority;
   - owns → `std::Owns` rules;
   - implementations → component `paths`;
   - relations → `relation`;
   - forbidPaths with the same target are merged into one multi-source clause;
   - memories → `note` plus `RefactorSensitive` when a guard exists.
3. Documents with `origin: generated_ast` are skipped unless `--include-generated` is given.
4. Unknown effects and edge kinds, marker templates, the owner team and the shape declaration go into module `shape1.migrated`. That module declares `shape Migrated {owner Maintainers}`, with `--maintainer <login>` adding person actors with identity `github("<login>")`.
5. The CLI then rewrites unit sources against the head manifest:
   - the language is taken from the manifest's file identity;
   - an exact symbol is kept;
   - otherwise a unique same-file identity whose last segment matches is used;
   - unregistered languages bind the raw file identity.
   Pass `--no-rewrite` to turn this off.
6. The sidecar is merged in. A sidecar declaration with the same (module, decl, name) replaces the migrated one. A sidecar `shape` declaration replaces every migrated one.

## 5. Manifests and code identities

A manifest is an in-toto statement:

- Subject: `shape:manifest/<revision>`, with digest = manifest root.
- `predicate.shape`: `{v: "shape.manifest.v1", revision, tree: [{path, mode, blob}], entries: [{id, projection, scheme, digest, kind, parent, markers?, merged?, hatchComplete?, executable?}]}`.
- `hatchComplete` and `executable` are prototype extensions. They are needed because the checker never reads code.

Identities and schemes:

| Language | Identity | Projections and schemes |
|---|---|---|
| TypeScript | `ts:<path>[#Sym.sub]` (functions, classes, methods, namespaces, const arrow/function/object literals; nested functions) | `file: ts.file.v1`, `own: ts.own.v2`, `unit: ts.unit.v2`, from the TypeScript compiler API found in the bun store (6.0.x here, not the pinned 5.9.3) |
| TypeScript, no compiler | same, top-level only | `ts.*.lex1` |
| Rust / Verus | `rust:` or `verus:path#Type::fn` (Verus if the file contains `verus!` or `vstd::`) | `<lang>.file.v1`, `<lang>.own.v2`, `<lang>.unit.v2`; Verus adds `verus.contract.syn1` and `verus.closure.syn1` (syntactic approximations) |
| package.json | `pkgjson:package.json#scripts.<name>` | |
| Workflows | `gha:<path>#jobs.<job>.steps.<i>` | |
| Everything else | `raw:<path>` | `raw.file.v1`, `raw.own.v1` |

- Digest = SHA-256(σ ‖ LF ‖ canon).
- Hatch markers counted: `ts_ignore`; Verus `external_body`, `external`, `assume`, `admit`, `assume_specification`, `uninterp`, `axiom`; `unsafe`.
- Revision: the CLI uses `git rev-parse <ref>` for git refs, and otherwise `gitTreeId(tree)` (40 hex). It prints `revision <hex>` on stderr. Records must carry this `revision`.

## 6. Evidence records (for provider agents)

**Format.** An in-toto Statement v1, optionally DSSE-enveloped:

- Tests use the test-result v0.1 predicate; other kinds use SCAI v0.3.
- Shape's fields are in `predicate.shape`. `makeStatement` builds the subjects, which RJ02 checks.
- Signing: `signStatement(stmt, [signerFromSeed(seed)])` signs the DSSE PAE over JCS(statement) with ed25519, with keyid = public hex.
- Declare the provider's `identity: ed25519("<pub hex>")` in the base shape so its records count as authenticated.
- Sigstore signatures are not verified and are rejected as RJ07 (except in preview mode).
- Record id = H(JCS(statement)).

**`predicate.shape` fields:**

- `v: "shape.evidence.v1"`, `kind`, `result`, `provider: {id: "<module>::<name>", version} | null`, `revision`, `time` (RFC 3339 UTC)
- `claim: {id, fp, nf?}`. `nf` is an optional extension, the JCS of `{v, op, args}`. It lets a record for a stronger template instance establish a weaker one, e.g. a test of `Bounded<f,0,50>` establishing `Bounded<f,0,100>`.
- `code` and `deps`: `[{id, projection, scheme, digest}]`, copied from the manifest. They must cover Req:
  - unit law: (bind, `unit`);
  - component law: top-level symbols at `unit` plus files at `own`;
  - judgments: at the law's projection;
  - hosted statements add (ref, `closure`).
- `harness`: required for observations, tests and proofs, possibly `[]`. It lists test files, fixtures and configuration.
- `scope: {root: scopeRoot(entries), entries: [{id, projection, scheme, digest, complete, deps}]}`, and `facts`:
  - `{type: effect, at, verb, resource: "pg.table(\"...\")"}`, `{type: call, at, to}`, `{type: edge, at, kind, to}`;
  - never hatch facts in an observation (RJ14).
- `assumptions`: `{id: "<identity>/<hatch kind>", kind: "hatch"} | {id: "z3@4.12.5", kind: "tool"} | {id, kind: "named"}`
- `counterexample`: non-null for a forceful `contradicts`.
- Judgments: `judge: "<actor Q>"`. Either signed by a key listed in that actor's `identities`, or relayed with provider = a base provider that `produces judgment`, plus `identity` = the reviewer's code-host identity.
- Answers: `result: "approves"`, `about: {change, refs: ["bd:<16+ hex>"]}`.

**When a record is usable.** A record whose revision is not the head is stale unless its provider is `depsComplete` in both shapes. A head-revision record citing a digest that differs from the head manifest is rejected (RJ13). Persisted records live at `shape/evidence/<2 hex>/<64 hex>.json`.

## 7. Output (`shape.check.output/v1`, plus extensions)

Top-level fields: `verdict`, `errors[{code, subject, message, causes, dischargers}]`, `rejected[{record, code: RJxx, detail}]`, `obligations`, `answered[{obligation, records, self, exploited, as: discharge | exception-answer}]`, `loosening[{question, subject, answer, exploited, final, affected, counterexample, obligation}]`, `renames[{base, head, rule: was | binding | component | hint}]`, `debt[{obligation, exception, owner, expiresInDays, flagged}]`, `preexisting`, `budget {limit, used, overflow}`, `health`, and `summary[{group, tier, eligible, approve, judge, members}]` (the phase-1 review lines).

Each obligation has:

- `key` (`ob:`), `kind`, `reason`, `questions`, `introduced`
- `severity: blocking | owed`, `tier`, `budget: mechanical | judgment`, `force`, `owner`, `assignee`
- `group` (`g:`), `claim {fp, ids, tier}`, `subject`, `witness` (fact or record ids), `facts`
- `counterexample`, `exploited`, `final`, `binding` (`bd:`), `exception`
- `dischargers[{act, by, agentSafe, eligible, creates, command?, snippet?}]`, `message`, `causes[{type, id, text}]`
- Prototype extensions: `affected`, `rule` (the A.7.5 severity rule that decided it, 2–9), `matched`.

Health keys: `coverage {num, den}`, `unobservable`, `unanswered`, `openAuthority`, `ungoverned`, `unmapped`, `externalCalls`, `ungovernedCalls`, `unanchored`, `droppedEdges`, `unauthenticated`, `executesHead`, `baseObservations`, `baseDefects`, `clockClamped`, `trustDebt`, `budget`, `self`, `preexisting`, `renames`, `assumption`, `cells`, `records`, `baseUnreadable`, and `teeth` when `--teeth` is given (unused grants, vacuous claims, gaps).

## 8. CLI: `bun experiments/shape-1/proto/src/cli.ts <cmd>`

**`check`.** Exit codes: 0 for pass or owed, 1 for blocked, 2 for invalid or a usage error.

- `--input <file|->`: a ready `CheckInput`; or build one from disk with `--model <dir>` (default `.`).
- `--base <dir|git-ref>`: if a git ref, the base shape files are materialised under `--tmp <dir>`.
- `--changed <file>` without `--base`: builds a synthetic base, namely the head shape over the head manifest minus the listed paths.
- With no `--base`, the base is the head itself.
- `--evidence <file|dir>…` and `--base-evidence …`: accept JSON, JSON arrays or JSONL; directories are read recursively.
- `--mode change|audit|preview`, `--now`, `--change-id…`, `--author <identity>…`, `--authors <json>`, `--reviews <json>`
- `--sidecar` and `--base-sidecar`; `--head-rev <ref>` or `--head-revision <hex>`
- `--maintainer <login>…`, `--include-generated`, `--no-rewrite`
- `--synthesize`: adds one tiny TS file per `ts(...)` unit binding, for shape-only fixtures.
- `--no-typescript`, `--teeth`, `--write-input <file>`
- Output format: `--json` (full) or `--core`.

**Other commands.**

- `manifest --root <dir> | --git <repo> --rev <ref> [--revision <hex>]`: prints the manifest statement.
- `migrate --model <dir>`, `elaborate --model <dir>`
- `sign --seed <hex> <statement.json>`: prints a DSSE envelope; the record id goes to stderr.
- `keygen --seed <hex>`, `record-id <file>`, `hash <file>`

`examples/write-inputs.ts <outdir>` writes the 21 worked-example inputs as JSON files.

## Build status

- **Gate:** passed.
- **Tests:** 131 passed, 0 failed.

**Commands**

- `bun test experiments/shape-1/proto/test/`
- `bun run typecheck && bun run lint`
- `bun experiments/shape-1/proto/examples/write-inputs.ts /tmp/claude-0/-home-user-shapelang/83ff80bc-0161-572f-9e5a-9075cccad6d0/scratchpad/shape1work/proto-inputs`
- `bun experiments/shape-1/proto/src/cli.ts check --input /tmp/claude-0/-home-user-shapelang/83ff80bc-0161-572f-9e5a-9075cccad6d0/scratchpad/shape1work/proto-inputs/ex1-B.json        # human diagnostics, exit 1`
- `bun experiments/shape-1/proto/src/cli.ts check --input - --core < input.json                   # core JSON on stdin`
- `bun experiments/shape-1/proto/src/cli.ts check --model fixtures/loosening/grant_added/head --base fixtures/loosening/grant_added/base --synthesize --maintainer alice --maintainer bob --now 2026-10-25T12:00:00Z`
- `bun experiments/shape-1/proto/src/cli.ts check --model . --mode audit --maintainer tim --maintainer ann --now 2026-10-25T12:00:00Z --json`
- `bun experiments/shape-1/proto/src/cli.ts check --model . --base HEAD~1 --tmp /tmp/claude-0/-home-user-shapelang/83ff80bc-0161-572f-9e5a-9075cccad6d0/scratchpad/shape1work/proto-scratch/tmp --maintainer tim --maintainer ann --now 2026-10-25T12:00:00Z --evidence <records-dir> --json`
- `bun experiments/shape-1/proto/src/cli.ts manifest --root <dir>    # or: manifest --git . --rev HEAD`
- `bun experiments/shape-1/proto/src/cli.ts sign --seed <64-hex> statement.json > envelope.json   # record id on stderr`
- `bun experiments/shape-1/proto/src/cli.ts keygen --seed <hex>      # prints ed25519("<pubhex>")`
- `bun experiments/shape-1/proto/src/cli.ts migrate --model <dir>     # shape.source.v1 the model loads as`

**Open problems**

- The CLI cannot verify Sigstore bundles, so records from providers with `sigstore(...)` identities are rejected (RJ07); use `ed25519("<hex>")` identities. Commit objects are not checked either: only an optional `treeId` against the tree rebuilt from the manifest. The rebuild itself was checked against git's own tree id for HEAD.
- TypeScript schemes are named ts.unit.v2 and ts.own.v2 but use the TypeScript found on disk (6.0.x), not the pinned 5.9.3, so digests are not portable across parser versions. env(x) resolves names within the file and import specifiers only, not transitively across files.
- Verus `contract` and `closure` digests come from a token scanner (verus.*.syn1), not VIR. The worked-example fixtures use label digests under .vir.v2 scheme names instead.
- Cells are computed by one global product-automaton BFS with a 10^6-state budget, rather than the spec's per pair. Base glob ties use the strictest view only in L1; elsewhere the codepoint-least component wins.
- Approximations:
- L3's DFS follows A.8.4.2 but skips the first pass over W_eval edges, and dfs_complete is open.
- L6 compares a reduced tuple set; requirement dominance uses level only.
- L7 does not check that an heir's head owner lies within owner*, and its provider and actor subject tiers are approximate.
- Teeth is minimal (unused grants, vacuous claims, gaps); the W1/W2/P1 closed forms and redundancy are not implemented.
- Exceptions match {from, to} subjects only through `pair` selectors, and never {nodes}. Exception answers require an eligible non-agent for the owner* of each excluding claim.
- Coverage sets come from head records' entry deps only. For a contradiction, tier* from base heirs is taken without checking the witness (spec_feedback 14).
- Migration does not mint exceptions for 0.x `unsafe` and does not migrate 0.x `binding` (DocumentedBy). Its owner team is a placeholder, filled by `--maintainer` or a sidecar.
- Spec points the prototype had to decide: the Hatch-clause semantics (spec_feedback 1), audit-mode governance (3), summary call-channel coverage (2) and owns → Owns (4). These change results on Examples 1–3 and on Shape's own model, and need a spec decision before differential testing against the Lean kernel.

**Spec feedback from the build** (folded into the final spec; see [RFC.md](../RFC.md))

- 1. Hatch clause defect (A.4.2.4 vs Example 2). `forbid hatch * outside boundaries` includes a clause `effect.forbid(Hatch<std::Trust>, [*], boundaries allowing Hatch)`. Because ↓Hatch contains every declared hatch kind, that clause also forbids the kinds a boundary allows, and makes the other nine clauses redundant (teeth would flag them). Measured on Example 2: HostTrusted's allowed `external_body` raises a preexisting, owed, sound contradiction of the Hatch clause (dc8454f2…), ob:220a9b307f0f3608. Fix: either the Hatch clause excepts boundaries allowing any kind, or it protects only the exact atom `Hatch<Trust>` (undeclared kinds). A.13.2's `forbid Hatch<Trust> within component K forbids every hatch in K` needs the ↓ reading, so the elaboration should change rather than the ↓ rule.
- 2. Summary channels and coverage (A.4.5.1, A.7.4.2 vs Example 1 Variants A and C and Example 3). `effects.upper/lower(u)` need channel `call(L)` at changed code in reach(u), and A.7.4.2 omits nothing. In Variants A and C the newly declared `effects complete` on purgeOldEvents needs `call(ts)`, which no example provider supplies. That raises a critical, blocking coverage obligation which joins the loosening group, so Variant C's group is not g:1a70082cc2804631. Adding an absence-sound `call(ts)` observer reproduces the vector group exactly (tested). Likewise, after Example 3 Step 1's judge line the verdict is `owed`, not `pass`: isoToday's summary needs `call(ts)` coverage at normal. The examples or the channel rule need reconciling.
- 3. Audit-mode governance is undefined. With `base: null`, G* has no base. Read literally, every provider is head-only (level declared), so 'Example 1's base in audit mode: pass' cannot hold: the critical law needs tested. The prototype uses the head as the governance base in audit mode.
- 4. `owns → std::Owns` (A.11.1) contradicts 'Shape migrated: no errors'. Owns forbids `Write<R>` and `provides` edges for non-owners. Measured on Shape: 35 E-conduct/E-structure errors (17 alone on SemanticDiagnostics, which ShapeChecker, ShapeModelLowerer and others append to). 0.x `owns` appears to mean provides-exclusivity only. Either migrate only the edge clause or soften Owns.
- 5. 'Shape migrated has 0 E-route, E-overlap, E-unbound' holds only partly:
- 0 E-route.
- 0 E-unbound, but only after the A.11.1 suffix rewrite (18 sources rewritten) and after treating generated-AST shapes as mapper output; otherwise 436 E-unbound, 127 E-overlap and 4 E-template. A.11.1 should say that `origin: generated_ast` documents are observations, not authored claims (SEED: observe, don't author).
- 2 E-overlap remain, because two 0.x functions source the same file once workflow step names are dropped: CiPipeline.runShapeCi and runExperimentalSemanticKernel both bind gha:.github/workflows/shape.yml; DocsSite.verifyDocs and DocsShapeBlockVerifier.verifyShapeCodeBlocks both bind docs-site/scripts/verify-shape-blocks.ts.
- These overlaps cascade into 6 E-conduct errors on complete summaries.
- 6. Path-less components (the 0.x loosening fixtures have no implementation blocks). A newly added unit moves its new identity from `ungoverned` (its base attribution) into its component. Any `* except component K` forbid, such as Owns, then reports L1 loosened at that identity. read_only_function_added and effects_unknown give L1 latent instead of A.8.6's 'tightening'. Either the base attribution of identities new in the head should honour head unit bindings, or path-less components need regions.
- 7. L7 on first adoption. An empty base has no shape owner and the std pack items differ in owner. Read literally, L7 'an owner changed' raises an undecided `shape` loosening on every first adoption, and DefaultPolicy then blocks it, contradicting 'empty base: owed'. The prototype skips owner comparison when the base has no shape declaration, and skips pack (std::) items.
- 8. When an item's owner is the shape owner (providers, actors, policy, shape), final items need 'a base shape owner member as second person'. Both persons then come from the same team. In Example 1's weakened-observer variant (final L7 on sqlEffects), alice is an author and the only other Platform person is carol, so the obligation can never be discharged. State whether two persons of that one owner are required.
- 9. A.4.4.9 'least supporting fact by (presence-sound, declared, fact id)' does not say whether true sorts before false. The prototype puts presence-sound and declared facts first. This is consistent with Example 4's representative 1bb37b47….
- 10. A head-revision record that cites a moved digest is rejected by RJ13 (no force, so the law's reason is `missing`), not counted `stale`. `stale` therefore arises only for records at other revisions or with deps-complete reuse. Worth saying in A.5.4.1.
- 11. L1 authority parts. The text ('positions gained atoms in A') would list HardDelete in Variant A, although it stays forbidden. The prototype requires the atom to be both newly permitted and newly in A, matching 'the grant newly permits Update'. Variant C's vector delta is reproduced either way.
- 12. Eligibility excludes authors*. Read literally, a persisted judgment by a person who later authors a change becomes unusable in that change, because the judge is ineligible there. This is probably unintended for reused judgments. The prototype applies it literally.
- 13. A.7.6.8 says reviews without a relay act, but eligibility (A.6.3.3) requires 'a base actor whose record is authenticated'. The prototype lets such reviews act and lists them in health `unauthenticated`.
- 14. tier*(o) (A.6.2.3) requires checking whether o's witness violates ρc_b. For heirs, the prototype counts the base claim's tier without that check, which is conservative upward.
- 15. The A.8.6 predictions assume real code. Measured with synthesized code: 18 of 23 match, 1 partial (memory_and_trait_removed: L4 but no L1), 4 differ:
- effects_unknown and read_only_function_added: item 6.
- memory_guard_removed: the head's 0.x `change … : RefactorSensitive` re-adds the same informal law, so no L4.
- guarded_fn_edited_in_place: needs an actual code edit, which synthesis cannot produce.
- 16. The input contract's `files`/`packs`/blob-id checks need a 1.0 parser. The prototype takes `source` (shape.source.v1) instead, and std is built in.
