# PR attestations and optional Jev enforcement

## Contents

- Exact transition and obligations
- PR evidence
- Direct Jev review
- Results and policy
- Live canary

## Exact transition and obligations

Use this workflow for `drift-review` when implementation changed without a shape
update. First confirm the installed CLI supports `check --json --base` (these
flags require a source revision containing PR attestations; the released v0.9.0
binary does not provide them). The orchestration scripts below belong to the
ShapeLang source checkout and run with Bun.

Read `shapelang.json`. Absent `attestations.mode` means `repo` and preserves
existing `.shape` attestations. To opt in, set:

```json
{ "attestations": { "mode": "pr" } }
```

Do not mix modes. In `pr` mode repository attestations, including docs waivers,
are ignored. V1 external evidence supports only `no-shape-change`; satisfy docs
bindings by updating the required docs.

Commit the candidate and run from the repository root, keeping temporary files
outside the repository or ignored:

```bash
<SHAPE_CMD> check --base <base-commit> --head <head-commit> --json > /tmp/shape-check.json
```

`--base` is the exact baseline, not an implicit merge base. Resolve a merge base
first if that is the intended comparison. `--head` must be checked out. The
worktree must be clean, including untracked files. `--worktree` is an alternative
to `--head` for a clean HEAD; it does not attest uncommitted edits. Do not combine
these options with `--changed-files`. JSON goes to stdout even on failure; retain
the exit status. Exit 0 passes, 1 is semantic/evidence failure, 2 is parse/usage
failure. Do not reinterpret a crash or absent JSON as a pass.
Default discovery rejects sparse checkouts that omit tracked non-hidden `shape/**/*.shape`
files. Include the complete default model in the checkout before generating PR
evidence; explicit positional file arguments instead check their selected scope.

Read `transition`, `diagnostics`, and `obligations`. Only entries with type
`shape-change-or-attestation` are attestable. `shp obligations` still reports
design-memory obligations; it is a separate API. Fix parser, conformance, final
forbid, integrity and binding failures directly. The baseline/candidate pair and
normalised coverage condition determine each `shp-obligation-<sha256>` ID.

## PR evidence

Inspect the exact implementation diff, current authored declarations and relevant
relationships. Update the shape when its claims no longer describe the code.
Only create evidence when no architectural claim needs to change.

Use a versioned bundle with full commit IDs from checker output:

```json
{
  "version": 1,
  "base": "<full baseline commit ID>",
  "head": "<full candidate commit ID>",
  "attestations": [
    {
      "obligation": "<exact ID from obligations>",
      "kind": "no-shape-change",
      "rationale": "Specific source-confirmed reason the authored model remains faithful."
    }
  ]
}
```

Enclose one JSON or YAML fenced payload between the exact markers
`<!-- shapelang:attestations:v1 -->` and `<!-- /shapelang:attestations -->`.
Optionally use `<details><summary>ShapeLang attestations</summary>` around the
fence. Preserve all text outside those markers byte-for-byte. Reject duplicate,
unclosed or unsupported markers; do not guess which block is authoritative.
The ShapeLang checkout provides `pr-attestations.ts` helper in its root `scripts` directory
with arguments `extract|replace body.md output [bundle.json]` for this operation. The core never parses PR bodies
or calls GitHub.

Fetch the current body before updating; compare it again before writing if the
host supports concurrent edits. Update only the marked section using the host's
PR API. Do not add a repo attestation file in PR mode. A body edit must rerun CI
(the reference workflow includes the `edited` event).

Validate the extracted bundle with the exact same check and
`--attestations /tmp/bundle.json`. A missing block is absence of evidence.
Malformed schema, unsupported version, stale base/head, unknown obligation or
conflicting duplicates fail. Identical duplicates are harmless. Every new head
or baseline requires fresh inspection and evidence; never simply rewrite the
commit IDs on an old claim.

## Direct Jev review

Jev reviews whether source changes contradict the authored model or a PR claim.
A structurally valid attestation can clear deterministic coverage even when its
rationale is false. The semantic policy can block that contradiction separately.
It cannot waive a final forbid or any other deterministic error.

Use `run-jev-enforcement.ts` in the source checkout's root `scripts` directory.
It reads `deterministic.json` and any `attestations.json` from `SHAPE_OUTPUT_DIR`,
assembles source evidence, calls TypeSafe, validates artifacts, and writes
recommendations.
The reference `pr-enforcement.yml` under the repository's `docs` → `examples`
directory and the repository's `.github/workflows/pr-enforcement.yml` run this
directly with Bun. No Claude credential or agent-selected context is required.
`check-pr.ts` in the same root scripts directory supplies the initial and final
checker results after verifying the current GitHub PR body and exact event
base/head.

For a local run, first save the initial exact-transition JSON check as
`deterministic.json` under an output directory outside the worktree. Preserve its
exit status. When reviewing a PR claim, extract its current bundle as
`attestations.json` in that directory and validate it with the deterministic
checker. Then, with `TYPESAFE_API_KEY` exported, run from the clean candidate root:

```bash
shape_tools_scripts="$PWD/scripts"
SHAPE_OUTPUT_DIR=/tmp/shape-enforcement \
  JEV_REVIEW_POLICY=fail JEV_FAILURE_POLICY=fail \
  bun "$shape_tools_scripts/run-jev-enforcement.ts"
```

The explicit policies in this command make this local run blocking. Omitting
them uses advisory warnings. Fix non-attestable deterministic errors before
requesting semantic review. A missing initial JSON result, stale bundle, or
unknown obligation is not an empty successful review.

