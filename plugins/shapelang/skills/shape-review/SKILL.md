---
name: shape-review
description: Use when Codex needs to review a code change (a PR or diff) for real bugs, using a whole-codebase Shape model to catch cross-object issues the diff alone can't show. Runs an exhaustive local recall pass (prune nothing), augments with cited cross-object findings from the Shape model, then applies a closed-list reality gate and a human-salience emission gate — emit the issues a careful reviewer would flag, and never drop a severe bug.
---

# Shape Review — human-salience prediction gate

Find the real bugs a careful human reviewer would flag in this change — and only those.
Two forces pull against each other and must both be honored: catch every real bug
(recall), and don't emit noise a human wouldn't bother flagging (precision). The
distinctive mechanism here is to predict that human salience directly, per candidate,
and emit on it — rather than suppressing by blanket category.

Two facts shape the procedure and must both hold:
- Recall first. Most real bugs are LOCAL. If you never write a real bug down, no gate
  can recover it. The exhaustive local pass (Step 1) is the recall foundation and
  is never shortchanged or pre-filtered.
- Precision via salience, not via blanket suppression. The only authority to remove a
  candidate is the closed-list named-reason gate (Step 4) plus one bounded
  low-salience-trivia drop (Step 5), and a SEVERE candidate is kept even under doubt.
  Category bans ("skip pure functions", "only high-severity", a separate "drop the
  false positives" sweep) collapse recall and are forbidden.

Use the whole-codebase Shape model on EVERY change, even a one-line diff — it is never
skipped or suppressed. Follow the `shape-lang` skill and its `cli-workflows` reference.
Use ONLY real `shp` commands: `shp graph [--stats] [SYMBOL] [--kind calls]`,
`shp explain SYMBOL`, `shp check`, `shp analyze`, `shp obligations`, `shp memory`. Do
not invent commands and do not treat analyzer hints as ground truth — confirm against
the code.

Work the steps in order, then emit your review (format in Step 6).

## Step 1 — Exhaustive local recall pass (cast wide; prune NOTHING here)

Review the diff exactly as a rigorous diff-only reviewer would and write down EVERY
plausible real defect visible in the changed code. This is purely a recall step: be
deliberately generous. If a line could be a real bug, record it. Do NOT prune, do NOT
weigh confidence, do NOT think about salience or precision yet — every removal happens
later, in Steps 4 and 5.

Sweep at minimum for:
- Logic errors, inverted/off-by-one conditionals, wrong operator, wrong variable.
- Null/None/undefined/zero-value dereference; missing existence or bounds checks.
- Error handling: swallowed errors, unchecked returns, wrong error path, missing rollback.
- Resource lifecycle: leaks, unclosed handles/locks/transactions, double-free/close.
- Concurrency: races, missing await/lock, check-then-act, ordering assumptions.
- Security: injection, missing authz/authn, unvalidated trust-boundary input, path/SSRF,
  secret exposure, unsafe deserialization.
- Incorrect API/library usage given the function's own signature and the visible call.
- State/data bugs: mutation of shared/aliased data, stale cache, wrong default, lossy
  coercion, lost write, missing transaction.

Record each candidate as `{path, line, body}` where `body` states the bug AND why it is
wrong, and note its suspected MECHANISM (the exact token/value/line that breaks). Keep
candidates even at moderate or low confidence — this list is your recall floor and must
be as complete as a dedicated reviewer's. Mark each finding `class: local`.

## Step 2 — Load Shape context (always run; informs Steps 3, 4 and the salience gate)

Orient in the model. This context feeds three later jobs: finding cross-object bugs
(Step 3), supplying named kill-reasons (Step 4), and — critically — judging whether a
candidate violates an AUTHORED invariant, which is the strongest single salience signal
(Step 5).

1. `shp graph --stats` — one-shot overview (vertices, hyperedges, arity, isolated vertices).
2. For each symbol changed in the diff: `shp explain <Symbol>` (derived facts, declared
   effects, return/ownership contract, rationale, memory, source anchor) and
   `shp graph <Symbol> --kind calls` (callers and callees — out-of-diff callers are where
   broken-contract bugs hide).
3. `shp check` — surface model-level diagnostics relevant to the changed area.
4. When a write/delete/permission/ownership/atomicity concern is involved: `shp obligations`
   and `shp memory` for guards and invariants on the changed targets, and
   `shp analyze --shape-files <model.shape> <changed-source-file>` to compare the diff's
   actual effects against the declared contract.

Read the output before claiming anything. Model silence is not evidence either way.

## Step 3 — Cross-object augment (bugs the diff cannot show; each one cited)

Using the Step-2 context, add real bugs that require understanding beyond the diff. For
each, you MUST name the specific model fact it violates and the `shp` command + symbol
that revealed it — an un-citable cross-object claim is a guess and is not admitted (this
citation gate applies to cross-object findings ONLY; it never touches a Step-1 local
finding). Look for:

- **Dependency-contract misuse** — the diff calls a function defined outside the diff
  against its declared effects/return/precondition contract (cite it from `shp explain`).
- **Violated invariant** — breaks an owned-resource invariant or cross-module contract
  (unaudited write, permission/ownership rule, atomicity, memory guard) declared elsewhere
  (cite `shp explain` / `shp memory` / `shp obligations`).
- **Broken caller** — the change alters a contract such that callers NOT in the diff
  (from `shp graph <Symbol> --kind calls`) now misbehave: now-wrong argument/return
  assumption, unhandled new error/sentinel, or a dropped effect they relied on.
- **Cross-component race / ordering** — a shared resource is mutated from multiple
  components without the `coordinated_call`/coordination the model implies.

Add each as a `{path, line, body}` candidate marked `class: cross-object`, carrying its
cited model fact in the body and noting its mechanism. If the model reveals nothing
cross-object, add nothing — that is the expected case on local-only changes, not a gap.
Do not let Shape additions tempt you to re-drop Step-1 survivors, and do not duplicate one.

## Step 4 — Reality gate (the only named-reason suppression; keep-on-doubt)

Walk every candidate from Steps 1 and 3 exactly once. The DEFAULT action is KEEP —
keeping requires no justification. You may drop a candidate ONLY by citing ONE concrete,
evidence-backed reason from this CLOSED list (no other reason is legal here):

- **Provably handled** — visible code or the Shape model shows the concern is already
  guarded (the null is checked upstream; the cited contract/invariant actually permits
  this; the effect is declared and satisfied).
- **Provably unreachable** — the path cannot execute (guarded by a condition, dead
  branch, a type that makes the value impossible), shown by visible code or the call graph.
- **Misread** — re-reading the hunk shows the candidate rests on a misreading (wrong
  line, wrong variable, the operator is actually correct), OR a cross-object citation, on
  re-check, does not prove a violation (the cited contract permits it, the relation isn't
  what you assumed, the invariant doesn't apply on this path).
- **Duplicate** — the same bug at the same location is already in the list (merge; keep
  the clearest, most precise body).
- **Not a bug class** — pure style/naming/formatting/idiom preference with NO behavioral,
  correctness, security, data, or concurrency consequence at all.

Rules for this gate, stated to prevent recall collapse:
- If NONE of the five reasons applies, you KEEP. Full stop.
- "I'm not fully sure", "this feels speculative", "probably fine", "low confidence" are
  NOT kill-reasons here. On any doubt about whether it is a real bug, you KEEP.
- Never drop a candidate merely for lacking supporting evidence — this gate asks whether
  there is a cited reason AGAINST the bug, not whether there is evidence FOR it.
- Never apply a category ban (no "skip pure functions", no "only high severity"). Blanket
  category suppression has destroyed recall; this closed list exists to forbid it.

The survivors of Step 4 are the set of candidates you believe are REAL bugs. Step 5
decides which of those a human would actually flag.

## Step 5 — Human-salience prediction gate (the precision lever)

For each Step-4 survivor, predict whether a careful human reviewer would flag THIS bug
in THIS change. This is a salience judgment about a bug you already believe is real; it
is NOT a second reality check and it is NOT a blanket category filter. Reason from these
concrete signals (do not free-float):

1. **Severity** — correctness / security / data-loss / data-corruption / concurrency
   defects are high-salience; humans flag them. A bug whose worst outcome is cosmetic,
   purely theoretical, or a micro-inefficiency is low-salience.
2. **Behavior impact** — does it change observable behavior or persisted/shared state for
   a realistic input or call path you can name (high), or is it only a theoretical
   weakness with no triggering path you can describe (low)?
3. **Non-obviousness** — a subtle defect a human would stop to call out (an edge case, a
   silent wrong result, a broken invariant) is high-salience; a triviality that any reader
   would shrug at, or that lint/types/tests would already catch, is low-salience.
4. **Authored-invariant violation (strongest signal)** — if the candidate violates a
   contract/effect/invariant/guard that the Shape model shows was deliberately authored
   (visible via `shp explain` / `shp obligations` / `shp memory`), humans almost always
   flag it. Treat a cited authored-invariant break as high-salience by default.

Decision:
- **Emit** the candidate if it is salient-and-real: it carries real behavior impact OR
  is high-severity OR violates an authored invariant. When a real bug is genuinely
  borderline on salience, lean EMIT — a missed real bug costs recall, and over-trimming
  here re-creates the precision/recall trade we are trying to beat.
- **Drop as low-salience trivia** ONLY a candidate that is real but clearly low on ALL of
  the above: low severity, no nameable behavior impact, obvious/trivial, and no authored
  invariant violated. Name why it is low-salience trivia (the same discipline as a
  kill-reason) — this is the only suppression in this step.
- **Hard guardrail (overrides every drop):** NEVER drop a candidate of severity
  correctness / security / data-loss / data-corruption / concurrency for "low salience".
  A severe real bug is kept even under doubt about whether a human would have flagged it —
  false negatives on severe bugs are the worst outcome. Low-salience trimming applies
  exclusively to genuinely minor, non-severe findings.

This gate aligns what you emit with what a human reviewer would actually flag: it removes
the technically-real-but-trivial extras a human would ignore, while the Step-1/4 recall
foundation keeps the real local bugs and the cited cross-object survivors carry the
structural bugs that need whole-codebase understanding.

## Step 6 — Assemble and emit

Union the salient survivors (local + cross-object). Merge exact duplicates (keep the
clearest body). For EVERY emitted comment, the `body` must state the bug AND its
mechanism so a reader could check it:
- **Local bug:** name the exact failing token/value/line and the input or state under
  which it breaks (e.g., "when `items` is empty, `items[0]` on line 142 is `undefined`
  and `.id` throws").
- **Cross-object bug:** name the specific violated contract / invariant / effect /
  relation / memory exactly as it appears in the model, plus the `shp` command that
  revealed it (e.g., "violates the `audited` effect declared on `AuditStore.purge`
  (`shp explain AuditStore.purge`): the new path deletes without the required audit
  write").

One concrete bug per comment. No style nitpicks, no naming/refactor suggestions, no
speculative architecture, no summaries, no praise, no general advice. Do NOT include
salience scores, confidence values, class labels, or gating reasoning in `body`.

Emit the final review as JSON:

```json
{"comments": [{"path": "relative/file.ext", "line": 42, "body": "one concrete issue"}]}
```

`path` is repo-relative; `line` is the line where the bug must be fixed (for a broken
caller, the caller's line). If after the gates there are no salient real bugs, emit
exactly `{"comments": []}` — an empty review is correct when nothing salient and real
remains. Do not relax the gates to pad the output, and do not drop a severe real bug to
trim the list.
