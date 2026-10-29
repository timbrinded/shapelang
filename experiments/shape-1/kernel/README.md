# Shape 1.0 Lean kernel (version 7): interface

The kernel decides a Shape change from a validated case and prints the complete core output of
`shape.check.output/v1` (records §5, A.12.10, A.16.31). It implements version 7 of the model
(spec/MODEL.md, spec/ANNEX.md with A.15 and A.16). Lean 4.34.0, no dependencies beyond Lean core
(no Mathlib, no `import Lean`).

## Executable `shapek`

`shapek [case.json]` reads a case from the file argument or stdin and prints one JSON document as
JCS bytes (RFC 8785, UTF-8, no trailing newline).

| exit | output |
|---|---|
| 0 | `shape.check.output/v1`, verdict `pass` or `owed` |
| 1 | `shape.check.output/v1`, verdict `blocked` |
| 2 | `shape.kernel.rejected/v1`: the case is malformed (`reasons: ["invalid case: …"]`) |
| 3 | `shape.kernel.rejected/v1`: the case is outside the kernel fragment, with named reasons |

The kernel never prints verdict `invalid`: input integrity (commits, trees, blob ids, pins,
signatures, RJ01–RJ14) is the pre-pass's, and an invalid input never reaches the kernel.

Fragment (A.11.2.2 [D23]); the kernel rejects instead of answering when:
- `options.teeth` is true (the teeth report is not implemented);
- `options.health` is false (that output is not fixed by the frozen set, A.16.30);
- a claim has an operator the kernel does not know;
- the cell search exceeds 10^6 product-automaton states (A.8.1.4).

L3's search budget (10^6 units) is in the fragment: it answers `undecided` with
`L3 budget <units>` in the part's delta.

## Case format `shape.kernel.case/v1`

The checker input of records §4 after the pre-pass (A.11.2.1): validated, authenticated, elaborated.

```
{"contract": "shape.kernel.case/v1",
 "mode": "change" | "audit" | "preview",
 "now": now* (integer seconds or RFC 3339),
 "change": {"ids": [...]},
 "authors": [actor Q, ...],                 authors*, base actors, closed (A.6.3.2)
 "unmappedBot": bool,                       an author is a bot no base actor maps
 "head": {"revision", "esf": ESF, "manifest": MANIFEST, "manifestAuthenticated"?: bool},
 "base": {"revision", "esf": ESF | null, "manifest": MANIFEST, "manifestAuthenticated"?: bool} | null,
 "records": [RECORD], "baseRecords": [RECORD],
 "reviews": [{"actor": Q | null, "identity", "line", "change"?, "ref"?}],
 "inputDigest"?: "sha256:…", "rejected"?: [{record, code, detail}], "clockClamped"?: bool,
 "options"?: {"health": bool, "teeth": bool}}
```

- `base` null: audit mode, or no base revision. `base.esf` null, `base.unreadable: true`, or an esf
  that is not a `shape.elaborated.v1` document (no `v`) is an unreadable base (L0, A.6.4.5, A.16.16):
  the head supplies L0's owner and answerers only; the base declares no providers, relay or manifest
  identity, so no provider is base-declared (A.6.2.6(d,e)), nothing but hatch channels is
  observable (A.4.5.6) and the self fallback never applies.
  An esf with no modules' items is the empty base (A.16.17).
- ESF: `shape.elaborated.v1` as the prototype's `elaborate` emits it (A.12.9, A.16.2(g)): `shape`
  `{q, owner, policy, manifest}`, `actors` (with `was`), `effects` `[{verb, implies}]`, `kinds`,
  `hatches` `[{kind, lang}]`, `resources`, `components` (`paths`, `exceptPaths`, `grants` list or null
  for open authority, `boundary`, `allows`, `assumes`, `was`), `units`, `claims`
  `[{ids, op, args, fp?, owner, tier, requirement|null, bearer?, statementForm?, ownerFrom?,
  tierFrom?}]` (`ownerFrom`/`tierFrom` on claims, units, components and resources name where an
  inherited owner or tier is written: `shape`, `component Q`, `unit Q`, `resource Q`, `default`;
  L7 reports an inherited field once, at that item, A.8.2.3 [D18]) (fp computed as
  `H({"v":"shape.claim.v1", op, args})` when absent; equal fps merge per A.4.1.7), `templates`
  `[{q, schemaFp, params, order}]`, `exceptions`, `providers` (with `implementation {paths, ids,
  digest}`, `trusts`, `depsComplete`, `identity`), `policy` `{tiers, budget}` (default
  std::DefaultPolicy), `errors` `[{code, subject, causes?, dischargers?}]` (head: shape errors of
  the elaborator and the pre-pass, e.g. E-parse, E-unknown, E-template, E-evidence-path; base: the
  base defects of health).
