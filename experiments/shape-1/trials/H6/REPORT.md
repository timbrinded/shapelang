# H6: teeth on Shape's own 1.0 model

## Hypothesis and falsification criterion (SEED)

**H6.** Teeth checks find real vacuity and gaps in real shapes.

**Falsified if** they find nothing in Shape's own model.

## Verdict: asserted (not falsified), with one qualification

**The qualification.** The teeth provider's own vacuity test is a claim whose closed-form kill set is empty. On Shape's model that test finds **0 of the 154 assessed claims** vacuous.

**What teeth does find in Shape's model:**
- **19 redundant claims.** One of the two classes exposes a defect in the spec's hatch expansion.
- **2 unused grants.**
- **Uncovered change classes in every operator family:**
  - P1: 79/79 resources uncaught.
  - W2: 3,530/4,028 added edges survive.
  - W1: 1,129 survivors, at unbound component code and at ungoverned code.

**When mutants are restricted to what the deployed providers can report:**
- 33/154 claims (21%) are vacuous in practice.
- 99.7% of W1 kills are against changes no provider can see.

**Law adequacy:**
- 250 of 296 code mutants of law-bound functions are killed by no law.
- Of the 17 tested laws that can be assessed, 4 are vacuous and 8 are weak on the code they are bound to.

**fixtures/skills:** the provider's own test finds 8 vacuous claims among 26.

**E10's headline gap (a destructive effect plus a grant passed on all 79 resources):**
- As a 1.0 change, it is caught by loosening L1 on all 237 realised probes, and on 75/79 grant-only changes. Only tier-low components miss.
- As a standing claim it is not closed. With no destructive forbid, P1 stays 0/5,607 in audit mode.

## 1. Setup

**Model.** `experiments/shape-1/dogfood/model.source.json`, unchanged. It has 418 claims:
- 154 upper bounds that teeth assesses: 101 effects.upper, 24 authority, 12 effect.forbid, 14 edge.forbid, 2 path.forbid, 1 cycle.forbid;
- 177 lower bounds that the closed form does not assess: 101 effects.lower, 76 edge.exists;
- 87 laws.

**Head.** One frozen manifest, revision `8cb085a8c17ef2b2b15dc7944a13a35330e23b67`. It contains the working tree's tracked files plus the dogfood files: 3,679 identities and 127 positions (102 units, 24 `K.*`, 1 `ungoverned`).

**Records at that revision:**
- tsClockScan: 23 Read facts in 345 files;
- tsCalls: 2,748 call facts in 216 files;
- bunTest: 50 records (19 supports, 2 contradicts, 29 inconclusive).

**Provider.** `proto/providers/teeth`, a closed form over W_decl with observed facts optional. The operators are:
- W1: add an effect fact;
- W2: add a type-correct edge;
- P1: grant a destructive verb and perform it at `K.*`;
- M2: remove a grant.

**What I built for this trial, because it was missing:**
- **Restricted universes,** in `teeth-dogfood.ts`:
  - observable mutants;
  - E10-comparable W1;
  - W2 by module pair, in `w2-edges.ts`.
- **E10's class as real changes through derive,** in `p1-change.ts`.
- **A law-adequacy runner for the dogfood laws,** in `law-adequacy.ts`. The provider's law path reads `bound.mutants`, and no dogfood record has it, so all 87 laws report `unassessed`.
- **A bridge back into the provider's law path,** in `law-teeth.ts`.
- **Two realisations:** the ungoverned clock read (`ungoverned-clock.ts`) and the boundary hatch (`hatch-allows.ts`).

## 2. The teeth provider on Shape's model

