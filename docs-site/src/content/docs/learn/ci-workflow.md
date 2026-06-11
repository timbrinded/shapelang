---
title: CI Workflow
description: Install the released Shape typechecker and run conformance checks in CI.
sidebar:
  order: 6
---

Shape is meant to run in review. In application repos, install a pinned `shp` release and run the checker directly.

![CI review workflow showing global Shape model files, changed files, coverage, shp check, and CI result.](../../../assets/infographics/global-model-review.png)

## Recommended workflow

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
      - uses: timbrinded/shapelang@v0.4.1
      - run: shp check
      - run: shp fmt --check
```

## Coverage gate

Coverage checks compare changed source paths with implementation blocks. A governed source change must be represented by a current `shape` update, or by a narrow attestation changed in the same change set:

```yaml
- name: Changed files
  run: git diff --name-only origin/main...HEAD > changed.txt

- name: Shape coverage
  run: shp coverage --changed-files changed.txt
```

If a governed source path changes without a Shape update or current attestation, the checker rejects the change.

## Claude Code contract review

CI can also run Claude Code as a PR job to check source semantics against the Shape model. This is separate from the deterministic checker: `shp check --changed-files` enforces current coverage and bindings, while Claude reviews whether the committed Shape claims faithfully describe the changed behavior.

The job needs `ANTHROPIC_API_KEY`, or `ANTHROPIC_AUTH_TOKEN` for proxy-backed repositories. Repositories that proxy Anthropic traffic can also set `ANTHROPIC_BASE_URL`. Detect the credential first so forked pull requests skip the Claude-only work instead of failing on an unavailable secret:

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
    - uses: oven-sh/setup-bun@v2
      id: setup-bun
      if: steps.claude-token.outputs.available == 'true'
    - run: bun install --frozen-lockfile
      if: steps.claude-token.outputs.available == 'true'
    - run: bun run changed-files
      if: steps.claude-token.outputs.available == 'true'
      env:
        GITHUB_BASE_REF: ${{ github.base_ref }}
        GITHUB_SHA: ${{ github.sha }}
    - name: Load structured output schema
      id: schema
      if: steps.claude-token.outputs.available == 'true'
      env:
        SCHEMA_PATH: .github/shape-contract/schemas/shape-contract-result.schema.json
      run: |
        node <<'NODE'
        const { readFileSync } = require("node:fs");
        const parseJsonValue = (value) => {
          if (typeof value !== "string") return value;
          const trimmed = value.trim();
          const candidates = [trimmed];
          const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
          if (fenced?.[1]) candidates.push(fenced[1].trim());
          for (const candidate of candidates) {
            try {
              return JSON.parse(candidate);
            } catch {}
          }
          return undefined;
        };
        const isShapeReview = (value) =>
          value !== null &&
          typeof value === "object" &&
          !Array.isArray(value) &&
          typeof value.status === "string" &&
          typeof value.summary === "string" &&
          Array.isArray(value.findings);
        const result = JSON.parse(readFileSync("claude-shape-review.json", "utf8"));
        const selected = [
          result.structured_output,
          parseJsonValue(result.result),
          result,
        ].find(isShapeReview);
        if (!selected) {
          console.error("Claude output did not include a valid Shape review object.");
          process.exit(1);
        }
        if (selected.status !== "pass" || selected.findings.length > 0) {
          console.error(JSON.stringify(selected, null, 2));
          process.exit(1);
        }
        console.log(selected.summary);
        NODE
```

Use a short prompt that makes `shape/` the authority:

```md
# Shape contract review

Review `changed.txt` against the durable Shape model in `shape/**/*.shape`.
For changed source behavior that affects the architecture contract, require a
faithful current Shape update or a narrow current attestation.

Run `bun shp check --changed-files changed.txt`, `bun shp obligations`, and
`bun shp memory`. Use `bun shp explain` when a symbol needs context and
`bun shp analyze` only as advisory input.

Return structured output with `status: "pass" | "drift" | "error"` and terse
evidence-backed findings.
```

## Shape repo workflow

The Shape repository dogfoods this workflow more strictly than a normal consumer repo. CI generates `changed.txt`, then runs formatting, semantic checks, coverage, obligations, and memory output:

```bash
bun run changed-files
bun run shape:ci
```

`shape:ci` runs `bun run ast:check` and then `bun shp check --changed-files changed.txt`, so generated AST context, implementation coverage, and bindings are checked together. Bindings are used for documentation coupling: if Shape-affecting code or model files change, the associated docs must change too, unless the current change set includes a narrow current `docs_not_needed` attestation.

On pull requests from repository branches, CI also upserts a single Shape CI summary comment. The comment reports the `Shape`, `Shape Claude Review`, `Shape Contract Guard`, and `Shape Index Coverage` job results for the latest commit and links back to the workflow run.

## Skill-driven PR jobs

The Shape repository runs three Claude-powered PR jobs, all driven by one
script: `.github/scripts/run-claude-skill.mjs`, invoked as
`node run-claude-skill.mjs review|guard|index` from the shared
`.github/actions/claude-skill-review` composite action (Bun toolchain, pinned
Claude Code CLI, run, gate). Each job detects Anthropic credentials first and
skips cleanly when none are available, validates the model's structured result
against a strict JSON schema under `.github/shape-contract/schemas/`, renders a
job summary, and gates on a per-skill policy. Two of the jobs start with a
deterministic prefilter, so most pull requests never invoke the model.

**Shape Claude Review** (`shape-claude-review`) checks source-to-model drift
using the policy in `.github/prompts/shape-contract-review.md`; any finding or
non-pass status fails the job.

**Shape Contract Guard** (`shape-guard`) applies
`plugins/shapelang/skills/shape-contract-guard/SKILL.md` (policy in
`.github/prompts/shape-guard.md`) to the authored `.shape` diff against the PR
base: removed final forbids, weakened traits, widened grants or effects,
relation or coverage weakening, and weak attestations. If no authored `.shape`
file changed, the prefilter emits a `pass` result without calling Claude.
Findings are advisory by design; only a `high`-severity finding (or a review
error) fails the job.

**Shape Index Coverage** (`shape-index`) applies
`plugins/shapelang/skills/shape-index/SKILL.md` (policy in
`.github/prompts/shape-index.md`) as an audit: the prefilter computes which
changed source files no authored `shape/*.shape` source/evidence ref or
`implementation` paths glob covers, and only asks Claude to judge that
uncovered remainder for architecture-significant subsystems lacking Layer-2
coverage. Gaps are reported in the job summary and PR comment but stay
non-blocking unless the repository sets the `SHAPE_INDEX_STRICT` Actions
variable to `true`.

## Direct binary install

If you do not want to use the setup action, use the release installer directly:

```yaml
- name: Install shp
  run: |
    curl --proto '=https' --tlsv1.2 -LsSf https://github.com/timbrinded/shapelang/releases/download/v0.4.1/install.sh | sh
```

Keep CI installs pinned to an explicit release. `shp update` is intended for local developer binaries and should not replace pinned CI installation.

## Shape repo checks

The Shape repository itself also runs Bun workspace tests, typechecking, docs verification, and release smoke tests. Those are contributor checks, not required for application repos that only consume `shp`.

See [Local Development](../reference/local-development) for the contributor commands.