- MANIFEST: the in-toto statement (bare, or a DSSE envelope whose payload is decoded) or a bare
  block `{v, revision, entries: [{id, projection, scheme, digest, kind, parent, refs, markers?,
  executable, hatchComplete}]}`. `manifestAuthenticated` is the pre-pass's verdict on the
  signature by the governing shape's manifest identity (A.5.2.17); when a case omits it, a DSSE
  envelope counts as signed iff one of its signatures names that identity's ed25519 key id (the
  signature itself is not verified by the kernel).
- RECORD: the statement or bare shape block of records §3, plus `authenticated` (a signature by the
  required identity verified), `persistedBase` (the record is in persisted.base, so a persisted
  judgment of an earlier change when its about names no change of this run, A.16.4(b)) and
  `rejected` (the pre-pass rejected it: no use, counted only in health). Persisted head records are
  passed in `records`. `id` defaults to H(statement). Identical ids merge.
- reviews: CI-supplied review lines with their base actor (`null` when no base actor has the
  identity). `ref` is the answer reference printed in `answered.records` (A.16.28); default
  `review:` + 16 hex of H(`review`, the review object as the input gave it, when the entry carries
  one; else of {identity, line, change?}). With a base-declared relay, reviews act on nothing
  (A.16.4(c)); without one, approve lines answer and judge or reject lines are unrecorded (A.7.6.8).
- `inputDigest`, `rejected` and `clockClamped` are printed as given: only the pre-pass can compute
  them from the check input (A.16.3). Without `inputDigest` the kernel prints H(case with every
  array sorted and deduplicated), which is permutation-invariant but is not the input's digest.
- Cells are never supplied: the kernel computes them (A.8.1.4 [D23]); a `cells` field is ignored.
- `preview`: judgment records and reviews are dropped (A.12.7.2).

## Output

The complete core output of records §5: `contract, mode, inputDigest, verdict, errors, rejected,
obligations, answered, loosening, order, renames, debt, preexisting, budget, health`, each with
the fields and encodings of A.12.10 and A.16.24–A.16.31; obligations carry `key, kind, reason,
questions, introduced, severity, tier, budget, force, owner, assignee, group, claim, subject,
witness, facts, counterexample, exploited, final, binding, exception, dischargers, causes`
(`causes` as `{type, id}`; no `message`, causes text, `command` or `snippet`). Obligations are
sorted by (severity, kind, key), errors by (code, subject), the other lists by key or id;
`health` has the 28 keys of A.16.30. Errors are the head ESF's errors plus the kernel's own,
deduplicated by (code, subject); the kernel itself decides E-conduct, E-structure (A.16.25),
E-provider-missing (providers, claims, manifest), E-exception (A.4.6.7), E-unbound, E-ambiguous
and E-was, and ignores ESF errors with those codes (except E-exception for an exception absent from
the ESF); it adds E-overlap for units on one identity and for tied head component globs, next to
the elaborator's E-overlap errors.

`options.debug: true` adds a non-core `debug` list of binding preimages (`key, affected, code,
delta`) for differential triage.

## Lean API (namespace `Shape`)

- `parseInput : J → Except String Input`, `deriveAll : Input → J × Nat` (document, exit code).
- Context: `buildCtx`, `Ctx.withHeirs`; worlds `buildWorld`, `computeDelta`, `computeRho`,
  `provGov`, `policyStar`; eligibility `Ctx.roleUnder`, `Ctx.eligible`, `Ctx.twoPersons`.
- Decisions: `permitted`, `excluding`, `lvlT` (Eval); `Ctx.evalEffects`, `Ctx.evalStructure`,
  `Ctx.evalLower` (Facts); `Ctx.evalLaw`, `Ctx.providerMissing` (Laws); `Ctx.coverage`
  (Coverage); `Ctx.loosening`, `l3Decide`, `computeCells` (Loosen, Cells); `Ctx.pass`,
  `Ctx.severity`, `Ctx.dischargers`, `Ctx.answerItems` (Derive).