| | W_decl | W_decl + observed facts |
|---|---:|---:|
| W1 killed / mutants | 110,001 / 111,130 | 111,094 / 111,126 |
| W2 | 498 / 4,028 | 528 / 3,997 |
| P1 | 0 / 5,607 | 0 / 5,607 |
| M2 | 179 / 181 | 179 / 181 |
| vacuous claims | 0 | 0 |
| redundant claims | 19 | 50 |
| unused grants | 2 | 2 |
| P1 resources uncaught | 79 / 79 | 79 / 79 |
| laws assessed | 0 / 87 | 0 / 87 |

**Differential check.** `validate-dogfood.ts` realises 100 evenly spaced mutants per operator as audit inputs. Closed form and derive agree on **300/300** (84 s).

**Kill-set sizes over W_decl:**

| Claim kind | Count | Smallest kill set | Largest kill set |
|---|---:|---:|---:|
| authority | 24 | 1,710 | 14,850 |
| effects.upper | 101 | 819 | 867 |
| effect.forbid | 12 | 84 | 1,270 |
| path.forbid | 2 | 16 | 68 |
| edge.forbid | 14 | 23 | 23 |
| cycle.forbid | 1 | 148 | 148 |

The smallest of all is AnalyzerStaysAdvisory, which kills 16 W2 mutants.

## 3. Vacuity

### 3.1 Closed form

0 of 154 claims are vacuous: every assessed claim kills at least one mutant. Under the provider's definition, Shape's own model contains no vacuous claim.

### 3.2 Against the deployed providers

The closed form counts a W1 mutant as killed even if no provider could ever report it. I therefore restricted the universe to mutants that a base provider with presence soundness could report:
- the channel is declared and applies to an identity at the position;
- for the stricter row, the verb is one the providers actually report, which is Read only.

| Measure | Value |
|---|---:|
| resources with any bound code | 67 / 79 (82 codes) |
| resources with a code on an observed channel | 1 / 79 (SystemClock: 4 `ts.call` codes) |
| W1 mutants observable (channel) | 1,437 / 111,130 (1.29%), killed 1,426 |
| W1 mutants observable (reported verbs) | 337 (0.30%), killed 336 |
| authority kills observable (channel / verbs) | 1,189 / 99 of 107,363 |
| effects.upper kills observable | 953 / 85 of 86,839 |
| effect.forbid kills observable | 520 / 433 of 2,593 |
| complete summaries with any observable atom | 2 / 101 |
| edge kinds a provider observes | calls only (tsCalls, presence); none of provides, callbacks, coordinated_call, data_flow |

**Observably vacuous claims.** These kill W_decl mutants but no mutant a deployed provider could report. There are **33/154**:
- **16 effects.upper.** 14 are on units bound to code with no observed channel: workflow steps, shell, Rust, Langium. Examples are `CiPipeline.runShapeCi`, `ReleasePipeline.buildReleaseAssets`, `ExperimentalSemanticKernel.runNativeProtocol` and `ShapeGrammar.generateAst`. The other 2 are `ShpCli.isoToday` and `ShpCli.main`, which already declare the only observable atom.
- **2 authority.** ExperimentalSemanticKernel (Rust code only), and ShpCli, which grants the only observable atom.
- **1 effect.forbid:** the `unsafe` hatch forbid. The repo has no Bend code.
- **14 edge.forbid over `provides`.** No provider observes `provides` edges, so only an authored relation can violate them.

**Lower bounds.** Refuting one needs absence-sound complete entries. Only tsClockScan has them, so:
- 2 of 101 effects.lower are refutable;
- 0 of 76 edge.exists are refutable, because tsCalls declares presence soundness only.

## 4. Redundancy, and a spec defect it exposes

Over W_decl there are 19 redundant claims:

| Class | Count |
|---|---:|
| a unit summary that lists exactly its component's grants, so its kill set ⊆ that component's authority (for example ShapeParser.parseShapeModule, ShapeFormatter.formatShapeModule, both ShapeStringHelpers units) | 10 |
| a kind-specific hatch forbid ⊆ the catch-all `Hatch<std::Trust>` forbid (`NoHatchesOutsideBoundaries/dc8454f26ba4`) | 9 |

