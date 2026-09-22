---
title: CI Workflow
description: Pin the released shp binary and run Shape conformance and coverage checks in CI.
sidebar:
  order: 6
---

Shape checks belong in review and CI. In application repos, install a pinned `shp` release and run the deterministic checker. This page separates consumer gates from optional LLM-assisted review and from the stricter workflow used inside the Shape repository itself.

![CI review workflow showing global Shape model files, changed files, coverage, shp check, and CI result.](../../../assets/infographics/global-model-review.png)

## Product boundary in CI

- `shp check` accepts or rejects the declared `.shape` model and review obligations.
- Coverage and bindings enforce that the current change set updated the model (or attested) when governed or bound paths change.
- Shape does not replace application tests, typechecking, or human code review of implementation quality.
- Optional Claude or analyzer jobs are advisory or policy-gated; they do not redefine the deterministic checker.

## Recommended consumer workflow

```yaml
name: Shape

on:
  pull_request:
  push:
    branches:
      - main

jobs:
  shape:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4
      - uses: timbrinded/shapelang@v0.9.0
      - run: shp check
      - run: shp fmt --check
```

Pin the setup action (or installer) to an explicit release such as `v0.9.0`. Do not use `shp update` as the CI install path; that command is for local developer binaries.

## Coverage gate

Coverage compares changed source paths with implementation blocks. A governed source change must be represented by a current Shape update, or by a narrow attestation in a `.shape` file changed in the same change set:

```yaml
- name: Changed files
  run: git diff --name-only origin/main...HEAD > changed.txt

- name: Shape coverage
  run: shp coverage --changed-files changed.txt
```

Alternatively:

```yaml
- run: shp check --changed-files changed.txt
```

`shp check --changed-files` runs semantic checks plus coverage and bindings. If a governed source path changes without a Shape update or current attestation, the check rejects the change. See [Implementations and Coverage](../concepts/implementations-coverage).

## Direct binary install

If you do not use the setup action:

```yaml
- name: Install shp
  run: |
    curl --proto '=https' --tlsv1.2 -LsSf https://github.com/timbrinded/shapelang/releases/download/v0.9.0/install.sh | sh
    echo "$HOME/.local/bin" >> "$GITHUB_PATH"
```

Keep CI installs pinned to an explicit release.

## Optional machine-readable model artifact

After the strict check passes, a workflow can export the accepted authored model
for a visualizer or another local reporting tool:

```yaml
- name: Check Shape
  run: shp check

- name: Export Shape model
  run: shp inspect --json > shape-model.json
```

`shp inspect --json` uses the same recursive `shape/**/*.shape` discovery and
canonical lowering as the CLI's model queries. Its schema is versioned, its IDs
are module-qualified, and it has no current-time field. Identical inputs and the
same pinned `shp` version therefore produce identical bytes. The export is not a
CI gate by itself: keep `shp check` before it, and make downstream consumers
reject unsupported inspection schema versions.

## Optional Claude contract review

Some teams run Claude Code as a separate PR job to review whether committed Shape claims faithfully describe changed behavior. That job is not a substitute for `shp check` or `shp coverage`.