The assembler works from committed Git objects at the recorded base and head:

1. Cover every exact obligation path with its literal-path diff and complete
   before/after source. Working-tree edits are never evidence.
2. Resolve authored function source/effect anchors, their complete declarations,
   direct relationships, referenced resources, guards, and global constraints.
   Include before and after context. Generated AST candidates do not establish
   architectural claims, and filenames do not establish production/test roles.
3. Include the exact current claim when present. Review obligations from the
   initial check even when a claim already satisfies them in the final check.
4. Reject missing anchors, ambiguous context, unsupported files, more than 20
   files per obligation, more than 20 obligations, or more than 64 KiB of evidence.
   Request inspection or narrow the change explicitly; never silently truncate.
5. Submit the fixed `QUESTIONS_V1` from the bundled
   `scripts/jev-enforcement.ts` helper to TypeSafe. Without a claim, omit the
   plausibility question. Use optional `JEV_MODEL` to select a provider model.
6. Validate labels, finite [0,1] probabilities, and each distribution's sum. A
   failed request may retry once within the same 30-second deadline. Never retry
   a valid verdict to seek a different answer or normalize invalid probabilities.

The bundled helper remains available for explicitly assembled evidence:
`bun <skill-dir>/scripts/jev-enforcement.ts evidence.json result.json`.
Its exported TypeScript contracts define
`{version: 1, obligation, diff, shapeContext, graphContext?, attestation?}`.
Retain exact input, every returned result, and any `attemptFailures`; those
failure records preserve bounded numeric/status diagnostics without copying
arbitrary provider payloads. Never synthesize a distribution when a call fails.
Use `validateResult(result, obligation.id)` before consuming stored output.

## Results and policy

The result has `{version: 1, obligationId, questionContract: "v1", provider:
"typesafe", model, assessments, attemptFailures?}`. Assessments are probability
maps:

- `semanticChange`: `none`, `local`, `architectural`, `uncertain`.
- `shapeUpdateRequirement`: `required`, `not_required`, `uncertain`.
- Optional `attestationAssessment`: `supported`, `unsupported`, `uncertain`.

`recommend(result, threshold)` returns `shape-update`, `attestation-candidate`,
or `inspect`. The default threshold is 0.9; accepted values are greater than 0.5
and at most 1. High architectural scope, a required update, or an unsupported
claim recommends an update. A candidate requires high `none`, `not_required`,
and, when assessing a claim, `supported`. Mixed evidence requests inspection.
A candidate still needs source review and a specific rationale.

Recommendations and blocking policy are distinct:

| Script environment | Default | Policy |
| --- | --- | --- |
| `JEV_THRESHOLD` | `0.9` | Confidence threshold for recommendations and contradictions. |
| `JEV_REVIEW_POLICY` | `warn` | `fail` blocks high-confidence `required` or `unsupported`; architectural scope alone does not block. |
| `JEV_FAILURE_POLICY` | `warn` | `fail` blocks unavailable providers and invalid or missing evidence/results. |

The reference workflow maps `SHAPE_JEV_THRESHOLD`, `SHAPE_JEV_REVIEW_POLICY`, and
`SHAPE_JEV_FAILURE_POLICY` Actions variables to these environment variables.
Enable semantic review with `SHAPE_JEV_ENABLED=true` and provide the
`TYPESAFE_API_KEY` secret only for trusted repository branch authors. Forked PRs
receive no provider secrets. Never execute candidate code through
`pull_request_target`. Require deterministic and semantic jobs independently
when adopting blocking semantic policy. The deterministic PR job runs without
the semantic enable flag. `SHAPE_JEV_MODEL` maps to the optional `JEV_MODEL`.

Keep `unavailable`, `invalid_evidence`, `invalid_response`, missing artifacts,
and valid but uncertain distributions separate. A provider failure means no
semantic verdict was obtained. Uncertain results remain visible for inspection,
even under blocking policy. This review covers bounded coverage obligations;
it is not a whole-PR correctness review. A PR with no such obligations makes no
provider calls. Probabilities never certify correctness, create an attestation,
author model changes, clear deterministic failures, or approve a PR.

The runner writes `<obligation-id>.input.json`, `<obligation-id>.result.json`,
`semantic-summary.json`, and `recommendations.md` under `SHAPE_OUTPUT_DIR`.
Summaries and annotations identify paths, recommendations, model, distributions,
threshold, policy, and next action. `validate-jev-artifacts.ts` in the root scripts
directory independently checks every expected obligation, the exact current
claim, and its result before publishing that report. Preserve the output
directory in CI artifacts on both success and failure.

## Live canary

With `TYPESAFE_API_KEY` exported, run from the source checkout:

```bash
SHAPE_OUTPUT_DIR=/tmp/shape-jev-canary bun run jev:canary
```

The canary creates real Git fixtures for a harmless parameter rename, a false
claim hiding a destructive change, and a false claim with injected instructions.
Each claim first passes structural evidence validation. The canary then requires
the live semantic policy to accept the rename and block both false claims at
0.9 confidence, with provider/evidence failures also blocking.

Read `canary-summary.json` and the per-scenario artifacts before reporting a pass.
Failed attempts are retained. Set `SHAPE_JEV_CANARY_ENABLED=true` to run this in
the hosted workflow on repository PRs or manual dispatch, independently of the
semantic job's enable flag. A local pass only establishes these bounded cases
with that provider run. It does not prove hosted GitHub execution, all injection
resistance, or general source correctness.
Never claim a live provider call was tested from mocked or fixture results.