## Files

- `Kernel/Order, Closure, Struct, Eval`: canonical order, reachability, the structure fragment
  and P(u)/Lvl, with proofs.
- `Kernel/Json, Sha256, Util, Model, Parse`: JSON, JCS, SHA-256, globs, resource-code canon,
  channels, times; the data model; the case reader.
- `Kernel/Cells`: cells by product-automaton BFS.
- `Kernel/World`: bindings and attribution over M_h, Δcode, relocation, finest changes, ρ with the
  rule-3 hint, G*, policy*.
- `Kernel/Context, Heirs, Obligation`: W_obs, W_decl, Calls°, Refs°, lifted edges, heirs by ⊒,
  tier*, owner*, R*, keys, bindings.
- `Kernel/Facts, Laws, Coverage, Loosen, Derive`: contradictions, refutations, laws, coverage,
  L0–L7 with the reverse pass, and the output.
- `Main.lean` (`shapek`), `Fuzz.lean` (`l3fuzz`), `AxiomsCheck.lean`.
- `Pending/`: the version 6 proofs, outside the build (see `Pending/README.txt`).
- `test/gen_cases.py`, `test/run_tests.py`, `cases/`: 32 hand-built cases from vectors.py values;
  `test/bridge.ts`: prototype fixtures through the prototype pre-pass, byte comparison.

## Proofs

`lake env lean AxiomsCheck.lean` prints the axioms of the 65 built theorems: only propext,
Quot.sound and Classical.choice, no sorry, admit, native_decide or new axiom. Proved: ga_sound and
l3_ga_sound, prune_sound, antitonicity of path, edge and cycle forbids and their conjunction,
l3_edge_exact, stronger_sound, validCex_sound, evalStruct_correct, perm_exact (raw_fact_exact with
summaries), l1_false, l1_sound, l1_complete, l1_levels, and the order and closure lemmas. The
version 6 theorems over the old executable layer (T1, T2, T3, T9, stale_iff, guards) are in
`Pending/` until redone. dfs_complete stays open (A.8.4.3).

## Commands

```
export PATH=<lean-4.34.0>/bin:$PATH
cd experiments/shape-1/kernel && lake build                    # shapek, l3fuzz, library
lake env lean AxiomsCheck.lean
python3 -I test/gen_cases.py cases && python3 -I test/run_tests.py .lake/build/bin/shapek cases --perm 3
.lake/build/bin/l3fuzz 20000 7
bun experiments/shape-1/kernel/test/bridge.ts experiments/shape-1/kernel/.lake/build/bin/shapek
bun experiments/shape-1/m0/vectors/check.ts --impl kernel --shapek experiments/shape-1/kernel/.lake/build/bin/shapek
```

## Readings the kernel takes where the text leaves a choice (speculation, to confirm)

- L1 authority-tier parts fire only where the head still excludes the atom by authority at a lower
  tier, or the position moved to open authority or ungoverned; a granted atom is authority+ only
  (now settled as A.16.39).
- L6 counterexample: the least call or edge fact of the head at a dropped position whose kind is
  among the tuple's kinds (null otherwise); a new via tuple is a part of the base claim its head
  claim inherits from, and none when it has none (A.16.18).
- L3: the edge-forbid counterexample is the least violating G_A edge by (from, kind, to), W_eval
  edges first; a path or cycle counterexample is the search leaf's whole prefix path in path order,
  and the part is exploited iff every edge of that path is in W_eval(head), declared edges included
  (A.16.26(b), A.8.3.1); an undecided search adds the delta `L3 budget <units>`. Type-correct
  candidate edges exclude self-pairs for `calls` only (A.4.4.2).
- L1 counterexample `resource` is the column's key: a canonical resource code, `res:Q` for a
  resource without bound code, or `trust` (A.16.26(b)); an effect fact realises only the column of
  its own resource code.
- An unmapped base item without a rule-3 hint is read as removed (A.16.45(a)): its L1 `res:Q`
  column and its L3 parts are decided (loosened), not undecided; an undecided hinted L3 part is read
  under the hint except for its counterexample (A.16.45(c)). Hints are never listed in renames
  (A.16.38).
- The reverse pass resolves both shapes leniently over M_h ∪ M_b (as the prototype does).
- E-overlap for tied head component globs has subject "component A component B".
- An actor subject with no owned or judged item has tier low.
