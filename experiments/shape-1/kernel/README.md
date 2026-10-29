# Shape 1.0 Lean kernel: interface

## Executable `shapek`
`shapek [case.json]` reads a case from the file argument or from stdin, and prints the core output as JCS followed by a newline.

Exit codes:
- 0: `pass` or `owed`
- 1: `blocked`
- 2: `invalid` (unparsable input, or a float in the input)

Build it with `lake build`. Lean 4.34.0 must be on PATH. The project has no dependencies beyond Lean core: there is no Mathlib, and it does not `import Lean`.

## Case format `shape.kernel.case/v1`
This is the checker input of records §4, with the parts the kernel spec assigns to the pre-pass (A.11.2.1) already resolved.

```json
{"contract":"shape.kernel.case/v1","mode":"change"|"audit","now":"RFC3339"|int,
 "change":{"ids":["github:acme/audit#57"]},
 "authors":["audit::codeAgent","audit::alice"],
 "unmappedBot":false,
 "head":{"revision":"h1","esf":ESF,"manifest":MANIFEST},
 "base":{"revision":"b0","esf":ESF,"manifest":MANIFEST} | null,
 "cells":[["audit::AuditStore.*","audit::AuditStore.*"],["ungoverned","ungoverned"]],
 "records":[RECORD], "baseRecords":[RECORD],
 "reviews":[{"actor":"audit::bob","line":"shape approve bd:…","change":"…"}]}
```

Field notes:
- `authors` is authors*: base actor Qs, already closed under agent → operator.
- `cells` is optional. These are the (base, head) attribution pairs; the TypeScript prototype's `computeCells` produces them.
- `now` should already be now*.
- `reviews` are review lines without a relay (A.7.6.8):
  - `approve` lines become answers.
  - `judge` and `reject` lines become claim judgments that cite the head's Req, computed by the kernel.

**ESF.** This is `shape.elaborated.v1` exactly as the prototype's `elaborate` emits it.
- `shape` gives `{q, owner}`.
- Lists: `actors`, `effects` (`[{verb, implies}]`), `hatches` (`[{kind, lang}]`), `kinds` (`[{name, from, to}]`), `resources`, `components` (with `boundary`, `paths`, `allows`, and `assumes` as `[{id}]`), `units` (with `bind` a string or null), `providers`, `exceptions`.
- `claims` are `[{ids, op, args, fp?, owner, tier, requirement|null}]`. If `fp` is absent, it is computed as `H({"v":"shape.claim.v1", op, args})`.
- `policy` is `{tiers, budget}`. If omitted, `std::DefaultPolicy` applies.

**MANIFEST.** Either the in-toto statement with `predicate.shape`, or a bare object, with `{revision, entries:[{id, projection, scheme, digest, kind, parent, markers?, hatchComplete?, executable?}]}`.

**RECORD.** Either the in-toto statement with `predicate.shape` per records §3, or the bare shape block, plus `"authenticated": bool`. Signatures are verified in the pre-pass; a record is authenticated iff a signature verified. `id` is optional and defaults to H(statement).

## Output (core subset of records §5)
```json
{"contract":"shape.check.output/v1","mode","verdict",
 "errors":[{"code","subject"}],
 "obligations":[{"key","kind","reason","questions","introduced","severity","tier","budget","force","owner","group","claim":{"fp","ids","tier"}|null,"subject","witness","exploited","final","binding","exception"}],
 "answered":[{"obligation","as":"discharge"|"exception-answer"}],
 "debt":[{"obligation","exception","owner","expiresInDays"}]}
```

Obligations are sorted by (severity, kind, key). Every hash uses SHA-256 over JCS, computed in Lean.

Errors the kernel raises: E-conduct, E-structure, E-provider-missing and E-exception. Every other shape error belongs to the elaborator.

## Lean API (namespace `Shape`)
- `deriveObs : Input → List Ob`: the open obligations.
- `deriveJ` / `deriveText`: the core output document and its printed text.
- `parseInput : J → Except String Input`.
- Building blocks: `att`, `permitted`, `lvl`, `HoldsA`, `l1Loosened`, `evalStruct`, `holdsStruct`, `gaEdges`, `l3Decide`, `usab`, `fpMoved`, `lawSat`, `lawReason`, `sevOf`.

