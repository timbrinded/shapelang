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
      - uses: timbrinded/shapelang@v0.4.0
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
        const { appendFileSync, readFileSync } = require("node:fs");
        const schema = JSON.stringify(JSON.parse(readFileSync(process.env.SCHEMA_PATH, "utf8")));
        appendFileSync(process.env.GITHUB_OUTPUT, `json_schema=${schema}\n`);
        NODE
    - name: Install Claude Code
      if: steps.claude-token.outputs.available == 'true'
      run: |
        curl -fsSL https://claude.ai/install.sh | bash
        echo "$HOME/.local/bin" >> "$GITHUB_PATH"
        "$HOME/.local/bin/claude" --version
    - name: Run Claude Shape contract review
      id: claude
      if: steps.claude-token.outputs.available == 'true'
      env:
        ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        ANTHROPIC_BASE_URL: ${{ secrets.ANTHROPIC_BASE_URL }}
        ANTHROPIC_AUTH_TOKEN: ${{ secrets.ANTHROPIC_AUTH_TOKEN }}
        JSON_SCHEMA: ${{ steps.schema.outputs.json_schema }}
      run: |
        set -euo pipefail
        prompt=$(cat <<'PROMPT'
        Read AGENTS.md when it exists, then read
        .github/prompts/shape-contract-review.md.

        Analyze this repository for Shape contract drift.
        Changed files are listed in changed.txt.
        Populate the configured structured-output fields.
        Do not modify tracked repository files.
        PROMPT
        )
        claude -p "$prompt" \
          --max-turns 100 \
          --output-format json \
          --allowedTools "Read,Glob,Grep,LS,Bash(git diff *),Bash(git show *),Bash(bun run shape:ci),Bash(bun shp check *),Bash(bun shp obligations *),Bash(bun shp memory *),Bash(bun shp explain *),Bash(bun shp analyze *)" \
          --disallowedTools "Write,Edit" \
          --json-schema "$JSON_SCHEMA" \
          > claude-shape-review.json
        node <<'NODE'
        const { appendFileSync, readFileSync } = require("node:fs");
        const parseJsonValue = (value) => {
          if (typeof value !== "string") return value;
          try {
            return JSON.parse(value);
          } catch {
            return undefined;
          }
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
        appendFileSync(process.env.GITHUB_OUTPUT, `structured_output=${JSON.stringify(selected)}\n`);
        NODE
    - run: node .github/scripts/check-claude-shape-review.mjs
      if: steps.claude-token.outputs.available == 'true'
      env:
        CLAUDE_SHAPE_REVIEW_RESULT: ${{ steps.claude.outputs.structured_output }}
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

## Direct binary install

If you do not want to use the setup action, use the release installer directly:

```yaml
- name: Install shp
  run: |
    curl --proto '=https' --tlsv1.2 -LsSf https://github.com/timbrinded/shapelang/releases/download/v0.4.0/install.sh | sh
```

Keep CI installs pinned to an explicit release. `shp update` is intended for local developer binaries and should not replace pinned CI installation.

## Shape repo checks

The Shape repository itself also runs Bun workspace tests, typechecking, docs verification, and release smoke tests. Those are contributor checks, not required for application repos that only consume `shp`.

See [Local Development](../reference/local-development) for the contributor commands.
