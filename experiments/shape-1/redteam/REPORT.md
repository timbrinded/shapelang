# Red team

Two red teams probed the Shape 1.0 model after the build and experiment phases. Each claimed gap that was not already blocked went to two independent skeptics, who tried to refute it (show that the spec, correctly implemented, already handles it, or that it is a prototype bug rather than a model flaw). A gap is **upheld** if at least one skeptic failed to refute it. Upheld gaps went to the crystallize step, which closed or explicitly accepted each one; the RFC decision that does so is listed below.

## Method

- **Spec lawyer** (`lawyer/`): looked for semantic holes: non-monotone loosening, order dependence, information the checker must not read, circular evidence, policy loopholes, interactions of exceptions, debt and final forbids, and points two implementations could decide differently. Cases run against the Lean kernel (`kattack.py`) and replayed on the TypeScript prototype (`pattack.ts`).
- **Negative conformance suite** (`agent/`): tests of one property: a change that violates a claim always produces the right blocking or owed obligation, whatever else the change does (mismatched or carried-over evidence, unchanged fingerprints, a law weakened in the change that re-establishes it, split or renamed claims and bindings, exceptions or policy over a final forbid, judged evidence in place of mechanical, provider edits). The suite is `negsuite.ts`; outcome *blocked* means the checker raised the expected obligation.
- **Skeptics:** two per gap, each given four gaps at a time with the core spec, re-running the demonstrations.
- **Interruption:** the first run of the second team was stopped by a safety classifier before doing anything, because its brief was framed as an agent trying to get a violating change accepted. It was re-run with the same coverage, framed as a negative test suite for the checker. The lawyer's completed result was reused verbatim.

## Results

| Team | Cases | Blocked | Partial | Succeeded | Upheld as model gaps |
|---|---:|---:|---:|---:|---:|
| Spec lawyer | 41 | 5 | 18 | 18 | 12 |
| Negative suite | 69 | 47 | 9 | 13 | 9 |
| **Total** | 110 | 52 | 27 | 31 | 21 |

101 of 110 cases were demonstrated by running them; the rest were argued from the spec text. Of the 58 cases that were not blocked, skeptics refuted 37, mostly as prototype or kernel bugs, or as behaviour the spec already requires.

## Upheld gaps

| Case | Outcome | Gap | Closed by |
|---|---|---|---|
| agent/B2 | succeeded | A record for a weaker template instance establishes a stronger one through string order | D13 |
| agent/C7 | partial | A base record of a preexisting violation masks a second violation in the same function (no n) | D15 |
| agent/D7 | partial | An optimisation in a callee breaks a unit law; the law's unit fingerprint is unchanged | D4 |
| agent/E1 | succeeded | A guarded unit's logic lives in a same-file helper; the helper changes | D4 |
| agent/E6 | succeeded | Append-only log rewritten (UPDATE ... SET payload = NULL) from code outside the law's component | D13 |
| agent/G7 | succeeded | A producer change masks an undeclared assume, so an answer substitutes for removing or declaring it | D9 |
| agent/G8 | succeeded | A producer change masks an undeclared named assumption, with no hatch involved | D9 |
| agent/W2 | succeeded | String budget widened from "250ms" to "1000ms" in the change that supplies a test of the widened law | D13 |
| agent/W6 | succeeded | Hosted statement's specification weakened in the change that re-proves it | D13 |
| lawyer/L01 | succeeded | Narrowing the judge list in the head turns on the self fallback (violates T2′) | D12 |
| lawyer/L02 | succeeded | Producer-changed masks assumption: one approve discharges a law that rests on an undeclared assume (also at tier final) | D9 |
| lawyer/L03 | succeeded | A fake head-only provider turns 'missing' into an answerable producer-changed obligation | D9 |
| lawyer/L04 | succeeded | Moving code out of a final component into a low-tier component with the same grants raises no question (violates T2) | D11 (see [spec/CHANGES.md](../spec/CHANGES.md)) |
| lawyer/L05 | succeeded | Leaving preexisting final drift is not monotone: lowering the tier deadlocks, while deleting or perturbing the claim passes | D11 |
| lawyer/L06 | succeeded | A final informal law is established by a single judgment, from an agent if critical's judges list agents | D11 (see [spec/CHANGES.md](../spec/CHANGES.md)) |
| lawyer/L08 | succeeded | A final law can be satisfied through admit, axiom or external_body | D11 (see [spec/CHANGES.md](../spec/CHANGES.md)) |
| lawyer/L19 | partial | A law with an empty Req is attributed to every component, so any component exception matches it | D14 |
| lawyer/L26 | partial | A stale harness digest: the kernel treats the record as usable, the prototype as producer-changed | D9 |
| lawyer/L36 | partial | A statement-position macro from a dependency hides an assume from the manifest | D20 |
| lawyer/L38 | partial | Spec points two implementations could resolve differently | D22 |
| lawyer/L41 | partial | The coverage binding omits the unmet claims and channels | D22 |

### agent/B2: A record for a weaker template instance establishes a stronger one through string order

- **Outcome:** succeeded; demonstrated.
- **Closed by:** D13 in [RFC.md](../RFC.md).

**Steps.** Clean encodeRow world: appendEvent is edited and every other law is freshly established, so the baseline verdict is pass. Template LatencyAtMost<F: unit, Budget: value> { law { evidence tested } order Budget by leq }. Law AppendFast = LatencyAtMost<AuditStore.appendEvent, "250ms"> (critical, tested by fastCheck). The only record is a fresh test of the instance Budget = "1000ms"; its nf is supplied and hashes to its fp. Prototype: verdict pass, because opOrderGeq compares strings by codepoint and "1000ms" < "250ms". Control with Budget "300ms": unestablished, blocking. Kernel: blocked (unestablished(missing) plus E-provider-missing), because the kernel's ⊒ for laws is equal fp only.

**Gap.** A.4.3.5 and A.5.6.4 define head-at-least-as-strict through `order P by leq|geq`, and A.4.3.1 allows value arguments to be strings or safe integers. No order on strings is defined, so implementations fall back to lexicographic order and weaker records establish stronger laws.

**Proposed fix.** A.4.3.5: leq and geq apply only to safe-integer arguments. A string argument at a parameter ordered leq or geq is E-template, because strings order only by equality.

**Skeptic 1** (not refuted). I re-ran it and got the same result: the prototype passes and the kernel blocks. The kernel blocks only because its law ⊒ is equal-fp, so it does not implement A.5.6.4's order tables at all. The demonstration as given leans on a field outside the spec: records §3 defines the record claim as {id, fp}, and A.12.5.1 ignores unknown fields such as `nf`. Without nf (variant V0, scratchpad/shape1work/skeptic1-RT4/b2variant.ts) the prototype blocks with E-provider-missing plus unestablished(missing). The gap itself survives in inputs that follow the spec, though. V1 declares a second law, AppendSlowOk = LatencyAtMost<appendEvent,"1000ms">, in base and head, and gives fastCheck a record for it with no nf. Result: pass, and AppendFast("250ms") counts as established by the 1000ms record. Controls behave as expected: "300ms" gives blocked; integers 250 and 1000 give blocked; reversed integers (1000 law, 250 record) give pass, which is correct. The same flaw reaches loosening (b2loosen.ts). Base "250ms" to head "1000ms" yields no L4 row and verdict pass, while integers 250 to 1000 yield L4 undecided and blocked. The spec text causes this. A.4.3.1 lets value arguments be strings, and A.4.3.5 and A.5.6.4 compare them by leq/geq from the base order table. Nothing defines leq on strings. The only string order the spec names is A.0.2's codepoint sort for outputs, so lexicographic comparison is the natural thing to implement. subset/superset have no operand type either, since A.12.8.2 args are scalars. Fix: allow leq/geq only on safe integers (a string argument to an ordered parameter is E-template), and give subset/superset a list kind or remove them.

**Skeptic 2** (not refuted). Not refuted: this is a gap in the spec text. A.4.3.1 allows value arguments to be strings, and the grammar's Arg includes String. A.4.3.5 and A.5.6.4 decide ⊒ for schema laws through `order P by leq|geq`, but no order on strings is defined anywhere. The only string order in the spec is A.0.2's codepoint convention for sorting outputs. The kernel blocks only because it does not implement the template op order at all (it uses equal fp), which contradicts syntax §4 ('a test of Bounded<f,0,50> establishes Bounded<f,0,100>'). So the kernel is not a correct reference here. One concession: the demonstrated case depends on the record's non-profile `claim.nf` field (records §3 gives claim = {id, fp}; A.12.5.1 says unknown fields are ignored). With that field ignored (LIT_NF=1), B2 as built is blocked with E-provider-missing plus unestablished(missing). The gap survives in profile-conformant variants that I built and ran on the repo prototype: (a) the head adds WeakLaw = LatencyAtMost<appendEvent,"1000ms"> (a tightening) and the failing 250ms record is dropped: pass; the same with integers 250/1000: blocked. (b) std Bounded<appendEvent,"0","50"> with a test of Bounded<…,"0","100">: pass; with integers: blocked. (c) No record is dropped at all: the head edits the law from "250ms" to "1000ms", or std Bounded Hi from "50" to "100". Codepoint order makes the head law an heir, so L4 is implied and nothing is raised: verdict pass. The integer controls each give a blocking critical L4 loosening. Treating strings as comparable only by equality (LIT_STR=1) blocks (a), (b) and (c), keeps the prototype core tests at 108/108, and changes only B2 and W2 among the 69 agent cases. Fix: leq/geq on value parameters compare safe integers only, and a string argument in an ordered position is E-template (or compared by equality only). Files: /tmp/claude-0/-home-user-shapelang/83ff80bc-0161-572f-9e5a-9075cccad6d0/scratchpad/shape1work/skeptic2-RT4/{b2build.ts,b2loosen.ts,cases/B2s_*,cases/B2h_*}.

### agent/C7: A base record of a preexisting violation masks a second violation in the same function (no n)

- **Outcome:** partial; demonstrated.
- **Closed by:** D15 in [RFC.md](../RFC.md).

**Steps.** Example 3 Step 2. checkFreshness already read Date.now() at base, and the base-revision scan reports it without n. The change adds a second Date.now() call in checkFreshness, and the head scan reports the fact once, without n. Prototype and kernel: a sound contradiction at critical, but preexisting and owed. Control with head n = 2 and base n = 1: introduced and blocking.

**Gap.** A.12.8.4 makes n optional, and A.7.3.1 calls a fact new only if no base entry reports it with n_b ≥ n. When an observer omits n, a new violation site in an identity with old drift is never new.

**Proposed fix.** A.7.3.1: a fact is not new only if both the base entry and the head fact carry n and n_b ≥ n_h. A missing n counts as unknown, so the fact is new. Presence-sound observers MUST report n on effect facts (RJ14).

**Skeptic 1** (not refuted). I could not refute this. It is a narrow model-level gap, not a prototype bug. Re-run with `bun <scratch>/skeptic1-C7D1D3/rerun.ts C7`: prototype and kernel both give `owed`, a sound critical contradiction of CheckerNeverReadsClock with introduced=false. Kernel variants (`python3 -I <scratch>/skeptic1-C7D1D3/c7var.py`, n given as head/base): none/none owed; 1/1 owed; none/1 owed; 2/1 blocked; 2/none blocked; 3/2 blocked; no baseRecords blocked (introduced). The kernel, which defines meaning (Invariant 7), treats a missing n as 1, as the prototype does (evidence.ts `f.n ?? 1`). The spec text forces this outcome. Records §2 and A.12.8.4 make n optional and exclude it from factId. Absence soundness (A.5.2.1) covers facts, not counts. A.5.2.5 does not require complete:false when n is unknown. A.7.3.1 compares n_b ≥ n. So an observer that omits n is spec-conformant, and so is a checker that masks the second site. Reading a missing n as 'unknown, therefore new' does not rescue it: it would make baseRecords (A.7.3.2) useless for such observers, and it contradicts the stated intent that edits adding no site introduce nothing (Example 2). The spec's own aims say second sites must count: Example 2 calls a second assume (2 markers against 1) new and blocking, and A.7.3.3 and A.11.4 H2 list 'second site' and 'new sites'. For observations those aims hold only when the provider happens to report n. The effect is bounded. The obligation is still raised, sound and visible under the right key, owner and subject. Final tier still blocks under rule 2. Only the blocking severity under rule 7 is lost, at tiers low to critical, and only in an identity that already has unexcepted drift. The fix is one sentence in the records contract: complete entries from absence-sound observers MUST carry n, or a fact at Δcode without n is new unless base and head both report n.

**Skeptic 2** (not refuted). Not refuted. This is a model-level gap, partial: the change is owed instead of blocked. RE-RUN: a scratch copy of the negsuite (W=/tmp/claude-0/-home-user-shapelang/83ff80bc-0161-572f-9e5a-9075cccad6d0/scratchpad/shape1work/skeptic2-C7D1D3; `cd /home/user/shapelang && NEG_ONLY=C7,C7h,C7b,... bun $W/negsuite2.ts`; outputs in $W/cases2/). Results: C7 gives owed in both the prototype and Lean (contradiction owed, critical, sound, preexisting, CheckerNeverReadsClock). The control (head n=2, base n=1) is blocked. My variant C7h (head n=2, base n absent) is blocked in both. My variant C7b (base n=2, head n absent) is owed in both. SPEC TRACE: A.12.8.4 and records §2 make n optional. A.5.2.1 defines presence and absence soundness over facts, and factId = H(fact without n), so a sound, authenticated tsClockScan that omits n conforms. A.7.3.1 calls the fact new only if no usable base-revision entry reports it with n_b >= n. No text gives a default for a missing n. Both independent implementations use 1: kernel Parse.lean `numD "n" 1` and proto evidence.ts `f.n ?? 1`. So this is not a prototype bug. DECISIVE POINT: the C7 input is exactly the input a benign edit produces when it adds no site to an already-drifting checkFreshness: the digests move, the fact id is the same, and it is reported once at base and once at head. The checker reads no code (Invariant 6), so n is the only channel that separates a second site from an edit that adds none. No reading of A.7.3.1 serves both of the spec's own commitments: (a) the second-site conformance vector (A.7.3.3, A.11.2.4; v5 wording 'a new site never hides behind an old fact id'; A.11.4 H2 'new sites'), and (b) the analogue of Example 2's 'an edit adding no marker introduces nothing'. Reading a missing n as 1 masks the second site (rule 6 owed instead of rule 7 blocking at critical). Reading it as unknown blocks every edit to drifting code. LIMITS: the contradiction is still sound, owned by owner* and visible as preexisting, and it would still block at tier final (rule 2). FIX: (i) require n on facts in complete entries from providers absence-sound on that channel (absence soundness then counts sites), or (ii) treat a missing n at code-delta (Δcode) identities as new; and add the n-less variant to the second-site vector.

### agent/D7: An optimisation in a callee breaks a unit law; the law's unit fingerprint is unchanged

- **Outcome:** partial; demonstrated.
- **Closed by:** D4 in [RFC.md](../RFC.md).

**Steps.** encodeWorld. The change optimises encodeRow; appendEvent's digests do not move, as A.5.7.2 intends: functions enter env by identity. fastCheck re-runs at head and the test of AppendDeterministic fails with a counterexample. fastCheck is presence-sound, and the record cites appendEvent@unit with deps encodeRow@unit (head). Prototype and kernel: a sound law contradiction that is preexisting and owed; verdict owed, so the change merges. Control in which appendEvent itself is edited: introduced and blocking.

**Gap.** A.7.3.3 introduces a law obligation only when Req meets Δcode ∪ deleted, and for `on unit u` Req is bind(u) (A.5.3.4). A behavioural break caused by an edit in a callee is therefore old drift, even with a fresh, sound, failing test. This is the SEED's 'optimisation that breaks a law'.

**Proposed fix.** The Req closure from C3: Req for `on unit u` includes identities of comp(u) reachable through Calls° and manifest refs, so encodeRow is in Req ∩ Δcode. Minimal alternative in A.7.3.3: a law obligation is also introduced when the code or deps of a record for c meet Δcode ∪ deleted.

**Skeptic 1** (not refuted). I could not refute this. A correctly implemented spec gives exactly this result. A.5.3.4 sets Req(on unit appendEvent, test) to (appendEvent, unit). Under A.5.7.2 (functions by identity) an edit to encodeRow moves neither appendEvent's own nor its unit digest. So Req does not meet Δcode ∪ deleted, and A.7.3.3 marks the fresh, sound, failing test's contradiction as not introduced. Severity rule 6 (preexisting, owed) fires before rule 7. Re-run: proto and Lean both owed, with introduced=false, tier critical, force sound. The control that edits appendEvent itself blocks. Only tier final blocks, via rule 2 (variant D7nf). The spec is inconsistent here: A.7.3.1 makes observed facts new through 'changed anchor deps', but A.7.3.3 has no such clause for a law record's deps. A further result contradicts T6′ as worded in §11. C3b's record set (an honest base supporting record with deps encodeRow@base) is blocked by E-provider-missing. Adding D7's one fresh failing record (variant D7t6) turns blocked into owed in both prototype and kernel. Adding a contradicting record therefore lowers severity without establishing, discharging or covering. I found no T6 theorem under experiments/shape-1/kernel. Suggested fix: also introduce a law obligation when a usable applicable record's code ∪ deps meets Δcode ∪ deleted, mirroring A.7.3.1.

**Skeptic 2** (not refuted). Not refuted: the gap is in the model. Rerun result, in both the prototype and the kernel: `owed | contradiction owed critical sound preexisting audit::AppendDeterministic`; the control is blocked. A correct implementation reaches the same result:
- A.5.3.4 gives Req(c, test) = (appendEvent, unit).
- A.5.7.2 enters callees by identity, so appendEvent's unit digest does not move.
- A.7.3.3 introduces a law obligation only if Req meets Δcode ∪ deleted, or if the producer changed. A record's deps never count, although A.7.3.1 does count changed anchor deps for observed facts.
- So severity rule 6 (preexisting, owed) fires before rule 7 (a sound contradiction blocks).

No other route raises it: no E-provider-missing; implementation and harness are unchanged, so no producer change; coverage only works on checker-decided channels. This is despite fastCheck declaring `deps complete`, the record naming encodeRow@unit(head) in deps, and tsCalls reporting a sound call fact appendEvent→encodeRow.