With observed facts the count rises to 50. Of these, 40 are summaries whose kill set ⊆ a caller's summary through observed calls. This depends on position-level reach and on the 336 preexisting transitive-summary contradictions, so treat it as indicative.

Path-forbid sources nest exactly as E10 found: ShapeChecker (40) ⊂ ShapeEditorServices (48) ⊂ ShpCli (68).

### The hatch defect

**Cause.** `forbid hatch * outside boundaries` elaborates to `effect.forbid(h<Trust>, [*], boundaries allowing h)` for each h ⇒ Hatch, *including Hatch itself* (model §4.2, A.4.2.4).
- The Hatch forbid's except list holds only boundaries that allow `Hatch`.
- Every declared kind lies below Hatch.
- So the catch-all forbids every hatch everywhere, and `allows hatch` never takes effect.

The redundancy teeth reports is the symptom.

**Realised on the spec's own Example 2.** This is the prototype's `ex2`, where HostTrusted allows `external_body, external, uninterp`. Script: `hatch-allows.ts`.

| Variant | Obligations | Hatch obligations |
|---|---:|---|
| as published | 3 | blocking assume contradiction at `set`; plus an **owed sound contradiction of `/dc8454f26ba4` at `verus:ironkv/src/host_t.rs#Host::send` for external_body**, inside the boundary that allows it. The example text reports only the 2 blocking obligations. |
| base lists no marker at Host::send | 3 | the external_body marker becomes a **sound, introduced, blocking** contradiction |
| no host marker | 3 | only the assume contradiction |

**Fix.** Read `*` as each declared hatch verb plus one leaf verb that undeclared kinds lift to (for example `Unregistered ⇒ Hatch`), never `Hatch` itself. The forbids then become disjoint and the redundancy disappears.

## 5. Uncovered change classes (gaps)

All figures are over W_decl.

| Change class | Mutants | Caught | Surviving | Caught by |
|---|---:|---:|---:|---|
| W1, unit positions, E10's 10 verbs × 79 resources | 80,205 | 80,195 | 10 | authority 79,168; summaries 78,988; forbids 144 |
| W1, granted atom at `K.*` (component code no unit binds) | | | 260 | none |
| W1, any non-hatch atom at `ungoverned` | 869 | 0 | 869 | none |
| W2 calls, back-edge | 148 | 148 | 0 | cycle forbid |
| W2 calls, new coupling | 256 | 28 | 228 | path forbids, cycle |
| W2 calls, shortcut | 98 | 0 | 98 | |
| W2 callbacks | 552 | 0 | 552 | |
| W2 coordinated_call | 546 | 0 | 546 | |
| W2 data_flow | 552 | 0 | 552 | |
| W2 provides | 1,876 | 322 | 1,554 | 14 provider forbids |
| P1, destructive grant and act, audit | 5,607 | 0 | 5,607 | none (79/79 resources) |
| M2, grant removal | 181 | 179 | 2 | unused: `ShapeRuleEngine Update<ShapeHypergraph>`, `DocsSite Update<DocsContent>` |

**The 10 unit-level W1 survivors** are all at `ShapeRuleEngine.requirementsForTarget`, the only unit with `effects unknown`. 9 of them gain an atom a sibling unit already has.

### Ungoverned code is the largest silent class

**Size.** 2,049 of 3,679 identities are ungoverned:
- 1,083 under experiments/shape-1;
- 442 under bend-probes;
- 170 under fixtures;
- 170 under packages. These include production files: `packages/shp-cli/src/freshness.ts` (3 identities), `shp-cli/src/lsp` (7), `shp-checker/src/checker.ts`, `index.ts`, `shape-domain.ts`, and `src/experiments` (12).