The theorems listed in the summary are about these exact functions.

## Files
- `Kernel/Model.lean`: data types and canonical inputs.
- `Order`, `Closure`: canonical sets and reachability, with proofs.
- `Struct`, `Eval`: the structure and authority fragments, with proofs.
- `Facts`, `Laws`, `Loosen`, `Coverage`, `Derive`: the executable checker.
- `Json`, `Sha256`, `Util`, `Parse`, `Main`: input and output.
- `Proofs/*`: T1, T2, T3, guards, stale, T7, T9, and the L1/L3 generator-versus-decision theorems.
- `Fuzz.lean`: the `l3fuzz` executable.
- `test/`: the case generator built from vectors.py values, the test runner, and the TS↔Lean bridge.

## Build status

- **Gate:** passed.
- **Tests:** 57 passed, 0 failed.

**Commands**

- `export PATH=/tmp/claude-0/-home-user-shapelang/83ff80bc-0161-572f-9e5a-9075cccad6d0/scratchpad/lean/lean-4.34.0-linux/bin:$PATH`
- `cd experiments/shape-1/kernel && lake build    # library + shapek + l3fuzz; clean build 19.2 s wall / 43.4 s CPU`
- `cd experiments/shape-1/kernel && lake env lean AxiomsCheck.lean    # #print axioms for all 149 theorems (non-module file)`
- `cd experiments/shape-1/kernel && .lake/build/bin/shapek cases/ex1_variant_b.json    # or: shapek < case.json ; exit 0 pass/owed, 1 blocked, 2 invalid`
- `cd experiments/shape-1/kernel && python3 -I test/gen_cases.py cases && python3 -I test/run_tests.py .lake/build/bin/shapek cases --perm 5    # 32/32, vectors.py values + permutation check`
- `cd experiments/shape-1/kernel && .lake/build/bin/l3fuzz 10000 7    # L3 decision vs brute force`
- `bun experiments/shape-1/kernel/test/bridge.ts experiments/shape-1/kernel/.lake/build/bin/shapek    # TS prototype vs Lean kernel on 24 prototype fixtures`
- `node_modules/.bin/oxlint --deny-warnings experiments/shape-1/kernel/    # bridge.ts lint (passes); tsgo typecheck reports no kernel errors`

**Open problems**