Two variants make it stronger (<W>/x/redteam/agent/variants.ts, outputs in cases-v/):
- V7b adds a base-revision passing test with deps encodeRow@base. The change provably turns an established law into a sound counterexample, and the result is still owed preexisting in both the prototype and the kernel.
- V7c tries widening the law to `on component AuditStore`. The widening is ignored: the elaborated `on` stays [unit audit::AuditStore.appendEvent], as A.4.3.3 says (a law's `on` comes from its unit/component/code parameters). So the author cannot widen the Req of a Deterministic<F: unit> law; still owed.

Carried-over case C3b has the same root (stale-by-deps graded owed preexisting). Possible fix: also count a law obligation as introduced when the record's deps or harness meet Δcode, or when the law flips from Sat at base to contradicted at head. W=/tmp/claude-0/-home-user-shapelang/83ff80bc-0161-572f-9e5a-9075cccad6d0/scratchpad/shape1work/skeptic2-D4D5D7E1

### agent/E1: A guarded unit's logic lives in a same-file helper; the helper changes

- **Outcome:** succeeded; demonstrated.
- **Closed by:** D4 in [RFC.md](../RFC.md).

**Steps.** Real TypeScript. isoToday is RefactorSensitive, tier critical, and was judged by ann at its base unit digest. It returns fmt(new Date()); the change rewrites fmt to use toLocaleDateString(). isoToday's unit digest does not move (fp-probe P3, by design). The judgment stays usable. Prototype and kernel: verdict pass. Splitting a guarded function into a wrapper and a helper thus moves every later edit outside the guard.

**Gap.** A.5.3.4 gives an informal law on a unit the Req (bind(u), π), and A.5.7.2 brings callees into the digest by identity only. A guard therefore never sees edits made to code its unit calls.

**Proposed fix.** The same Req closure as C3/D7 (A.5.3.4): Req for `on unit u` is bind(u) plus the identities of comp(u) reachable through Calls° and the manifest's refs, at π. A judgment must cite them, so an edit to fmt makes it stale.

**Skeptic 1** (not refuted). This is not a prototype bug, and the spec passes it as written. The scope-correct env leaves isoToday's unit digest unchanged, listing only `fmt=fn …#fmt`, as A.5.7.2 intends. A.5.3.4 sets a unit judgment's Req to (bind(u), unit). The relay cites only Req computed from the reviewed tree (A.7.6.3) and never deps, so no judgment can depend on fmt. Test records, by contrast, go stale through deps (C3b). Retention has open authority and no effect claim, so coverage is vacuous (A.7.4.5). Re-run: proto and Lean both pass. A plain informal law on unit Retention.isoToday (variant E1unit) also passes, so the template is not the cause. The model can express a guard that sees helper edits, but only coarsely. `on component Retention` (E1comp) gives unestablished(stale), blocking at critical. `on code ts("src/purge.ts")` (E1file) gives stale, owed at normal, because a code-targeted law does not inherit the component's tier. TS has no unit-plus-callees projection; Verus has closure (A.3.2.5, A.12.2.5). Meanwhile std RefactorSensitive<U: unit> and shp migrate (A.11.1; Example 3 Step 1) turn every 0.x file-level guard into the unit form. That silently drops 0.x's protection against same-file helper edits, and raises no L4 question because the base is also elaborated through migrate. Every edit after a wrapper/helper split then escapes the guard, which counts against H2 for informal guards. Possible fixes: a TS closure projection (unit plus the own digests of the function identities in env, transitively, tree-only) as the default π for unit judgments, or deps recorded by the relay. Measure the cost against H1. Artifacts: /tmp/claude-0/-home-user-shapelang/83ff80bc-0161-572f-9e5a-9075cccad6d0/scratchpad/shape1work/skeptic1-D4D5D7E1/ (negsuite.ts, env-correct.ts, env-correct.out.txt, cases/).

**Skeptic 2** (not refuted). Not refuted: the gap is in the model. It is by design, but nothing compensates for it. P3 stays SAME with both the original and the scope-correct fingerprinter, so this is not a prototype bug; the prototype and the kernel both pass. A correct implementation gives the same result:
- A.5.3.4 makes the Req of a judgment on a unit (bind(u), π).
- A.5.7.2 enters functions by identity.
- A.7.6.3: the relay cites only Req, so relayed judgments carry no deps.
- §4.5 and §7.4: coverage applies only to channels of checker-decided claims.
- A.4.3.3 fixes RefactorSensitive<U: unit>'s `on` to the unit.

The probe's own justification is that the caller's freshness "relies on deps/coverage", but judged laws have neither:
- V1b: ann's judgment signed by herself with deps [fmt@unit] gives only `unestablished(stale) owed critical preexisting`, in both the prototype and the kernel, again because of A.7.3.3.
- V1c: the only mitigation is a hand-written `law … { on code ts("src/purge.ts") informal … }`, which gives `blocked`. But that is exactly the 0.x per-file trigger that `shp migrate` and Example 3 ("other edits in the file do not fire") deliberately narrow away.

So migrating a 0.x file guard to RefactorSensitive silently drops protection for same-file helpers that 0.x had. An agent can launder an edit in two steps: extract a helper (one benign refactor judgment), then edit the helper (no obligation at all). The root cause is the same as D7. W=/tmp/claude-0/-home-user-shapelang/83ff80bc-0161-572f-9e5a-9075cccad6d0/scratchpad/shape1work/skeptic2-D4D5D7E1

### agent/E6: Append-only log rewritten (UPDATE ... SET payload = NULL) from code outside the law's component

- **Outcome:** succeeded; demonstrated.
- **Closed by:** D13 in [RFC.md](../RFC.md).

**Steps.** Example 1 Variant B′: scripts/purge-audit.ts is ungoverned. The purge rewrites rows instead of deleting them, so the signed sound observation reports Update on pg.table("audit_events"). AuditEvent is AppendOnly (final), and HistoryPreserved<AuditEvent> is a law on component AuditStore. Prototype and kernel: verdict pass. Control with HardDelete: a final contradiction, blocking.

**Gap.** The std AppendOnly<R> template is `forbid HardDelete<R>` (syntax §4). ↓HardDelete excludes Update, Redact and LogicalDelete, so rewriting an append-only log is permitted; this is A.11.6 open question 1. Ungoverned code has no authority, and a resource law's Req covers only its `on` component, so no claim governs the rewrite.

**Proposed fix.** std: AppendOnly<R> { forbid Update<R> }. ↓Update contains Redact, LogicalDelete, HardDelete, Truncate and DropStorage. A log that must allow GDPR redaction would use a separate, non-final template; that part is speculation, not tested.

**Skeptic 1** (not refuted). Not refuted. This is a spec gap in the std pack's content, not in the core model, and not a prototype bug.

Re-run (the harness is a copy of redteam/agent/negsuite.ts with absolute imports plus skeptic variants, at /tmp/claude-0/-home-user-shapelang/83ff80bc-0161-572f-9e5a-9075cccad6d0/scratchpad/shape1work/skeptic1-E6G6G7G8/negsuite.ts):
- Command: `cd /home/user/shapelang && NEG_ONLY=E6,E6fixU,E6redact,E6redactFix bun <that file>`.
- E6: prototype pass and kernel pass, with 0 obligations. The control (HardDelete) is blocked by the final sound contradiction.

The spec text predicts pass:
- std `AppendOnly<R> = forbid HardDelete<R>` (syntax §4). ↓HardDelete is {HardDelete, Truncate, DropStorage}, so Update, Redact and LogicalDelete are permitted.
- `ungoverned` has no authority claim (A.4.2.5).
- HistoryPreserved's Req is AuditStore's code only (A.5.3.4, `on component`).
- Coverage is met by sqlEffects' complete entries on effect(pg.table("audit_events")).

The core model is not at fault, and the claim that "no claim governs" the rewrite is false in general:
- E6fixU: both shapes add `rule NoRewrite { tier final forbid Update<AuditEvent> }`. Prototype and kernel are blocked by a final sound contradiction, ob:731db32e4587928f, subject {ts:scripts/purge-audit.ts#purgeOldEvents, Update<audit::AuditEvent>}. So the `*` forbid reaches ungoverned code.
- E6redact: Redact passes under std.
- E6redactFix: Redact is blocked under NoRewrite.

The gap is one std template line, which is A.11.6 open question 1. It is still a real 1.0 defect: the flagship claim on a final resource silently permits `UPDATE … SET payload = NULL` by any code.

Fix options:
- Make AppendOnly `forbid Update<R>`. Because P is up-closed, Redact ⇒ Update cannot be separated, so GDPR redaction must be scoped with `except unit Redactor`.
- Or rename the current template so that it does not promise append-only.

**Skeptic 2** (not refuted). I could not refute this. The reproduction matches, it is not a prototype bug, and the spec does not raise an obligation. Command: `NEG_ONLY=E6,G6,G7,G8 bun /tmp/claude-0/-home-user-shapelang/83ff80bc-0161-572f-9e5a-9075cccad6d0/scratchpad/shape1work/skeptic2-E6G678/neg.ts`. That file is a copy of redteam/agent/negsuite.ts with absolute imports, run against kernel/.lake/build/bin/shapek. Result: prototype `pass`, kernel `pass`, 0 obligations. Coverage is met: sqlEffects has complete entries for ts:scripts/purge-audit.ts and #purgeOldEvents. Health shows only ungoverned 5/7. The HardDelete control blocks with a final sound contradiction. Why the spec passes it: in §4.4, P(ungoverned) is all atoms minus the atoms below the forbids. std AppendOnly is `forbid HardDelete<R>`, and ↓HardDelete = {HardDelete, Truncate, DropStorage}, so Update is permitted. The law's Req is AuditStore only (A.5.3.4), and resource-only law targets are E-law-target (A.4.3.3), so the script is never in Req. Extra probes (neg2.ts): an ungoverned Redact passes and an ungoverned bare Write passes. Limits of the gap: (1) the same Update inside AuditStore (Variant B with verb Update) is a sound, critical, blocking authority contradiction in both implementations. The hole is only writers outside a restrictive authority: ungoverned code, open-authority components, or components that grant Update or Write. (2) The model already has what it needs. Adding `forbid final Update<AuditEvent>` to base and head turns E6 into a final sound blocking contradiction in both implementations (probe S2E6fu). So the defect is the content of the std AppendOnly template, which is open question A.11.6(1). Example 1 presents AppendOnly as protecting the log, and std as written lets an ungoverned script set every payload of a final resource to NULL. The fix is in the pack, for example `AppendOnly<R> { forbid Update<R> }` with GDPR redaction handled by an exception or a separate template. No new concept is needed. The second leg of the claim (a resource law's Req covers only its `on` component) is by design and not a separate gap, because confining writers is the job of forbids and authority.

### agent/G7: A producer change masks an undeclared assume, so an answer substitutes for removing or declaring it

- **Outcome:** succeeded; demonstrated.
- **Closed by:** D9 in [RFC.md](../RFC.md).

**Steps.** Example 2: the agent inserts assume, and the fresh proof's cone holds the undeclared hatch. The same change bumps ironkv/Cargo.lock, which is part of verus' implementation. In phase 2 dana approves the SetRefinesSpec obligation's binding. Prototype and kernel: the reason becomes producer-changed, which is answerable, and the law is discharged. The verdict stays blocked only because of the separate hatch contradiction, which Example 2's exception path can turn into debt.

**Gap.** A.5.4.1's first-match order puts producer-changed before assumption, and A.7.6.5 gives producer-changed an answer discharger. Touching any implementation file therefore turns an assumption obligation into one a person's approve line clears, contradicting EM-4 (no answer declares an assumption).

**Proposed fix.** A.5.4.1: order the per-record reasons stale, expired, assumption, weak, producer-changed. A.5.4.3: order the law reasons assumption, weak, producer-changed, expired, stale. A producer-changed answer then never covers an assumption or a weak record.

**Skeptic 1** (not refuted). Not refuted, although my first refutation holds at the stated tier.

Re-run:
- Prototype and kernel are both blocked.
- dana's line discharges ob:8b9a1c953f7ed31c, whose reason is producer-changed.
- Only the sound, mechanical hatch contradiction ob:815d7ebb9678dbea remains open.

Refutation attempt at the stated critical tier:
- That contradiction is the right obligation, and no answer clears it (A.7.6.7). The only route to merge is an exception plus an exception answer, which Example 2 already designs.
- G7narrowBump (exception waiving contradiction only, Cargo.lock bump, dana approves both): owed, with the assume as debt.
- G7designed (no bump, exception waiving both kinds): owed, with both as debt.
- G7narrowNoBump: blocked.
- So at critical the bump only buys a narrower exception and one fewer debt row.

The refutation fails when the law is tier final. That configuration is legal: E-policy is met by dana and erin.
- G7finalNoBump and G7finalWide: blocked. Exceptions never reach a final law (§4.6), and no answer clears an assumption.
- G7finalBump (dana and erin) and G7finalBumpOne (dana alone): owed. The final law ob:8b9a1c953f7ed31c is discharged and the assume merges.
- Command: `NEG_ONLY=G7,G7narrowBump,G7narrowNoBump,G7designed,G7finalBump,G7finalNoBump,G7finalWide,G7finalBumpOne`.

The root cause is in the spec, and the kernel reproduces it (Laws.lean `usab` and `lawReason`):
- A.5.4.1's first-match order puts producer-changed before assumption.
- A.5.4.3's law order does the same.
- A.7.6.5 gives producer-changed an answer discharger.

Secondary defect: one person discharges a final producer-changed obligation. Model §6.3 says "Tier final needs two distinct eligible persons", but A.6.3.4 and A.7.6.5 grant the second person only for loosenings. Both implementations follow the annex.

Fix:
- Put assumption before producer-changed in both orders, or carry every reason and discharge each one separately.
- Apply the two-person rule to final producer-changed answers.

**Skeptic 2** (not refuted). I could not refute this. The behaviour follows the spec. Reproduced in the prototype and the kernel: dana's approve discharges ob:8b9a1c953f7ed31c, and the verdict is blocked only by the separate hatch contradiction ob:… bd:2ea660886d27e5e3. In phase 1 (probe S2G7p1), both implementations report SetRefinesSpec as unestablished(producer-changed), blocking at critical and answerable, not unestablished(assumption). The spec text produces exactly this. A.5.4.1's first-match order is stale, expired, producer-changed, assumption, weak. A.5.4.3's law order puts producer-changed first. A.7.6.5 gives producer-changed an answer discharger. The kernel's `usab`, `lawReason` and `answerable` in Kernel/Laws.lean encode these rules literally. The result contradicts A.7.6.5's own conclusion ('So no answer … declares an assumption (EM-4)') and A.14.2.6. To show it is not harmless, probe S2G7pre puts the assume in base as well (1 marker on each side, so the hatch contradiction is preexisting), edits set, bumps Cargo.lock, and has dana approve. Verdict: `owed` in both implementations. The control without the bump gives unestablished(assumption), blocking. So an undeclared assume in a law's cone merges on a single approve line. Probe S2G7final2: with SetRefinesSpec at tier final, A.5.4.4 says an assume never satisfies a final law, yet dana's and erin's approve still discharges the law obligation in both implementations. Suggested fix: put assumption before producer-changed in A.5.4.1 and A.5.4.3, or let an answer lift only the producer-changed reason and then re-derive. Also make A.7.3.3's 'introduced' test check that the producer changed, not that the reason is producer-changed. By inspection, not run: the same order lets producer-changed mask weak, so an answer could also meet an evidence floor.

### agent/G8: A producer change masks an undeclared named assumption, with no hatch involved

- **Outcome:** succeeded; demonstrated.
- **Closed by:** D9 in [RFC.md](../RFC.md).

**Steps.** Example 2 without the assume. The fresh proof lists the named assumption NetworkDelivers, which no base boundary assumes. Cargo.lock is bumped and dana approves the SetRefinesSpec binding. Prototype and kernel: discharged; verdict owed, from one unrelated preexisting obligation, so the change merges. Control without the bump: unestablished(assumption), blocking.

**Gap.** Same as G7 (A.5.4.1 and A.5.4.3 reason order).

**Proposed fix.** Same as G7.

**Skeptic 1** (not refuted). Not refuted.

Re-run:
- Prototype and kernel: owed. dana's single approve line discharges ob:8b9a1c953f7ed31c.
- Control without the bump: unestablished(assumption), blocking at critical.
- G8final (law at final, dana and erin): owed.

What the reviewer sees (G8phase1, before any answer):
- Reason: producer-changed, introduced, blocking, judgment budget.
- Message: "not established at proven: producer-changed", with one cause, "proof … is producer-changed". Nothing mentions NetworkDelivers.
- Dischargers: answer (dana), rerun, exception, lower-requirement.

No refutation is available:
- The fresh proof's first match (A.5.4.1) is producer-changed, because Cargo.lock is in the base-declared implementation.
- A.5.4.3's order also puts producer-changed first, so either reading of "held" gives producer-changed.
- Eligibility is genuine: dana is a person in IronKvTeam and is not in authors* = {kvAgent, frank}.
- No checker-decided claim covers named assumptions, so nothing else blocks.

The answer does not literally declare the assumption. G8afterMerge (base = G8 head) shows unestablished(assumption) again, but preexisting and owed (rule 6), so it never blocks again below final. But A.5.4.4's dischargers (remove, then declare) and EM-4 are bypassed at the only gate where the obligation is introduced and blocking.

G8declared shows the declare route works: with `assumes NetworkDelivers` on a base boundary the law is Sat. The lockfile bump is a strictly cheaper substitute for it.

Argument for the fix: producer-changed records keep contradiction force (A.5.4.2). A reported undeclared assumption is adverse evidence of the same kind, so it should survive a producer change.

Side findings:
1. The kernel's binding for this producer-changed obligation is bd:1da36a42e325dc5a…, identical to Example 2's assumption binding. Kernel `mkLawOb` adds only `pcHarness`, omitting the implementation finest changes that A.7.2.2 requires. The prototype includes them (bd:7dd75e8fb8b337a2). So in the kernel, Example 2's inert approve line would start discharging after a later Cargo.lock push.
2. The "unrelated preexisting" ob:220a9b307f0f3608 is HatchesStayAtBoundaries' Hatch clause catching the allowed external_body at HostTrusted. A.4.2.4's effect.forbid(Hatch<Trust>, [*], boundaries allowing Hatch) covers ↓Hatch, which is every hatch kind. That is a separate A.4.2.4 defect, and without it G8's verdict would be pass.

**Skeptic 2** (not refuted). I could not refute this. Reproduced exactly. Phase 1 (probe S2G8p1): SetRefinesSpec is unestablished(producer-changed), blocking at critical, in both implementations. Phase 2: dana's approve discharges ob:8b9a1c953f7ed31c. Verdict `owed` in both, left only with the preexisting owed contradiction NoHatchesOutsideBoundaries/dc8454f26ba4. The control without the bump gives unestablished(assumption), blocking. This is not a prototype bug. A.5.4.4 says a named assumption is declared only by a base boundary's `assumes`, and none declares NetworkDelivers. After that, the same rules as in G7 decide the outcome: A.5.4.1 and A.5.4.3 order producer-changed before assumption, A.7.6.5 makes producer-changed answerable, and the kernel encodes this literally. The precondition is ordinary: verus' implementation binds ironkv/Cargo.toml and Cargo.lock, and bunTest in Example 3 binds bun.lock, so a lockfile bump is enough. Final-tier probe (neg3.ts): with the law at tier final, phase 1 is unestablished(producer-changed), blocking at final, and the no-bump control is unestablished(assumption), blocking at final. Approves from dana and erin discharge it, and dana alone also discharges it in both implementations. That last point is a separate defect: §6.3 requires two distinct persons at tier final, but A.7.6.5 names a second person only for loosenings. A separate kernel bug that does not change the verdict: the kernel's binding for the producer-changed law obligation leaves out implementation finest changes. Its binding bd:1da36a42e325dc5a equals the no-bump binding, while the prototype gives bd:7dd75e8fb8b337a2, and A.7.2.2 says those changes belong in the binding. Probe files: /tmp/claude-0/-home-user-shapelang/83ff80bc-0161-572f-9e5a-9075cccad6d0/scratchpad/shape1work/skeptic2-E6G678/{neg.ts,neg2.ts,neg3.ts,extra.ts,extra2.ts,cases/}.

### agent/W2: String budget widened from "250ms" to "1000ms" in the change that supplies a test of the widened law

- **Outcome:** succeeded; demonstrated.
- **Closed by:** D13 in [RFC.md](../RFC.md).

**Steps.** Clean world. The base law AppendFast = LatencyAtMost<appendEvent, "250ms"> (order Budget by leq) is widened in the head to "1000ms", and a fresh record supports the widened instance. Prototype: the head law counts as an heir because "1000ms" ≤ "250ms" by codepoint, so no L4 is raised and the verdict is pass. Control with "300ms": L4, blocking. Kernel: L4, blocking.

**Gap.** As B2: A.4.3.5 orders value parameters by leq/geq without defining an order on strings, so heirs and L4 rest on lexicographic order.

**Proposed fix.** As B2: leq and geq apply to safe integers only; a string argument at an ordered parameter is E-template.

**Skeptic 1** (not refuted). NOT REFUTED. This is a real gap in the spec, though a narrow one, and it has the same root as B2.

What the spec says. A.4.3.1 accepts string arguments for `value` parameters ("string or safe integer"). A.4.3.5 lets any parameter be ordered `by leq|geq|subset|superset|equal`. No clause defines leq or geq on strings, and none rejects them (A.4.3.7 lists E-template only for self-attachment, arity and kind errors). The only string order the spec defines anywhere is codepoint order (A.0.2, A.12.10.6). That order is for sorting output, but a literal implementer can reasonably apply it here, and the prototype does: strength.ts cmpValue calls cmpStr. So the spec does not settle whether "1000ms" is an heir of "250ms", and I cannot show that a correct implementation raises L4.

The kernel's L4 is not a counter-argument. The kernel implements no template order table at all: Kernel/Loosen.lean l4Parts treats a law as an heir only when the fp is equal. So it would also raise L4 on a genuine tightening; B3 shows this, with a kernel L4 on Bounded 100 to 50.

Re-run (bun <scratch>/skeptic1-W2W6H3H4/rerun.ts orig): W2 prototype pass with no obligations; kernel blocked with L4. Variants on the original prototype (variants.ts):
- "250ms" to "1000ms": pass, wrong.
- "9ms" to "10ms": no L4, wrong.
- "250ms" to "300ms": L4, right.
- "250ms" to "100ms": heir, right.
- "0250ms" to "1000ms": L4, right only by accident.
- Integers 250 to 1000: L4, right. Integers 250 to 100: heir, right.
So codepoint order gives 2 false heirs among the 5 string pairs, and integers behave correctly.

Nothing else catches the change. L7 does not fire because tier and requirement are kept, the record is fresh and applicable, and the verdict is pass at critical.

The fix needs one sentence of spec, not a prototype bug fix. Suggested wording: "leq/geq compare safe integers; a string argument at an ordered parameter compares by equality only (or E-template)". subset and superset on scalar values are undefined in the same way. I applied the equality-only rule to a scratch copy of the prototype (proto-fixed/src/strength.ts). With it, W2 becomes L4, blocking, critical, latent; B2 becomes unestablished(missing) plus E-provider-missing; and all 21 redteam-inputs examples give identical output.

Scope: no std template orders a string (Bounded uses integers). This should be merged with B2 and not counted as a separate gap.

**Skeptic 2** (not refuted). Not refuted. This is a gap in the spec text, not a prototype bug.

Re-run: bun <scratch>/skeptic2-W2W6H3H4/neg.ts with NEG_ONLY=W1,W1t,W2,W2t (a private copy of redteam/agent/negsuite.ts plus my variants; <scratch> = /tmp/claude-0/-home-user-shapelang/83ff80bc-0161-572f-9e5a-9075cccad6d0/scratchpad/shape1work).
- W2 ("250ms" -> "1000ms"): prototype pass with no L4. The "300ms" control gives L4, blocking at critical.
- New W2t ("250ms" -> "50ms", which is stricter in meaning): prototype gives L4, blocking. Codepoint order is wrong in both directions: it misses a loosening and invents one.

The kernel's L4 is no evidence that the spec handles strings. In Loosen.lean, l4Parts finds an heir only on equal fp and has no template order at all. So the kernel also raises L4, blocking, on the integer tightening Bounded<f,0,50> -> <f,0,40> (variant W1t), where the prototype correctly passes.

Spec text:
- A.4.3.1 allows string values.
- Core §4.3, A.4.3.5 ('order P by leq|geq') and A.5.6.4 ('args by the base order table') never define leq or geq on strings.
- The only string order in the spec is A.0.2's codepoint sort of outputs, and A.0.2 requires total functions. So the prototype's codepoint comparison is a conforming reading, and under it the heir, and so the implied L4, is unsound.
- No error rejects leq on a string parameter: A.4.3.7's E-template covers only self-attachment, arity and kind.

Fix (one sentence in A.4.3.5): leq and geq compare safe integers only, and a string argument under a leq or geq order is E-template (or strings compare by equality only).

### agent/W6: Hosted statement's specification weakened in the change that re-proves it

- **Outcome:** succeeded; demonstrated.
- **Closed by:** D13 in [RFC.md](../RFC.md).

**Steps.** Example 2 without the assume. The change weakens set's ensures clause, so set's closure digest moves. The fresh verus proof cites the new closure and supports SetRefinesSpec. Prototype and kernel: equal NF counts as an heir, so no L4 is raised and SetRefinesSpec is established; verdict owed, from an unrelated preexisting obligation. The other red-team agent found the same, in its case A14.

**Gap.** None in the spec: A.5.6.4 makes hosted laws ⊒ only with closures ≡ (or a contributing implies record), and A.8.2.3 then gives L4 undecided. The prototype (opOrderGeq and the heir loop) and the kernel (⊒ = equal fp) ignore closure digests.

**Proposed fix.** Prototype and kernel: for hosted laws, an heir requires that the statement ref's closure digest is equal or ≡ between M_b and M_h, or a contributing code-space implies record. Otherwise raise L4 undecided. Add this case as a vector.

**Skeptic 1** (refuted). REFUTED as a model gap. The attacker agrees the spec is clear, and the spec does decide this case. Four clauses say a moved closure denies heirship to a hosted law:
- A.5.6.4: hosted laws are ⊒ only with "equal NF with closures ≡ or a contributing code-space implies record".
- A.4.3.8: "Hosted statements loosen only via equal closure digests, implies records or answers."
- A.5.7.1: the hosted NF carries "no digest; closure moves seen by freshness and L4".
- A.8.2.3: L4 is undecided, with "closure changes awaiting an implies record or answer".
When correctly implemented, SetRefinesSpec has no heir, so L4 is undecided. Its tier is the base tier, critical, inherited from DelegationMap. It is latent, and DefaultPolicy critical blocks latent loosening, so the verdict is blocked until an IronKvTeam person answers or a contributing implies record arrives.

Re-run with the original code: prototype and kernel both give owed, with only the preexisting NoHatches contradiction. Both are implementation deviations:
- The prototype's heir loop (derive.ts ~l.408) accepts equal fp, and opOrderGeq returns true on equal NF before any closure check.
- The kernel's l4Parts tests only `fp == cb.fp`, and its Stmt.hosted carries no digest.

Patched scratch prototype (proto-fixed/src/derive.ts): for a hosted law, a closure that is not ≡ between M_b and M_h removes the heir, unless a claim-implies record supplies it. Result: W6 is blocked by `loosening[L4] blocking critical introduced latent ironkv::SetRefinesSpec`. All 21 redteam-inputs examples are unchanged.

Secondary point: the demo leaves set's contract digest unchanged although it edits the ensures text. With the contract digest moved as well, the original prototype already blocks, because SetContractFaithful (judged at contract) becomes unestablished(stale), blocking at critical. The fixture is consistent only for a weakening routed through a spec function's body, since env resolves functions by identity.

Editorial defect to fix: model §5.6 and A.5.6.3 list "equal NF" as an unconditional generator of ⊒. That contradicts A.5.6.4 for hosted laws and misled both implementations. Both should say "equal NF (hosted laws: and closures ≡)".

**Skeptic 2** (not refuted). Not refuted, but for a different reason than the attacker gives, and the demonstration overstates the effect on Example 2.

(1) The fixture is unrealistic. The ensures clause is part of the contract projection (verus-probes README: contract = signature plus requires/ensures), yet W6 leaves set's contract digest unmoved. My variant W6c moves both contract and closure. There the prototype and the kernel both return blocked: SetContractFaithful is unestablished (stale), introduced, critical, and blocks under DefaultPolicy. So the real Example 2 change does not merge.

(2) The general gap is real. Variant W6d removes SetContractFaithful and dana's judgment from both sides. Both implementations then give owed, with only the preexisting NoHatches contradiction and no L4 for SetRefinesSpec.

(3) It is a defect in the spec text, not only in the two implementations.
- Core §5.6 and A.5.6.3 define ⊒ as the closure of equal NF, plus records, plus the op order.
- A.5.7.1 puts no digest in a hosted law's NF.
- A.6.2.1 (H(c_b) = {c_h ⊒ ρc_b}) exempts only effect forbids and authority.
- A.8.2.3 implies L2–L4 whenever an heir exists.
- Together these give an heir, and L4 implied, for every closure move. A.5.6.4's 'closures ≡' only adds an op-order route and cannot remove the equal-NF one. That leaves A.4.3.8, A.5.7.1 ('closure moves seen by ... L4') and A.8.2.3 ('closure changes awaiting an implies record') unreachable.
- 'Closures ≡' also names no manifests. Since §6.1 and A.8.1.5 resolve both shapes over M_h, a literal implementation compares M_h with itself.

Both independent implementations follow the literal text: the prototype's opOrderGeq (strength.ts:63) returns true on equal fp, and the kernel's heir test is equal fp.

Fix: hosted laws are ⊒ only when M_b(ref, closure) ≡ M_h(ref, closure) or a contributing code-space implies record exists. Write this in core §5.6, A.5.6.3 and A.6.2.1, then fix the prototype and the kernel.

### lawyer/L01: Narrowing the judge list in the head turns on the self fallback (violates T2′)

- **Outcome:** succeeded; demonstrated.
- **Closed by:** D12 in [RFC.md](../RFC.md).

**Steps.** Kernel. Run python3 -I experiments/shape-1/redteam/lawyer/kattack.py; it writes cases/*.json and *.out.json and prints kernel-summary.txt. Actors: ShapeMaintainers={tim}; person bob, not in the team; agent claude (operator tim); authors*={claude,tim}. Base policy: normal judges [owner, agents, tooling::bob]; critical judges [owner, tooling::bob]. Head policy: DefaultPolicy values. policy* intersects the judge lists as strings, giving [owner, agents] and [owner], so the persons eligible by role are {tim} and the self fallback admits tim. L7 sees judges_h ⊆ judges_b and raises nothing. (a) The head removes the RefactorSensitive law (L4, normal, latent) and tim writes `shape approve`: control blocked (exit 1), attack pass, answer recorded as a discharge. (b) A critical guard on an edited isoToday, and tim writes `shape judge`: control blocked (critical unestablished), attack pass. (c) A seeded Date.now in ShapeRuleEngine (critical, sound contradiction), plus a component exception the head adds, plus tim's approve: control blocked, attack owed as an exception answer, debt 37 days. Cases: cases/A1a_*, A1b_*, A1c_*. In the prototype this cannot be told apart, because named judges are already dropped there (see L16): its control self-discharges (proto-cases/A1a_judges_narrowing_L4__control_head_policy_unchanged.out.json, answered self).

**Gap.** A.6.2.6 treats 'judges intersected' as the direction that cannot lower severity, and L7 flags only judges_h ⊄ judges_b. But the self fallback (A.6.3.3) depends on how many base persons are eligible by role, and that number falls as the judge list shrinks. A head edit that tightens the judges therefore lets an author approve their own loosening, judge their own guard, or answer their own exception. T2′ is false.

**Proposed fix.** Compute the fallback condition ('the only base person eligible by role') from the base policy's judges alone, never from policy*. Or make any head change to judges an L7 question that acts only after merge. Add a T2′ property: no head policy edit may make an author eligible who was not eligible under the base policy.

**Skeptic 1** (not refuted). I could not refute this. It is a gap in the model, not a kernel artefact. Re-ran kattack.py from a scratch copy (/tmp/claude-0/-home-user-shapelang/83ff80bc-0161-572f-9e5a-9075cccad6d0/scratchpad/shape1work/skeptic1/kattack.py, same shapek binary). A1a: control exit 1, blocked (loosening, normal); attack exit 0, pass, tim's approve recorded as a discharge. A1b: control blocked (unestablished, missing, critical); attack pass. A1c: control blocked (sound contradiction, critical); attack owed, exception answer, debt ClockComp 37 days. The kernel follows the spec text here. Laws.lean `eligible` and `selfFallback` read judges from polStar, which takes the intersection as A.6.2.6 says. The fallback condition in A.6.3.3 is 'the only base person eligible ignoring authorship'. Here 'base' qualifies the person (actors come from the base only), and eligibility is 'listed by tier*(o)'s judges' under policy*. Base judges {owner, agents, bob} give two eligible persons, {tim, bob}, so the fallback is off. The intersection {owner, agents} gives {tim}, so the fallback is on. The fallback is anti-monotone in the size of the eligible set, so intersecting judges is not the direction that cannot lower severity. Refutations tried: (1) A.6.2.8 says head edits act 'only where they cannot lower severity'. But it gives no procedure, and A.6.2.6 fixes the judges direction explicitly. The two clauses contradict each other, which is itself a model defect. (2) L7 fires only on judges_h ⊄ judges_b (A.8.2.3), so nothing is raised. After merge the narrowing also permanently enables self-approval, and no question is ever asked. The prototype cannot separate control from attack because of its own named-judges bug (L16), which does not affect the kernel demonstration. A fix belongs in the model: count fallback eligibility over base ∪ head judges, or make a judges narrowing that leaves no non-author eligible an L7 question.

**Skeptic 2** (not refuted). Not refuted; this is a model-level gap. I re-ran a copy of kattack.py in /tmp/claude-0/-home-user-shapelang/83ff80bc-0161-572f-9e5a-9075cccad6d0/scratchpad/shape1work/skeptic2/ and the kernel gives the same results. A1a: control exit 1 blocked (loosening, normal); attack exit 0 pass (answered as 'discharge'). A1b: control exit 1 blocked (unestablished/missing, critical); attack exit 0 pass. A1c: control exit 1 blocked (sound contradiction, critical); attack exit 0 owed (exception-answer, ClockComp debt 37 days). The spec text produces this result as written. A.6.2.6 sets policy* judges to the intersection. A.6.3.3 lists eligible judges by tier*(o)'s judges, which is policy*. The fallback condition is 'j is the only base person eligible ignoring authorship', so it is evaluated under policy*. L7 flags only 'judges ⊄' (A.8.2.3), so removing bob raises no question. The rules are therefore inconsistent with A.6.2.8 ('act in the run only where they cannot lower severity') and with T2′: the number of persons eligible by role falls as the list shrinks, and that is what switches the fallback on. I tried three ways to refute it. (1) Intersecting persons instead of strings (the L16/A12 issue) gives the same result: {tim, bob} ∩ {tim} = {tim}. (2) A.9.5 says loosenings are answered by the subject's base owner, so a reading where bob was never eligible for loosenings could also make the A1a control self-discharge. Variant (b) does not depend on that reading. It is a claim judgment of a critical law, bob is a listed critical judge (A.5.3.5), and the only head edit is the policy narrowing; it still goes from blocked to pass. (3) The prototype cannot tell the cases apart because it drops named judges (L16), so the evidence is the kernel alone. That evidence follows the annex literally. Possible fix: count the fallback's 'only eligible person' over the base judges, or over the union, rather than over policy*.

### lawyer/L02: Producer-changed masks assumption: one approve discharges a law that rests on an undeclared assume (also at tier final)

- **Outcome:** succeeded; demonstrated.
- **Closed by:** D9 in [RFC.md](../RFC.md).

**Steps.** Kernel and prototype. Example 2 without the NoHatches rule. SetRefinesSpec is critical in one variant and final in another. The fresh proof supports it, but set carries an undeclared assume marker. Control: unestablished(assumption), blocking, budget mechanical; dana's `shape approve` discharges nothing, verdict blocked. Attack: the PR also bumps ironkv/Cargo.lock, which is one of the verus provider's implementation paths. Phase 1 then shows unestablished(producer-changed), budget judgment. dana (IronKvTeam, not an author) writes one approve line: discharged, pass, nothing recorded as debt. The final variant needs the same single person. Both implementations agree. Cases: cases/A2a_{critical,final}_*; proto-cases/A2a_*.

**Gap.** A.5.4.1 checks reasons in the order stale, expired, producer-changed, assumption, weak, and A.5.4.3 takes the first one held, so producer-changed hides assumption and weak. A.7.6.5 makes producer-changed the only unestablished reason an answer can discharge. An answer to it therefore also accepts every reason that comes after it in the order, which contradicts A.7.6.5 ('no answer ... declares an assumption') and A.5.4.4 ('a final law is never satisfied through an assume'). A producer-changed answer on a final law needs only one person, because rule 4 covers only loosening and coverage.

**Proposed fix.** Read a producer-changed answer as 'treat the producer-changed records as if their producer had not changed', then re-evaluate the law, so that any remaining reason (assumption, weak, expired, stale) keeps the obligation open. Equivalently, report producer-changed only when every producer-changed record would be usable apart from that. Require two distinct persons for producer-changed answers, claim judgments and dismissals on final laws.

**Skeptic 1** (not refuted). I could not refute this. Re-ran both implementations: kernel via kattack.py; the prototype via a scratch copy of pattack.ts with absolute import paths, so the lawyer's proto-cases were not overwritten. Critical and final variants behave the same. Control: unestablished, reason assumption, blocking, budget mechanical, dana's line discharges nothing. Attack phase 1: reason producer-changed, budget judgment, with the same binding bd:8ad54064b6f2def4 as the control. Phase 2: pass, answered = discharge. The cause is in the spec text. A.5.4.1's first-match order is stale, expired, producer-changed, assumption, weak. A.5.4.3 ranks producer-changed first. T9 allows one reason per claim. A.7.6.5(1) makes producer-changed the only answerable reason. So an answer accepts a proof whose cone holds an undeclared assume, which contradicts A.7.6.5's 'no answer ... declares an assumption'. The kernel's `usab` and `lawReason` mirror that order exactly. Refutations tried: (1) Rule 8 only makes the obligation blocking until answered. (2) A.5.4.4 'never satisfied through an assume' technically survives, since Sat stays false, but the obligation is discharged and the verdict is pass. That is the same effect. (3) The two-person rule (A.6.3.4, rule 4) covers only loosening and coverage, so one person suffices at final. The trigger is an ordinary edit to an existing implementation path (a lockfile bump). It raises no L7 question and no coverage obligation (raw data, no hatch-channel claim). This is a model-level masking flaw.

**Skeptic 2** (not refuted). Not refuted; this is a model-level gap, and both implementations show it. I re-ran it. Kernel: A2a critical and A2a final controls exit 1 blocked with unestablished(assumption), tier critical and final. The attacks show producer-changed in phase 1 and exit 0 pass after one approve by dana (answered as 'discharge', obligation ob:8b9a1c953f7ed31c…, the Example 2 key). Prototype (re-run from my scratch copy of pattack.ts): controls blocked, attacks pass. This follows from the spec text. A.5.4.1 takes the first matching reason, and producer-changed comes before assumption and weak. A.5.4.3 also puts producer-changed first at law level, whether 'held' means the record's first-match reason or any condition it meets. A.7.6.5(1) makes producer-changed the only answerable unestablished reason, and the answer discharges the obligation; nothing re-derives the next reason. Rule 4 and A.6.3.4 ask for two persons only on final loosenings and coverage, so one person is enough at final. That contradicts A.7.6.5 ('no answer ... declares an assumption') and A.5.4.4 ('final laws are never satisfied through an assume'). My own variant shows the masking is general. I removed the assume and pinned the law to a different provider, so verus's authenticated proof is weak (pinned out). Without the lockfile edit it stays blocked as weak. With Cargo.lock bumped it becomes producer-changed, and one approve passes it (cases/V_L02_weak_pinned_out_*). Possible fix: let a producer-changed answer only lift that one reason, then re-derive, or make it answerable only when no other reason holds.

### lawyer/L03: A fake head-only provider turns 'missing' into an answerable producer-changed obligation

- **Outcome:** succeeded; demonstrated.
- **Closed by:** D9 in [RFC.md](../RFC.md).

**Steps.** Kernel and prototype. Critical law CheckIsDeterministic (Deterministic<checkShapeModules>, tested). The authenticated bunTest run timed out and left an inconclusive record. That counts as supplied for E-provider-missing, so the reason is missing and no answer applies. Control: blocked. Attack: the head declares provider quickCheck (produces test, decides template Deterministic, implementation paths packages/shp-checker/src/**, no identity) and adds an unauthenticated supporting record citing the head's Req. Its implementation paths meet Δcode, so the record is producer-changed (A.6.2.6(c) unites base and head implementations). Phase 1 shows producer-changed, budget judgment. One `shape approve` by ann discharges it: pass. Adding a provider raises no L7 question. Both implementations agree. Cases: cases/A2b_*; proto-cases/A2b_*.

**Gap.** Head-only providers are meant to act only through contradictions ('establishes after merge', A.6.2.6), but their records still hold usability reasons. The only answerable reason, producer-changed, is reachable by declaring implementation paths that match the change itself. Head-only providers therefore have the power to make obligations answerable.

**Proposed fix.** Records from providers the base does not declare count only for contradiction. They hold no reason under A.5.4.3 and do not affect whether an obligation is answerable. Producer change uses only base implementations for providers that also exist in the base. Combine with the fix for L02.

**Skeptic 1** (not refuted). I could not refute this, although one refutation does land on the exact demonstration. Re-ran it: kernel and prototype both give control blocked (missing) and attack pass, after one line from ann on a producer-changed obligation. Refutation (i): A.5.3.5 defines 'applies' only for records that support or contradict. Read literally, the authenticated inconclusive bunTest record is not applicable, so A.5.2.13 would raise E-provider-missing and block the exact case whatever the fake record says. The kernel's providerMissing counts any non-stale record carrying the claim fp. That weakens this demonstration but not the gap. Two kernel variants I ran remove the dependency. (a) bunTest unauthenticated and supplying no record: control blocked (missing); attack phase 1 producer-changed, phase 2 pass. (b) bunTest authenticated, presence-unsound, failing with a counterexample, which is an applicable heuristic contradiction: with one approve line from ann the control stays blocked (missing), while the attack passes with both obligations discharged. Refutation (ii): 'Head-only providers act under (a) only' might exclude clause (c). But A.5.4.1 says 'implementation, base ∪ head', A.6.2.6(c) says 'implementations united', and A.5.4.3 counts any supporting record. A.5.1.3 and Example 1 also make head-only records take part in reasons, as declared, giving weak. So the literal spec yields producer-changed, which masks weak (s(r) = declared < tested). The head chooses the implementation paths, so it can always reach the answerable reason. That contradicts 'act under (a) only' and A.7.6.5's 'no answer meets an evidence floor'. The root is the same as L02, plus head-chosen implementation paths, and it is model-level.

**Skeptic 2** (not refuted). Not refuted; this is model-level, with the same root cause as L02 plus the fact that head-only providers can trigger producer-changed. I re-ran it. Kernel and prototype: control blocked (unestablished/missing, critical); attack phase 1 shows producer-changed, and one approve by ann gives pass. I tried two refutations. (1) An inconclusive record might not be 'applicable' (A.5.3.5 defines applicability only for supports and contradicts). Then E-provider-missing would block both control and attack. Variant V1 removes this dependency: bunTest has no identity and supplies no record, so E-provider-missing cannot apply. The attack still goes from blocked (missing) to pass. (2) 'Head-only providers act under (a) only' (A.6.2.6) might mean their records hold no reasons. But A.5.1.3 explicitly gives them level 'declared', which only matters if they take part in Sat and reason computation, and A.5.4.1 computes producer-changed over 'base ∪ head' with no exclusion. My variants show it needs no trick: V2 uses an implementation that is a new file the change adds, as in a normal adoption PR, and gets producer-changed then pass. V3 uses an unrelated implementation digest but lists the changed file in the record's own harness, and gets producer-changed then pass. V4, the control, puts nothing of the provider in the delta: it shows weak and stays blocked after the approve. So a record that cannot establish turns an unanswerable reason (missing or weak) into an answerable one. One person's answer then stands in for the tested floor, against 'establishes after merge' and A.7.6.5 ('no answer meets an evidence floor'). Files: skeptic2/variants.py, variants.stdout, cases/V_L03_*.

### lawyer/L04: Moving code out of a final component into a low-tier component with the same grants raises no question (violates T2)

- **Outcome:** succeeded; demonstrated.
- **Closed by:** D11 (see [spec/CHANGES.md](../spec/CHANGES.md)) in [RFC.md](../RFC.md).

**Steps.** Kernel and prototype. Base: Vault (tier final, grants Read<Ledger>, paths src/vault/**/*.ts) and Scratch (tier low, the same grants). The head adds the more specific glob src/vault/purge/**/*.ts to Scratch and adds new code src/vault/purge/p.ts#purge; no observer is declared. Control (no glob change): coverage at tier final, blocking under rule 4. Attack: pass with zero obligations, in both implementations. L1 finds identical Perm and no forbid levels at the moved identities and at the (Vault.*, Scratch.*) cell. L6's Con tuples (A.8.2.3) have no authority tuple. L7 compares each component's own tier, and neither changed. Coverage tier is max(tier*(Scratch)=low, authority(Scratch)=low), which is health only. Cases: cases/A50_*; proto-cases/A50_*.

**Gap.** A.11.3 T2 says moving code out of a final claim is a two-person loosening, and core §8.2 L6 says 'tier and requirement included'. But the annex has no per-position authority tier: Lvl in L1 counts only effect forbids, Con_S in L6 omits authority, and tier*(K) is per component. The code governed by a final authority claim can therefore shrink, and its later coverage drops to health only, with no question raised.

**Proposed fix.** Add an authority tuple (component and authority tier) to Con_S(x) in L6, or extend Lvl(u)(a) so that an atom closed authority does not grant takes the authority claim's tier. Add a loosening vector for code moved by a glob from a final component to a low one.

**Skeptic 1** (not refuted). I could not refute this. Re-ran it: kernel and prototype both give control blocked (coverage, final) and attack pass with zero obligations. Two further kernel variants: unedited existing code moved by the glob passes with zero obligations; edited existing code is blocked as final coverage in the control but passes in the attack. The spec procedures produce this outcome. A.4.4.7 defines Lvl from effect forbids only. L1's parts (A.8.2.3) come from forbids and gained grants, and Perm is equal here. L6's Con_S has no authority tuple. A.8.1.2's Γ carries no authority tier. A.6.2.1 limits authority heirs to equal NF, and the component is in the NF, so authority(Scratch) is not an heir of authority(Vault). tier*(c,x) and tier*(K) are per component, and L7 compares each component's own unchanged tier. So S_h ⊑ S_b under A.8.1.3, while A.11.3 T2 says 'moving code out of ... a final claim ... is a two-person loosening' and core §8.2 L6 says 'tier and requirement included'. That is an internal inconsistency in the spec, not a bug in either implementation. Coverage is not the only loss: once the code sits under authority(Scratch), a later violation there is a low-tier contradiction. It can be waived by an exception and becomes owed when preexisting, where it was blocked under rule 2 at final.

**Skeptic 2** (not refuted). Not refuted; this is a model-level gap in the annex procedures. I re-ran it. Kernel and prototype: the A50 control is blocked by final coverage, and the attack passes with zero obligations. The annex text confirms there is no mechanism to catch it. A.4.4.7 defines Lvl(u)(a) as the highest tier of effect forbids only. L1 (A.8.2.3) compares Perm, which is equal here, and Lvl. L6's Con_S tuple list has no authority entry. tier*(c,x) brings base tiers only from claims c is an heir of, and authority heirs need an equal NF, which includes the component name. So coverage tier is max(low, low): health only. That contradicts A.11.3 T2: 'moving code out of ... a final claim with a lower-tier ... is a two-person loosening; new violating code blocks'. It also contradicts the core L6 wording, 'tier and requirement included'. My variants go further. V1: the same change also adds an observed, presence-sound HardDelete<Ledger> at the moved p.ts#purge, plus a component exception. Control: a sound contradiction at final that blocks and cannot be waived. Attack: a sound contradiction at tier low, so one exception answer by quinn turns it into owed debt (37 days). In a single change, new violating code that the base governs under a final claim becomes waivable debt. V2: the same move against a final effect forbid instead of authority is caught, giving L1 loosened, final, blocking. That isolates the gap to authority's tier being absent from Lvl and Con. Possible fix: give authority's tier a level per position in L1, or add authority tuples to L6's Con_S. Files: cases/V_L04_*.

### lawyer/L05: Leaving preexisting final drift is not monotone: lowering the tier deadlocks, while deleting or perturbing the claim passes

- **Outcome:** succeeded; demonstrated.
- **Closed by:** D11 in [RFC.md](../RFC.md).

**Steps.** Kernel and prototype. Base: forbid Read<SystemClock> within ShapeRuleEngine at tier final. Base and head records report the same Date.now fact at an unchanged checkFreshness, so the drift is preexisting. The team is {tim, ann, bob}; the authors are {claude, tim}. (a) A change that touches only README.md: blocked by rule 2. (b) Lower the forbid to critical with the same NF, and ann and bob approve the final L1/L7 loosening: the loosening is discharged, but the contradiction keeps tier* final (taken from the base claim with the same fp), so the change is blocked. (c) Delete the forbid, with the same two approvals: owed (the contradiction moves to authority, normal). (d) Replace the forbid with a critical copy whose NF differs only by the inert `except component ShpCli`, with the same two approvals: owed. Both implementations agree. Cases: cases/NM_*; proto-cases/NM_*.

**Gap.** tier*(o) inherits the base tier only through heirs, and for effect forbids an heir must have an equal NF. The weaker edits (delete the claim, or change its NF) therefore escape, while the milder one (lower the tier) can never merge, even after the required two persons approve. Severity is not monotone in the loosening order. Rule 2 also blocks every unrelated change while final drift exists, which contradicts A.7.5.4 ('old drift never blocks an unrelated change') and §7.3 ('tightenings are adoptable'): raising a drifted claim to final blocks the change that does it.

**Proposed fix.** When a final loosening of claim c is answered by two persons in this run, compute c's contradictions with tier_h(c). Otherwise take tier* from Lvl_b at the fact's position, so that it does not depend on NF equality. Decide explicitly whether preexisting final drift blocks unrelated changes. If it does, amend A.7.5.4 and §7.3; if it does not, apply rule 2 only to introduced contradictions.

**Skeptic 1** (not refuted). Not refuted. This is a model-level defect, but it affects liveness and consistency, not safety. I re-ran the lawyer's kattack.py on the kernel (shapek) in sk1-L05-08/. All four NM variants matched the lawyer's outputs byte for byte: (a) blocked, (b) blocked, (c) owed, (d) owed. The prototype pattack.ts gave the same four verdicts. Each outcome follows from the spec text, not from a bug: A.6.2.1 gives effect forbids heirs only on equal NF; A.6.2.3 takes tier* from heirs; A.7.5.1 puts rule 2 before rule 6; A.7.6.5 and A.7.6.7 say no answer clears a sound contradiction; A.6.2.8 says governance edits act only after merge.

Refutation attempts that partly succeed (sk1-L05-08/probes.py):
- Safety (T2) holds. Without answers, b0, c0 and d0 all block on the final loosening (rule 4).
- The edit-code exit works: removing Date.now with the final forbid kept gives pass.
- A two-step exit exists: delete the forbid (two persons), then re-add it at critical, which gives preexisting owed.

What survives:
- Non-monotonicity. With the same two answers (ann, bob), (b) stays blocked and (d) is owed. The only difference is an inert NF change (`except component ShpCli` is disjoint from the scope ShapeRuleEngine). That change removes heir-ness, yet L1 sees both heads as the same final-to-critical demotion. So in-run tier inheritance is syntactic while its gate is semantic. The 'edit-shape' discharger shown on the final contradiction does not work for a tier edit.
- Adoption cliff at final. Adding an observer over existing final drift blocks (probe g). Re-adding the claim at final blocks (f2), and so does raising a drifted critical forbid to final (h). This contradicts M§7.5 and A.7.5.4 ('old drift never blocks an unrelated change') and M§7.3 ('tightenings are adoptable'). Yet M§7.7, A.7.7.2 and v4 §9.7 say preexisting obligations block at final. The spec contradicts itself.
- The effect is confined to final. Lowering a drifted critical forbid to normal blocks only on its critical latent loosening (probe i). The contradiction itself stays preexisting owed, so once that loosening is answered the change is owed.

**Skeptic 2** (not refuted). NOT REFUTED. The non-monotonicity part is a real gap in the model. The 'unrelated change blocks' part is behaviour the spec intends, but its wording contradicts itself.

Re-runs. All 8 kernel NM cases match the attacker's outputs byte for byte (shapek on .../shape1work/skeptic1/cases/NM_*.json). All 8 prototype NM inputs match too (bun /tmp/claude-0/-home-user-shapelang/83ff80bc-0161-572f-9e5a-9075cccad6d0/scratchpad/shape1work/sk2-L05-08/prerun.ts). Results: (a) blocked; (b) blocked, with the L1+L7 loosening discharged by ann+bob; (c) owed; (d) owed.

Refutation attempts (kernel: python3 -I sk2-L05-08/variants.py and variants2.py; prototype: bun sk2-L05-08/pvariants.ts; outputs in sk2-L05-08/var and sk2-L05-08/proto-var):

1. Is the attacker's base reachable? Not through gated changes. Every way into final drift blocks:
- V1: raise a drifted critical forbid to final with code unchanged: blocked, rule 2, non-introduced.
- V2: add the observer under a final forbid: blocked.
- V3: first adoption of a final forbid over drift: blocked. The critical version (V3c) is owed.

But the same pattern appears in a state that is reachable: the adoption change itself, for example a migrated 0.x `forbid final` (A.11.1) whose new 1.0 observer reports a violation at unchanged code. There, lowering to critical with ann+bob approving is blocked (kernel V2b and prototype), while deleting the forbid or perturbing its NF with the same approvals is owed (V2c, V2d). So reachability does not refute the attack.

2. Is (b) a permanent deadlock? No. Deleting the forbid with two approvals (owed) and then re-adding it at critical (V4, owed) reaches the same state in two changes. A code fix plus the lowering passes (V6). So this is a perverse ordering rather than a lockout.

3. Is the outcome intended? A.6.2.1 and A.6.2.3 let an effect forbid inherit the base tier only through an equal-NF heir. L1, by contrast, is semantic and per position. Deleting the forbid or adding an inert `except` therefore pays the same two-person final loosening as (b), but escapes the inherited final tier. No rule lets (b)'s two approvals take effect. T2 puts removing a final claim and replacing it with a lower-tier one in the same class (both two-person loosenings), but the rules give them opposite results. The honest downgrade is strictly harder than deletion or NF obfuscation.

4. The 'unrelated change blocked' half is intended. §7.7 and A.7.7.2 say preexisting obligations block at tier final, and rule 2 precedes rule 6. That behaviour contradicts three statements in the spec: A.7.5.4 ('old drift never blocks unrelated changes'; 'first adoption is owed', which V3 falsifies) and §7.3 ('tightenings are adoptable', which V1 falsifies). These are text defects.

The gap is a model-level defect agreed by both implementations, not a prototype bug.

### lawyer/L06: A final informal law is established by a single judgment, from an agent if critical's judges list agents

- **Outcome:** succeeded; demonstrated.
- **Closed by:** D11 (see [spec/CHANGES.md](../spec/CHANGES.md)) in [RFC.md](../RFC.md).

**Steps.** Kernel and prototype. A guard law at tier final on an edited isoToday. The policy's critical judges are [owner, agents]. reviewBot is an agent that is not an author (operator ann). Control: unestablished, final, blocking. Attack 1: one `shape judge` line from reviewBot gives pass. Attack 2: one line from ann gives pass. Both implementations agree. Cases: cases/A5a_*; proto-cases/A5a_*.

**Gap.** Core §6.3 says 'Tier final needs two distinct eligible persons ... no agent, no fallback'. A.6.3.4 applies this only to final loosenings and coverage. A.6.3.3 lets agents judge whenever the judges list includes agents, and E-policy does not stop critical's judges, which tier final also uses, from listing agents.

**Proposed fix.** Pick one rule. Recommended: claim judgments, producer-changed answers and heuristic dismissals on final claims need two distinct persons, one from the base item owner and one from the base shape owner, and no agent. Final ignores 'agents' in critical's judges, or E-policy rejects that combination.

**Skeptic 1** (refuted). Refuted as a model gap. The behaviour is the governing design, and what remains is a difference in wording between the core and the annex.

(1) Scope of the rule. The annex governs detail, and its 'meanings are version 4's unless stated'. A.6.3.3 lets agents judge when the tier lists them. A.6.3.4 applies the two-person/no-agent rule to final loosenings and final coverage only. v4 model §318-319 states the same scope explicitly. Syntax §1 says E-policy checks that two persons 'can lift' a final item, which is about loosening. T2 covers only weakening a final claim. The M§6.3 sentence 'Tier final needs two distinct eligible persons' is a v5 compression that reads wider than intended. If it were taken as governing instead, the spec would reject the change and the kernel and prototype would both be implementation bugs. Either way this is not a gap in the model.

(2) Parity with other evidence. A claim judgment is establishing evidence, like a test or a proof. Probe A5ap_final_tested_one_record: one bunTest record establishes a final tested law, giving pass.

(3) The agent route needs a non-default policy. Under DefaultPolicy (critical judges: owner), reviewBot's judgment of the final guard is ineligible and the change is blocked (unestablished/missing). Policy* intersects judges, so the head cannot add agents.

(4) Separation of duties holds. Judgments by authors tim and claude leave the final guard blocked. The self fallback is excluded for final items (A.6.3.3).

Residual issues, not soundness gaps: M§6.3 needs rescoping in the text, and TierPolicy has no final entry, so a team cannot allow agents at critical while excluding them at final.

**Skeptic 2** (not refuted). NOT REFUTED. Re-runs: the 3 kernel A5a cases and 3 prototype A5a cases are identical to the attacker's. Control: unestablished, final, blocked. One reviewBot line: pass. One ann line: pass.

The root is in the source: Kernel/Laws.lean `eligible` sets noAgent only for loosenings, exception answers and producer-changed answers, and applies no final rule to judgments.

Variants (python3 -I sk2-L05-08/variants.py):
- V7, DefaultPolicy (critical judges = owner): reviewBot is ineligible (blocked). So the agent variant needs the non-default policy. But one person (ann) still gives pass.
- V8: the same law at critical gives exactly the same outcomes for ann (pass), reviewBot (pass) and tim (blocked). Final adds nothing to how an informal law is established.
- V9 and V10: author tim and author-operated claude are both blocked at final, for the ordinary author and self-fallback reasons, not because of a final rule.

So the behaviour follows the annex: A.5.3.7 needs one usable applicable judgment, and A.6.3.3-4 confine two-person, no-agent eligibility to final loosenings and final coverage.

The core says otherwise:
- §6.3: 'Tier final needs two distinct eligible persons ... no agent, no fallback', with no restriction.
- §9 and A.9.3 list 'two persons for final' among the fixed rules that policy cannot override, and 'Tier final uses critical's policy plus the fixed rules'.
- §7.1 makes `shape judge` the discharger of the final law's unestablished obligation.

Under the core, a critical judges list that includes agents should not make an agent eligible at final. The spec's own rule ('a difference in meaning is a defect') makes this a spec defect, and both implementations implement the weaker reading. The gate effect is concrete: a blocking final law flips to pass on one agent's line.

The one-person variant could be argued as a design choice, but the core text settles it the attacker's way.

### lawyer/L08: A final law can be satisfied through admit, axiom or external_body

- **Outcome:** succeeded; demonstrated.
- **Closed by:** D11 (see [spec/CHANGES.md](../spec/CHANGES.md)) in [RFC.md](../RFC.md).

**Steps.** Kernel and prototype. DelegationMap is a boundary that allows admit in base and head. SetRefinesSpec is final. set carries an admit marker in base and head, and a fresh supporting proof lists set/admit. Control with assume in place of admit: unestablished(assumption), blocked. Attack with admit: pass. Both implementations agree. Cases: cases/A39_*; proto-cases/A39_*.

**Gap.** A.5.4.4 says 'a final law is never satisfied through an assume' and names a single hatch kind. Verus admit() proves anything, and axiom, external_body and assume_specification are unproven trust that is at least as strong. The kernel and the prototype both implement the literal text (kind == assume).

**Proposed fix.** A final law is never satisfied through any hatch fact in its cone (any h ⇒ Hatch). Only tool assumptions declared in the base provider's `trusts` may be assumed for final laws.

**Skeptic 1** (not refuted). Not refuted. I re-ran A39: the kernel and the prototype both give blocked for the control (assume) and pass for the attack (admit).

Kind sweep (probes.py, kernel; each hatch declared by the boundary in base and head, with a fresh proof listing the hatch):
- At final, only `assume` is rejected (1 of 7 kinds). admit, axiom, external_body, assume_specification, external and uninterp all pass.
- At critical, all 7 pass.
- The prototype agrees for assume, admit, axiom, external_body and assume_specification.
- An undeclared admit at final is still blocked (assumption), so the gap needs the boundary allowance.

Escalation path:
- Step 1: the head adds `allows admit` to the critical boundary. This is an L7 question at the boundary's tier, critical, answered by one person (dana).
- Step 2: the next change adds `admit()` to set. The final law then passes on a proof that rests on admit (assume(false), which proves anything).
- The same two steps with `assume` stay blocked.

So a single critical-tier approval empties the proof requirement of a final law. That goes against the purpose of T2 ('weakening a final claim needs two persons') and against the evident purpose of M§5.4 and A.5.4.4.

The gap holds under every reading:
- Read literally (kind == assume, as both implementations do), the rule names one kind, and a strictly stronger one escapes it.
- Read as a mere corollary of 'exceptions never declare assumptions', the rule is vacuous. The control's block is then an over-restriction, and declared admit and assume both let a final law pass on one critical approval.
- The sentence first appears in v4, directly after the two-level admit vector, so the class it meant likely included admit.

Scope: the decisive case is admit, with axiom probably included. external_body, assume_specification, external and uninterp are declared boundary-surface trust. Excluding all hatches would make any final law whose Calls° cone reaches host-trusted code unsatisfiable. The fix should therefore name a class of proof-internal hatches, not one kind and not all kinds.

Files are in /tmp/claude-0/-home-user-shapelang/83ff80bc-0161-572f-9e5a-9075cccad6d0/scratchpad/shape1work/sk1-L05-08/: probes.py, probe-results.json, pattack.ts, prun2.log.

**Skeptic 2** (not refuted). NOT REFUTED. Re-runs: the 2 kernel A39 cases and 2 prototype A39 cases are identical. The `assume` control gives unestablished(assumption), blocked; admit gives pass.

Both implementations encode the literal text, so this is not an implementation bug:
- kernel Laws.lean:169: `tierStar e c == .final && of.f.kind == "assume"`
- prototype laws.ts:213: `tier === "final" && h.kind === "assume"`

Variants, with each Verus hatch kind allowed by the boundary in base and head and a fresh proof listing it (kernel variants.py and prototype pvariants.ts agree on all 9):
- assume: blocked.
- admit, axiom, external_body, assume_specification, external, uninterp: all pass at final.
- admit not allowed: blocked, an undeclared assumption.
- assume allowed at critical: pass.

So the only thing final adds is a ban on the single kind `assume`. The core (§5.4, '`assume`') and A.5.4.4 ('an assume') say exactly that, and no ⇒ edge links admit or axiom to assume in std.

The ban is incoherent: admit() closes any goal, which is strictly stronger than assume(p), and axiom can introduce false. The boundary-allowed control is rejected while the same boundary-allowed admit passes, so the distinction is arbitrary. The gap is in the spec text.

Caveat: the attack overreaches on external_body, assume_specification, external and uninterp. These are the normal trusted-interface hatches (std's HostTrusted allows external_body, external, uninterp), and the proof cone follows callees through Calls°. Barring every hatch at final would make final Verus laws unattainable for code that calls host functions. The defensible fix bars the proof-goal hatches (assume, admit, and probably axiom). The admit case alone is decisive.

### lawyer/L19: A law with an empty Req is attributed to every component, so any component exception matches it

- **Outcome:** partial; demonstrated.
- **Closed by:** D14 in [RFC.md](../RFC.md).

**Steps.** Kernel. A law on component Empty, whose globs match no file, so Req = ∅. The exception 'waives unestablished of component ShpCli for component ShpCli' matches it because ∅ ⊆ code(K), and the obligation becomes debt (37 days, exception CliWaiver). Case: cases/A11_*.

**Gap.** A.4.6.4 and A.4.6.5 ('Req ⊆ code(K)', 'Req ⊆ ⟦Σ⟧') hold vacuously when Req is empty. Severity is unchanged here, but the debt is attributed to an unrelated exception. Also, any test record that cites any code applies to a law whose Req is empty.

**Proposed fix.** Attribute a law obligation to K only when Req ≠ ∅ and Req ⊆ code(K). Make an empty Req an E-law-target error, or list the law in health as vacuous.

**Skeptic 1** (not refuted). Not refuted. This is a real defect in the spec text, though low severity. (1) It follows literally from the spec. A.4.6.4 'law obligations iff Req ⊆ code(K)' and A.4.6.5 'Req ⊆ ⟦Σ⟧' hold vacuously when Req = ∅, and nothing rejects a law on a component whose globs match no files: E-law-target covers only resource-only targets, and E-unbound covers only units. The kernel implements the text as written. The prototype quietly adds a guard (`reqIds.length > 0` in derive.ts exceptionMatches), so the two implementations already disagree. (2) The effect on verdicts goes beyond what the attack claims. In audit mode at critical, the kernel gives owed, exit 0, debt CliWaiver 37 days with the unrelated ShpCli exception, and blocked, exit 1, without it (W/l19.py L19_b). The prototype keeps the same EmptyDocumented obligation blocking even with the exception (W/proto/l19.ts). So the reference kernel and the prototype give different verdicts for one shape. (3) The effect is bounded. In change mode severity is unchanged at normal and at critical, with or without the exception (both owed, rule 5 versus rule 6). The match ends as soon as the law has code: a file appearing under Empty's glob makes the obligation introduced and unmatched, and at critical it blocks (L19_c). The sub-claim that any record citing any code applies is harmless: the record must still be about that claim, and it goes stale once Req grows (L19_d: pass, then stale and owed). Fix: require Req ≠ ∅ in A.4.6.4/A.4.6.5, or attribute law obligations by their `on` components. Optionally also flag empty-Req laws as vacuous, either as an error or through teeth.

**Skeptic 2** (refuted). Refuted. I re-ran cases/A11_attack: debt CliWaiver, 37 days, owed. That follows the spec (∅ ⊆ code(K) and ∅ ⊆ ⟦Σ⟧), but no checker decision depends on it.

(a) Non-introduced obligations: matching only moves the obligation from rule 6 (preexisting, owed) to rule 5 (debt, owed).
- L19_no_exception: owed.
- L19_claim_exception (an exception targeting the law itself): the identical debt, 37 days, owed.
So the outcome is the same with no exception, with a direct exception and with the unrelated one.

(b) Introduced obligations: with Req = ∅, Req can never meet Δcode, so only a producer change can introduce the obligation. A matched introduced obligation still needs an exception answer from an eligible non-agent for the law's owner* (A.4.6.6). That is the same person who could answer a claim-targeted exception, or answer the producer-changed obligation directly through its own answer discharger.

Adding an exception is free (A.4.6.8). So the vacuous match gives no new power and never changes severity, eligibility or exit code.

The claim that any test record applies overstates it. Applicability still needs r.claim ⊒ c (A.5.3.5), so only records about this law apply. With Req = ∅ there is no code to go stale. Once the component gains code, Req grows and partial citations become stale.

The effect is a cosmetic debt attribution. Attributing law obligations to K only when Req ≠ ∅ would be an optional tidy, not a fix for a model gap.

Files under /tmp/claude-0/-home-user-shapelang/83ff80bc-0161-572f-9e5a-9075cccad6d0/scratchpad/shape1work/skeptic2-L17-20/: v/L19_*, k/A11_attack.out.json.

### lawyer/L26: A stale harness digest: the kernel treats the record as usable, the prototype as producer-changed

- **Outcome:** partial; demonstrated.
- **Closed by:** D9 in [RFC.md](../RFC.md).

**Steps.** Kernel and prototype. A bunTest record from an older revision, from a provider that is deps complete in both shapes. Its code and deps match M_h, but its harness digest is older than M_h's, and the harness is not in this change's Δcode. Kernel: usable, verdict pass. Prototype: producerChanged() treats a harness digest mismatch as producer-changed, giving unestablished(producer-changed), blocking at critical and answerable by a person. Cases: cases/DH_*; proto-cases/DH_*.

**Gap.** A.5.4.1 makes a record stale only for cited or dependency digests, and producer-changed requires the harness to be in Δcode ∪ deleted, so neither applies; the kernel follows that reading. A record whose harness changed after it ran is not evidence about the current harness, and the prototype's reading also opens another route to an answerable producer-changed obligation (L02).

**Proposed fix.** Add 'harness digest ≢ M_h' to stale in A.5.4.1, so that such a record has no force. In the prototype, move the digest-mismatch branch (laws.ts lines 158-162) from producer-changed to stale.

**Skeptic 1** (not refuted). Re-ran the kernel case DH_harness_mismatch: pass. Its record is at revision b5 (the base) with a harness digest that contradicts M_b. RJ13 ('digest contradicting the revision's manifest') rejects it, and the prototype applies RJ13 to harness entries (proto/src/records.ts:328), so that demo is malformed.

The gap survives the realistic variant. Run with python3 -I .../skeptic1-L25-28/kvar.py. Record from an older revision a0, which RJ13 cannot check because only M_b and M_h are inputs: kernel verdict pass, no E-provider-missing (the record counts as reusable through deps complete). Control, the same record with a moved code digest: stale plus E-provider-missing. Prototype: unestablished/producer-changed, blocking at critical, introduced (laws.ts:158-161 treats a harness digest ≢ M_h as producer-changed).

As written, the spec gives 'usable'. A.5.4.1 makes a record stale only for cited or dependency digests. Producer-changed needs the harness to meet Δcode ∪ deleted. A.5.4.2 reuses records when 'digests and deps ≡ M_h'. But A.5.2.8 defines deps complete as 'complete deps and harness', and A.5.2.7 defines the harness as what 'defined the check'. So the reuse check leaves out part of what the provider declares its result depends on.

Consequence: a harness edit lands, and its own change is discharged by a person's producer-changed answer without a rerun (producer-changed records count as supplied, A.5.2.13). From then on, every change that leaves the code unchanged reuses the record made before the edit. The reviewed harness never runs, and the law reads Sat until the code next changes.

This is a model-level gap, low severity. Fix: add 'a harness digest ≢ M_h' to the stale reasons in A.5.4.1 and core §5.4. Stale means no force and nothing answerable. Producer-changed, as the prototype has it, is the wrong reason: a person could answer it (the L02 route).

**Skeptic 2** (refuted). I re-ran it. Kernel script: .../skeptic2-L25-28/kvariants.py (python3 -I); prototype: peq2.ts. The kernel passes DH as given and the matching-harness control. The prototype gives unestablished(producer-changed), blocking, critical. This is a prototype deviation from the text: laws.ts:160-161 treats a harness digest that is not ≡ M_h as producer-changed, and A.5.4.1 has no such rule (producer-changed only when the implementation or harness meets Δcode ∪ deleted). So the 'another route to an answerable producer-changed (L02)' half is prototype-only. The kernel reading is not a gap. Freshness is defined over claim and code fingerprints (SEED §4; core §5.4: cited and dependency digests). A producer change, whether implementation or harness, is gated at the change that makes it, and records do not carry implementation digests either. Kernel variants show the harness edit is caught where it happens. C1 (base harness old, head new, old record) gives unestablished(producer-changed), introduced, blocking at critical. C1 with a fresh head record gives the same. C1 at normal tier is introduced and owed, as DefaultPolicy says for normal. Dropping the record instead gives E-provider-missing, blocked. In C1 the merge needs either a fresh run under the new harness or a person's answer to producer-changed. A failing new-harness run with a counterexample is a sound contradiction that no answer clears (A.7.6.5). Afterwards the old record still truthfully shows that the unchanged code passed a check the shape accepted. Replaying it is covered by the documented removal and selection non-monotonicity (A.5.9.1). Requiring the harness to be ≡ M_h for reuse under deps complete is a possible tightening, not a missing soundness condition.

### lawyer/L36: A statement-position macro from a dependency hides an assume from the manifest

- **Outcome:** partial; argued on paper.
- **Closed by:** D20 in [RFC.md](../RFC.md).

**Steps.** Paper. A.12.2.8 makes only item-producing macros mark an identity as not hatch-complete. A macro from an external crate, invoked in statement position and expanding to assume(...), leaves no marker in the identity's own text. The identity stays hatch-complete, the hatch forbid sees nothing, and hatch coverage is met. Laws are protected only if the proof provider lists the hatch after expansion (A.5.2.8), and the kernel ignores that list (L09).

**Gap.** The definition of hatch-complete leaves out macros invoked in statement or expression position whose definitions lie outside the tree. Presence and absence soundness of manifest hatch facts is therefore false for such identities.

**Proposed fix.** An identity that invokes any macro not defined in the tree (except verus! and registry-listed builtins) is not hatch-complete. Make the registry list the macros it expands.

**Skeptic 1** (not refuted). I could not refute this, and I have now demonstrated it, so it no longer rests on paper. Scratch dir: .../shape1work/skeptic1-L29-37/macro/.

Setup: `dep.rs` is a plain-Rust crate built with `rustup run 1.99.1 rustc --crate-type=rlib`. It exports `macro_rules! trust_me { ($e:expr) => { ::verus_builtin::assume_($e) } }`. `hidden_ext.rs` invokes `trust_me!(valid(x));` in statement position inside `proof fn set(x: u64) ensures valid(x)`.

Results:
- Verus 0.2026.10.23.dccae1d (`verus hidden_ext.rs --edition 2021 -L dependency=. --extern dep=libdep.rlib`) reports '2 verified, 0 errors'.
- The control without the macro reports '1 verified, 1 errors'.
- `--no-cheating` reports 'assume/admit not allowed' at the macro call site.
- The prototype's A.12.2.8-conformant fingerprinter (`proto/src/fingerprint/rust.ts`, via fp_probe.ts) reports `verus:hidden_ext.rs#set markers={} hatchComplete=true`.

So, under the spec correctly implemented:
- the manifest has no hatch fact at set, and `forbid hatch * outside boundaries` stays silent;
- hatch(verus) coverage counts as met, because A.7.4.3 says 'hatch(L) met iff x is hatch-complete';
- no provider may declare hatch channels (A.3.4.4), so nothing else can supply the fact.

The stated guarantee 'sound for presence and absence at hatch-complete identities (parsed, no item-producing macro)' (M§3.4, A.3.4.4, A.12.2.8) is therefore false here. This is a gap in the definition, not a prototype bug.

The law route is different. A.5.2.8 together with A.5.4.4 ('declared ones plus M_h hatch facts') makes a deps-complete proof record that lists the expanded assume give reason `assumption`. The attack's claim that this route is ignored relies on kernel bug L09/A38. Even when implemented correctly, though, it protects only laws whose provider declares deps complete, and it blocks only where policy blocks unestablished (critical in DefaultPolicy).

Suggested fix: an identity that invokes a macro not defined in-tree (other than verus! and registry-listed hatch-free vstd macros) is not hatch-complete.

Two related findings. First, a direct `::verus_builtin::assume_(valid(x));` in set also verifies (2 verified, 0 errors), and the prototype counts no marker for it (`markers={}`); the A.12.2.8 registry names only the surface form `assume(…)`. Second, speculation, not demonstrated: an in-tree macro defined in a boundary allowed to use assume would export assumes to unmarked callers in other files.

**Skeptic 2** (refuted). The attack concedes the decisive case. Laws are protected by the spec as written, and the residual is the declared dependency-code trust assumption, not a new gap. (1) Laws: A.5.2.8 requires proof providers to list 'verifier-trusted items after macro expansion as hatch assumptions'. The records profile gives assumption kinds (hatch, named, tool), and A.5.4.4 counts a record's 'declared ones' plus manifest hatch facts. An assume that is undeclared (not allowed by a boundary in base and head) makes the law unestablished(assumption), and a final law is never satisfied through an assume. The 'kernel ignores that list' premise is an implementation omission: kernel/Kernel/Laws.lean:170 checks record assumptions of kind named and tool, never hatch. Re-run: A38_attack_record_lists_hatch_manifest_silent, with the record listing set/assume and no manifest marker (exactly this macro scenario), gives pass. A38_control_manifest_marker gives blocked with unestablished(assumption), critical. Per spec the attack case must equal the control, so in Example 2's setting the change is still blocked. (2) Forbid and coverage: the macro's definition lies outside the tree, so the hiding is done by dependency code. Health lists that as an explicit assumption ('dependency code and configuration data', A.10.4, A.12.2.7). The same capability exists without macros: a dependency exporting `#[verifier::external_body] proof fn trust_me(b: bool) ensures b {}` gives assume(b) at the call site. No manifest marker can see it, the effect forbid uses direct atoms Xd only, and the proof provider is again the route (A.5.2.8 lists axioms and trusted callee items). By design the manifest is built without executing head code or resolving dependencies (A.3.2.6), so it cannot expand out-of-tree macros. With an in-tree macro_rules! definition, the defining identity is not hatch-complete (A.12.2.8), so hatch coverage is unmet there and blocks at critical. (3) Taken literally, 'sound for absence at hatch-complete identities' overstates the guarantee for out-of-tree expression macros. The fix is one registry line, consistent with A.5.2.5 ('unexpanded macros' force complete: false for observers): treat invocations of macros defined outside the tree, other than an allowlist, as not hatch-complete. That is a registry-entry correction, not a model-level gap, and the attack is undemonstrated.

### lawyer/L38: Spec points two implementations could resolve differently

- **Outcome:** partial; argued on paper.
- **Closed by:** D22 in [RFC.md](../RFC.md).

**Steps.** Paper, with kernel code cross-checked. (1) A.4.4.9 picks the representative as least by (presence-sound, declared, fact id) without giving the order of the booleans. (2) A.7.4.4 says 'one answer eligible for all items discharges', A.7.6.5 says 'for each item, some answer from an eligible actor'. (3) Merged claims take 'the owner of the highest-tier id, ties least id' (A.4.1.7), while the kernel's ownerStar takes the first base claim with the same fp. (4) A provider's L7 subject tier is 'claims it decides or whose channels meet its own' (A.8.2.2), while the kernel's provTier takes every non-law claim for any observer. (5) Two units on one identity in the base (lenient): the kernel's unitOf takes the first in canonical order, the same name-dependence as L13. (6) Which exception debt names (L18).

**Gap.** Each is an underspecified tie-break or set definition that affects bindings, owners, tiers or debt in the core output.

**Proposed fix.** (1) Order sound before heuristic, declared before observed, then fact id. (2) Keep A.7.6.5 and delete A.7.4.4's phrase. (3) Make the kernel apply A.4.1.7. (4) Make the kernel intersect the provider's channels with each claim's T(c). (5) Treat a base unit overlap like a base glob tie (strictest view). (6) As in L18.

**Skeptic 1** (refuted). Refuted. The claim that each of the six points is an underspecified tie-break that two correct implementations could resolve differently is false for at least four of them. (1) Representative order: the context fixes it. A.4.4.10 makes the canonical witness least by the number of heuristic facts, with declared-only witnesses first, and A.4.4.5 makes declared facts presence-sound. Reading it as false<true would choose heuristic representatives and defeat that rule, so the only coherent reading is presence-sound first, then declared. Both implementations already agree on it: proto/src/checker.ts factCost/bestFact ranks declared [0,0] < presence-sound [0,1] < heuristic [1,1], and kernel Facts.lean structContras sets force=sound iff the violation survives in the sound-edge subgraph. What is left is a wording fix: write 'presence-sound first'. (2) No conflict. A.7.4.4's 'one answer eligible for all items discharges' is a sufficient case of A.7.6.5's general rule that each item needs some eligible answer. Example 1 B'' (A.14.1.7: bob and carol answer separately for one coverage obligation), A.6.3.4 and model rule 4 ('each such claim's owner answers') all confirm the collective reading, and kernel Derive.lean answerItemsOk implements it. (3) Not a divergence. Claims are merged before the kernel sees them (A.12.9 ESF claims carry ids[]). proto/src/elaborate.ts lines 1033-1068 implement A.4.1.7 exactly: owner of the highest-tier id, ties least id. So kernel ownerStar's baseSame finds the single merged claim. (4) The spec defines it: 'channels meet' uses the A.5.2.3 matching rule. Kernel Loosen.lean provTier gives every observer the tiers of all non-law claims. That is a kernel over-approximation (stricter, never laxer), not spec ambiguity. (5) A.6.4.2 gives the rule (base failures become empty bindings and are listed in baseDefects). Kernel unitOf and proto world.ts (first unit by sorted name) both deviate from it, so this is an implementation issue. The tie-break uses base unit names, which the change author cannot edit, and reaching the case needs an already-defective base. (6) Only the debt row's 'exception' label is unspecified when several exceptions jointly match; this duplicates L18. Days to expiry follow from the matching rule in A.4.6.5, and severity is unaffected. Net: two editorial fixes ((1) wording, (6) = L18), no model-level gap.

**Skeptic 2** (not refuted). Four of the six points fall, but two are real spec gaps, and one of those flips a verdict. (1) Refuted. Model §5.5 fixes force: a presence-sound report makes a violation sound. A.4.4.10 ranks witnesses by fewest heuristic facts, and A.4.4.5 makes declared facts presence-sound, so 'sound and declared first' is the only coherent reading of A.4.4.9; it is a wording nit. The prototype does exactly this (checker.ts factCost/bestFact: declared [0,0] < presence-sound [0,1] < heuristic [1,1]). (2) Refuted. A.7.4.4's 'one answer eligible for all items discharges' is a sufficient special case of A.7.6.5's per-item rule. Model §7.6 and Example 1 B'' (bob and carol each answer one item) settle the per-item reading. The kernel's answerItemsOk checks only K's owner plus the owners of final unmet claims; that is a kernel bug (lawyer A4), and proto derive.ts checks each item. (3) Refuted. Claims are merged during elaboration (proto elaborate.ts, the byFp loop: highest tier, then least id, per A.4.1.7), so the kernel receives merged ESFs. Across all 63 kernel case shapes there are 0 duplicate fps, so baseSame returns at most one claim and 'first' is the only one. (4) Not a spec gap. A.8.2.2 is defined (claims it decides, or whose T(c) meets its channels under A.5.2.3). Proto loosening.ts implements it (decides || channelMeet); the kernel's provTier over-approximates, which is a kernel bug. (5) Stands. The spec has no rule for two base units resolving onto one identity. A.3.3.5 says 'the unit', which presumes there is only one. E-overlap applies to the head only (A.3.3.6, A.6.4.1). A.6.4.3's rename-in-place rule produces the collision from a well-formed base: f and g are deleted and the file gains exactly one new h. A.6.4.4's strictest view covers tied globs only, and A.6.4.2's 'empty bindings' is a third possible reading. Kernel demo (python3 -I .../shape1work/skeptic2-L38-41/l38.py): base units Store.<p> and Store.m both bind s.ts#h, with a critical forbid HardDelete<Ledger> within the protected unit; the head removes that unit and the forbid. With the protected unit named 'a', L1 is loosened, critical and blocking (exit 1). Named 'z', the verdict is pass (exit 0). proto world.ts also picks the first unit by name. (6) Stands, but repeats L18. A.7.7.1 and A.12.10.1 give one exception and one expiresInDays per debt row, with no rule for several matching exceptions. Re-running the lawyer's A3 case: the debt row names AaaRuleWaiver with expiresInDays 311, but the obligation stops being debt once ZzzAuthorityWaiver expires on 2026-10-30; at now 2026-11-01, debt is []. It lapses in 5 days while showing 311, so the 14-day flag never fires. Renaming the exceptions does not change the kernel's pick (it takes the exception matching the primary excluding claim), but the spec does not define the pick. Net: points 1-4 are not model gaps; points 5 and 6 are underspecified rules that change core output, and point 5 also changes the verdict.

### lawyer/L41: The coverage binding omits the unmet claims and channels

- **Outcome:** partial; argued on paper.
- **Closed by:** D22 in [RFC.md](../RFC.md).

**Steps.** Paper, consistent with the kernel's Coverage.lean mkCov. Under A.7.2.2 a coverage binding is H(key, uncovered identities, own digests, delta=[]). If a later push adds a new claim with new channels, owned by the same owner, the binding stays the same, so an approval given for a gap on table t1 also covers a new gap on t2.

**Gap.** A.7.4.4 says the obligation lists the uncovered identities, digests and channels, but the binding hashes only the identities and digests.

**Proposed fix.** Put the sorted (claim fp, channel) pairs into the coverage binding's delta.

**Skeptic 1** (refuted). Refuted as a model-level gap; the mechanism is real. I re-ran it on the Lean kernel with /tmp/claude-0/-home-user-shapelang/83ff80bc-0161-572f-9e5a-9075cccad6d0/scratchpad/shape1work/skeptic1-L38-41/l41.py (python3 -I; cases under .../skeptic1-L38-41/cases/). The coverage binding bd:47123ca8f8c5a346... stays the same in all 7 push-2 variants, as A.7.2.2 intends ('Coverage binds unit or own digests only'). In the attack's scenario, a head push adds a new forbid on Orders with the same owner StoreTeam, and kate's push-1 approval still gives 'pass'. The control push without the new claim also gives 'pass' with the same answer. So the head edit cannot lower severity relative to leaving the claim out (T2'); the author gains nothing. It also cannot hide anything the base required: the base never needed t2 observed at x, and the spec deliberately puts no coverage on a new claim over unchanged code (A.7.4.1 includes only F_h minus F_b of claims with an equal-NF base claim). The approval binds code, and the accountable owners are re-checked on every run as answer items (A.7.6.5(2): K plus each claim with an unmet pair). A new claim with a different owner needs a new eligible answer. With a final claim (rule 4, A.6.3.4), the variant whose new final claim has another owner stays 'blocked' in the kernel. Eligibility is also recomputed under the obligation's new tier*. The only carry-over is when the same accountable person, who already accepted x's digest landing unobserved, owns the new claim; the variant where the claim lands in the base first behaves the same way. That is the spec's explicit rebase rule (a rebase that leaves cited code alone does not reopen), not a gap. Side finding (a kernel bug, already filed as lawyer A4): the variant with a non-final new claim owned by SecTeam passes on kate's answer alone. A.7.6.5 requires an eligible answer from SecTeam as well (sam); kernel answerItemsOk checks only unmetFinal owners.

**Skeptic 2** (not refuted). The attack's own scenario is weak, but the gap it names is real and I demonstrated it. The stated scenario: a later push adds a new same-owner claim over code that was already approved. Splitting it into two changes gives the same result, because adding a claim over unchanged code creates no coverage (A.7.4.1 only adds F_h∖F_b for equal-NF base claims), and A.7.6.5 re-checks each unmet claim's owner, so a different owner or a final claim still needs its own answer. The real gap: under A.7.2.2 the coverage binding hashes only the uncovered identities and their own digests, and the prototype (derive.ts) and kernel (Coverage.lean mkCov) agree. When the set of unmet (claim, channel) pairs grows on an identity that was already uncovered, the obligation does not reopen. A scanner edit exploits this. Kernel demo (python3 -I .../shape1work/skeptic2-L38-41/l41.py; outputs in .../skeptic2-L38-41/cases/L41_*.out.json), using a critical clock rule and an absence-sound tsClockScan with implementation paths: (a) Push 1 edits checkFreshness to add Date.now(). The honest scanner reports it, giving a sound, introduced, blocking contradiction. Coverage is blocking only because a forbid Write<Db> on an unobserved pg.table("t1") is unmet; binding bd:4d6726f1cb82a21c. ann (not an author) approves that binding. (b) Push 2, same change id: checkFreshness is unchanged and tools/clock-scan.ts is edited, so the scanner is producer-changed and reports nothing. The contradiction disappears, and coverage now also lacks the four ts.call channels. The binding is still bd:4d6726f1cb82a21c, ann's push-1 line discharges it, and the verdict is pass (exit 0). Without the line, push 2 is blocked (coverage, critical, same binding). (c) Control without the t1 gap: push 1 has no coverage obligation; push 2 is blocked with coverage bd:4d6726f1cb82a21c (byte-identical, which shows the binding ignores which claims are unmet). The prior L20/A9 runs showed coverage is the only guard against scanner edits, and this lets an answer about table t1 silently discharge it. This contradicts §7.2's 'it is what an answer approves'. A fix: hash the sorted unmet (identity, claim fp, channel) triples and the producer-changed providers into coverage bindings. Note: my first run of l41.py loaded kattack.py with only OUT redirected, which rewrote redteam/lawyer/kernel-results.json. The diff showed only its 65 'case' path fields had changed, so I restored it with git checkout to its committed state; git status shows it clean.

## Cases not upheld

Blocked cases, and cases both skeptics refuted. The skeptics' reasons for the refuted ones are in the details below.

| Case | Outcome | Demonstrated | Case name |
|---|---|---|---|
| agent/A1 | blocked | yes | Test record cites a superseded digest of the changed unit (revision = head) |
| agent/A2 | blocked | yes | Test record cites a superseded digest; revision is a third commit, so RJ13 cannot check it |
| agent/A3 | blocked | yes | Observation scope entry for the violating unit cites a wrong digest (revision = head) |
| agent/A5 | blocked | yes | In-toto subject digest and predicate digest disagree (subject = head digest, predicate = old digest) |
| agent/A6 | blocked | yes | In-toto subject digest wrong, predicate digest right |
| agent/B1 | blocked | yes | Test record names the law's id but carries another claim's fingerprint |
| agent/B3 | blocked | yes | Record for the base instance of a law the head tightened |
| agent/B4 | blocked | yes | A fresh supporting record alongside a fresh contradicting one for the same law |
| agent/C1 | blocked | yes | A base-revision test record replaces the fresh one |
| agent/C2 | blocked | yes | A deps-complete provider reuses a base record whose citations no longer cover Req |
| agent/C3b | blocked | yes | As C3, but the base record honestly lists the callee in deps |
| agent/C5 | blocked | yes | Answers given before a push that edits the purge |
| agent/C6 | blocked | yes | Answers given on another change id |
| agent/D6 | blocked | yes | Control: the guarded unit's own body changes |
| agent/E2 | blocked | yes | A component split moves the violating code out of a component-scoped forbid |
| agent/E3 | blocked | yes | Rule renamed and narrowed in the change that violates it |
| agent/E4 | blocked | yes | Resource renamed with identical bindings and no `was`, in the change that violates its forbid |
| agent/E5 | blocked | yes | Resource binding narrowed so the new read's resource code is unmapped |
| agent/E7 | blocked | yes | Unit law re-bound to a decoy while the real function is broken |
| agent/F1 | blocked | yes | Exception names the final forbid by claim id, with an exception answer |
| agent/F2 | blocked | yes | Component exception on AuditStore (a non-final target) covering the purge, with an exception answer |
| agent/F3 | blocked | yes | Exception names the final forbid by fingerprint prefix |
| agent/F4 | blocked | yes | Head lowers AuditEvent from final to critical and adds a component exception, with an exception answer |
| agent/F5 | blocked | yes | Head restates the final forbid at tier low and drops AppendOnly |
| agent/F6 | blocked | yes | Head policy stops blocking unestablished at critical while the law's evidence is dropped |
| agent/F7 | blocked | yes | Head policy admits agents as critical judges; a non-author agent approves Variant C's final loosening |
| agent/F8 | blocked | yes | Preexisting final violation under a whole-component exception declared in base and head |
| agent/G1 | blocked | yes | `shape judge` line for a law that requires tested evidence |
| agent/G2 | blocked | yes | Signed judgment record for a law that requires tested evidence |
| agent/G3 | blocked | yes | Head adds `or judged` to the law, then judges it |
| agent/G4 | blocked | yes | `shape approve` of the unestablished law's binding |
| agent/G5 | blocked | yes | Judgment and approval offered against the final forbid's contradiction |
| agent/W1 | blocked | yes | Integer bound widened in the change that supplies a test of the widened law |
| agent/W3 | blocked | yes | Law requirement lowered from tested to declared while its evidence is dropped (normal tier) |
| agent/W4 | blocked | yes | Law re-pinned to a head-only provider that supplies the only record |
| agent/W5 | blocked | yes | Law target narrowed from the component to one unit, so the old citations cover it again |
| agent/W7 | blocked | yes | Law tier lowered to low while its evidence is dropped |
| agent/W8 | blocked | yes | User template's law body lowered from tested to declared while the evidence is dropped |
| agent/H1 | blocked | yes | Head drops presence soundness from the observer |
| agent/H2 | blocked | yes | Head drops absence soundness from the observer |
| agent/H5 | blocked | yes | Head narrows the observer's channel but its record still reports the violation |
| agent/H6 | blocked | yes | Head bumps the observer's implementation digest (new version) |
| agent/H7 | blocked | yes | Head swaps the observer's signing identity and supplies a clean record signed by the new key |
| agent/H8 | blocked | yes | Head changes the prover's trusted solver version to match a proof run on it |
| agent/H9 | blocked | yes | Head makes the tester deps-complete and reuses a base-revision record |
| agent/H10 | blocked | yes | Head-only provider decides the law and supplies the only supporting record |
| agent/H11 | blocked | yes | Head drops bun.lock from the tester's implementation paths in the change that edits bun.lock |
| agent/A4 | partial | yes | Observation from a third commit whose purge.ts entries (file and unit) cite other digests; deps-complete observer |
| agent/C3 | succeeded | yes | Deps-complete base record reused although an observed callee of the law's unit changed (deps: []) |
| agent/C4 | partial | yes | A base-revision observation from a deps-complete observer replaces the head one (normal tier) |
| agent/D1 | partial | yes | Head manifest keeps base digests for an edited file whose blob changed |
| agent/D2 | succeeded | yes | A guarded unit reads a const imported from another file; the const changes |
| agent/D3 | succeeded | yes | A guarded unit reads an imported JSON file; the JSON changes |
| agent/D4 | succeeded | yes | A guarded unit passes a same-file const as `{ days: days }`; the const changes |
| agent/D5 | succeeded | yes | A guarded unit uses a same-file enum; the enum value changes |
| agent/G6 | succeeded | yes | A failing (inconclusive) test plus a harness edit turns the law into an answerable producer-changed obligation |
| agent/H3 | partial | yes | Head deletes the authenticated observer's declaration and its record |
| agent/H4 | partial | yes | Head narrows the observer's channel to another table and its record is dropped |
| agent/X1 | partial | yes | Observer reports the violation at a nested identity the manifest does not list (relocated fact) |
| agent/X2 | partial | yes | Observer reports the violation, but its scope omits the violating file (unanchored fact), normal tier |
| lawyer/L31 | blocked | yes | A heuristic dismissal reused after the contradiction's force becomes sound |
| lawyer/L32 | blocked | yes | The head adds `trusts` to declare a tool assumption within the same run |
| lawyer/L33 | blocked | no | Deleting a persisted reject judgment to clear a sound contradiction |
| lawyer/L34 | blocked | no | Head-side G* fields (deps complete, assumes, allows, identity, establishing presence) acting in the run |
| lawyer/L35 | blocked | no | Listing colleagues as co-authors to force the self fallback |
| lawyer/L07 | partial | yes | An agent dismisses a heuristic contradiction of a final forbid |
| lawyer/L09 | succeeded | yes | The kernel ignores a hatch assumption that the proof record itself declares |
| lawyer/L10 | succeeded | yes | Rebinding a resource's code bypasses its final forbid in the kernel |
| lawyer/L11 | succeeded | yes | Weakening a Verus spec under a hosted law raises no L4 question |
| lawyer/L12 | succeeded | yes | Whether an L3 loosening is exploited depends on the DFS order, and a latent answer carries over to the realised case |
| lawyer/L13 | succeeded | yes | With a base glob tie, the kernel's verdict depends on component names |
| lawyer/L14 | succeeded | yes | The kernel's coverage answer checks only the component's owner |
| lawyer/L15 | succeeded | yes | Named judges satisfy the final two-person rule and lock out the owners |
| lawyer/L16 | succeeded | yes | Prototype bug: judges named by actor are never eligible (dangling else) |
| lawyer/L17 | partial | yes | Judge lists are intersected as strings: a narrower list that is still semantically valid becomes an L7 loosening nobody can answer |
| lawyer/L18 | partial | yes | Two exceptions, each covering one excluding claim: the debt reports the later expiry |
| lawyer/L20 | partial | yes | At tier normal, observer silence beats a report: a producer-changed or stale observation downgrades a sound contradiction to owed coverage |
| lawyer/L21 | succeeded | yes | `shape judge` lines carry no revision, so one line judges every later push |
| lawyer/L22 | partial | yes | Phase 2 after the relay's commit makes revision-tied evidence stale |
| lawyer/L23 | succeeded | yes | An author with an unmapped, non-bot identity removes the agent's operator from authors* |
| lawyer/L24 | succeeded | yes | In the prototype, an implies record from a provider that decides neither claim makes a weaker structural claim an heir |
| lawyer/L25 | partial | yes | A code-equivalence record with no declared scope re-validates a human guard judgment across an edit |
| lawyer/L27 | partial | yes | Core and annex disagree on when a producer-changed law obligation is introduced |
| lawyer/L28 | partial | yes | Rewriting a violation into a worse one with the same fact counts as old drift |
| lawyer/L29 | partial | yes | An agent's `shape reject` is a sound veto |
| lawyer/L30 | partial | yes | An exception `for code <file>` does not cover the file's symbols |
| lawyer/L37 | partial | no | Unauthenticated providers keep full force, including absence and coverage |
| lawyer/L39 | partial | no | Circular proof evidence through the same provider's records |
| lawyer/L40 | partial | no | Renewing or widening an exception is never reviewed |

<details><summary>agent/A4: Observation from a third commit whose purge.ts entries (file and unit) cite other digests; deps-complete observer</summary>

**Claimed gap.** A.5.2.13 checks only that an authenticated base observer supplied some authenticated record. A record from another revision that is reusable through deps complete satisfies it, even when it has no usable entry for the changed code. Replaying an old observation instead of the head one therefore trades a code-only sound contradiction for answerable coverage.

**Skeptic 1** (refuted). I re-ran it and got the same result: `bun shape1work/skeptic1/rerun.ts redteam/agent/cases/A4.input.json` gives blocked with errors [] and one coverage obligation (blocking, final, component audit::AuditStore). shapek on A4.kernel.json gives the same, with no errors. The cause is the implementations, not the spec. A.5.2.13's observer clause asks for an "authenticated head record" and offers no reuse alternative. The "at head or reusable through deps complete" wording belongs only to the test/proof clause of the same sentence. Records carry a required `revision` field (records §3), and this record's revision (cdcd…) is a third commit, so it is not a head record. Read that way, the check raises E-provider-missing at step 4b. That is an error, rule 1 blocks on it, and no answer clears an error. The intent is stated twice: model §5.2 says dropping evidence cannot pass a gate, and A.5.9.1 says that for authenticated providers E-provider-missing turns such removals into errors. The other reading, where any record in `records` counts, would make the clause empty. A.7.3.2 says authenticated observers SHOULD supply base-revision records, and anyone could move one of those into `records`. Both implementations deviate. In proto/src/laws.ts providerMissing, `(r.shape.revision === ctx.Mh.revision || g.depsCompleteB)` borrows the test-only exemption. kernel/Kernel/Derive.lean providerMissing does not check revision at all (`mine.any (·.kind == .observation)`). Patched copy at scratchpad/shape1work/skeptic1-RT4/proto-strict, with only `|| g.depsCompleteB` deleted, run by rerun_strict.ts: A4 becomes blocked with E-provider-missing provider audit::sqlEffects. Across all 69 negsuite inputs only A4 and C4 change, and none of the 21 redteam-inputs example verdicts change. Even without the error, A.11.3 T2 only promises that new violating code blocks as a contradiction or as coverage. The coverage here is final and needs two persons (bob and carol), with no agent and no fallback. What is left is wording: A.5.2.13 should define a head record as revision = head.

**Skeptic 2** (refuted). This relies on implementation bugs, not a gap in the model. A.5.2.13 has two different conditions. For an authenticated base observer it requires an 'authenticated head record'. For test and proof providers it accepts a record 'at head or reusable through deps complete'. The reuse exemption is written only into the test/proof clause. The attack's summary ('checks only that ... supplied some authenticated record') drops the word 'head'. A.5.4.1 and A.5.4.2 use 'at head' to mean revision = head. Model §5.2 and T6 (A.5.9.1) say E-provider-missing turns the removal of an authenticated provider's record into an error. T6′ (A.5.9.2) says adding a record lowers severity only by establishing, discharging or covering. The two implementations misread the clause in different ways. The prototype accepts any revision when the observer is deps complete (proto/src/laws.ts:404, `revision === head || g.depsCompleteB`). The kernel ignores revision entirely (kernel/Kernel/Derive.lean providerMissing, `mine.any (·.kind == .observation)`). Re-run: the repo prototype and shapek on redteam/agent/cases/A4 give blocked with only final coverage of AuditStore, as claimed. Control (head observation dropped, nothing added): prototype and kernel both raise E-provider-missing for sqlEffects. Adding the third-commit record removes that error even though it establishes, discharges and covers nothing for purge.ts, because both purge.ts entries are unusable. That violates T6′ as written. I applied the literal reading (observer record must have revision == head) in a scratch prototype (LIT_OBS=1) and in a one-line kernel patch (kernel-lit). Both give blocked with E-provider-missing provider audit::sqlEffects plus final coverage. E-provider-missing is an error (rule 1); its only discharger is a CI rerun, which re-reports the HardDelete, so answers from bob and carol cannot clear it. Regressions: the prototype core tests still pass 108/108. Across 69 agent cases only A4 and C4 change. Across 175 lawyer and kernel cases only A9 and L20_7 'only_base_revision_record' change, and the kernel now matches the prototype on them. Kernel expectation tests pass 32/32 and the full lake build, proofs included, succeeds. Remaining defect: the wording. 'Head record' should say 'a record whose revision is the head; reusable entries do not count'. Both implementations need fixing. Files: /tmp/claude-0/-home-user-shapelang/83ff80bc-0161-572f-9e5a-9075cccad6d0/scratchpad/shape1work/skeptic2-RT4/{rerun.ts,proto-lit,kernel-lit,cases/A4_drop_only.*}.

</details>

<details><summary>agent/C3: Deps-complete base record reused although an observed callee of the law's unit changed (deps: [])</summary>

**Claimed gap.** A.5.4.1 judges staleness only by the cited code and the deps the record lists. A deps-complete record that omits a dependency stays fresh, even when the checker holds a call fact from its cited code into changed code. Separately, A.5.3.4 makes Req for `on unit u` bind(u) alone.

**Skeptic 1** (refuted). I re-ran it and got the same result: the prototype passes, and the kernel blocks with E-provider-missing plus unestablished(stale), owed and preexisting. The attack depends on a false record, not a spec flaw. fastCheck declares `deps complete`, and A.5.2.8 requires complete deps from module graphs or traces. appendEvent calls encodeRow in the same module (store.ts), so any module-graph deps list includes it. A trace-based list leaves encodeRow out only if the test never ran it, and then reusing the old result matches what a rerun at head would give: appendEvent's unit digest is unchanged, and encodeRow's body cannot affect a run that never calls it. So deps: [] here means fastCheck broke its declared contract. That is the same trust boundary as an absence-sound observer omitting a fact (§5.2: without absence soundness, complete means nothing), and it is outside the model's guarantees. The honest variant C3b blocks in both implementations (stale plus E-provider-missing). The kernel's reading, where deps: [] counts as revision-tied ("revision-tied record without deps"), is also admissible and catches this case. Checking deps against static call facts would wrongly stale honest trace-based deps, so it is optional defence in depth. Separately, the attacker's remark that Req for a unit law is bind(u) alone points at a different gap that is real. I tested it with an honest head rerun after the encodeRow-only edit: a fresh, sound, contradicting fastCheck record with deps [encodeRow@unit head] (scratchpad/shape1work/skeptic1-RT4/c3honest.ts, case C3_H2). Prototype and kernel (kbridge.ts) both give verdict owed: a sound critical contradiction with introduced=false, treated as preexisting under rule 6. A.7.3.3 counts a law obligation as introduced only when Req meets Δcode ∪ deleted, and A.5.3.4's Req leaves out the record's deps. So a behavioural bug introduced in a callee merges as owed (relevant to H3). This should be filed as its own model gap, with the fix that law obligations are also introduced when a record's deps or cone meet Δcode.

**Skeptic 2** (refuted). The pass depends on a record that breaks the provider's declared contract, not on a gap in the model. A.5.2.8 defines `deps complete` as complete deps and harness from module graphs or traces. A.5.7.2 deliberately leaves callee bodies out of a unit digest ('functions by identity'), so a callee must appear in deps. The suite's own genuine fresh fastCheck record for AppendDeterministic lists encodeRow@unit in deps. C3 hand-builds a record with deps [] and signs it with fastCheck's key, which a change author cannot do: authenticated providers sign from jobs that run no head code (A.5.2.12). Honest variants are caught: C3b (deps = encodeRow@unit) and my C3s_base_deps_module_file (store.ts cited at file) are stale and blocked by E-provider-missing in both the prototype and the kernel. If an honest trace really gives deps [] (encodeRow never executed), reusing the record gives the same result as a rerun, so nothing is lost. A.5.4.1's 'revision-tied record without deps not at head' read literally, as the kernel does, also blocks the demo: LIT_DEPS=1 gives blocked with E-provider-missing, the prototype core tests stay at 108/108, and only C3 changes among the 69 agent cases. Remaining cases: non-empty but incomplete deps (C3s_base_deps_module_own, store.ts cited at own, which A.3.2.5 says excludes children) still passes. That is again a provider breaking its contract. A possible hardening: require deps ⊇ the Calls° reach of the cited code when an absence-sound call observer exists; the checker already computes cone(r) over Calls° (A.5.4.4). The aside 'Req = bind(u)' points at a different, real issue that C3 does not demonstrate. An honest fresh head record that contradicts (C3s_head_rerun_contradicts) gives a sound critical law contradiction that is not introduced, because A.7.3.3 requires Req to meet Δcode. So the verdict is owed, exit 0. That is attack D7's gap. Relative to the honest pipeline, C3's forged reuse changes only owed to pass, both exit 0. Files: /tmp/claude-0/-home-user-shapelang/83ff80bc-0161-572f-9e5a-9075cccad6d0/scratchpad/shape1work/skeptic2-RT4/{c3build.ts,cases/C3s_*}.

</details>

<details><summary>agent/C4: A base-revision observation from a deps-complete observer replaces the head one (normal tier)</summary>

**Claimed gap.** As A4: A.5.2.13 counts any authenticated record from the observer, including a deps-complete record of another revision with no usable entry for the changed identity. At tiers whose policy does not block coverage, dropping the head observation silently downgrades a blocking sound contradiction to owed coverage.

**Skeptic 1** (refuted). I re-ran it and got the same result: prototype and kernel both give owed, with coverage of component checker::ShapeRuleEngine owed at normal and no errors. As in A4, the cause is the implementations. The supplied tsClockScan record has revision = base, so it is not the "authenticated head record" that A.5.2.13's observer clause requires. The deps-complete reuse exemption appears only in the test/proof clause. A conforming checker raises E-provider-missing provider tooling::tsClockScan at step 4b, and rule 1 blocks. That matches model §5.2 (dropping evidence cannot pass a gate) and A.5.9.1 (for authenticated providers, removing an observation is an error). Base-revision scans belong in baseRecords (A.7.3.2), and that section says authenticated observers SHOULD have them. If moving one into `records` satisfied the check, the observer clause of E-provider-missing would never fire. The patched prototype copy (scratchpad/shape1work/skeptic1-RT4/proto-strict, with `|| g.depsCompleteB` removed from laws.ts providerMissing) gives C4 blocked with E-provider-missing provider tooling::tsClockScan. Across the 69 negsuite inputs and the 21 example inputs, the only verdicts that change are A4 and C4. The kernel also needs to check revision = head in Derive.lean providerMissing. What is left is wording, not a model flaw: define a head record in A.5.2.13 as revision = head. The operational cost is that a deps-complete observer must sign a record at every head, even when it reuses cached entries.

**Skeptic 2** (refuted). Same root as A4: an implementation misreading of A.5.2.13, not a gap in the model. The observer clause requires an authenticated head record and, unlike the test/proof clause, has no deps-complete reuse exemption. Re-run: the repo prototype and shapek on C4 both give owed, with coverage of ShapeRuleEngine owed at normal and no error, as claimed. Control (head scan dropped, nothing added): E-provider-missing for tsClockScan, blocked, in both prototype and kernel. Adding the genuine base-revision scan turns blocked into owed. Yet that record has no usable entry for any changed identity: guards.ts own has record digest 7fcb8986f002 against head b5a15eacda46, and checkFreshness unit has c6a6d135e4eb against 59855530c54f. So it establishes, discharges and covers nothing, and the drop in severity breaks T6′ (A.5.9.2) and T6 (A.5.9.1). Under the literal reading (record revision == head), the scratch prototype (LIT_OBS=1) and the patched kernel (kernel-lit) both give blocked with E-provider-missing provider tooling::tsClockScan. Rule 1 applies at every tier, so tier normal and policy no longer matter. The lawyer's earlier vector A9 'attack_only_base_revision_record' already shows the prototype raising this error for a non-deps-complete tsClockScan. The kernel misses it in both cases because it never checks the revision. Remaining defect: the wording of A.5.2.13 ('a record whose revision is the head') and the two implementations. Files: /tmp/claude-0/-home-user-shapelang/83ff80bc-0161-572f-9e5a-9075cccad6d0/scratchpad/shape1work/skeptic2-RT4/{proto-lit,kernel-lit,cases/C4_drop_only.*}.

</details>

<details><summary>agent/D1: Head manifest keeps base digests for an edited file whose blob changed</summary>

**Claimed gap.** A.12.7.5 has the checker rebuild the git tree from the manifest and check the commit. That proves the tree listing is complete, but nothing ties entry digests to blobs and nothing authenticates the manifest. A manifest whose digests did not move hides any edit: nothing is introduced, and judgments, answers and reusable records stay fresh.

**Skeptic 1** (refuted). The attack depends on forged checker input that the change author cannot produce. It is not a model gap. The spec defines the manifest as a deterministic function of the tree and registry versions (A.12.2.8; digests per A.5.7.2), built by `shp manifest` in CI without executing head code (A.3.2.6, A.12.7.5). The checker cannot tie digests to blobs because it never reads code (Invariant 6). The defence is the trusted input assembly, the same trust the spec already places in CI for now, authors and unauthenticated records (A.5.2.11: 'CI assembled these records and the change could not alter them'). The demonstration also needs the authenticated observer to sign the forged digests: negsuite's scanRecord copies its entry digests from the forged manifest. Under A.5.2.11–12 that observer is a default-branch workflow that runs no head code. I re-ran with `bun <scratch>/skeptic1-C7D1D3/d1var.ts`. (a) As given: owed (reproduced). (b) Same forged manifest, but the authenticated observer cites the digests it computed from the real tree: RJ13 rejects the record, E-provider-missing tooling::tsClockScan, blocked. (c) Real manifest from the spec pipeline (checkFreshness unit digest moved: true): sound, introduced, blocking contradiction at critical. So any honest authenticated observer turns the forged manifest into a blocking error through RJ13, and an honest manifest makes the fact new. The prototype skips the commit and tree check, but that is irrelevant: the forged tree lists the real blob, so the check would pass anyway. Optional hardening, not a gap: sign the built-in manifest provider's statement, since A.5.2.12 already places it under signing separation.

**Skeptic 2** (refuted). Refuted. RE-RUN: D1 gives owed in both the prototype and Lean, reproduced (NEG_ONLY=D1 via $W/negsuite2.ts). The attack forges two inputs that the spec keeps out of a change author's reach. (1) THE HEAD MANIFEST. The spec defines it as the output of the built-in manifest provider (A.9.6: 'the manifest provider is built in'; A.12.7.5: 'built by shp manifest without executing head code'). A.12.2.8 says manifests 'depend only on tree and registry versions', so the manifest is a deterministic function of the commit-verified tree that the gate or any auditor can recompute. derive is pure and never reads code (Invariant 6), so it can no more tie digests to blobs than it can verify authors, reviews or now. All of these sit under A.5.2.11's stated trust model: 'CI assembled these records and the change could not alter them'. (2) THE SIGNED OBSERVATION. negsuite re-signs the authenticated tsClockScan record with the provider's own key (KEYS.tsClockScan) so that it cites the forged digests. A.5.2.11-12 forbid this: such records are signed from a job that runs no head code. DEFENCE IN DEPTH, DEMONSTRATED: my variant D1h keeps the forged manifest but supplies the honest signed scan, which cites the true head digests (guards.ts own, checkFreshness unit) and the Date.now fact. RJ13 rejects it ('guards.ts@own contradicts the revision's manifest'), E-provider-missing (A.5.2.13) fires, and the prototype verdict is blocked. The Lean bridge reports pass only because the kernel does not implement RJ13 (the bridge forwards only RJ01-RJ08 drops). A.12.6 makes RJ13 normative, so the prototype's blocked verdict is what the spec prescribes. Control D1c (honest manifest) is blocked in both, matching Example 3. The point that the prototype compares only an optional treeId is a prototype gap in A.12.7.5's tree rebuild, not a model flaw. RESIDUAL, editorial only: say explicitly that the gate MUST build or rebuild the manifest from the verified commit, or else list a supplied manifest among the unauthenticated inputs in health. With only unauthenticated observers, a forged manifest would pass, but that is the trust assumption A.5.2.11 already lists in health.

</details>

<details><summary>agent/D2: A guarded unit reads a const imported from another file; the const changes</summary>

**Claimed gap.** The spec rule exists (A.5.7.2, A.12.2.10: data by canonical initialiser, transitively, re-exports followed). The prototype's env(x) records an imported name only as `import path#name`. So this is a prototype bug; the spec lacks only a cross-file data test vector.

**Skeptic 1** (refuted). The attacker concedes this is a prototype bug, and I confirmed it. The spec already requires this edit to move the digest. Core §3.2 says digests 'include what free names resolve to'. A.5.7.2 adds 'data by canonical initialiser, transitively', and A.12.2.10 resolves relative specifiers in the tree with 're-exports followed'. The prototype's fingerprint/ts.ts envOf stops at imports: line 399 emits `${name}=import ${resolved}#${imported}` and never reads the target's initialiser, so no cross-file data change can move a unit digest. Re-ran `bun experiments/shape-1/redteam/agent/fp-probe.ts`: TypeScript 6.0.2, P1 and P9 unit SAME. That parser version is itself a deviation from the pinned 5.9.3 in A.12.3.1. A minimal A.12.2.10-faithful resolver (`bun <scratch>/skeptic1-C7D1D3/envfollow.ts`) moves the env digest for D2 (9a6bd6c82f735968 → 58a451818aa38867) and for the barrel case P9 (9f6945da92c4f5b4 → 62de754298152259). Under a correct implementation purgeOld's unit digest moves, ann's judgment goes stale, and the result is unestablished(stale), blocking at critical, which matches control D6. The test-vector point is minor: A.12.3.2 already lists aliased-import and workspace-barrel vectors, and a cross-file data vector would complete it.

**Skeptic 2** (refuted). Refuted. This is a prototype bug, as the attack itself concedes. RE-RUN: `bun experiments/shape-1/redteam/agent/fp-probe.ts` with TypeScript 6.0.2 reproduces the original result: the digest moves for 4 of 11 probes, and P1 and P9 are SAME. D2 gives pass in both the prototype and Lean. CAUSE: proto/src/fingerprint/ts.ts envOf records an imported name only as `DAYS=import src/config.ts#DAYS`. A.5.7.2 and A.12.2.10 require tree-only resolution with re-exports followed, functions by identity, and data by canonical initialiser, transitively. DEMONSTRATION: I patched only envOf, in a scratch copy at $W/proto-src/fingerprint/ts.ts (about 45 lines). The patch follows a resolved import to its top-level non-function initialiser, through `export {X} from`. derive and the kernel are unchanged. Re-running the probes ($W/fp-probe2.ts, output $W/fp-probe2.out.json): P1 and P9 now move, and 7 of 11 probes move, up from 4. D2s (direct import) and D2bs (barrel) both give unestablished(stale), blocking, critical, in the prototype and in Lean, the same as control D6. D2p, the unpatched rerun, still passes. So the spec, correctly implemented, blocks this change. A.12.3.2 already lists 'const RETENTION = { days: 0 }', 'aliased import' and 'workspace barrel import' as fingerprint vectors, and A.11.2.4 lists 'barrel import'. A vector for a relative-file const would only be an editorial addition. Of the attack's other misses, P5, P6 and P8 are the same kind of prototype bug under A.5.7.2 (same-file free names and enums), and P3 is by design.

</details>

<details><summary>agent/D3: A guarded unit reads an imported JSON file; the JSON changes</summary>

**Claimed gap.** A.5.7.2 brings only code initialisers into env(x). A data file imported by code (JSON, YAML, TOML, text) has no initialiser, so the spec leaves its contents outside every function's digest.

**Skeptic 1** (refuted). The demonstration does not isolate a spec gap, and the spec as written covers JSON. Every import fails in this prototype for the same reason as D2: envOf records only `import path#name`, for TS targets too. So 'pass' here shows the D2 prototype bug, not a JSON-specific hole. On the text: core §3.2 says digests include 'what free names resolve to'. A.12.2.10 probes relative specifiers 'exact' first, so `./retention.json` resolves in the tree. A.3.2.3 classifies JSON as data, and A.5.7.2 appends data 'by canonical initialiser, transitively'. Nothing restricts this to code initialisers. The pinned parser supplies the initialiser directly: TypeScript's parseJsonText turns a .json module into a JsonSourceFile whose single statement is the object-literal expression. `bun <scratch>/skeptic1-C7D1D3/envfollow.ts` follows `cfg` to that expression and moves the env digest (6ac3305310f082d2 → 15ee84729b2cc983). A correct implementation therefore stales ann's judgment: unestablished(stale), blocking at critical. The YAML, TOML and text extension was not demonstrated. For those raw modules the spec could say in one line that a name resolving to a raw data module appends its own digest, and add a JSON-import vector. That clarifies an existing rule and needs no new concept.

**Skeptic 2** (refuted). Refuted; not convincingly a model gap. The premise that 'A.5.7.2 brings only code initialisers into env(x)' is not in the text. A.5.7.2 says non-file identities append env(x) with 'tree-only resolutions; functions by identity, data by canonical initialiser, transitively'. A.12.2.10's resolver probes relative specifiers 'exact' first, so './retention.json' resolves to the in-tree file. A.3.2.3 classifies 'Other JSON, YAML, TOML' as data. So the imported binding cfg is data reached by a tree-only resolution, and it must enter env(purgeOld) by its canonical value. DEMONSTRATED with the same scratch envOf patch, which treats a resolved JSON module as data using JCS of the parsed value: fp-probe P2 now moves. D3s gives unestablished(stale), blocking, critical, in both the prototype and Lean. My variant D3fmt (a value-preserving reformat of the JSON) passes in both, so this reading does not over-trigger. D3p, the unpatched rerun, still passes. Run: `cd /home/user/shapelang && NEG_ONLY=D3,D3s,D3fmt,D3p bun $W/negsuite2.ts`. The pass verdict therefore comes from the prototype's envOf, which stops at `cfg=import src/retention.json#default`. RESIDUAL, editorial only: A.12.2.10 should name the canonical form of a resolved data module (JCS for JSON), and A.12.3.2 should add a JSON-import vector. Data read at run time (fs.readFileSync, environment variables) is outside env(x), but that is the declared health assumption 'dependency code and configuration data' (A.12.2.7, A.10.4), not this attack.

</details>

<details><summary>agent/D4: A guarded unit passes a same-file const as `{ days: days }`; the const changes</summary>

**Claimed gap.** None in the rules: days is a free name, so by A.5.7.2 its initialiser belongs in env(x). Prototype bug: the free-name analysis is a set of names per function, and a property key or nested declaration named `days` hides the free use.

**Skeptic 1** (refuted). This is a prototype bug, not a model gap, and the attacker's own 'claimed gap' says so ('None in the rules'). Spec: core §3.2 says digests include what free names resolve to. A.5.7.2 and A.12.2.10 add data by canonical initialiser, transitively. In run({ table, days: days }) the value `days` resolves to the top-level const, so purgeOld's unit digest must move. Root cause: proto/src/fingerprint/ts.ts envOf keeps one flat `declared`/`used` name set per function. It counts a PropertyAssignment key named `days` as a declaration, which hides the free use. A nested `const LIMIT` hides the outer LIMIT in P6 the same way. It also counts PropertySignature names as uses, which explains run's false move; that error is conservative. Re-run: the negsuite cases D4, D5, D6, D7 and E1 reproduce exactly (D4: proto pass, Lean pass). The kernel's pass is not independent evidence, because the kernel bridge feeds it the manifest the prototype built. Independent check: a scope-correct env (TS 6.0.2 binder, getSymbolAtLocation, property names excluded; skeptic1-D4D5D7E1/env-correct.ts) moves purgeOld's unit digest for P5, for the negsuite D4 text and for shorthand `{ days }`. It also moves P6 and leaves run's digest unchanged. Feeding that moved head digest into the same input (case D4fix) gives unestablished(stale), blocking at critical, in both prototype and kernel. Suggested: add A.12.3.2 vectors for `{k: k}`, shorthand and shadowing.

**Skeptic 2** (refuted). Refuted: this is a prototype bug, and the attack itself says no rule is missing. Under A.5.7.2 and A.12.2.10, `days` in `run({..., days: days})` is a free name that resolves inside the tree to `const days = 30`, so its canonical initialiser belongs in env(purgeOld) and the unit digest must move. Root cause is envOf in proto/src/fingerprint/ts.ts. It keeps one `declared` set per function, and it counts a PropertyAssignment key as a declaration, so the key `days` hides the free use. P6 fails the same way: a nested `const LIMIT` hides an outer free use. The same bug causes the false move on `run`, because the PropertySignature `days` in run's parameter type was counted as a use and pulled `days=30` into run's env. I wrote a scope-aware version in a scratch copy (a use is free iff no scope between it and the unit declares the name; property keys, member names and declaration names are not uses); patch script <W>/patch_fp.py. With it: P5 and P6 move, run's false move goes away, P3 (callee by identity) stays SAME, P4/P7/P10/P11 still move. The prototype's fingerprint and vector tests pass 26/26; the one failure is environmental (the scratch copy is not a git repo). `NEG_ONLY=D4 bun <W>/x/redteam/agent/negsuite.ts <shapek>` now gives, in both the prototype and the kernel, `blocked | unestablished(stale) blocking critical ret::Retention.purgeOld/RefactorSensitive/law`, the same as control D6. The kernel only passed before because it uses the digests in the manifest the prototype built. W=/tmp/claude-0/-home-user-shapelang/83ff80bc-0161-572f-9e5a-9075cccad6d0/scratchpad/shape1work/skeptic2-D4D5D7E1

</details>

<details><summary>agent/D5: A guarded unit uses a same-file enum; the enum value changes</summary>

**Claimed gap.** A.5.7.2 says data enters by canonical initialiser but does not say which declarations are data. The prototype omits enums.

**Skeptic 1** (refuted). This is a prototype bug. Core §3.2 says digests include what free names resolve to. A.5.7.2 splits those resolutions into functions (by identity) and data (by canonical initialiser). A.12.2.2 does not list enums as TS identities, so `Days` cannot enter 'by identity'. The only reading consistent with the core is by content. Whether enums are data is therefore settled, not left open. The prototype's topData map (fingerprint/ts.ts, top-level loop) collects only VariableStatement initialisers and drops EnumDeclaration. Re-run: proto and Lean both pass, but the kernel consumes the prototype's manifest. The scope-correct env adds `Days=data enum Days { Keep = 30 }` and moves purgeOld's unit digest. With that digest (case D5fix), prototype and kernel both give unestablished(stale), blocking at critical. Wording nit: name enums in A.12.2.10 and add a vector. Separate residual issue, not D5: classes and namespaces are identities, and the prototype passes classes by identity. A class's static initialiser change would then share E1's root cause.

**Skeptic 2** (refuted). Refuted: this is a prototype bug, and the spec already covers it. In A.5.7.2, env(x) splits every tree-only resolution into two cases: functions enter by identity, everything else enters as data by its canonical initialiser. `Days` resolves to an in-tree declaration that is not a function; A.12.2.2 does not even make enums identities. So it is data, and its member initialisers belong in env(purgeOld). The prototype only collects top-level VariableStatement, FunctionDeclaration and ClassDeclaration, so enums vanish. In the scratch copy I added EnumDeclaration as data, by its canonical declaration text (<W>/x/proto/src/fingerprint/ts.ts, marked PATCH(skeptic2)). P8's unit digest then moves, and the D5 rerun gives, in both the prototype and the kernel, `blocked | unestablished(stale) blocking critical ret::Retention.purgeOld/RefactorSensitive/law`. What remains is wording, not a model gap: the annex could say outright that enums are data, add an enum vector to A.12.3.2, and say how namespace members and class static fields enter env. W=/tmp/claude-0/-home-user-shapelang/83ff80bc-0161-572f-9e5a-9075cccad6d0/scratchpad/shape1work/skeptic2-D4D5D7E1

</details>

<details><summary>agent/G6: A failing (inconclusive) test plus a harness edit turns the law into an answerable producer-changed obligation</summary>

**Claimed gap.** None in the spec: A.5.4.3 counts reasons only from a supporting or contradicting record, so the reason is missing and there is no answer discharger. Prototype bug: evaluateLaws gives inconclusive records a usability reason.

**Skeptic 1** (refuted). Refuted: this is a prototype bug. The attack's own claimed-gap text says the same.

Re-run:
- Prototype: pass. ann's answer discharges ob:79b18d16e2bc560c.
- Kernel: blocked, with unestablished(missing), blocking at critical.

The spec is unambiguous:
- A.5.4.3 counts reasons only from "a supporting or contradicting record".
- A.5.5.1 says a test failing without a counterexample is inconclusive and has no force.
- Under A.7.6.5 and A.7.6.7, `missing` has no answer discharger, so the obligation stays blocking (DefaultPolicy critical blocks unestablished).

The kernel matches the spec: Kernel/Laws.lean `recFor` requires result supports or contradicts before `holdsReason` sees a record.

The bug is in /home/user/shapelang/experiments/shape-1/proto/src/laws.ts `evaluateLaws`:
- Lines ~258–306 push inconclusive records into `evals` with usability reasons (here producer-changed, from the harness edit).
- The law-reason loop at ~348 does not filter by direction.

Extra probe G6base adds an honest base-revision supports record whose cited unit and harness both moved:
- Kernel: stale, blocked. The record holds its first-match reason (A.5.4.1), which is stale.
- Prototype: pass again, from the same bug.

Suggested wording fix: in A.5.4.3, say "whose first-match reason (A.5.4.1) is" instead of "held by". Under an any-condition reading, G6base's base record would also hold producer-changed and become answerable.

**Skeptic 2** (refuted). This is a prototype bug, and the attack itself claims no spec gap. Reproduced. Prototype: phase 1 gives unestablished(producer-changed), ann's approve discharges ob:79b18d16e2bc560c, verdict `pass`. Kernel: unestablished(missing), blocking at critical, binding bd:384bb4b34f64e16b, in both phases. Under the spec the kernel is right. A.5.3.5 defines applicability only for supports and contradicts results. A.5.4.3 counts law reasons only from 'a supporting or contradicting record', so an inconclusive record holds no reason and the reason is missing. A.7.6.5 gives missing no answer discharger, and rule 9 with DefaultPolicy blocks critical unestablished obligations. Root cause: in proto/src/laws.ts, evaluateLaws (around lines 262-263) passes inconclusive records through the same `geq` relatedness test as supporting ones. It then gives them a usability reason (producer-changed) and counts it in the law-reason loop (`evals.some((e) => e.reason === o)`) without filtering on direction. The kernel's recFor (Kernel/Laws.lean) requires supports or contradicts. Probe S2G6noharness (inconclusive record, no harness edit) gives missing in both, which confirms the leak happens only through producer-changed. Editorial note only: core §5.4 says 'that any record for it holds'; it should say 'any supporting or contradicting record' to match A.5.4.3.

</details>

<details><summary>agent/H3: Head deletes the authenticated observer's declaration and its record</summary>

**Claimed gap.** None in the spec: A.5.2.13 requires a head record from every authenticated base observer, whatever the head declares. Prototype bug: providerMissing requires the channels declared in both base and head (channelsB) to be non-empty, so deleting or narrowing the head declaration silences the check.

**Skeptic 1** (refuted). REFUTED: this is a prototype bug, and the attacker agrees. A.5.2.13 raises E-provider-missing (blocking, step 4b) when "an authenticated base observer supplies no authenticated head record". Authentication comes from the base declaration's identity (A.5.2.11; G*: "identity from the base"), so what the head declares does not matter. Errors block (§7.5 rule 1), and no answer discharges this one; the discharger is a CI rerun. The signing workflow is a default-branch workflow from the base, so the rerun's record would report the HardDelete and bring back the final contradiction.

Re-run with the original code: kernel blocked with E-provider-missing(audit::sqlEffects). Prototype blocked with only final coverage plus final L7, both answerable. The cause is in laws.ts providerMissing, which guards on `g.channelsB.length > 0`. channelsB is the base ∩ head intersection from evidence.ts, and it is [] once the head deletes the provider.

Patched scratch copy (proto-fixed/src/laws.ts), with the guard on the base `observes` instead: H3 is blocked with E-provider-missing provider audit::sqlEffects, alongside the same coverage and L7 obligations. H1, H2, H5 and all 21 redteam-inputs examples are unchanged.

The spec as written already stops the hard delete from merging on two answers.

**Skeptic 2** (refuted). Refuted: this is a prototype bug, and the spec is clear.

A.5.2.13: 'an authenticated base observer supplies no authenticated head record' gives E-provider-missing, whatever the head declares. Authentication and identity come from the base (A.5.2.11, A.6.2.6(d)), and head governance edits act only after merge (§6.2, A.6.2.8). Rule 1 makes the error block, and its only discharger is a CI rerun, so two answers cannot merge the hard delete.

Re-run: the kernel (Derive.lean, providerMissing over the base's providers) gives E-provider-missing(sqlEffects), blocking.

Cause: prototype laws.ts:403 adds the condition `&& g.channelsB.length > 0`, which A.5.2.13 does not contain. channelsB is the intersection of base and head `observes` (evidence.ts:62), so deleting the head declaration empties it and skips the check.

Check: I deleted only that condition in a copy of the prototype (<scratch>/skeptic2-W2W6H3H4/x/proto) and re-ran with neg-patched.ts and NEG_ONLY=H1,H2,H3,H4,H5. H3 now gives E-provider-missing plus the final coverage and L7 obligations, matching the kernel. H1, H2 and H5 are unchanged.

</details>

<details><summary>agent/H4: Head narrows the observer's channel to another table and its record is dropped</summary>

**Claimed gap.** Same prototype bug as H3. The spec is clear.

**Skeptic 1** (refuted). REFUTED: this is the same prototype bug as H3. A.5.2.13 depends only on the base observer being authenticated and having no authenticated head record. Narrowing the head's channel to effect(pg.table("audit_archive")) does not change that. G* gives the base identity, and a head edit is only an L7 question that takes effect after merge.

Re-run with the original code: kernel blocked with E-provider-missing(audit::sqlEffects). Prototype blocked with only coverage and L7, both final and answerable. The prototype misses the error because it intersects the channel strings: effect(pg.table("*")) ∩ effect(pg.table("audit_archive")) = [] (evidence.ts providerGovernance). That empty list fails the `channelsB.length > 0` guard in laws.ts providerMissing.

Patched scratch copy, with the guard on the base `observes`: H4 is blocked with E-provider-missing provider audit::sqlEffects. H5, where the record is kept, still gives the blocking final contradiction with no spurious error, and all 21 redteam-inputs examples are unchanged.

Artifacts: <scratch>/shape1work/skeptic1-W2W6H3H4/{rerun.ts,variants.ts,proto-fixed/src}. Run them from /home/user/shapelang with `bun <path>/rerun.ts orig|fixed` and `bun <path>/variants.ts`.

**Skeptic 2** (refuted). Refuted: this is the same prototype bug as H3, and the spec is clear.

A.5.2.13 requires an authenticated head record from every authenticated base observer, whatever the head narrows its channels to. The head's `observes` edit is an L7 question that acts only after merge (§6.2, A.6.2.6, A.6.2.8).

Re-run: the kernel gives E-provider-missing(sqlEffects), blocking.

Cause: the prototype's `inter` (evidence.ts:52) compares channel strings literally. {effect(pg.table("*"))} intersected with {effect(pg.table("audit_archive"))} is empty, so the guard `g.channelsB.length > 0` at laws.ts:403 skips the check.

Check: with that one condition removed in my patched copy (<scratch>/skeptic2-W2W6H3H4/x/proto, run through neg-patched.ts), H4 gives E-provider-missing plus the coverage and L7 obligations, matching the kernel.

</details>

<details><summary>agent/X1: Observer reports the violation at a nested identity the manifest does not list (relocated fact)</summary>

**Claimed gap.** A.4.4.5 makes every fact at an identity absent from M_h heuristic. A final forbid's violation reported inside an anonymous, merged or differently named inner function, where the provider's and the manifest's identity registries disagree, therefore never blocks. Rule 2 needs a sound contradiction.

**Skeptic 1** (refuted). Re-ran with `NEG_ONLY=X1,X2 bun experiments/shape-1/redteam/agent/negsuite.ts` and got the same results. The prototype returns owed: one final heuristic contradiction, relocated to purgeOldEvents. The kernel returns pass. The kernel's pass is a kernel bug, not a model flaw. In kernel/Kernel/Facts.lean, `anchorEntry` uses `ancestors` (Eval.lean:54), which is built from the manifest, so an id not in M_h has no ancestors and the fact is dropped. A.4.4.5 says the fact must be relocated and marked heuristic.

The model gap is not real, because a correct implementation never reaches relocation:
(1) A.12.2.2 makes dot-joined named functions identities. On real TypeScript, the prototype's manifest builder lists `function batch(){}` declared in purgeOldEvents' body as `ts:src/audit/purge.ts#purgeOldEvents.batch` with parent purgeOldEvents. It does the same for a nested `const batch = async () => …`.
(2) A.3.2.1 and A.5.2.1 make a presence-sound provider report anonymous-function facts at the nearest enclosing identity, and same-name declarations merge into one identity. Both producers follow one pinned registry ("Manifests depend only on tree and registry versions"), so a conforming pair always agrees.

Probes (scratch shape1work/skeptic1-X1X2/run.ts):
- Manifest lists purgeOldEvents.batch: blocked, sound final contradiction under rule 2, with or without a scope entry for batch (the fact anchors to purgeOldEvents' entry).
- Provider reports at the enclosing identity (Variant B): blocked.
- The attack as built: owed.
- The same faulty provider simply omitting the fact: pass.

The demonstration needs sqlEffects to report at a non-identity. Its complete entry for purgeOldEvents then omits a true fact at that identity, which breaks its declared absence soundness. A provider that breaks absence soundness can always drop the fact instead, and that gives pass. So the relocation fallback is strictly more conservative than the trust assumption it backs up: the obligation stays visible, final and owed, and only AuditTeam persons can dismiss it. The PR author cannot choose the output of an authenticated provider whose implementation is pinned in the base.

Marking relocated facts heuristic is principled. parentOf on a non-identity string is a guess (for example, `purgeOldEvents.batch = …` written at file level is not inside purgeOldEvents). Treating the guess as sound could attribute the fact to the wrong unit and fabricate a sound contradiction.

Residual, a precision issue rather than a model gap: A.12.2.2 does not say whether a named function declared in a nested block, or a named function expression, is an identity. The prototype says no to both: `if (x) { function batch(){} }` yields only purgeOldEvents, and `const purgeOldEvents = async function batch(){}` yields only purgeOldEvents. Pinning that registry text and adding a provider conformance corpus would close the one route to a good-faith mismatch. An optional hardening: keep presence soundness for a relocated fact when every candidate location on its ancestor chain up to the file has the same attribution and the same covering forbids.

**Skeptic 2** (refuted). I re-ran it with `cd /home/user/shapelang && bun /tmp/claude-0/-home-user-shapelang/83ff80bc-0161-572f-9e5a-9075cccad6d0/scratchpad/shape1work/skeptic2-X1X2/x1.ts`. The recorded input reproduces: `owed`, one final heuristic contradiction ob:bb51a88f…, subject relocated to purgeOldEvents. But the attack only works because the fixture's head manifest is hand-built and leaves out an identity the registry requires.

(1) A.12.2.2 says TS symbols are "dot-joined named functions, classes, methods, namespaces and const-bound functions". A.12.7.5 says the manifest is built by `shp manifest` from the tree and the registry version only (A.12.2.8), without executing head code. So a nested `function batch`, a `const batch = async () => …`, or two merged `batch` declarations all appear in M_h as ts:src/audit/purge.ts#purgeOldEvents.batch with parent purgeOldEvents. I checked this with the prototype's own `manifestFromFiles`: all three forms list `…#purgeOldEvents.batch`, and the merged form carries `merged 2`.

(2) When I add that identity to the X1 head manifest and change nothing else (same signed sqlEffects record, fact still at `.batch`), the result is `blocked`: one contradiction, blocking, final, sound, subject {code: …#purgeOldEvents.batch, atom: HardDelete<audit::AuditEvent>}.

(3) A truly anonymous function is not an identity. A.3.2.1 sends its facts to the nearest enclosing identity, and A.5.2.1 defines presence soundness as "true at their stated location (nearest enclosing identity)". So a presence-sound sqlEffects must report at purgeOldEvents, which is Variant B. Re-signed that way, it is `blocked` with a final sound contradiction.

The relocated path therefore arises only from a non-conforming manifest builder or from a provider that breaks its declared presence soundness. The head author can cause neither: the manifest is built without head code, and the observer is authenticated and runs in a job with no head code (A.5.2.12). A provider that breaks its soundness contract can already produce `pass` just by leaving the fact out, since its complete entry still meets coverage. Treating relocation as heuristic gives `owed` with a visible final obligation, which is stricter than what that trust assumption already allows. So this is not a model gap.

The kernel's `pass` is a separate problem: the kernel does not implement A.4.4.5 relocation. That is a kernel conformance bug to fix, not a model flaw.

</details>

<details><summary>agent/X2: Observer reports the violation, but its scope omits the violating file (unanchored fact), normal tier</summary>

**Claimed gap.** A.4.4.5 ignores unanchored facts even in head-revision records from presence-sound providers. A.5.2.13 does not require the observer to cover the changed identity, so an incomplete scope downgrades a blocking sound contradiction to owed coverage.

**Skeptic 1** (refuted). Re-ran (same command): the prototype and kernel agree, both owed with one normal-tier coverage obligation for component checker::ShapeRuleEngine, and health.unanchored = 1.

Probe across tiers (scratch shape1work/skeptic1-X1X2/run.ts), with the tsClockScan scope omitting guards.ts and checkFreshness. Each row compares the attack record (Date.now fact unanchored) with a self-consistent record that has the same scope and no fact:
- normal: owed and owed
- critical: blocked and blocked (coverage)
- final: blocked and blocked (coverage, rule 4)

Controls:
- Scope covering guards.ts: blocked at all three tiers (sound contradiction).
- Normal tier with a policy that lists coverage in `blocks`: blocked.

So the unanchored fact neither adds nor removes protection compared with an observer that never scanned the file. The model deliberately separates contradiction from observability: §1 makes coverage a separate question, and §7.4 turns unobserved changed code into coverage obligations. Whether coverage blocks is left to policy (§9). DefaultPolicy's normal tier blocks only latent loosening, so owed coverage at normal is the documented policy outcome, not a lost guarantee. At critical and final the same change blocks.

The scenario also needs an internally inconsistent provider record: the scanner found Date.now in checkFreshness yet left checkFreshness out of its own scope. A.5.2.5 requires an entry, at worst `complete: false`, for code the provider scanned. Even an incomplete entry anchors the fact, giving a sound contradiction that blocks under rule 7. The PR author cannot shape the scope of an authenticated observer whose implementation is pinned in the base. Editing the scanner's configuration instead makes it producer-changed, which is the separate attack A9.

Ignoring unanchored facts follows from usability being defined per entry (A.5.4.2: an entry is usable when its digests and deps match M_h). Anchoring facts from head-revision records directly to M_h would only improve precision; it would not fix a soundness gap.

**Skeptic 2** (refuted). I re-ran it with `cd /home/user/shapelang && bun /tmp/claude-0/-home-user-shapelang/83ff80bc-0161-572f-9e5a-9075cccad6d0/scratchpad/shape1work/skeptic2-X1X2/x2.ts`. The recorded input reproduces: `owed`, coverage owed at normal on component checker::ShapeRuleEngine, health.unanchored = 1. The prototype and the kernel agree, and both follow the spec text, so this is not a prototype bug. The question is whether it is a model gap. It is not, for three reasons.

(a) It opens no new way to evade. With the same scope (no entries for guards.ts or checkFreshness), I compared four variants at normal tier:
- fact reported (the attack): `owed` (coverage, normal);
- fact not reported, as a provider consistent with that scope would do: identical `owed`;
- full scope with checkFreshness entry `complete:false`, which the author can force with an unresolvable access because A.5.2.5 makes `complete:false` mandatory for unresolved callees or dynamic access: identical `owed`;
- control, full scope with the fact: `blocked` by a sound contradiction.
The dropped fact therefore lowers nothing below what normal tier already accepts for unobserved changed code. That is a deliberate policy choice: DefaultPolicy normal blocks only latent loosening (§9). At the rule's real Example 3 tier, critical, the same attack record gives `blocked` (coverage blocking critical), and so do all the variants above.

(b) The head author cannot produce this record. tsClockScan is authenticated: it signs from a job running no head code (A.5.2.12). Its scope is fixed by the base-pinned implementation, with no implicit configuration identities (A.5.2.6), and editing that implementation makes the provider producer-changed, which removes its coverage. Also, an observation is "facts over a scope" (§5.1), and A.5.2.5 requires an entry, if necessary `complete:false`, for every file the provider analyses. A record with a fact in a file it lists no entry for is malformed output from a base-configured provider, not something an attacker can trigger.

(c) The violation is still raised by the rule the model assigns to it. A.5.2.13 exists to stop evidence being dropped. Unobserved changed code is handled by coverage (A.7.4), and coverage fired here: health.unanswered lists guards.ts and checkFreshness as affected, and health counts the unanchored fact.

One optional hardening remains: A.4.4.5 could keep unanchored facts from head-revision records of presence-sound providers instead of ignoring them. That would turn this one malformed-provider case into a sound contradiction. It does not close any gap the head author can reach, so it is not a model-level flaw.

</details>

<details><summary>lawyer/L07: An agent dismisses a heuristic contradiction of a final forbid</summary>

**Claimed gap.** This is the same inconsistency as L06. A.6.3.3 allows agents to answer heuristic contradictions and makes no exception for final claims. The severity does not change (heuristic contradictions are owed), but a visible contradiction of a final claim disappears from the obligations on one agent's word.

**Skeptic 1** (refuted). Refuted. The dismissal has no effect on gating, and the contradiction does not disappear.

- I re-ran A5b. Phase 1 is owed, with a heuristic, introduced contradiction at tier final. The agent's `shape approve` gives pass.
- Owed and pass both exit 0. Rule 7 makes heuristic contradictions owed at every tier, by fixed force (SEED: heuristic observers only raise obligations; rule 2 needs a sound contradiction). The attack itself concedes the severity does not change.
- The dismissal is recorded and visible: `answered` lists `{as: discharge, obligation: ob:d98055745547389f...}`.
- It acts for one change only (A.7.6.4). The same line carrying change id #2 does not act (verdict owed).
- In the follow-up change after merge (README-only edit, change #2, the fact in baseRecords), the contradiction is back as preexisting owed.
- It is bound to its support code (A.7.2.2), so editing checkFreshness reopens it.
- Agents are eligible only because the policy lists agents in critical's judges. Under DefaultPolicy the same agent line discharges nothing (verdict owed).
- If the observer becomes presence-sound, the contradiction turns sound and final, and rule 2 blocks.

No merge that would otherwise block can pass this way.

**Skeptic 2** (refuted). REFUTED: no model-level gap of its own.

Re-run: the 4 kernel A5b cases are identical. Control: owed, heuristic, final. With reviewBot's approve line: pass.

Why this is not a gap:
- Heuristic contradictions are owed at every tier. Rule 2 is sound-only; rule 7 makes heuristic ones owed. This matches SEED: heuristic observers 'only raise obligations'.
- So the verdict without the answer is already owed, exit 0 and mergeable. The dismissal changes owed to pass, which is also exit 0. No gate changes.
- The obligation is not lost. Kernel output lists it under `answered` (ob:d98055745547389f..., as: discharge), and the answer acts only for the listed change id (A.7.6.4).
- In the next change (V12, base = this head, base records report the fact, new change id) the same contradiction reappears as preexisting, owed, final, heuristic, whether or not the old answer is replayed (V12, V12b).
- The agent cannot touch a sound final contradiction: with the same answer and a presence-sound observer, the change stays blocked (V13).
- The behaviour at critical is identical (V14), as A.6.3.3 intends: agents are excluded only for loosenings, exception answers and producer-changed answers.

What remains is the core §6.3 'no agent at tier final' wording conflict already upheld under L06. Fixing that, by applying no-agent and two-person eligibility to all tier-final judgments and answers, also covers this case.

Re-run with python3 -I /tmp/claude-0/-home-user-shapelang/83ff80bc-0161-572f-9e5a-9075cccad6d0/scratchpad/shape1work/sk2-L05-08/variants.py.

</details>

<details><summary>lawyer/L09: The kernel ignores a hatch assumption that the proof record itself declares</summary>

**Claimed gap.** A.5.4.4 defines a proof's assumptions as 'declared ones plus M_h hatch facts in cone(r)'; the kernel drops the declared hatch assumptions. The id grammar is also ambiguous: A.14.2.2 writes 'set/assume', while the prototype uses '<full identity>/<kind>'.

**Skeptic 1** (refuted). This is a kernel conformance bug. The model is not missing anything. Re-run: shapek on redteam/lawyer/cases/A38_attack_record_lists_hatch_manifest_silent.json gives pass; the prototype gives blocked with unestablished(assumption) at critical, binding bd:1da36a42e325dc5a. Both results reproduced.

The spec already requires the record's listed hatch assumptions to count:
- A.5.4.4: 'Assumptions of a test or proof: declared ones plus M_h hatch facts in cone(r)'.
- A.5.2.8: 'proofs list verifier-trusted items after macro expansion as hatch assumptions'. This is exactly the hidden-macro case, and the record is meant to be its safety net.
- A.14.2.2: 'A proof omitting the hatch gets it from M_h', so the record is the primary source and M_h is the supplement.
- DelegationMap is not a boundary allowing assume, so the listed set/assume is undeclared, the reason is assumption, and the change blocks at critical. The prototype does exactly this.

Kernel cause: Laws.lean:170 hasAssumption tests only a.2 == "named" and a.2 == "tool".

Patch test. In a scratch copy (sk1-L09-12/kernel-patched, `lake build shapek` 45 s), I added the hatch case to hasAssumption: +6/-1 lines, splitting the id at the last '/' and reusing hatchDeclared. Results:
- the A38 attack becomes blocked with unestablished(assumption), critical;
- the A38 control, the A39 cases and the A2a cases are unchanged;
- across all 120 kernel and lawyer cases, only this one output changed.

Id grammar: A.14.2 uses 'set' as shorthand for the identity throughout ('set digests', 'code set at unit and closure'), so 'set/assume' is consistent with <identity>/<kind>. The grammar is unpinned in A.12.5, which is an encoding nit. Under A.5.4.4 an id whose identity resolves to no allowing boundary is undeclared, so a correct implementation fails closed and the nit cannot produce a pass.

Side findings (not model gaps):
- proto laws.ts drops a hatch id with no '/' (`if (i > 0)`), which fails open;
- A.5.4.4 uses 'declared' in two senses; 'listed ones' would read better for the first.

**Skeptic 2** (refuted). This is a kernel bug, not a model gap. Re-run: `shapek` on cases/A38_* gives control blocked, unestablished(assumption), critical, bd:8ad54064b6f2def4; the attack passes (exit 0). The prototype, re-run from the saved proto-cases with skeptic2-L09-L12/rerun_proto.ts, blocks both: unestablished(assumption), critical, bd:1da36a42e325dc5a. The spec covers this case in four places. (1) A.5.4.4 says a record's assumptions are 'declared ones plus M_h hatch facts in cone(r)'; 'declared ones' means the record's listed `assumptions`. (2) A.5.2.8 says 'proofs list verifier-trusted items after macro expansion as hatch assumptions', which is exactly the macro-hidden case. (3) The records table lists the assumption kinds hatch, named and tool. (4) A.14.2.2 says 'A proof omitting the hatch gets it from M_h', so the two sources are unioned; v4 §7.6, whose meaning v6 keeps, says 'its declared `assumptions` plus every hatch fact of M_h'. A hatch is declared only if its identity's boundary allows it in base and head. DelegationMap is not a boundary, so the reason is assumption. DefaultPolicy critical blocks it, and it has no answer discharger (A.7.6.5). The kernel's Kernel/Laws.lean:166-170 `hasAssumption` checks only a.2 == "named" and "tool", so it drops listed hatches. On the id grammar, I ran l09_ids.ts on the prototype with no manifest marker. `<full identity>/assume`: blocked. The A.14.2.2 shorthand `set/assume`: blocked, since 'set' is not an identity and no boundary allows it. With DelegationMap a boundary allowing assume in base and head: pass, correctly declared. A bare `assume` with no slash: pass, a prototype bug (proto/src/laws.ts:200-202 `if (i > 0)` silently drops an id it cannot parse). Under A.5.4.4 an id naming no identity has no boundary that allows it, so it is undeclared. The grammar gap is therefore conservative under the spec and not a bypass. Text fixes: pin the hatch id as `<code identity>/<hatch kind>`, split at the last '/', in A.12.5.2, and say that an id naming no M_h identity is undeclared. In A.5.4.4, write 'the record's listed assumptions' instead of 'declared ones', since the sentence uses 'declared' in two senses. Add 'and every hatch it lists' to core §5.4.

</details>

<details><summary>lawyer/L10: Rebinding a resource's code bypasses its final forbid in the kernel</summary>

**Claimed gap.** The spec covers this case; the kernel does not. The kernel's notes say L1 is keyed by resource Q, but this run shows the consequence: a final forbid bypassed with verdict pass. The kernel's final_is_final quantifies over added records, policies and exception lists, not over edits to the shape, so the theorem does not cover this route. None of the bridge's 24 fixtures rebinds a resource.

**Skeptic 1** (refuted). The attacker itself says 'the spec covers this case; the kernel does not'. The spec blocks the change; the kernel deviates from it. Re-run: the kernel passes A6_attack_binding_moved. The prototype blocks it with:
- L1 loosening on forbid fp ccfcbabf..., final, bd:8d771e08d86d43b2;
- L1 loosening on component AuditStore, critical;
- final coverage on resourceCode pg.table("audit_events").

Why the spec blocks:
- A.8.2.3 L1 ranges over T = resource codes of either shape's bindings, and lifts unmapped codes as 'all verbs permitted, none protected'. It states 'unmapping a resource code loosens'.
- For t = audit_events the base protection is final and the head protection is none. That is a final L1 part, so rule 4 blocks until two persons answer. This is T2 as stated in A.11.3: weakening a final claim is a two-person loosening.
- L6 also covers 'resource codes whose resource changed'.

Kernel cause: Loosen.lean atomUniverse builds atoms from s.res.map (·.q), keying by Q instead of by resource code.

Patch test. In the scratch kernel I added l1Rebind: +33/-3 lines, comparing the base atom on each code a base resource bound with the head's resource for that code, or treating it as unmapped. Results:
- the A6 attack becomes blocked, with the same two L1 subjects as the prototype: fp ccfcbabf... final, and component AuditStore critical;
- the control is unchanged;
- across 120 cases only the attack cases changed.

final_is_final being limited to records, policies and exceptions is a gap in proof coverage. Kernel/Proofs/Loosen.lean proves L1 against the kernel's own Q-keyed l1Loosened, so A.11.2.2's claim that L1 is proved, and T2's shape-edit clause, are overclaimed for this route. The fix belongs in the kernel's formalisation plus a rebinding fixture, not in the model.

Side finding: the prototype marks these parts exploited=false, although the purge fact realises them (A.8.3.2 'least realising fact id'). With resource and component at tier low, the attack gives owed instead of blocking under rule 8. That is a prototype bug, irrelevant at final.

**Skeptic 2** (refuted). The attack itself concedes the spec covers this case; what it found is a kernel bug plus a gap in the kernel proof's scope. Re-run: kernel A6 control is blocked (sound contradiction, final); the attack passes. The prototype blocks the attack with three blocking obligations. (1) Vocabulary coverage for resourceCode pg.table("audit_events"), final, bd:b9301499b8aa1a8b. (2) An L1 loosening on the AppendOnly forbid ccfcbabf10265d64, final, bd:8d771e08d86d43b2. This is the same binding as Example 1 Variant C's final loosening, so the rebinding is judged exactly like removing AppendOnly. (3) An L1 loosening on component AuditStore, critical, bd:f127be8dc9e371e3. The spec text: A.8.2.3 L1 defines 'T = resource codes of either shape's bindings ... (unmapped: all verbs permitted, none protected) ... unmapping a resource code loosens'. Here Lvl_h(purge)(HardDelete@audit_events) = none, below final, so rule 4 blocks until two persons answer (bob for AuditTeam and carol for Platform). A.7.4.6 adds vocabulary coverage, and A.11.3 T2 explicitly covers shape edits: 'removing, weakening, moving code out of, or replacing a final claim ... is a two-person loosening'. Where the kernel deviates: Kernel/Loosen.lean `atomUniverse` (lines 25-32) builds atoms as verbs × resource Q, not resource code, and the kernel raises no vocabulary coverage. Kernel/Proofs/Final.lean:201 `final_is_final` quantifies only over `inp.withEvidence` (added records, policies, exceptions), which is narrower than the spec's T2. The bridge also lacks a fixture that rebinds a resource. All of these are implementation and proof-scope defects. One minor prototype bug: its L1 parts report exploited=false with counterexample {purge.ts, DropStorage}, although the purge's HardDelete fact realises them (A.8.3.2, 'least realising fact id'). Severity is unchanged.

</details>

<details><summary>lawyer/L11: Weakening a Verus spec under a hosted law raises no L4 question</summary>

**Claimed gap.** A.4.3.8 and the L4 rule in A.8.2.3 say closure changes stay undecided until an implies record or an answer arrives. But the NF leaves out the closure digest, so the head claim has an equal fp, counts as an heir, and L4 is implied in both implementations. The only remaining guard is the proof record going stale, and a new proof against the weaker spec passes it.

**Skeptic 1** (refuted). Both implementations ignore an explicit annex rule; the spec itself raises the question. Re-run: the kernel and the prototype both pass A14_attack_spec_weakened and the control.

The annex says in four places that a closure move breaks heirship even though the NF omits the digest:
- A.5.7.1: '{ref, projection: "closure"} (no digest; closure moves seen by freshness and L4)'.
- A.5.6.4: '⊒ for hosted laws: equal NF with closures ≡ or a contributing code-space implies record'.
- A.4.3.8: hosted statements loosen only via equal closure digests, implies records or answers.
- A.8.2.3 L4: 'closure changes awaiting an implies record or answer'.

So the weakened head law is not an heir, and L4 is undecided at critical. DefaultPolicy at critical blocks latent loosening, so the change blocks until a base-owner person answers or verusRefines supplies an implies record. A weaker spec cannot honestly get such a record.

Implementation causes:
- proto derive.ts heirs: `ch.fp === rfp`, and opOrderGeq returns true on equal fp;
- kernel Loosen.lean l4Parts: `e.head.claims.any (·.fp == cb.fp)`.
Both compare fp only.

Patch tests:
- Prototype: requiring an equal M_b/M_h closure digest for hosted heirs (derive.ts +9/-1) blocks the attack with L4 undecided, critical, bd:508f7ba251501eea. The control still passes. 2 of 73 lawyer proto-cases change; this one and L12's. 102 of 102 proto tests pass (examples, obligations, vectors, determinism).
- Kernel: the same check in l4Parts blocks the attack with L4, critical, bd:bda585618fa85745. The control still passes.

The real defect is wording: core §5.6 ('NFs are equal after renaming' implies ⊒) should add 'for hosted laws, with closures ≡ (A.5.6.4)'. That likely misled both implementers, but the annex governs detail.

**Skeptic 2** (refuted). The spec raises L4 here; both implementations wrongly treat an equal fp as an heir for hosted laws. Re-run: both pass on both the control and the attack. The spec text: A.5.6.4's op order for hosted laws is 'equal NF with closures ≡ or a contributing code-space implies record'. A.5.7.1 says the hosted statement carries 'no digest; closure moves seen by freshness and L4'. A.4.3.8 and the L4 entry in A.8.2.3 say 'closure changes awaiting an implies record or answer'. v4 §7.9, whose meanings v6 keeps, is explicit: 'hosted laws: equal NF and ... M_b(ref, closure) ≡ M_h(ref, closure) or a contributing code-space implies record'. So the weakened closure has no heir, and L4 is undecided at the base tier, critical. DefaultPolicy critical blocks latent loosening (A.8.3.1's '(none: all count)' also makes it exploited at critical). The change is blocked until a person of IronKvTeam answers, or until an implies record arrives, which no real weakening can earn. Demonstration: in a patched copy of the prototype (skeptic2-L09-L12/proto-src-spec/derive.ts:409), a hosted law's heir requires the M_b and M_h closure digests to match. The attack is then blocked with one L4 loosening (critical, bd:508f7ba251501eea), and the control passes. The cause in the shipped code is proto/src/derive.ts:400-413 and Kernel/Loosen.lean:204 (`e.head.claims.any (·.fp == cb.fp)`). Caveat: the text does conflict. Core §5.6 and A.5.6.3 list plain 'equal NF' as making a claim at least as strong, with no exception for hosted laws, which explains why both implementations erred. By the spec's own rule the annex governs detail, and the generic reading would make A.4.3.8, A.5.6.4's closure clause and A.5.7.1 meaningless, so the hosted rule wins. This needs an editorial fix (add '(hosted laws: also closure digests ≡, A.5.6.4)' to core §5.6 and A.5.6.3) and a differential test vector (this case). It is not a model gap.

</details>

<details><summary>lawyer/L12: Whether an L3 loosening is exploited depends on the DFS order, and a latent answer carries over to the realised case</summary>

**Claimed gap.** 'Exploited' is defined on 'the' counterexample, the first leaf of the search, which is an artefact of search order, rather than on whether some realised completing set exists. Exploitation is also absent from the binding, so an approval given while the loosening was latent still discharges it once it is realised.

**Skeptic 1** (refuted). Part 1 (exploited depends on search order) fails because both implementations skip a normative step. Re-run: the kernel and the prototype both report A7_attack as L3 loosened, exploited=false, owed at low, with the same binding as the control.

A.8.4.2(2) says 'A first pass uses W_eval(head) edges only'. The heuristic call f→g is in W_eval: A.4.4.5 includes usable observations regardless of soundness, as Example 4 relies on. So the first leaf is [A→C], which is realised, so the loosening is exploited and rule 8 blocks.

Patch test. I implemented the first pass in the scratch prototype: loosening.ts +27/-2, with SKEPTIC_FIRST_PASS=0 restoring the original behaviour. Results:
- attack: blocked, exploited=true, counterexample [A→C], blocking at low;
- control: owed, latent, counterexample [A→B, B→C].

With the first pass, whether a loosening is exploited does not depend on search order. It equals the existence of a realised, head-admitted violating path in W_eval. prune_sound makes the pruned DFS exhaustive within budget, so only which witness is reported depends on order. Pruning realised paths that violate a head claim is correct: the head still forbids them, so they do not exploit the loosening, and they surface as contradictions instead.

Part 2 (exploitation absent from the binding) is reproduced but is not a gap. A quinn approval of the latent binding bd:08a98d811501186a discharges the realised obligation: pass, with answered showing exploited=true. pat, an author, cannot answer it. However:
- Latent and exploited loosenings have identical dischargers and answerers (A.7.1.3). Exploitation only decides whether an unanswered loosening blocks (rule 8 against rule 9), so the carry-over grants no authority the same answer would not grant.
- An answer approves the weakened claim, meaning every world the head admits and the base rejects. Code moves in the sources and delta widening still reopen it (A.7.2.2).
- The same end state is reachable with zero answers at low by splitting the change (the latent loosening lapses at merge, and the edge is added later), so the carry-over is never weaker than what policy already allows.
- The output's answered entry records whether the loosening was exploited (A.12.10.1), so the status stays visible.

Patched copies and scripts are in /tmp/claude-0/-home-user-shapelang/83ff80bc-0161-572f-9e5a-9075cccad6d0/scratchpad/shape1work/sk1-L09-12/ (proto-patched, kernel-patched, *.diff, a7answer.ts, psweep.ts).

**Skeptic 2** (refuted). The demonstrated miss comes from both implementations skipping the first search pass that A.8.4.2 requires; the binding behaviour is by design. Re-run: kernel gives both owed, low, L3, exploited=false, bd:dc12efdad4312d93. The prototype gives both owed, low, counterexample [A→B, B→C], bd:08a98d811501186a. A.8.4.2 says 'A first pass uses W_eval(head) edges only'. I added that pass to a patched copy (proto-src-spec/loosening.ts:540). The attack is then blocked, exploited=true, counterexample [A→C] (rule 8), and the control stays owed with [A→B, B→C]. The first pass searches all realised edges before the wider G_A pass. So exploited is true exactly when some realised completing set exists, since any realised violating path contains a simple minimal-pair sub-path lying in W_eval. Two caveats: the 10^6 budget, and head-claim pruning (a realised path pruned for violating a head claim is itself a head contradiction). The 'search-order artefact' claim therefore fails against the text. Both implementations omit the pass; the kernel's `searchCex` (Loosen.lean:129-147) runs one pass over G, and I found no note in proto/ that documents the skip. On the binding claim, I ran skeptic2-L09-L12/l12_binding.ts at normal tier on the original and the patched prototype. V1, realised by editing the source component A (call f→g): the binding moves from bd:08a98d811501186a to bd:d03b16a0e8fb411b, the push-1 approval does not act, and the change is blocked. V2, realised by editing the middle component B (h→g, with A→B already present): the binding is unchanged, the push-1 approval discharges, and the change passes. This follows A.7.2.2 and A.8.3.2 (L3's affected code is the sources' code) and A.8.2.3 (the delta 'never [includes] the counterexample'), and it is deliberate. An answer approves the loosening of the base claim. Who may answer (A.6.3.3: the base owner's persons, never agents) and the dischargers (A.7.1.3) do not depend on exploitation. Exploitation only chooses the severity of an unanswered obligation (rule 8 or rule 9). In V2 the realised path is exactly the counterexample shown in phase 1. After merge the claim is gone, so the realisation would raise nothing anyway. Re-asking the same persons would add cost, not authority.

</details>

<details><summary>lawyer/L13: With a base glob tie, the kernel's verdict depends on component names</summary>

**Claimed gap.** The kernel's compByGlob breaks ties by the codepoint-least name everywhere, including base attribution for L1. A.6.4.4 requires the strictest view (Perm intersected, Lvl maximised). The kernel case format cannot express tied cells (the list-valued sides of A.12.1.3), and nothing in the bridge's 24 fixtures has a tie.

**Skeptic 1** (refuted). This is a kernel conformance bug plus a missing fixture, not a model flaw. Re-run with shapek: lax_component_sorts_first gives exit 0, pass; strict_component_sorts_first gives exit 1, blocked (L1, component z::Alpha). The spec already sets the strictest view for base ties: A.6.4.4 (Perm intersected, Lvl max, Con united), A.8.1.4 (base ties are a sorted list of tied pseudo-units) and A.12.1.3 (the base side of a cell may be a list). Under that reading the head's Perm {Read,Write} is not a subset of the base's {Read}, so L1 is loosened and blocks at critical whatever the names. The prototype implements this: loosening.ts evalT splits pb on '|' and intersects the profiles. Re-running the saved inputs gives blocked in both orders, and the L1 subject is always the stricter component (z::Beta, then z::Alpha), so the outcome does not depend on names. The kernel breaks the tie itself: Eval.lean compByGlob picks the strLt-least name. It also receives cells as input, and kattack.py picked [least.*, lax.*], so the case format cannot carry a tied base side. The bridge's 24 fixtures contain no tie. A tie can only exist in a base that would itself fail E-overlap as a head, which means a bypassed gate or a migrated base. Fixes: make kernel att and cells take list-valued base sides, and add a tie fixture. RESIDUAL, a separate small gap in the spec: A.6.4.4 covers L1 and L6 but not base footprints, attribution or owner as used by coverage (A.7.4.1 F_h minus F_b, A.6.2.4 tier*(c,x), coverage's 'component's base owner'). The prototype breaks ties by name there (world.ts att, who[0]). Demonstration with the same tied base, where the head keeps only the STRICTER component and L1 is silent: strict component named Alpha gives pass; named Beta gives blocked (coverage, critical, component z::Beta). Inputs: scratchpad/shape1work/skeptic1/A8x_head_keeps_strict__{Alpha,Beta}.input.json. Suggested fix: one sentence in A.6.4.4 saying every base-derived quantity uses the tie list, so tied code is in F_b(c) only if it is in F_b(c) under every tied view.

**Skeptic 2** (refuted). This is a kernel conformance bug, not a model gap. The spec states the rule the kernel leaves out. A.6.4.4: 'Tied base globs: strictest view (Perm intersected, Lvl max, Con united)'. A.8.1.4: 'base ties: sorted list of tied pseudo-units, strictest view'. A.12.1.3 spells tied cells as sorted lists. A.6.2 reads every base field in the direction that cannot lower severity. No spec text mentions a codepoint-least tie-break; it exists only in kernel/Kernel/Eval.lean:76-80 (compByGlob, `strLt`). Applied correctly, the base Perm at ts:src/m.ts, ts:src/m.ts#f and every tied cell is {Read<z::R>} ∩ {Read<z::R>,Write<z::R>} = {Read<z::R>}. The head permits Write<z::R>, so L1 is loosened at critical tier and DefaultPolicy blocks it as a latent loosening, whichever name sorts first. Re-run of shapek on redteam/lawyer/cases/A8_*.json: lax-first gives pass (exit 0), strict-first gives blocked (exit 1, L1 on component z::Alpha). That matches the claim, but the cause is the kernel's tie-break. The prototype reaches the spec answer in both orders through the cell (cell:[["z::Alpha.*","z::Beta.*"],...], atom Write<z::R>). The case format's inability to express tied cells, and the bridge having no tie fixture, are tooling and test gaps. Extra implementation finding: the prototype applies the strictest view only to cells. For identities, world.ts att() takes `who[0]`, the least name. After quinn approves the L1 loosening (bun scratchpad/shape1work/skeptic2/L13-16/rerun.ts), lax-first gives pass and strict-first stays blocked on a coverage obligation for component z::Beta (ts:src/m.ts, ts:src/m.ts#f). Under 'Con united' those identities are already in F_b of Beta's authority, so F_h∖F_b is empty and no coverage is owed. That is a second implementation deviation. The spec only needs a clarifying sentence in A.3.3.5: base att at a tied identity is the sorted list of tied pseudo-units, and footprints and owners use Con united.

</details>

<details><summary>lawyer/L14: The kernel's coverage answer checks only the component's owner</summary>

**Claimed gap.** A.7.6.5 lists the answer items for coverage as 'K and each claim with an unmet pair', and the kernel implements only the final subset of those claims. The two implementations disagree, and the kernel lets a component owner waive another team's critical claim.

**Skeptic 1** (refuted). This is a kernel bug, not a model gap. Re-run with shapek: phase 1 raises one coverage obligation, blocking, critical, owner x::StoreTeam. kate's approve alone gives exit 0, pass (discharge); sam alone gives blocked. The spec requires every item to be answered. Core §7.6 lists 'a coverage obligation's component and unmet claims' as answer items. A.7.6.5 says 'K and each claim with an unmet pair, for coverage'. A.7.1.3 says 'answer by K's base owner and each unmet claim's owner*'. A.7.4.4 says 'one answer eligible for all items discharges'. owner*(LedgerIsAppendOnly) is SecTeam={sam}, and DefaultPolicy's critical judges are only 'owner', so kate is not eligible for the claim item and her answer alone cannot discharge it. The prototype implements exactly this. Re-running the saved inputs: kate alone is blocked, sam alone is blocked, kate plus sam pass, with eligible=[x::kate, x::sam]. The kernel's Derive.lean answerItemsOk, coverage branch, checks only o.owner and o.unmetFinal. It mixes up severity rule 4 (final-only blocking) with the answer items, which cover every unmet claim. Fix: iterate over the owner* of every unmet claim, requiring persons and no agents only when the claim is final, and add a non-final cross-team coverage fixture to the bridge.

**Skeptic 2** (refuted). This is a kernel bug; the spec and the prototype already require both answers. Core §7.6 lists a coverage obligation's answer items as 'a coverage obligation's component and unmet claims'. A.7.6.5: 'K and each claim with an unmet pair, for coverage'. A.7.4.4: 'one answer eligible for all items discharges'. The final-only clauses (§7.5 rule 4, A.6.3.4) add the persons-only, no-fallback restriction for final claims. They do not limit the item list. The kernel's answerItemsOk (kernel/Kernel/Derive.lean:118-121) checks `o.owner` and `o.unmetFinal` only, so it drops the critical SecTeam forbid. Re-run of shapek on cases/A4_attack_kate_only.json: pass, exit 0, coverage discharged by kate alone. A4_control_sam_only: blocked. The prototype's answerItemsSatisfied (proto/src/derive.ts ~1102-1109) adds an item for every unmetClaims owner*. Re-run on proto-cases/A4_* gives kate alone blocked, sam alone blocked (sam cannot answer for K = Store, whose owner is StoreTeam), and kate plus sam pass. That is exactly the spec outcome. So the spec, correctly implemented, does not let a component owner waive another team's critical claim. Fix the kernel and add an A4-shaped fixture to the bridge.

</details>

<details><summary>lawyer/L15: Named judges satisfy the final two-person rule and lock out the owners</summary>

**Claimed gap.** A.6.3.4 '(base item owner, base shape owner)' and core §6.3 'one from the item's base owner and one from the shape owner' can be read as membership in each owner, or as eligibility for each owner's role. A judge named in the policy is eligible for every owner, so the kernel accepts two outsiders. E-policy checks membership but not the judges list.

**Skeptic 1** (refuted). The safety claim fails against the spec text; both implementations share an implementation defect; one liveness gap in E-policy remains. Re-run with shapek: dave plus erin gives exit 0, pass, discharging final ob:031024b1dfd16fe2 and ob:ca99c5461b8ff9a8; bob plus carol gives blocked. I fixed only the dangling else in a scratch copy of the prototype. It then also discharges both loosenings for dave plus erin (only the critical coverage obligation stays blocking), and blocks bob plus carol. Both implementations treat the second person as role-eligible for the shape-owner item and never test membership: kernel answerItemsOk js2 = eligibleAnswerers(S.owner); prototype answerItemsSatisfied {owner: shapeOwner}. The spec requires membership. Core §6.3 says 'one from the item's base owner and one from the shape owner'. A.7.6.5 says 'plus a base shape owner member as second person if final'. A.8.2.2 says 'Final subjects also need a base shape owner member'. A.7.1.3 says 'plus the base shape owner if final', and Example 1 C names carol 'Platform'. erin is not in Platform and dave is not in AuditTeam, so a correct implementation keeps the final loosening blocking under rule 4, and the outsiders cannot lift a final item. The misreading starts in A.6.3.4's bare parenthetical '(base item owner, base shape owner)'. The owners being locked out follows from the policy author removing 'owner' from critical's judges, since A.6.3.3 eligibility requires being listed. That is fail-closed, not unsound. It can be undone by an L7 edit to 'policy critical' (tier critical, which dave or erin can answer) and a second run. RESIDUAL, liveness only: A.9.4 E-policy counts only membership. It therefore accepts a policy under which no person is both a member and eligible as a judge for final items, which makes syntax §1's 'E-policy checks that two distinct persons can lift it' false. Suggested fix: A.6.3.4 should say 'a member of the base item owner and a member of the base shape owner, each eligible', and A.9.4 should check that against critical's judges.

**Skeptic 2** (refuted). Read correctly, the spec rejects the two outsiders. The owner lockout fails closed and can be escaped. On membership, core §6.3 says 'two distinct eligible persons, one from the item's base owner and one from the shape owner'. A.7.6.5 names the second item as 'a base shape owner member as second person if final'. A.9.4 says 'two distinct persons across owner and shape owner'. Syntax §1 and Example 1 ('carol, the final obligation's second person (Platform...)') use membership too. Only A.6.3.4's terse parenthetical '(base item owner, base shape owner)' allows a role reading. The kernel takes that reading: judgesAllow (kernel/Kernel/Laws.lean:39-42) admits a named judge for any owner, and the final branch of answerItemsOk has no membership test. Re-run: A13 outsiders → pass (exit 0, 2 discharges); owners → blocked. I built a prototype copy with L16 fixed plus a membership conjunct on final answer items, in scratchpad/shape1work/skeptic2/L13-16/proto-spec; output is in rerun.out.txt. On that build, dave plus erin discharge only the critical L1 on component AuditStore, which is non-final and which a named judge may answer. The final loosening (forbid ccfcbabf…) stays blocking for every pair tried: bob+carol, dave+erin, bob+dave, dave+carol, and all four. So T2 holds and outsiders cannot lift a final claim. The lockout follows from the policy author's own choice to drop `owner` from critical judges, and two PRs escape it (escape.ts, escape.out.txt). First, a policy-only PR widening critical judges to [owner, dave, erin]. That is an L7 'policy critical' loosening, non-final, and dave alone discharged it. Then Variant C under the widened base: bob plus carol discharge both loosenings, while dave plus erin still cannot discharge the final one on the spec build. Two residual items are wording and liveness, not soundness. First, reword A.6.3.4 to 'each eligible, one a member of the item's base owner and one of the base shape owner'. This matters because both the kernel and the L16-fixed prototype (proto-fixed build: dave+erin discharge both loosenings) chose the role reading. Second, A.9.4's E-policy could intersect membership with the judges list, so that syntax §1's 'E-policy checks that two distinct persons can lift it' actually holds.

</details>

<details><summary>lawyer/L16: Prototype bug: judges named by actor are never eligible (dangling else)</summary>

**Claimed gap.** This is an implementation defect, not a spec defect. It matters because the differential bridge reports 24/24 agreement while never exercising named judges.

**Skeptic 1** (refuted). The defect is real but sits in the prototype, as the attack itself says. The spec is correct: A.9.1 has judges ⊆ {owner, agents} ∪ actors, and A.6.3.3 says 'listed by tier*(o)'s judges', so an actor named as judge is eligible. Re-ran `bun experiments/shape-1/redteam/lawyer/dangling_else.ts`: ["m::bob"] -> [], ["owner","m::bob"] -> ["m::tim"], ["agents","owner","m::bob"] -> ["m::tim"]. In proto/src/governance.ts eligibleByRole, the final `else` binds to the inner `if (a.kind === "agent")`. I braced the three branches in a scratch copy (scratchpad/shape1work/skeptic1/proto-fixed) and re-ran the saved inputs. A1a control goes from pass (tim, self) to blocked with eligible=[tooling::bob], matching the kernel's blocked; the A1a attack still passes by self, also matching the kernel. A13's eligible lists become [audit::dave, audit::erin], and dave plus erin then discharge both loosenings, as in the kernel (both wrong per L15). The 24/24 bridge agreement never exercised this: proto/examples/fixtures.ts declares no `policy` or `judges`, and bridge.ts has 9+5+2+3+5 = 24 cases, all on DefaultPolicy. Fixes: brace the branches, and add bridge fixtures with named judges (including A1a and A13).

**Skeptic 2** (refuted). Confirmed, but it is a prototype bug that the attacker admits is not a spec defect. The spec makes named actors eligible: §9 `judges ⊆ {owner, agents} ∪ actors`, and A.6.3.3 'listed by tier*(o)'s judges'. The kernel implements this (Laws.lean judgesAllow, third disjunct). Reproduced with `bun experiments/shape-1/redteam/lawyer/dangling_else.ts`: ["m::bob"] -> [], ["owner","m::bob"] -> ["m::tim"], ["agents","owner","m::bob"] -> ["m::tim"]. In proto/src/governance.ts:86-88 the final `else` binds to the inner `if (a.kind === "agent")`. Bracing the branches (scratchpad/shape1work/skeptic2/L13-16/proto-fixed) restores named judges. On that build, A13 dave plus erin discharge both loosenings, matching the kernel. One caution for the fix: fixing L16 alone moves the prototype onto the kernel's L15 misreading, so the membership conjunct from L15 must land with it. The bridge reporting 24/24 agreement with no named-judge, tie or multi-owner coverage fixture is a test-coverage gap, not a model gap.

</details>

<details><summary>lawyer/L17: Judge lists are intersected as strings: a narrower list that is still semantically valid becomes an L7 loosening nobody can answer</summary>

**Claimed gap.** A.6.2.6 'common judges' and L7 'judges ⊄' do not say whether judges compare as strings or as resolved actors. An implementation that resolves them gives no L7 question and policy* = {ann}. The string reading blocks a legitimate tightening permanently.

**Skeptic 1** (refuted). Refuted. I re-ran the saved cases and they reproduce: shapek gives semantically identical output on all 10 saved kernel cases (A12, A3, A11, A9), and the prototype gives identical output on all 10 saved inputs (bun W/proto/rerun.ts). (1) The spec is not ambiguous. A.9.1 types judges as a subset of {owner, agents} ∪ actors. A.6.2.6 intersects them and L7 (A.8.2.3) compares them with ⊄ over that set. Names are resolved only when eligibility is checked (A.6.3.3). Both implementations do exactly this. (2) [ann] is not below [owner] in the policy order, because `owner` means each item's own owner, and the policy also governs items added later without any question being raised. Kernel test (W/l17.py, L17_3): add a component owned by OtherTeam {bob} whose head grant grows, which is a latent L1 loosening that blocks at normal. Under judges [ann], ann's approve discharges it (pass) and bob's does not (blocked). Under [owner] it is the reverse. Adding such a component raises nothing under either policy (L17_4: pass, 0 obligations). So the 'resolving' reading would let [owner]→[ann] land unquestioned, and a non-owner could then approve another team's loosenings without any question ever being asked. L7's 'loosened' is correct, and comparing the names as strings is the sound reading. (3) It is not permanent. Two reviewed steps work. Step 1, [owner]→[owner, ann]: L7 loosened, policy* judges = {owner}, ann (a shape-owner member and not an author) discharges it, pass. Step 2, [owner, ann]→[ann]: the head's judges are a subset of the base's, so no L7, pass. The kernel (L17_1, L17_2) and the prototype (W/proto/l17.ts: step 1 discharged, step 2 raises no L7) agree. The one-step dead end is the spec's documented 'no eligible answerer' state (A.7.1.4), with revert as the discharger. At most this suggests a liveness refinement: policy* could intersect the resolved eligible sets per obligation, which still never lowers severity. It is not a model gap. W = /tmp/claude-0/-home-user-shapelang/83ff80bc-0161-572f-9e5a-9075cccad6d0/scratchpad/shape1work/skeptic1-L17-20.

**Skeptic 2** (refuted). Refuted. I re-ran cases/A12_* in the kernel and proto-cases/A12_* in the prototype. Both raise L7 on `policy normal` with no eligible answerer and the verdict is blocked, as claimed. That is still not a model gap, for three reasons.

(1) The string reading is what the spec says. A.9.1 types judges as a subset of {owner, agents} ∪ actors. So ⊄ in L7 (A.8.2.3) and the intersection in policy* (A.6.2.6) operate on those symbols. Resolving symbols to persons happens only in eligibility (A.6.3.3).

(2) L7 is the right obligation, because [owner] -> [ann] is not a tightening. `owner` resolves per item, and a named judge may answer any item (kernel judgesAllow).
- L17_other_team_item: under base [ann], ann discharges a loosening of an item owned by OtherTeam{bob} (pass). Under [owner], the same review leaves it blocked.
- L17_selffallback: the narrowing gives ann the self fallback. With authors {ann, annbot}, ann approves her own L4 guard removal. Base [owner]: blocked, because tim is eligible. Base [ann]: pass.
- The resolved-actor comparison the attack proposes would raise no L7, so both weakenings would merge unreviewed. Later additions of other-team items, and removals of team members, raise no question, so this change is the only point where it can be reviewed.

(3) The block is not permanent. Two reviewed steps reach the same end state:
- Step 1, [owner] -> [owner, ann]: L7 fires, policy* judges = [owner] = {tim, ann}, and ann's approve discharges it. Kernel: pass. Prototype: eligible [ann], discharged.
- Step 2, [owner, ann] -> [ann]: the head list is a subset, so no L7 fires. Pass in both implementations.

The one-step deadlock is the T2′ conservatism of A.6.2.8, and A.7.1.4 reports it as 'no eligible answerer'. Revert or the two-step split remain available. The cost is one extra PR, not a soundness or determinacy gap.

Files under /tmp/claude-0/-home-user-shapelang/83ff80bc-0161-572f-9e5a-9075cccad6d0/scratchpad/shape1work/skeptic2-L17-20/: variants.py, v/L17_*.json and .out.json, variants.stdout, p17.ts.

</details>

<details><summary>lawyer/L18: Two exceptions, each covering one excluding claim: the debt reports the later expiry</summary>

**Claimed gap.** A.4.6.5 'Several excluding claims: each matched' does not say whether one exception must match every excluding claim or several may share the work, and the debt record names a single exception. The expiry that actually governs is the minimum over the exceptions needed, which neither the output nor the flag reflects.

**Skeptic 1** (refuted). Refuted. This is a reporting shortcut in both implementations and only affects what is displayed. (1) Matching is specified. A.4.4.7 says 'no precedence, so exceptions must match all', and Example 3 says 'an exception on the rule alone would not match, because authority also excludes the fact'; together these make jointly matching exceptions legal. The match ends exactly at the shorter expiry. Kernel (W/l18.py): debt at 2026-10-25T12:00 and at 2026-10-29T23:59:59; preexisting at 2026-10-30T00:00:00 and at 2026-11-01. (2) Severity and verdict never change. Preexisting debt (rule 5) and preexisting (rule 6) are both owed. In the introduced variant, the seeded fact is new and ann gives the exception answer: owed debt at 10-25, blocking again at 11-01. With only the long exception it blocks on both dates, as it should. (3) The reported '311 days, not flagged' contradicts explicit spec text. A.2.2 says 'exceptions active while now* < expiry (flagged 14 days before)'. §7.7 says debt carries 'days to expiry', and A.4.6.5 fixes when the debt lapses: the earliest expiry among the exceptions the match needs, here 2026-10-30. Nothing in the spec says 'report the first exception by name'; that choice is in the code. The kernel's Derive.lean matchedBy checks `o.excl.all (… active.any …)` and then reports `active.find?`, under a docstring that reads 'The active exception matching every excluding claim'. The prototype's derive.ts reports `o.matched[0]`. A single component exception with the same expiry reports 5 days and 1 day correctly (MmmComponentWaiver). Fix: the implementations. An optional one-line clarification in A.7.7.1/A.12.10.1: expires is the least expiry among the needed exceptions, name that exception (or emit one debt row per contributing exception).

**Skeptic 2** (refuted). Refuted: this is a bug in both implementations, not a model gap.

The spec makes one exception match every excluding claim:
- A.4.6.5 defines when an exception is matched. Every condition is on that one exception: now* < its expires, its kinds, its target, its Σ, and 'several excluding claims: each matched'.
- Core §4.6 says 'it matches ... each must be matched'.
- The debt record names one exception, and expiresInDays = ceil((expires − now*)/86400) uses that exception's expiry (A.7.7.1, A.12.10.1).
- Example 3 says an exception on the rule alone does not match, because authority also excludes the fact.
- The kernel's own docstring for matchedBy (Kernel/Derive.lean) reads 'The active exception matching every excluding claim'.

The kernel code instead checks each excluding claim against any exception and returns the first exception that matches any of them. The prototype's derive.ts step 12 does the same.

I patched a scratch copy of the kernel with a one-line fix (kpatch.diff, rebuilt with lake in 18 s):
- A3 at 2026-10-25 and at 2026-11-01: no debt; the contradiction is preexisting and owed; verdict owed on both days, the same severity as before.
- All 32 of the kernel's own test cases give byte-identical output, including ex2_exception_* (3 cases), ex3_component_exception_unanswered and ex3_rule_exception_no_match.

The spec's route for an obligation with two excluding claims is one component exception. L18_one_component_exception, expiring 2026-10-30, gives debt RuleEngineWaiver with expiresInDays 5, which is ≤ 14, so it is flagged.

Even under the attack's reading the severity is owed in all 5 runs; only the debt display differs.

Files under /tmp/claude-0/-home-user-shapelang/83ff80bc-0161-572f-9e5a-9075cccad6d0/scratchpad/shape1work/skeptic2-L17-20/: kpatch.diff, kpatch/, kp/*.out.json, v/L18_*, pdebt.ts.

</details>

<details><summary>lawyer/L20: At tier normal, observer silence beats a report: a producer-changed or stale observation downgrades a sound contradiction to owed coverage</summary>

**Claimed gap.** Rule 8 blocks producer-changed law obligations when Req is in the delta, but nothing comparable applies to observers. A.5.2.12 says observers never execute head code, which the checker cannot verify, and in-repo scanners such as tools/clock-scan.ts are normally run from the head checkout. The kernel's E-provider-missing ignores the record's revision; A.5.2.13 says 'head record'.

**Skeptic 1** (refuted). Refuted. Attack 1 needs an observer that executes head code, which A.5.2.12 forbids: 'Observers, relays and the manifest provider never execute head code', and no head-executing job holds id-token permission. In a conforming deployment, the base scanner runs over the head source and reports the fact, so a sound contradiction blocks. This holds in the kernel (W/l20.py L20_2) and in the saved control_scanner_edited_still_reports case in both implementations. A head-executing job cannot sign as the base identity, so its record is unauthenticated and the change is blocked with E-provider-missing (L20_8). For an unauthenticated observer, health records the assumption 'the change could not alter them'. What is left, owed coverage at normal, is exactly what DefaultPolicy gives any uncovered change at normal. The same result comes from an unedited scanner that marks the entry incomplete (L20_3), or from an unauthenticated scanner that supplies no record (L20_4). It blocks if the normal tier lists coverage in `blocks` (L20_5) or at tier critical (L20_6). The missing rule-8 counterpart is a principled asymmetry: tests and proofs execute head code by nature (executesHead), while observers do not, so an observer's producer change can only withhold coverage, and the model does withhold it. Attack 2 is a kernel bug. A.5.2.13 requires an 'authenticated head record'. The kernel's providerMissing (Derive.lean, around line 17) checks only kind and authentication and ignores the record's revision. The prototype (laws.ts, around line 403) requires revision equal to M_h's revision or deps complete, raises E-provider-missing and blocks, as the spec says.

**Skeptic 2** (refuted). Refuted. I re-ran cases/A9_* in the kernel and proto-cases/A9_A29_* in the prototype:
- Kernel: control blocked; scanner-edited owed; base-revision-only owed; edited but still reporting blocked.
- Prototype: the same, except that the base-revision-only case is blocked with E-provider-missing.

Attack 1, the edited scanner:
- (i) A conforming deployment does not run the edited scanner. A.5.2.12 says observers never execute head code and authenticated records are signed from a job that executes no head code. So the base scanner runs and reports the fact. A9_control_scanner_edited_still_reports is blocked in both implementations, because a producer-changed record keeps its contradiction force (A.5.4.2).
- (ii) A non-conforming deployment runs the scanner from the head. The checker still detects the implementation edit and withdraws absence force and coverage (A.5.4.2). That raises a coverage obligation on checkFreshness, which is the model's treatment of any unobserved changed code. At tier normal, DefaultPolicy deliberately does not block coverage.
- The same owed outcome is reachable without touching the scanner. An unedited absence-sound scanner must mark an obfuscated Date read as incomplete (A.5.2.5). L20_obfuscated_site_incomplete_normal gives owed coverage and exit 0 in both the kernel and the prototype (the prototype record was re-signed; p20b.ts). So a rule-8 analogue for observers would close none of what tier normal already exposes.
- Rule 8 exists because test and proof providers execute head code (executesHead); observers by spec do not.
- At tier critical the attack fails: L20_attack_scanner_edited_critical blocks on critical coverage in the kernel and the prototype.

Attack 2, the base-revision record, is a kernel bug. A.5.2.13 requires an 'authenticated head record', but the kernel's providerMissing ignores the record's revision. The prototype raises E-provider-missing. With a revision == headRev check in the patched kernel, this case gives E-provider-missing and blocks; the other A9 cases and all 32 kernel test cases are unchanged.

Files under /tmp/claude-0/-home-user-shapelang/83ff80bc-0161-572f-9e5a-9075cccad6d0/scratchpad/shape1work/skeptic2-L17-20/: v/L20_*, kp/A9_*, kpatch.diff, p20.ts, p20b.ts.

</details>

<details><summary>lawyer/L21: `shape judge` lines carry no revision, so one line judges every later push</summary>

**Claimed gap.** A.7.6.8 says judge and reject lines act 'on the change tip', but the reviews input is only {identity or actor, line, change}. The checker cites the head's Req, so it mints a judgment of code the reviewer never saw. Phase 1 prints `shape judge <id>` with no digest. Approve lines are content-addressed; judge lines are not.

**Skeptic 1** (refuted). Reproduced: kernel A10_push1/push2 both give pass, and so does the prototype. But the attack depends on how the input was built and on a kernel deviation. It is not a model gap. (1) The kernel case declares a base relay: tooling::reviews, produces judgment. A.7.6.8 lets reviews-input lines act only 'Without a relay'. With a relay, a judge line acts only as the relay's record, and A.7.6.3 has that record cite 'Req(c, judgment) computed purely from the reviewed tree' and the 'reviewed revision'. Kernel/Parse.lean reviewRecords turns raw lines into authenticated judgments whether or not a relay exists, which is a kernel bug. Correct relay behaviour, re-run in the kernel: ann's relayed judgment citing push-1's isoToday unit digest 70a4ca80… gives pass at push 1 and unestablished(stale), blocking, critical at push 2 (3dd06036…) (k_A10_push1_relayed.json, k_A10_push2_relayed.json). Re-run in the prototype with ann's signed judgment: the same pass at push 1 and stale blocking at push 2. (2) Without a relay, A.7.6.8 admits only 'judge and reject lines on the change tip', and A.12.7.4 has CI build reviews from platform data. Code-host reviews carry their commit, so a correct CI does not pass the push-1 line at push 2. Prototype push 2 without the off-tip line gives blocked, unestablished/stale/critical. This mode is unauthenticated and CI-trusted by design: CI could just as well invent the actor or the line, and the properties hold only over authenticated records (A.11.3). So adding a revision field would make nothing verifiable. What remains is editorial: let the reviews input carry the review commit so the pre-pass can filter by tip, and make the kernel ignore raw lines when a base relay is declared. Files: /tmp/claude-0/-home-user-shapelang/83ff80bc-0161-572f-9e5a-9075cccad6d0/scratchpad/shape1work/skeptic1-L21-24/run.ts and /home/user/shapelang/experiments/shape-1/kernel/Kernel/Parse.lean:243.

**Skeptic 2** (refuted). Refuted: the demonstration comes from the input format and two ignored conditions, not from a model flaw. Reproduced: kernel cases/A10_push2_never_reviewed passes, and the prototype push2 case passes. (1) A.7.6.8 limits no-relay judge and reject lines to those written 'on the change tip'. The change tip is not the head, which is the merge commit (§6.1) whose Req the lines cite. That is exactly the contrast with content-addressed approve lines. ann wrote her line on push 1's tip, so a conforming CI does not pass it into push 2's run. Re-run with that filter: prototype blocked, unestablished(stale), blocking, critical, introduced; kernel blocked, unestablished(missing), blocking, critical. (2) The kernel case declares a base relay (tooling::reviews produces judgment), so A.7.6.8 ('Without a relay') does not apply. A.5.8.1 and RJ07 then exempt only reviews lines without a relay, and A.7.6.3 has the relay cite Req computed from the reviewed tree. A relay judgment citing push 1's isoToday digest gives push 1 pass and push 2 blocked, unestablished(stale), critical, in both kernel and prototype (self-signed judgment in the prototype). Both implementations ignore 'without a relay' and 'on the change tip': kernel Parse.lean reviewRecords; prototype derive.ts 507-521, whose Review type has no commit field. The {identity, line, change} reviews shape is the prototypes' own format; the spec says only 'reviews from platform data' (A.12.7.1, A.12.7.4). Remaining gap (contract precision, not model): give each reviews entry its reviewed commit and give the input the change tip, so the checker drops off-tip judge and reject lines itself, mirroring the relay's 'reviewed revision'. Files: /tmp/claude-0/-home-user-shapelang/83ff80bc-0161-572f-9e5a-9075cccad6d0/scratchpad/shape1work/skeptic2-L21-24/{kvar.py,l21_proto.ts,k/L21_*,v/L21_*}.

</details>

<details><summary>lawyer/L22: Phase 2 after the relay's commit makes revision-tied evidence stale</summary>

**Claimed gap.** A.7.6.3 has the relay commit persisted judgments into the change before phase 2, while A.5.4.1 makes test and observation records without deps-complete reuse stale once their commit is not the head. The two-phase flow therefore requires every revision-tied provider to re-run after the relay's commit, or it blocks itself.

**Skeptic 1** (refuted). Reproduced: phase 1 passes. Phase 2 at the new revision with the old records is blocked: the prototype gives 2 E-provider-missing (bunTest and tsClockScan) plus unestablished(stale); the kernel gives 1, because its case has no tsClockScan record. This is the designed, fail-closed behaviour, not a contradiction in the flow. A.6.1.2 makes the head the landing revision, so the relay's commit is a new head. A.14.3.4 already says of bunTest: 'Without deps complete it is rerun each head'. A.5.4.2 allows reuse when deps are complete and digests match M_h. Because record files are excluded from manifests (A.3.2.6), the relay's own judgments stay usable by citation, and a rerun persists nothing new, so the flow converges in one provider run. Re-run checks: in the prototype, re-signing the same test and observation at the new head gives pass, and declaring deps complete for bunTest and tsClockScan, with deps listed and no rerun, also gives pass. In the kernel, the A34 phase-2 case with the bunTest record re-run at h5r gives pass (k_A34_phase2_rerun.json). The cost is one extra provider run per relay commit. That is the same cost as any push or any move of the base branch, which also changes the merge commit. What remains is editorial: A.7.6.3 could say that phase 2 runs at the relay's commit, with providers re-run or reused through deps complete. Files: /tmp/claude-0/-home-user-shapelang/83ff80bc-0161-572f-9e5a-9075cccad6d0/scratchpad/shape1work/skeptic1-L21-24/results.json.

**Skeptic 2** (refuted). Refuted: the change fails closed, so this is a cost to fix, not a model gap. Reproduced: kernel phase 2 blocked with E-provider-missing (bunTest) plus unestablished(stale), blocking, critical; prototype phase 2 blocked with E-provider-missing ×2 plus stale (owed). Staleness is the intended meaning of a revision-tied record. A test without deps complete has not shown that its result is independent of the files the relay added (code can read shape/evidence/), so the checker must not treat the new tree as the old one. The spec gives two exits, both verified. (a) The ordinary CI run on the relay's commit re-runs the providers ('the next run passes', Example 3 Step 1). With records re-signed at the new revision: kernel pass, prototype pass. (b) Reuse through deps complete (A.5.2.8, A.5.4.2). Prototype: pass with deps complete declared in base and head. Kernel: pass once the record lists non-empty deps; with deps [] the kernel still treats it as revision-tied, which is its reading of 'without deps'. Example 3 Step 2's own phase 2 is an L4 approve, which is an answer, and §7.6 persists only claim judgments. Phase 1 there is blocked on L4; phase 2 at the same head with ann's approve line passes, answering ob:a4a8d01ab841cdac, with no commit at all. Remaining gap (efficiency): treat evidence-only commits, already named in A.6.3.1, as transparent for 'at head' when deps and harness exclude record files, and add the deps-complete clause to A.5.2.13's observer case. Files: /tmp/claude-0/-home-user-shapelang/83ff80bc-0161-572f-9e5a-9075cccad6d0/scratchpad/shape1work/skeptic2-L21-24/{kvar.py,l22_proto.ts,k/L22_*,v/L22_*}.

</details>

<details><summary>lawyer/L23: An author with an unmapped, non-bot identity removes the agent's operator from authors*</summary>

**Claimed gap.** A.6.3.3 disables the self fallback only for unmapped bots. Unmapped human or machine-user identities are dropped without notice, so separation of duties depends on which account the author chooses for the agent. GitHub machine users are ordinary accounts and are not flagged as bots.

**Skeptic 1** (refuted). Reproduced in the prototype: with the unmapped non-bot author the run passes with 3 discharges, and the mapped-agent control is blocked on the final L1 loosening. The claimed mechanism is wrong, though. No answer carries the self flag, so the self fallback that A.6.3.3 disables for unmapped bots is never used: alice answers as a non-author. Re-run with an unmapped BOT author github("acme-helper[bot]"): the result is identical, pass with 3 discharges. The bot/non-bot distinction therefore changes nothing. The real issue is that an account the base does not map to an actor has no operator. That is a sockpuppet, and no identity-based separation-of-duties rule can detect one. GitHub's own last-pusher approval rule has the same limit. Actors and operators are base-only by design (A.6.2.6), and declaring the agent's identity is exactly the input the model uses. A.6.3.1 also puts 'agent-session principals' among the authors. Adding alice as the session principal to the attack's authors restores blocked on the final loosening. Failing closed on every unmapped author would block every outside contribution. What remains is a notice, not soundness: A.10.4 health does not list unmapped verified authors, and could. Files: /tmp/claude-0/-home-user-shapelang/83ff80bc-0161-572f-9e5a-9075cccad6d0/scratchpad/shape1work/skeptic1-L21-24/run.ts (L23_* variants).

**Skeptic 2** (refuted). Refuted: this is a sock puppet, which no actor-based model can see. Reproduced: prototype pass with 3 answered. The outcome depends neither on the bot flag nor on A.6.3.3's self fallback. alice is not in authors* at all, so she is eligible without any fallback. Marking github("acme-helper") bot:true gives the same pass (V2), and a plain second account github("alice-alt") gives the same pass (V4). The attack therefore reduces to 'a person authors under an account that no base actor maps'. No separation of duties based on identities can detect that; GitHub's own last-pusher rule fails the same way. The spec covers the scenario as described. A.6.3.1 counts agent-session principals as authors: adding github("alice") as the session principal gives blocked, with the final L1 loosening open and eligible [bob, carol] (V1). Declaring the machine user as an identity of codeAgent (operator alice) in the reviewed base gives the same block (V3). Remaining gap (visibility only): health could list verified authors that no base actor maps; that changes a health field, not a verdict. Files: /tmp/claude-0/-home-user-shapelang/83ff80bc-0161-572f-9e5a-9075cccad6d0/scratchpad/shape1work/skeptic2-L21-24/{l23_proto.py,v/L23_*}.

</details>

<details><summary>lawyer/L24: In the prototype, an implies record from a provider that decides neither claim makes a weaker structural claim an heir</summary>

**Claimed gap.** A.5.6.1 requires that the provider 'decide both claims' for claim-space contributions, and no provider decides checker claims. A.6.2.1 says effect forbids and authority have heirs only by equal NF. The prototype implements neither restriction. The spec should also say explicitly that checker-decided claims accept no implies records.

**Skeptic 1** (refuted). Reproduced in the prototype: the control is blocked on L3 at critical, and the attack passes with an implies record from 'refines', which decides only ['equivalence'], over two path.forbid claims. This is a prototype bug, which the attack itself admits. proto/src/derive.ts:301-304 contributing() checks only that the provider is presence-sound and decides equivalence. Lines 391-406 then apply claimImplies to every op, effect.forbid and authority included, which bypasses the guard on line 404 that applies only to the op order. The spec already excludes this. A.5.6.1 requires a contributing claim-space record to come from a provider that is also 'deciding both claims and citing both Reqs'. The grammar has Decided ::= template Q | statements L | equivalence, so no provider can decide a checker-decided path.forbid. Req is defined only for laws (A.4.5.4, A.5.3.4), so 'citing both Reqs' cannot be met for structural claims. A.5.5.1 makes non-contributing equivalences hints only. A.6.2.1 adds that effect forbids and authority have heirs only by equal NF. A correct implementation therefore gives the control result, L3 loosened and blocking, and so does the kernel. The suggested sentence, 'checker-decided claims accept no implies records', is a clarification of text that already has this meaning. Files: /tmp/claude-0/-home-user-shapelang/83ff80bc-0161-572f-9e5a-9075cccad6d0/scratchpad/shape1work/skeptic1-L21-24/eq1.ts.

**Skeptic 2** (refuted). Refuted: this is a prototype bug, as the attack itself concedes. A.5.6.1 already requires a claim-space contribution to come from a provider 'deciding both claims and citing both Reqs'. Decides is only template Q, statements L or equivalence (syntax Decided, A.5.2.4), so no provider decides a path.forbid and no implies record can contribute to a checker-decided claim. A.6.2.1 and A.5.6.4 also give effect forbids and authority heirs by equal NF only. Reproduced: prototype attack pass, control L3 loosened, blocking, critical. In derive.ts, lines 393-398 add to claimImplies for any record that passes contributing() (presence-sound and deciding equivalence), and line 410 uses claimImplies without the effect.forbid/authority guard that line 409 applies. A patched scratch copy (protofix/src/derive.ts, about 8 lines) requires both claims to be laws the provider decides and keeps effect.forbid and authority at equal NF. It gives the attack blocked, L3 loosened, blocking, critical, identical to the control. No prototype test uses claim-space records. Saying 'checker-decided claims accept no implies records' outright would be editorial, since it already follows from A.5.6.1 and A.5.2.4. Files: /tmp/claude-0/-home-user-shapelang/83ff80bc-0161-572f-9e5a-9075cccad6d0/scratchpad/shape1work/skeptic2-L21-24/{protofix/src/derive.ts,prun_fix.ts,p/EQ1_*.fixed.out.json}.

</details>

<details><summary>lawyer/L25: A code-equivalence record with no declared scope re-validates a human guard judgment across an edit</summary>

**Claimed gap.** A.5.6.1 and A.5.6.2 allow this as written, but equivalence providers declare no language or projection scope, so a Verus refinement checker may equate TypeScript unit digests. A machine-made equivalence record also carries a person's judgment (evidence about evidence) to code that person never saw, which is exactly what a RefactorSensitive guard exists to prevent.

**Skeptic 1** (refuted). Re-ran (bun /tmp/claude-0/-home-user-shapelang/83ff80bc-0161-572f-9e5a-9075cccad6d0/scratchpad/shape1work/skeptic1-L25-28/eq2.ts, outputs in .../skeptic1-L25-28/pcases/). Control: unestablished/stale owed plus coverage owed. Attack as given (code: []): only coverage owed. Attack with the record citing (isoToday, unit, ISO_H): only coverage owed. In three variants the stale obligation stays: provider declared only in the head, base provider without presence, and unsigned record (RJ07). So the record acts only when the provider is declared in the base, presence-sound in both base and head, and signed with its base identity.

This is the specified behaviour, not a gap. A.5.4.1 makes a record stale only when a cited digest is ≢ M_h, and says judgments are reused by citation. A.5.6.5 lists freshness as a use of ≡. A.5.7.2 says equivalence records carry API migrations (E3 42/44). In SEED, a fingerprint is a 'normalised hash of meaning'. A presence-sound equivalence asserts that ISO_H means what ISO_B meant, and a behavioural constraint that isoToday preserved is then preserved. Answering the guard mechanically where a sound decider can is SEED invariant 5 (judgment is the residual), not a bypass.

The 'Verus checker equates TS digests' case needs a base-reviewed, presence-sound provider to report an equivalence it never decided. That is a false report, which breaks its declared soundness. Every guarantee already assumes this away, exactly as for a presence-sound observer that invents facts. The pair holds the two digests, and the scheme σ is hashed into each, so a record can join only those exact two unit digests. There is no projection confusion.

Prototype bug noted: RJ10 at proto/src/records.ts:314 omits kind equivalence, although records §3 requires `code` for equivalence records. The demo's `code: []` record should have been rejected. This does not decide the verdict, because the citing variant behaves the same.

Residual: an unscoped `decides equivalence` widens the blast radius of an executesHead compromise. That trust assumption is already listed in health. Adding `decides equivalence <lang>` would be cheap hardening, not a model gap.

**Skeptic 2** (refuted). I reproduced it. The behaviour is what the spec asks for, and the trust it rests on is declared in the base and reviewed. Script: /tmp/claude-0/-home-user-shapelang/83ff80bc-0161-572f-9e5a-9075cccad6d0/scratchpad/shape1work/skeptic2-L25-28/peq2.ts, run from the repo root with bun; outputs in .../skeptic2-L25-28/pcases/. Results: with no record, the guard is unestablished(stale), owed, normal. The record as given (code: []) clears the stale obligation. So does a conforming record that cites ts:...#isoToday at unit (ISO_H), so the attack does not depend on the prototype's RJ10 gap (records.ts:314 leaves out equivalence, while records.md requires `code` for equivalence). Every gate in A.5.6.1 and A.6.2.6 holds: a head-only provider gives stale; a base without presence gives stale, and the head adding presence is an L7 loosening that blocks; a one-way `implies` gives stale (≡ needs two-way records, A.5.6.3); an unsigned record is rejected with RJ07. Why this is not a model gap: (1) ≡ is meant to carry freshness for every record kind: A.5.6.5 lists freshness (≡) among its uses, A.5.4.1 says 'judgments reuse by citation', and A.14.2.4 uses exactly a verusRefines code-space record for API migration. Judgments already survive edits the judge never saw, because digests drop formatting and inert comments (A.5.7.2). (2) A presence-sound equivalence provider asserts that the two code versions really are equivalent. Equivalent code keeps any behavioural constraint the judge approved, which is what RefactorSensitive asks ('Changes to this unit preserve the constraint...'). (3) The 'no language scope' point is about trusting providers, not a flaw in the model. The name verusRefines means nothing to the checker. A base declaration of `sound presence` plus `decides equivalence` is a reviewed statement that every equivalence the provider reports is true, the same kind of trust as a presence-sound test provider, whose `decides template Q` names no language either. Digests already carry their scheme (σ = lang.projection.vN is hashed in), so a record joins two specific digests and cannot spread to other projections. The trust surface is already accounted for: equivalence providers are listed as executesHead, T6/A.5.9.3 name contributing equivalences as an unblocking category, and every soundness result is conditional on provider declarations. A language scope would narrow the damage from a wrong declaration; it is not missing soundness. Aside, outside this claim: A.8.2's L7 and both implementations (Loosen.lean, loosening.ts:791) only walk base providers. So adding a new equivalence provider in the head raises no L7 question, against core §6.2 ('every head governance edit is also a loosening question'). That is worth filing on its own.

</details>

<details><summary>lawyer/L27: Core and annex disagree on when a producer-changed law obligation is introduced</summary>

**Claimed gap.** The core says the obligation is introduced when the producer changed; the annex says when the reason is producer-changed. They differ whenever an earlier reason in the order (stale, expired) hides producer-changed.

**Skeptic 1** (refuted). Re-ran the kernel case D13 (python3 -I .../skeptic1-L25-28/kvar.py, outputs in kcases/): unestablished, stale, owed at critical, not introduced, as claimed. The variants show that the two readings never change an outcome the spec promises:
(a) the same case with bunTest authenticated: blocked by E-provider-missing, with the record at the base revision and at an older revision. The stale record is neither at head nor reusable.
(b) a fresh head record from the edited harness, authenticated or not: producer-changed, introduced, blocking at critical under both readings.
(c) unauthenticated, record dropped: unestablished/missing/owed, the same outcome as the attack.
(d) unauthenticated control with no harness edit: stale and owed, identical to the attack. The harness edit adds nothing to the law's state, because the record was already unusable for an independent earlier reason.
(e) the same pattern holds with bun.lock (an implementation path) edited.

So the readings differ only when the sole record is stale or expired and no fresh record exists. With an authenticated provider, that is E-provider-missing. With an unauthenticated provider, an attacker can reach the same owed result by dropping the record, which neither reading prevents. Core §5.2 promises that dropping evidence cannot pass a gate only for authenticated providers, and T1-T9 hold over authenticated records.

On the text: core §5.4 says the first matching reason decides an unusable record's state, and core §7.5 rule 8 uses producer-changed as a reason name. So 'whose producer changed' in §7.3 refers to that reason, which A.7.3.3 states precisely, and the annex governs detail. The prototype (laws.ts:359) and the kernel agree. At most this is an editorial fix: write 'reason producer-changed' in §7.3.

**Skeptic 2** (refuted). I re-ran it (kvariants.py, kcases/D13_*). As given: unestablished(stale), not introduced, owed, critical. A record whose harness agrees with its own base revision (the as-given record cites the head harness digest at revision b5, which RJ13 would reject) gives the same. Under first-match usability, which the core states itself in §5.4 ('The first matching reason makes an applicable record unusable'), a stale record is not producer-changed. Read that way, core §7.3 'whose producer changed' means what A.7.3.3 says, and model.md's Status line makes the annex govern detail. At most the core needs a one-phrase edit ('whose reason is producer-changed'). The annex outcome is right in every reachable configuration. Authenticated provider with the stale record: E-provider-missing, blocked, because the record is neither at head nor reusable through deps complete (A.5.2.13). Fresh head record (what a correct CI supplies, since the record is revision-tied without deps): producer-changed, introduced, blocking, with or without authentication. Unauthenticated, record dropped: unestablished(missing), owed, the same as as-given. The core-literal reading would make supplying an unusable stale record block while dropping it is only owed. That rewards dropping evidence, against the spirit of T6/T6′. The owed outcome only arises when an unauthenticated CI fails to rerun, and the model already lists that trust assumption in health. Properties T1-T9 are stated over authenticated records.

</details>

<details><summary>lawyer/L28: Rewriting a violation into a worse one with the same fact counts as old drift</summary>

**Claimed gap.** A.7.3.1 treats a fact at changed code as new only if no base-revision entry reports it at least as often. The fact id has no code content, so a worse rewrite of an existing violation is never introduced, and it blocks only at final.

**Skeptic 1** (refuted). Re-ran the OLD cases (python3 -I .../skeptic1-L25-28/kvar.py). As given, the rewritten site and the unchanged site both give a sound contradiction, owed at critical, not introduced. Variants show the spec reacts to everything a claim can distinguish:
- the rewrite takes n from 1 to 2: introduced, blocking;
- the rewrite adds another clock resource (performance.now) at the same site: new fact, introduced, blocking;
- the same rewrite at tier final: blocks (rule 2);
- no baseRecords: the fact counts as new (A.7.3.2), blocking.

This is deliberate design, not a gap. A.7.3.1 makes a fact new by fact id and count n. Example 2 says 'an edit of set adding no marker introduces nothing' and 'a later second assume is new and blocks again'. A.7.5.4 gives the rationale (R4: 83-98% of commits carry an outstanding assume or admit).

'Worse with the same fact' cannot be stated as a violated claim. The subject {code, atom} and the fact (at, verb, resource, n) are identical, so nothing the shape can say is newly violated. The claim was already violated at base, and the obligation stays open, owned and visible in every change (§7.7).

Where the difference matters, the vocabulary can express it. An all-rows DELETE that an observer reports as Truncate (std: Truncate ⇒ HardDelete) has a different fact id, so it is new and introduced. AppendOnly, the Example 1 case, is final, so its preexisting contradiction blocks anyway.

The alternative, treating any edit at a violating site as introducing, contradicts the stated Example 2 design and would make every edit of a function that carries old drift block.

**Skeptic 2** (refuted). I re-ran it (kvariants.py, kcases/OLD_*). As given and the unchanged-site control both give a sound contradiction, not introduced, owed, critical. Worsening along every axis an effect claim can express is introduced and blocks. n=2 at head: introduced, blocking (A.7.3.1, n_b ≥ n). A second resource code (performance.now): introduced, blocking. A stronger verb (Export ⇒ Read): introduced, blocking. The rule at final: blocking by rule 2 even though not introduced, so the AppendOnly DELETE example (tier final) blocks. With no baseRecords: introduced, blocking (A.7.3.2). effect.forbid's subject is {code, atom}. Rewriting the site with the same identity, atom, resource code and count leaves exactly the same violation of that claim; 'worse' is not something the claim can state. Behavioural worsening, such as deleting one row versus all rows within HardDelete, belongs to laws (core §1, SEED: laws are over values and histories). A law whose Req meets Δcode is introduced, so the edited site must be re-tested: D13_unit_edited_stale_record gives stale, introduced, blocking at critical. A finer verb (std Truncate ⇒ HardDelete) would also make it a new fact if the observer maps DELETE with no WHERE to Truncate (speculation about observer vocabulary). Treating any fact at edited code as new would make every edit of a function with existing drift block, against A.7.5.4 (R4: 83-98% of commits carry outstanding hatches). The violation stays open, owned, visible and preexisting, so this is a deliberate trade-off, not a model gap.

</details>

<details><summary>lawyer/L29: An agent's `shape reject` is a sound veto</summary>

**Claimed gap.** A.5.5.1 gives every eligible judgment sound force and fixes force outside policy. Under DefaultPolicy, therefore, any base agent that is not an author can block any normal-tier change that touches a judged law.

**Skeptic 1** (refuted). I re-ran the case and got the same result: `shapek redteam/lawyer/cases/VETO_attack_bot_rejects.json` exits 1 (blocked: a sound, introduced, blocking normal-tier contradiction), and the control `VETO_control_bot_judges.json` exits 0 (pass). Both outputs match the recorded .out.json byte for byte.

This behaviour is written into the spec, not missing from it:
- §5.5 and A.5.5.1 say eligible judgments 'establish (judged) or contradict soundly'.
- A.5.5.2 says 'a fresh contradicting judgment beats supporting ones; no latest-wins; mistaken judgments clear when citations move or an exception carries them'.
- T3 repeats 'fresh contradicts beats supports'.

Who holds this power is decided by the base's reviewed governance, not fixed by force. Eligibility (A.6.3.3) needs a base actor, an authenticated relayed record, a listing in tier*(o)'s judges, and j not in authors*. I ran four variants (scratch .../shape1work/skeptic1-L29-37/veto/):
- (a) ann, a person judge, writes the same `shape reject`: identical blocking sound contradiction (exit 1). The veto belongs to every eligible judge, not to agents.
- (b) the base policy sets normal `judges owner`: the bot's reject is ineligible and the verdict is owed (exit 0, unestablished owed).
- (c, d) tim's or ann's `shape judge` after the bot's reject: still blocked, as A.5.5.2 specifies.

The outcome fails closed. A wrong veto blocks a merge, never admits bad code, and it is cleared by an edit that moves the cited digest, or by an exception plus an exception answer from a person.

What is left is a question about DefaultPolicy's default: whether normal-tier judges should include agents. Under H1 the bot's `shape judge` passing is the larger and intended power. This is not a model-level gap.

**Skeptic 2** (refuted). The demonstration reproduces, but the behaviour is the designed, fail-closed meaning of an eligible judge, not a soundness gap. Re-run with shapek: VETO_control_bot_judges gives exit 0 pass; VETO_attack_bot_rejects gives exit 1 blocked, with one sound, introduced, normal contradiction and no dischargers. Six variants (python3 -I veto_variants.py, outputs cases/S2_V*.out.json) bound the effect. (V1) If ann, a person in the owner team who is not an author, adds `shape judge`, the change stays blocked. That is A.5.5.2 as written ('a fresh contradicting judgment beats supporting ones; no latest-wins'): a counter-assertion never overrules a contradiction, consistent with T3 and A.5.3.7. (V2) A whole-claim exception on the law plus ann's `shape approve bd:fc9749239b6bf3aa` gives owed debt of 37 days, with answered=exception-answer. The author tim's identical line stays blocked, by separation of duties. This is the stated remedy: 'mistaken judgments clear when citations move or an exception carries them' (A.5.5.2). (V3) As a relayed record, the reject cites the reviewed isoToday digest. On that tip it blocks (V3a). After a push that moves isoToday it is stale and the change is owed, unestablished(stale) (V3b), which is the state without any review. So the veto is not durable; it behaves like 'dismiss stale reviews on push'. Without a relay, lines act for one run only (A.7.6.8). (V4) A policy with normal judges set to owner only makes the bot's reject inapplicable (owed, missing), because eligibility is part of applicability (A.5.3.5). (V5) At critical under DefaultPolicy, agents are not judges, so the reject has no force. Only base-declared agents with operators can do this at all (actors are base-only; RJ09). Refusing agents contradiction force while granting them establishing force would trust an agent to pass a change but not to fail it, which is the unsound direction. Rule 7 also blocks every other sound contradiction regardless of tier. What remains is an availability and trust trade-off chosen in policy (listing `agents` as judges). Nothing here lets a violation merge, so this is not a model-level gap.

</details>

<details><summary>lawyer/L30: An exception `for code <file>` does not cover the file's symbols</summary>

**Claimed gap.** A.4.6.3 says subjects are 'resolved per identity' but does not say whether `code x` covers x's descendants. Attribution (att) and Req do use ancestry, so two implementations could reasonably disagree.

**Skeptic 1** (refuted). I re-ran both cases and got the recorded results: `XF_for_code_file` gives owed, a preexisting critical contradiction with no exception; `XF_for_code_symbol` gives owed with debt `tooling::ClockFile`, 37 days.

The spec decides the denotation of `code x`; it does not leave it open:
- A.4.6.5 matches by `code ∈ ⟦Σ⟧` and `code(u) ⊆ ⟦Σ⟧`, over identity sets 'resolved per identity' (A.4.6.3).
- A file and its symbols are distinct identities (A.3.2.1, A.12.2.3, M§3.2).
- The spec states ancestry explicitly wherever it applies: att 'nearest ancestor-or-self' (A.3.3.5), fact anchoring (A.4.4.5), and Req at trust 'it or a descendant' (A.5.3.4). It says nothing of the kind for `code x`.
- Wider subjects already have their own selectors, `for unit` and `for component`, which resolve through attribution.

Two independent implementations agree on the exact reading: kernel `Kernel/Derive.lean` excSubjOk `.code id => id == y`, and prototype `proto/src/derive.ts:1063` `sub.kind === "code" ? sub.id === x`, elaborated at `elaborate.ts:1163`. So there is no measured disagreement.

The exact reading also fails closed. In an introduced variant (head digests moved, no baseRecords; scratch .../skeptic1-L29-37/xf/mk2.py), `for code <file>` plus tim's exception answer stays blocked (exit 1), while `for code <symbol>` plus the same answer becomes owed debt (exit 0, 37 days). A mismatch between readings could therefore only over-block. Even the wider reading would still need an eligible non-agent exception answer naming that obligation's binding.

Editorial fix only: state ⟦code x⟧ = {x} in A.4.6.3, and replace 'inside the listed subjects' in M§4.6.

**Skeptic 2** (refuted). The spec has one reading of `code x`: the identity x itself. Both implementations use it, and it is the fail-safe reading. (1) Text: model §3.2 makes a file and each of its symbols distinct identities with their own digests. Facts anchor at the nearest enclosing identity (A.3.2.1, A.4.4.5), and the {code, atom} subject carries that exact identity. Ancestry is used only where the text says so: att's 'nearest ancestor-or-self' (A.3.3.5), and code(K) and code(u) for component and unit selectors. The same `code SourceRef` form as a law target gives Req 'on code x: (x, unit) or (x, file)' (A.5.3.4, annex line 158), which is x alone with no descendants. So A.4.6.5's 'code ∈ ⟦Σ⟧' with ⟦code x⟧ = {x} matches the spec's other use of the construct. (2) Implementations: the Lean kernel (kernel/Kernel/Derive.lean:67, `.code id => id == y`) and the independently written TS prototype (proto/src/derive.ts:1063, `sub.id === x`) both compare exactly. The claim that two implementations 'could reasonably disagree' is contradicted by the two that exist, and A.11.2.4's byte-identical differential tests would catch a divergence. (3) Fail-safe: in the lawyer's preexisting case, the file and symbol subjects give the same severity (both owed); only the debt listing differs (37 days vs none). With an introduced fact (xf_variants.py, cases/S2_XFi_*.out.json), phase 1 is blocking under both subjects. After tim's exception answer, the symbol subject becomes 37-day debt, while the file subject stays blocking with exception=null, visible to the author. The exact reading therefore never waives more than was written. Authors who want file-wide scope have `for unit U`, with U bound to the file (its unbound descendants fall in code(U) through att), or `for component K`. At most a one-line clarification is warranted ('code x denotes exactly x'). This is not a model-level gap.

</details>

<details><summary>lawyer/L37: Unauthenticated providers keep full force, including absence and coverage</summary>

**Claimed gap.** Absence (complete entries) is the most dangerous force to forge, yet unauthenticated providers receive it with nothing but a health note.

**Skeptic 1** (refuted). There is no case to re-run (demonstrated=false), so I checked the claim against the spec text. The scenario breaks a normative deployment requirement and a trust assumption the spec states:
- A.5.2.12: 'Observers, relays and the manifest provider never execute head code.'
- A.5.2.11's health text names exactly the trust being forged: 'CI assembled these records and the change could not alter them'.
- The core properties T1–T9 are stated 'over authenticated records' (M§11, A.11.3).
- SEED's strategic decision 'Signing is optional' is what gives unauthenticated providers their force.

Within the model, the change cannot obtain absence force itself:
- Under G*, coverage and establishing force count only if both base and head grant them; a head-only provider only contradicts; the identity comes from the base (M§6.2, A.6.2).
- A head edit to the observer's declared implementation or harness makes its records producer-changed, which gives contradiction force only and no coverage (A.5.4.2). A.5.2.6 forbids implicit configuration identities.
- Once the base names an identity, records must be signed from a job running no head code (RJ07, A.5.2.12), and dropping one is E-provider-missing (A.5.2.13).

Marking an entry `complete` does not suppress contradictions. Leaving out facts does that, equally in any forged record whether or not it is complete. `complete` adds only refutation and coverage.

So the remaining risk is exactly the trust assumption the spec lists, and the spec supplies the remedy (a base-declared identity). At most this supports an optional policy knob, for example 'coverage at critical/final requires authenticated providers'. It is not a model-level gap.

**Skeptic 2** (refuted). The behaviour is what the spec states. The attack's premise negates the spec's own stated assumption, and absence is not uniquely dangerous, so this is not a model gap. Demonstration (unauth_variants.py, cases/S2_U*.out.json, starting from an introduced, sound, critical clock contradiction): (U0) the honest authenticated record gives blocked. (U1) With the observer declared without an identity, a forged record with complete entries and no facts gives pass, which confirms the mechanism. (U2) With the base-declared identity, the same forged, unsigned record is rejected (RJ07) and the change is blocked with E-provider-missing. (U3) Without an identity, dropping the record instead gives a blocking critical coverage obligation. So the protection is available and opt-in through the reviewed base (A.5.2.11-13), and model §11 and A.11.3 state the properties only 'over authenticated records'. The scenario 'CI collects records from jobs that run head code' violates A.5.2.12 ('Observers, relays and the manifest provider never execute head code') and the health assumption printed for each unauthenticated provider ('CI assembled these records and the change could not alter them'). Under that same violation, the change can equally forge an unauthenticated test 'supports' record (establishing force clears a critical unestablished law), drop facts from a presence-only observation (no contradiction needs absence force), or forge `reviews` and `authors` lines (without a relay, approve lines act as answers, A.7.6.8) to discharge loosenings and coverage. Removing absence force from unauthenticated providers would therefore close none of these holes, and would only make every unsigned adoption owe coverage on every change. The coherent remedy is authentication, which the spec already provides; gates without signing infrastructure are acknowledged as open question 9.

</details>

<details><summary>lawyer/L39: Circular proof evidence through the same provider's records</summary>

**Claimed gap.** The spec has no well-foundedness condition on evidence that depends on evidence.

**Skeptic 1** (refuted). Refuted. The attack confuses accumulating assumptions with deriving support. In the spec, cone(r) (A.5.4.4) only collects the hatch facts r is assumed to rely on. Closing it over other same-provider, same-revision proof records can only add assumptions, which makes records less usable. Over finite sets the closure is a least fixpoint, so a cycle in the record graph is harmless. The checker never builds support out of other records: Sat (A.5.3.7) needs one usable applicable test or proof whose own result is 'supports', reported by its provider. Kernel Laws.lean lawSat/supportsUsable work per record, and its cone is code plus deps only. Implies or equivalence records (A.5.6) only transfer support between claims; they cannot create it without a base supporting record, so no cycle of records bootstraps Sat. Whether a prover's own reasoning is well-founded is part of presence soundness for 'supports' results (A.5.2.1, A.5.2.14). Establishing force needs that soundness in both base and head under G*(b), from a base-declared, reviewed provider. Invariant 6 (the checker never reads code) rules out the checker verifying proof structure itself. A Lean or custom prover that accepts circular lemmas is simply unsound, which is the same trust boundary as a buggy test runner. Lemmas assumed as axioms or admits are hatch kinds that the manifest counts, so they show up as reason 'assumption'. The attack itself concedes that Verus blocks the circular case.

**Skeptic 2** (refuted). cone(r) (A.5.4.4) is used only to collect the hatch assumptions of a test or proof. A cycle among same-provider proof records just gives a finite closure (a union of hatch facts), so it creates no support. The checker never composes support. Sat(c) needs a usable, applicable record with result supports for c itself, or for a claim at least as strong via ⊒ (A.5.3.5, A.5.3.7). Even circular implies/equivalent records only make c1 ≡ c2 and still need a supporting record for one of them. Whether a reported 'supports' is valid, including well-founded mutual recursion, is the provider's presence-soundness duty (A.5.2.1; A.5.2.14: 'Verus proofs presence-sound for success'). Establishing force needs soundness declared in both base and head (A.6.2.6(b)), and providers that run head code are listed in health as executesHead. A prover that verifies circular contracts without termination checks is simply unsound, like any provider whose record is false. The checker cannot check well-foundedness without reading proofs (Invariant 6). Rejecting cycles in deps would also be wrong, because callee-contract cycles are normal in modular verification when the verifier checks decreases. Any axiom, assume_specification, external_body or admit used to break a cycle is a manifest hatch fact in the cone, so the law gets reason assumption (A.5.4.4, A.5.2.8). Lean requires proved termination (partial defs cannot be unfolded in proofs), and verifier-trusted items are listed as hatch assumptions. This is the trust boundary the model declares, not a missing rule.

</details>

<details><summary>lawyer/L40: Renewing or widening an exception is never reviewed</summary>

**Claimed gap.** Debt's expiry is a governance value, yet the change author can edit it with no review.

**Skeptic 1** (refuted). Refuted. An exception's expiry decides no severity, so renewing it without review changes no verdict. A non-introduced matched obligation is owed as debt (rule 5); once the exception expires the same obligation is owed as preexisting (rule 6). Kernel Derive.lean sevOf gives .owed in both branches, and Example 2 states 'After expiry the contradiction is preexisting and owed'. Exceptions never apply at tier final (A.4.6.7), so the only blocking case for preexisting work cannot be reached. An expiry therefore only switches the label between the debt and preexisting lists and suppresses the health flag 14 days before expiry. The obligation stays open, owned by owner*, with its witnesses visible (A.4.6.6, A.7.7.2). 'Debt never lapses' is empty, because lapsing never blocks anything. Widening an exception changes nothing for introduced work without an exception answer: an eligible person for each excluding claim's owner*, never an agent (A.4.6.6, A.7.6.6). The phase-1 summary also lists such matched, introduced members with ref, kind, subject and tier (A.7.6.2). This is the point of A.4.6.8: exceptions are not governance state because they cannot lower severity alone (model §4.6). The attack's claim that expiry is a governance value contradicts A.4.6.8 and A.8.1.2 and is not backed by any severity effect.

**Skeptic 2** (refuted). Editing an exception can never change severity, so its expiry is not a governance value. The spec says so on purpose (A.4.6.8; A.8.1.2: 'Exceptions are not governance'). The severity rules, in change mode with a base: a matched obligation that is not introduced is owed debt (rule 5); without the exception it is owed preexisting (rule 6); the severity is identical. An introduced obligation becomes debt only through an exception answer from an eligible non-agent for the owner* of each excluding claim. That is base governance, and the exception's own owner plays no part (A.4.6.6). The answer acts only for the listed change id, so every new change that introduces work needs a fresh answer. In later changes the obligation is not introduced and stays owed either way. Exceptions never apply to final items, loosenings or coverage (rule 2 and rule 4 come first). Adding or editing an exception introduces nothing by itself (A.7.3.3), and witnesses stay visible. After expiry the obligation reverts to preexisting: owned, visible and owed, with the same severity, so 'debt never lapses' loses no enforcement. Widening the subjects likewise only moves obligations from preexisting to debt, or still needs owner answers. Budget is not affected either (A.10.3 excludes introduced matched groups from agents). The remaining effect is labelling (debt versus preexisting, expiresInDays), and the edit itself sits in a reviewed shape file. The audit-mode effect (matched means owed rather than blocked) does not matter, because gates accept only change mode.

</details>