**Realised.** The only observable W1 gap is Read<SystemClock> at ungoverned code. I seeded `void Date.now();` into `freshness.ts#resolveFreshnessDate`, where `isoToday` is bound by an explicit unit binding but no component glob covers the rest of the file. That file is the subject of Example 3.

| Seed | Clock facts | Introduced obligations |
|---|---|---|
| `freshness.ts#resolveFreshnessDate` (ungoverned) | 23 → 24 | **0**; not even coverage |
| `git.ts#git` (governed, ShpCli) | 23 → 24 | a sound **blocking** ClockReadOnlyAtCliBoundary contradiction, owed coverage, and owed CliDocumented |

In both rows the verdict is blocked by E-provider-missing, because only clock records were supplied. That is the same in both rows; the introduced obligations are the signal.

## 6. E10's destructive-effect-plus-grant class as 1.0 changes

**What the audit closed form misses.** P1 is audit-only and counts forbids. A change that adds a grant is also judged by loosening and coverage.

**Setup** (`p1-change.ts`):
- Base and head are both `probeSource(dogfood)`: every resource gains a synthetic `ts.call` binding, and a presence-sound probe observer is declared on both sides.
- Per resource R (79), one component K is chosen round robin over the 21 components that have grants and a TS-bound complete unit u. That gives 11 critical, 9 normal and 1 low component; the low one covers 4 resources.
- A code edit is a digest change of u (and its file) in the base manifest.
- The dogfood records are included in every run.
- Baseline: verdict `owed`, 414 obligations, 0 blocking.

**Results.** Counts use obligations with new keys.

| Variant | n | Result |
|---|---:|---|
| G1: head adds `grants HardDelete<R>` to K only | 79 | **L1 blocking 75**: all critical and normal, latent, blocked by the `latent loosening` policy. **L1 owed 4**: all low tier, verdict owed. |
| G2: grant + `V<R>` in u's complete summary (E10's probe) × {HardDelete, Truncate, DropStorage} | 237 | **237/237 blocked.** L1 exploited by the declared fact: 237. L2 (summary weakened): 237. Callers' summaries contradicted: 123 (41 per verb). |
| G3: grant + code edit + observed fact | 79 | **79/79**: L1 exploited and blocking, plus a sound blocking contradiction of u's summary. Coverage 79 (48 blocking). |
| G4: grant + code edit, no fact (R unobservable, as in reality) | 79 | **L1 blocking 75**: 44 exploited through uncovered changed code at critical, 31 latent at normal. **L1 owed 4** at low. Coverage 79 (48 blocking). |
| E1: code edit + observed fact, no grant | 79 | **79/79** sound blocking authority contradiction, plus the summary contradiction |
| E0: code edit only (control) | 79 | coverage obligation 79/79, of which 48 blocking (critical) |

**Control.** With `: std::AppendOnly` attached to every resource (`p1-control.ts`), P1 is 5,607/5,607 caught. This matches E10's control, which caught 79/79.

**Escalated obligations (artefact).** In the code-edit variants (E0, E1, G3, G4), 52/79 runs also escalate a preexisting obligation to blocking. This happens because the runs supply no base-revision records, so every observed fact at edited code counts as new. G1 and G2 edit no code and are unaffected. The L1 and authority counts above use new keys only.

**Conclusion for this class.** 1.0 turns the class into a decision, through L1 at normal and critical tier. It stays unblocked at tier low, and in audit and adoption, where no prior shape is compared.

## 7. Law adequacy

**Plan.** 87 laws:
- 21 tested (19 hold, 2 documented contradictions);
- 29 untested Property laws;
- 27 RefactorSensitive;
- 10 DocumentedBy.

Laws on units cover 35 units. 33 of them are TS functions; 2 are bound to raw files (`build-release-assets.sh`, `shape.langium`).

**Mutants.** 248 are available in unit spans and 278 in same-file callees. I chose up to 12 per unit span and up to 8 in callees, **296 in total**. Each one runs the whole 21-law suite (6.4 s; seeded generators, so deterministic).