- dfs_complete is stated as the Prop `DfsComplete` but not proved: an `exhausted` L3 verdict rests on it. It is supported empirically: 20,000 fuzz instances, 0 disagreements, 14 exhausted verdicts.
- Not implemented in the kernel: L0 and L6; refutation of lower bounds (effects.lower, edge.exists); vocabulary coverage; relocation of facts at identities missing from M_h; cells (taken as input); exploitation through uncovered changed code (only realised counterexamples count); and health, teeth, dischargers, causes and budget allocation. Glob ties and E-overlap are left to the elaborator.
- Simplified: claim strength ⊒ for laws is equal fp only, with no schema order tables, no implies or equivalence records and no ρ-renamed fps; code ≡ is exact digest equality. A test or proof's cone is the cited code plus deps and their descendants, not closed under observed calls or same-provider proof records. tier*(c,x) for coverage is approximated by tier*(c). L1 atoms are keyed by resource Q, so a change in how a resource code binds is invisible to L1. Exceptions are read from the head shape only.
- T1 is proved for permutation and duplication of the top-level input collections. Order inside nested lists (for example a record's code list) is data; the parser does not normalise it.
- The JSON, SHA-256, JCS, glob and resource-code canon layer, and the parser that turns review lines into records, are tested, not proved. JCS key order uses UTF-16 code units; the SHA-256 implementation matched known digests.
- The prototype is still changing. The bridge (test/bridge.ts) should be rerun after each prototype change. It currently relies on the prototype for elaboration, signature checking, authors* and cells.

**Spec feedback from the build** (folded into the final spec; see [RFC.md](../RFC.md))

- Example 2, extra obligation from the Hatch clause: the `HatchesStayAtBoundaries` Hatch clause is effect.forbid(Hatch<std::Trust>, [*], []) (A.4.2.4; vectors.py has except [] for Hatch). Since every declared hatch kind h ⇒ Hatch (A.3.4.3) and a forbid excludes its whole down-set, that clause forbids every declared hatch everywhere, including kinds a boundary allows. In Example 2 the boundary's allowed external_body marker raises a preexisting, sound, owed contradiction (Hatch-clause fp dc8454f2… with subject {host send, external_body<std::Trust>}) that the example omits. The TypeScript prototype also derives 3 obligations, not 2. Possible fix: lift undeclared kinds to a distinct verb (Unknown ⇒ Hatch) and make the catch-all clause forbid Unknown<Trust>, or set the Hatch clause's except to the union of allowing boundaries.
- Summaries' call(L) channel adds coverage the examples omit: A.4.5.1 gives effects.upper/lower the channels call(L) and effect(t). So any changed unit that has an `effects` summary and no call(ts) observer raises coverage. In Example 3 Step 1, isoToday's summary raises a normal-tier owed coverage obligation, so the verdict is owed, not the pass that X§3 and acceptance test A.11.5 state. In Example 1 Variant A, the new summary raises a critical coverage obligation (blocking, on top of the E-conduct error and L1). H9 assumes only effect channels matter. Both the kernel and the prototype derive these obligations.
- A.4.4.12 'keys with one report no contradiction' needed an interpretation: an observed fact whose {code, atom} is also declared by a summary on that unit's identity is not raised again as a contradiction (Variant A). The wording should say so.
- In version 6 there is no obligation kind 'stale'; it is unestablished with reason stale. An exact iff with 'a fingerprint changed' needs two qualifications. First, the hypothesis that nothing else is wrong with the evidence, because A.5.4.3 checks stale last. Second, 'fingerprint' has to include the revision of revision-tied records (A.5.4.1). The proved `stale_iff` makes both explicit.
- T2 ('no record removes a final sound contradiction') holds for checker-decided claims. For laws, a policy change can remove one: a contradicting judgment's force depends on judge eligibility (policy judges) and on max_age. Head provider edits can also remove soundness when presence comes only from a head declaration (base ∨ head). The proved theorems are scoped to forbids and authority.
- 'Evidence never discharges a guard except reevaluation' has one exception: A.7.6.5 lets a person's answer discharge a producer-changed unestablished guard, and an answer is not a reevaluation. The proved statements say that non-judgment evidence never satisfies a guard, and that answers discharge only producer-changed unestablished obligations.
- A.7.6.7 has `answered.as` include exception-answer, while §7.5 says answered obligations 'move to answered'. An exception-answered obligation is debt and stays in `obligations`. The spec should state that it appears in both lists, as the prototype does.
- Whether `obligation.exception` names a matched exception that has not taken effect (an introduced obligation with no exception answer) is unspecified. The kernel is aligned with the prototype: the field is set only when the exception takes effect (debt).
- L1 authority+ parts: read literally, 'per base component K whose positions gained atoms in A' would also report gains in A that a forbid still blocks, even though L1's iff says nothing loosened. The kernel requires both an A-gain and a P-gain, which reproduces the Variant C delta exactly (HardDelete and Update, not Truncate).
- The L7 delta encoding `L7 <field> <JCS(base)> <JCS(head)>` (A.12.8.7) needs a fixed field list and value encoding per item kind to be byte-reproducible. The kernel copies the prototype's list (tier, requirement, owner, blocks, max_age, floor, judges, budget, allows, assumes, removed, trusts, produces, observes, decides, presence, absence, persist, depsComplete, identity, implementation, member, operator). The annex should fix this list.
- The kernel input (A.11.2.1: both ESFs, manifests, pre-pass records, review lines, authors*, now*) has no wire format in the spec, and A.12.9's ESF field list is loose. Both checkers need a shared normative format; shape.kernel.case/v1 above is a candidate.
- dfs_complete (A.8.4.3) is still open.