Run the review through the official [`anthropics/claude-code-action`](https://github.com/anthropics/claude-code-action). It installs Claude Code, runs the prompt headless, and when `--json-schema` is passed in `claude_args` it validates the model’s final answer and exposes it as a `structured_output` step output. The action’s credential check accepts `ANTHROPIC_API_KEY` or a Claude Code OAuth token. Proxy-backed repositories can authenticate with `ANTHROPIC_AUTH_TOKEN` and `ANTHROPIC_BASE_URL` instead: the action forwards its environment to Claude Code, so set both on the job env and pass the token through the `anthropic_api_key` input to satisfy the credential check. Detect the credential first so forked pull requests skip the Claude-only work instead of failing on an unavailable secret:

```yaml
shape-claude-review:
  if: github.event_name == 'pull_request'
  runs-on: ubuntu-latest
  steps:
    - name: Detect Claude credentials
      id: claude-token
      env:
        ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        ANTHROPIC_AUTH_TOKEN: ${{ secrets.ANTHROPIC_AUTH_TOKEN }}
      run: |
        if [ -n "${ANTHROPIC_API_KEY:-}" ] || [ -n "${ANTHROPIC_AUTH_TOKEN:-}" ]; then
          echo "available=true" >> "$GITHUB_OUTPUT"
        else
          echo "available=false" >> "$GITHUB_OUTPUT"
          echo "Skipping Claude Shape contract review because no Anthropic API credential is available."
        fi
    - uses: actions/checkout@v4
      if: steps.claude-token.outputs.available == 'true'
      with:
        fetch-depth: 0
    - run: git diff --name-only "origin/${{ github.base_ref }}...HEAD" > changed.txt
      if: steps.claude-token.outputs.available == 'true'
    - name: Run Claude Shape contract review
      id: claude
      if: steps.claude-token.outputs.available == 'true'
      uses: anthropics/claude-code-action@v1
      env:
        ANTHROPIC_AUTH_TOKEN: ${{ secrets.ANTHROPIC_AUTH_TOKEN }}
        ANTHROPIC_BASE_URL: ${{ secrets.ANTHROPIC_BASE_URL }}
      with:
        anthropic_api_key: ${{ secrets.ANTHROPIC_AUTH_TOKEN || secrets.ANTHROPIC_API_KEY }}
        github_token: ${{ github.token }}
        prompt: |
          Review changed.txt against the durable Shape model in shape/**/*.shape.
          For changed source behavior that affects the architecture contract,
          require a faithful current Shape update or a narrow current attestation.
          Return status "pass" only when the model faithfully covers the change.
        claude_args: |
          --model claude-sonnet-4-6
          --max-turns 100
          --disallowedTools Write,Edit
          --json-schema '{"type":"object","additionalProperties":false,"required":["status","summary","findings"],"properties":{"status":{"type":"string","enum":["pass","drift","error"]},"summary":{"type":"string"},"findings":{"type":"array","items":{"type":"string"}}}}'
    - name: Gate on the review result
      if: steps.claude-token.outputs.available == 'true'
      env:
        REVIEW_RESULT: ${{ steps.claude.outputs.structured_output }}
      run: |
        node <<'NODE'
        const result = JSON.parse(process.env.REVIEW_RESULT || "{}");
        if (result.status !== "pass" || (result.findings ?? []).length > 0) {
          console.error(JSON.stringify(result, null, 2));
          process.exit(1);
        }
        console.log(result.summary);
        NODE
```

Use a short prompt that makes `shape/` the authority:

```md
# Shape contract review

Review `changed.txt` against the durable Shape model in `shape/**/*.shape`.
For changed source behavior that affects the architecture contract, require a
faithful current Shape update or a narrow current attestation.

Run `shp check --changed-files changed.txt`, `shp obligations`, and
`shp memory`. Use `shp explain` when a symbol needs context and
`shp analyze` only as advisory input.

Return structured output with `status: "pass" | "drift" | "error"` and terse
evidence-backed findings.
```

In Bun workspaces that invoke the CLI via package scripts, substitute `bun shp` for `shp` only when that is how the repo packages the binary.

## Shape repository workflow

The Shape repository dogfoods this workflow more strictly than a normal consumer repo. CI generates `changed.txt`, then runs formatting, semantic checks, coverage, obligations, and memory output:

```bash
bun run changed-files
bun run shape:ci
```

`shape:ci` runs `bun run ast:check` and then `bun shp check --changed-files changed.txt`, so generated AST context, implementation coverage, and bindings are checked together. Bindings are used for documentation coupling: if Shape-affecting code or model files change, the associated docs must change too, unless the current change set includes a narrow current `docs_not_needed` attestation.

On pull requests from repository branches, CI also upserts a single Shape CI summary comment. The comment reports the `Shape`, `Shape Claude Review`, `Shape Contract Guard`, and `Shape Index Coverage` job results for the latest commit and links back to the workflow run.

### Skill-driven PR jobs

The Shape repository runs three Claude-powered PR jobs, all driven by one script: `.github/scripts/run-claude-skill.mjs`, invoked from the shared `.github/actions/claude-skill-review` composite action. The script runs twice per job: a `--prefilter` pass that either finishes deterministically or emits the prompt and `claude_args` (Sonnet by default), the official `anthropics/claude-code-action` runs the model call with `--json-schema` structured output, and a gate pass validates the result against the strict JSON schema under `.github/shape-contract/schemas/`, renders a job summary, and gates on a per-skill policy. When a proxy gateway drops structured output, the gate recovers the JSON result from the action’s execution log instead. Each job detects Claude credentials first and skips cleanly when none are available. PR review jobs prefer an existing `CLAUDE_CODE_OAUTH_TOKEN` when configured, clear conflicting gateway credentials, and use the official Anthropic endpoint. Other callers without OAuth retain their configured API route. Two of the jobs start with a deterministic prefilter, so most pull requests never invoke the model.

Recovery requires a successful Claude execution. An explicitly failed run cannot
pass using a partial JSON result. Rate limits, authentication failures, and
timeouts produce a failing summary without copying sensitive provider payloads.
The PR jobs use Claude's default request timeout and a 30-minute job limit.

**Shape Claude Review** (`shape-claude-review`) checks source-to-model drift using the policy in `.github/prompts/shape-contract-review.md`; any finding or non-pass status fails the job.

**Shape Contract Guard** (`shape-guard`) applies `plugins/shapelang/skills/shape-contract-guard/SKILL.md` (policy in `.github/prompts/shape-guard.md`) to the authored `.shape` diff against the PR base. It normalizes before/after facts, classifies semantic impact separately from supporting decision evidence, and checks removed final forbids, weakened traits, widened grants or effects, relation or coverage weakening, and weak attestations. If no authored `.shape` file changed, the prefilter emits a `pass` result without calling Claude. Findings remain advisory interpretations; the host fails only for a high-impact suspicious finding or a review error. Specifically supported high-impact changes remain visible for human review without being silently reclassified as low impact.

**Shape Index Coverage** (`shape-index`) applies `plugins/shapelang/skills/shape-index/SKILL.md` (policy in `.github/prompts/shape-index.md`) as an audit: the prefilter computes which changed source files no authored `shape/*.shape` source/evidence ref or `implementation` paths glob covers, and only asks Claude to judge that uncovered remainder for architecture-significant subsystems lacking Layer-2 coverage. Gaps are reported in the job summary and PR comment but stay non-blocking unless the repository sets the `SHAPE_INDEX_STRICT` Actions variable to `true`.

### Shape repo contributor checks

The Shape repository itself also runs Bun workspace tests, typechecking, docs verification, and release smoke tests. Those are contributor checks, not required for application repos that only consume `shp`.

See [Local Development](../reference/local-development) for the contributor commands.

Official releases add a separate blocking skills candidate workflow and manual
environment approval before tagging. See [Releasing Shape](../reference/releasing).

## Practice

**Do**

- Pin `shp` (or the setup action) to a release tag in every environment
- Fail CI on strict `shp check` without `--allow-unknown-effects`
- Produce `changed.txt` the same way locally and in CI when testing coverage
- Keep optional LLM review jobs credential-gated and secondary to the deterministic checker

**Do not**

- Soften final forbids or drop coverage only to green CI
- Treat Claude findings as a replacement for model updates when the contract changed
- Require Shape-repo-only Bun workflows in pure consumer application repos

## Related pages

- [Quickstart](./quickstart)
- [Global Model Updates](./global-model-updates)
- [CLI Reference](../reference/cli)
- [Model Updates and Attestations](../concepts/model-updates-attestations)

## Optional PR evidence and Jev workflow

PR attestations close a specific coverage obligation for an exact base/head
transition. Their deterministic validation establishes scope and freshness; it
does not establish that the rationale faithfully describes the implementation.
Jev adds a source review of that claim. A destructive source change accompanied
by a "rename only" claim can therefore pass evidence validation and still fail
the separately configured semantic review.

The repository includes an opt-in workflow at
`.github/workflows/pr-enforcement.yml` and a consumer reference at
`docs/examples/pr-enforcement.yml`. These require a ShapeLang source revision
containing PR attestations and its Bun helper scripts. The released v0.9.0 binary
does not provide this workflow. Consumers should use a reviewed tools revision
in a separate checkout and adapt the CLI/helper paths.

The deterministic job checks out the exact PR head, fetches the current PR body,
verifies the event base/head, discovers obligations, extracts typed evidence, and
reruns the check with that evidence. Include the `edited` PR event so editing
evidence reruns the check. Commit the candidate first and keep the worktree clean,
including untracked files. Store intermediate artifacts outside the repository.

The failing check step prints human-readable diagnostics and emits GitHub error
annotations for the final result, with file locations where available. Its exit
status remains the checker’s status. The job summary publishes `check.md`; full
`deterministic.json` and `check.json` results remain in the uploaded artifact.
Errors cleared by accepted evidence are not annotated. Missing or unreadable
checker output fails reporting explicitly instead of showing a passing summary.

Set `attestations.mode` to `pr` in `shapelang.json`. The default `repo` mode remains
unchanged. Require the deterministic job independently in branch protection.

### Direct semantic review

Enable the `SHAPE_JEV_ENABLED` Actions variable and set `TYPESAFE_API_KEY` as a
secret. The semantic job runs `bun scripts/run-jev-enforcement.ts`; it needs no
Claude credential or agent to select evidence. Enable this only for repository
branches whose authors may use the key. Forked PRs receive no provider secrets,
and the workflow does not use `pull_request_target` to execute candidate code.

For each obligation from the initial deterministic check, the assembler reads
the exact committed diff and full before/after source files. It includes
source-anchored authored declarations, direct relationships, referenced claims,
and relevant constraints. It also includes the current PR attestation, even when
that attestation already satisfies the deterministic gate. Missing authored
anchors, ambiguous context, or evidence exceeding 20 files or 64 KiB require
inspection; the assembler does not silently omit or truncate them.

The fixed questions assess semantic scope, whether a Shape update is required,
and, when present, whether the attestation is supported. Every returned label,
probability, and probability sum is validated. At most one retry shares the
30-second request budget; failed attempts remain in the artifacts. Responses
are never silently normalized into valid distributions.

| Actions variable | Default | Effect |
| --- | --- | --- |
| `SHAPE_JEV_ENABLED` | unset | Set to `true` to run the semantic job; the deterministic PR job runs independently. |
| `SHAPE_JEV_MODEL` | `jev-latest` | Provider model sent with the fixed questions. |
| `SHAPE_JEV_THRESHOLD` | `0.9` | Probability required for a confident recommendation; must be greater than 0.5 and at most 1. |
| `SHAPE_JEV_REVIEW_POLICY` | `warn` | Set to `fail` to block a high-confidence Shape-update requirement or unsupported attestation. |
| `SHAPE_JEV_FAILURE_POLICY` | `warn` | Set to `fail` to block provider failures or missing/invalid evidence and results. |
| `SHAPE_JEV_CANARY_ENABLED` | unset | Set to `true` to run the hosted live canary on repository PRs or manual dispatch. |

The scripts use `JEV_THRESHOLD`, `JEV_REVIEW_POLICY`, and `JEV_FAILURE_POLICY`
environment variables; the workflow maps the Actions variables above to them.
`SHAPE_JEV_MODEL` maps to `JEV_MODEL`. Scope classified as
`architectural` alone does not fail review. Mixed or uncertain results request
inspection and remain visible. Even with both policies set to `fail`, this is a
review of bounded coverage obligations, not a complete correctness review of the
PR. Require the semantic job separately when adopting its blocking policy.

Job summaries and file annotations state the recommendation and next action.
Uploaded artifacts retain `deterministic.json`, `check.json`, any
`attestations.json`, every `<obligation-id>.input.json` and
`<obligation-id>.result.json`, `semantic-summary.json`, and `recommendations.md`.
A failed provider attempt has no semantic verdict. No result creates an
attestation, edits a model, suppresses a deterministic failure, or approves a PR.

### Live canary

With `TYPESAFE_API_KEY` exported, run from the source checkout:

```bash
SHAPE_OUTPUT_DIR=/tmp/shape-jev-canary bun run jev:canary
```

The canary creates real Git fixtures and checks that a rename-only claim is
accepted, a false claim about a destructive change is blocked, and an injected
instruction in that claim does not make it pass. It exercises the real provider
and separate review policy, and retains evidence on success or failure. Assess
its generated report before claiming a live integration passed; fixture tests
alone do not demonstrate provider behavior or hosted GitHub execution.