| Units, by the laws they carry | Location | Killed by own law | Killed by another law | Survived | Unreached |
|---|---|---:|---:|---:|---:|
| some tested law | unit | 24 | 0 | 39 | 0 |
| some tested law | same-file callee | 16 | 1 | 39 | 0 |
| informal laws only | unit + callee | 0 | 1 | 52 | 33 |
| untested (+ informal) | unit + callee | 0 | 4 | 61 | 26 |
| **all** | | **40** | **6** | **191** | **59** |

"Unreached" means the mutant is in a file no law test imports, so no law test can execute it. Those 59 mutants are in 6 units: CiPipeline ×2, DocsShapeBlockVerifier, and ShpCli main, defaultShapeFiles and update. They count as survivors without being run.

**Law verdicts through the teeth provider's own law path.** I fed the counts back as `bound.mutants` (`law-teeth.ts`):
- **5 teeth:**
  - the two IncrementalReuses laws, 12/20 each;
  - ForbiddenPathFewestHops, 4/8;
  - FreshnessEnforcesOnlyIsoDates, 4/6;
  - HypercycleShortestWitness, 8/14.
- **8 weak:**
  - IncrementalRebuildsOnDocumentChange, 6/20;
  - CheckIsDeterministic, 3/15;
  - FinalForbidBeatsGrant, 3/20;
  - the three Inspection laws, 2/15 each;
  - SourcePathRulesShared, 2/5;
  - UpdateDraftsPreferUnknown, 2/14.
- **4 vacuous:**
  - FinalForbidNotWaivedByContext, 0/20;
  - FinalForbidTargetsDeterministic, 0/20;
  - ForbiddenPathHopsKeepProvenance, 0/8;
  - FormatterIdempotent, 0/2.
- **2 unassessable:** the ChangePlan laws. `lowerChange` has no mutable operator in its span or its same-file callees.

**What 1.0 does with the 250 unkilled mutants.** These follow from the severity rules; I did not run derive on them.
- **206** are in units with a RefactorSensitive law, which goes stale and needs a judgment. 133 of these are at critical tier, where the obligation blocks; 73 at normal, where it is owed.
- **2** are in units with only untested laws; their unestablished obligation becomes introduced, at normal tier, so owed.
- **42 pass the law layer silently.** These are exactly the units whose guards the dogfood retired as "fully covered by tested laws": IncrementalShapeChecker.check, checkFreshness, deriveFinalForbidsForResource, findHypercycle, findShortestPath, normalizeShapeSourcePath and formatShapeModule. On those 7 units the laws kill **33/75** mutants. For example, all the rule-based (`when R has T`) final-forbid code survives.

**Hand check** (`data/survivor-handcheck.json`). Of 12 evenly spaced survivors in tested units, 11 change behaviour. One (`appliesTo ?? target` → `||`) differs only on an empty string. The survival rate is therefore not an artefact of equivalent mutants.

## 8. fixtures/skills

All 14 models were migrated by the prototype loader. 3 of them carry E-unbound, and teeth still runs on them.

| Measure | Value |
|---|---:|
| models with claims | 12 |
| assessed claims | 26 |
| vacuous | **8** |
| redundant | 2 |

**The 8 vacuous claims:**
- 7 are `effects complete {}` summaries in models that declare no resource, so there is nothing for them to exclude: index/missing-ast 1, review/cross-object 2, review/root-cause-grouping 3, review/stale-model 1.
- 1 is a migrated Owns `provides` forbid in preflight/guarded-unknown, whose only component is the owner.

**The 2 redundant claims** are summary ⊆ authority, the same class as in the dogfood.

**P1:**
- unix-system-visualiser: 3/3 caught by its AppendOnly.
- preflight/guarded-unknown: `TemplateCatalog` uncaught at its owner, which the Owns forbid excepts.

**A duplicate removed before teeth runs.** unix-system-visualiser's 0.x `rule retain_system_events { forbid HardDelete<SystemEvent> }` restates `: AppendOnly` exactly. Elaboration merges them by fingerprint into one claim with two ids.

## 9. Comparison with E10

| E10 finding (0.x model, `shp check`) | E10 | 1.0 dogfood | Closed? |
|---|---|---|---|
| 1. Destructive effect + grant passes | probe 0/237 killed; 79/79 resources | Audit P1: 0/5,607, 79/79 uncaught. As changes: G2 (E10's probe) **237/237 blocked** (L1 exploited + L2); grant only 75/79 blocked; tier low owed. AppendOnly control 5,607/5,607. | **As changes, at normal and critical: yes, via L1. As standing claims: no.** Not at tier low; not in audit or adoption. |
| 2. Effects spread inside a component | M1 1,027 / 79,415 survive | 10 / 80,205 survive (requirementsForTarget, `effects unknown`) | **Yes for declared worlds**, through `effects complete` summaries. Observable only for SystemClock: 85 of 86,839 summary kills. |
| 3. New `calls` coupling | 172/502: back-edge 148/148, shortcut 0/98, new 24/256 | 176/502: back-edge 148/148, shortcut 0/98, new 28/256. Module-pair table identical in 32 of 35 pairs. | **No.** ShapeAnalyzer→ShapeChecker is now forbidden (AnalyzerStaysAdvisory). ShapeAuthoring→ShapeChecker still passes. |
| 4. Kernel isolation | 4 direct calls pass; callbacks and coordinated_call routes pass | same 4 direct edges pass; callbacks 0/23, coordinated_call 0/23, data_flow 0/23 into the kernel | **No** |
| 5. Providers | 1,554 of 1,876 provides pass | 1,554 of 1,876 pass. The 47 migrated Owns forbids were dropped: the naive migration caught P1 for 17/79 resources (3,231/5,607). | **No** |
| Unused grants | 2 | the same 2 | no change |
| Redundant path clauses | 40 ⊂ 48 ⊂ 68 | the same nesting, as path-forbid sources | no change |
| `owns` in no diagnostic | 47 | dropped from the model | removed |
| New in 1.0 | | ungoverned code (869 W1 survivors, realised); observability (33/154 observably vacuous); the hatch defect; 10 summary ⊆ authority redundancies; law teeth (4 vacuous, 8 weak) | |

## Threats to validity

- **Position-level closed form.** `K.*` and `ungoverned` are single positions, so kills over W_decl plus observed facts are overstated for them. I report gap classes over W_decl only.
- **Additions only.** The closed form covers W1, W2 and P1 plus M2. Lower bounds are not assessed.
- **Plausibility.** The mutant universes include implausible mutants, such as DropStorage<SystemClock>.
- **Observability assumptions.** The analysis uses declared channels and the verbs providers actually reported. It treats `calls` as observed everywhere, although tsCalls scans only part of the tree, so observability is overstated.
- **P1 change runs** use synthetic bindings and synthetic digest edits. They use one component per resource, and only 1 low-tier component, covering 4 resources.
  - No base-revision records were supplied, so code-edit variants escalate preexisting obligations (52/79). These are reported apart.
  - The first pass lacked escalation tracking. Only its G1 and G2 rows are used; all code-edit variants were rerun with `--resume`.
- **Law adequacy.**
  - Mutants are sampled: 296 of 526.
  - Only same-file callees are mutated; H3 found 12/54 killed for cross-file callees.
  - A static import filter counted 59 mutants as survivors without running them.
  - The outcome classes come from the severity rules, not from derive runs.
  - The equivalent-mutant rate is estimated at 1 in 12.
- **Machine load.** Load average was 8 to 15 from other agents, so timings are indicative only.
- **Moving HEAD.** Commit 7a8e27b tracks experiments/shape-1, so 1,083 of the ungoverned identities are prototype and kernel files.

## Spec implications

1. **Fix the hatch expansion** (model §4.2, A.4.2.4). `*` should mean each declared hatch verb plus an `Unregistered` leaf, never `Hatch`. Today the catch-all ignores `allows hatch`, and spec Example 2 carries a contradiction at an allowed boundary marker.
2. **Make teeth relative to observability.** Report kills over W_decl and over W_obs, and list observably vacuous claims in health. On Shape's model that is 33/154.
3. **Judge P1 in change mode.** Report a P1 mutant as caught by L1 at tier t, or as uncaught. Today tier low and audit or adoption leave it open.
4. **Report ungoverned code as its own teeth gap class**, and count it per channel in health. A clock read seeded there raises nothing.
5. **Give law teeth a producer.** Either providers that decide templates must emit `bound.mutants`, or teeth mutates Req itself. Without it, 87/87 laws are unassessed.
6. **Show law teeth beside L4 guard retirements.** On Shape's model the 7 retired guards rest on laws that kill 33/75 mutants.
7. **No language change** is needed for redundant single-unit summaries or empty summaries in models with no resources; reporting them in teeth is enough.

## Files and commands

**Scripts** (`experiments/shape-1/trials/H6/`):

| Script | What it does |
|---|---|
| `teeth-dogfood.ts` | frozen manifest, providers, teeth, observable and E10-comparable universes |
| `validate-dogfood.ts` | closed form against derive |
| `w2-edges.ts` | W2 by module pair and named edges |
| `p1-control.ts` | AppendOnly control |
| `p1-change.ts` | E10's class realised as changes |
| `law-adequacy.ts` | the law-adequacy runner |
| `law-teeth.ts` | counts back through the provider's law path |
| `teeth-skills.ts` | fixtures/skills models |
| `hatch-allows.ts` | the boundary hatch on Example 2 |
| `ungoverned-clock.ts` | ungoverned against governed clock seed |
| `ungoverned-ids.ts` | ungoverned identities by directory and language |
| `retired-guards.ts` | guards the dogfood retired |
| `analyze.py` | aggregates everything into `data/summary.json` |
| `runall.sh` | the end-to-end order |

**Data** (`trials/H6/data/`): `summary.json`, `analyze.out.txt`, `validate.json`, `w2-edges.json`, `hatch-allows.json`, `ungoverned-clock.json`, `ungoverned.json`, `p1-control.json`, `p1-setup.json`, `law-teeth.json`, `law-baseline.json`, `teeth-skills.json`, `retired-guards.json`, `rec-head.summary.json`, `survivor-handcheck.json`.

**Bulky outputs** (`/tmp/claude-0/-home-user-shapelang/83ff80bc-0161-572f-9e5a-9075cccad6d0/scratchpad/shape1work/H6/`): `manifest.json`, `rec-head/`, `teeth-decl.json`, `teeth-obs.json`, `teeth-extra.json`, `p1-rows-*.jsonl`, `law-rows-*.jsonl`, `law-plan.json`, `tree*/`.

**Representative commands** (from the repo root, with W set to the bulky-output directory):
- `bun experiments/shape-1/trials/H6/teeth-dogfood.ts --work $W`
- `bun experiments/shape-1/trials/H6/validate-dogfood.ts --work $W --per 100`
- `bun experiments/shape-1/trials/H6/p1-change.ts --work $W --shard i/3 [--resume]`
- `bun experiments/shape-1/trials/H6/law-adequacy.ts --work $W --shard i/2`
- `python3 -I experiments/shape-1/trials/H6/analyze.py $W experiments/shape-1/trials/H6/data/summary.json`

**Checks.** `oxlint --deny-warnings experiments/shape-1/trials/H6/` is clean, and `bun run typecheck` is clean. Every script is `// @ts-nocheck` and one-off. Nothing was committed.
