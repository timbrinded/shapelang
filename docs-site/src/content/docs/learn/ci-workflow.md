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
      - uses: timbrinded/shapelang@v0.1.0
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

## Copilot CLI contract review

CI can also run GitHub Copilot CLI as a PR job to check source semantics against the Shape model. This is separate from the deterministic checker: `shp check --changed-files` enforces current coverage and bindings, while Copilot reviews whether the committed Shape claims faithfully describe the changed behavior.

The job needs a repository secret such as `COPILOT_GITHUB_TOKEN`, containing a fine-grained personal access token for a Copilot-licensed account with Copilot Requests permission:

```yaml
shape-copilot-review:
  if: github.event_name == 'pull_request'
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
      with:
        fetch-depth: 0
    - uses: oven-sh/setup-bun@v2
    - run: bun install --frozen-lockfile
    - uses: actions/setup-node@v4
      with:
        node-version: 24
    - run: npm install -g @github/copilot
    - run: bun run changed-files
      env:
        GITHUB_BASE_REF: ${{ github.base_ref }}
        GITHUB_SHA: ${{ github.sha }}
    - run: |
        copilot -p "$(<.github/prompts/shape-contract-review.md)" \
          --allow-tool='read,write(copilot-shape-review.json),shell(git:*),shell(bun:*)' \
          --no-ask-user
      env:
        COPILOT_GITHUB_TOKEN: ${{ secrets.COPILOT_GITHUB_TOKEN }}
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

Write JSON to `copilot-shape-review.json` with `status: "pass" | "drift" |
"error"` and terse evidence-backed findings.
```

## Shape repo workflow

The Shape repository dogfoods this workflow more strictly than a normal consumer repo. CI generates `changed.txt`, then runs formatting, semantic checks, coverage, obligations, and memory output:

```bash
bun run changed-files
bun run shape:ci
```

`shape:ci` runs `bun shp check --changed-files changed.txt`, so implementation coverage and bindings are checked together. Bindings are used for documentation coupling: if Shape-affecting code or model files change, the associated docs must change too, unless the current change set includes a narrow current `docs_not_needed` attestation.

## Direct binary install

If you do not want to use the setup action, use the release installer directly:

```yaml
- name: Install shp
  run: |
    curl --proto '=https' --tlsv1.2 -LsSf https://github.com/timbrinded/shapelang/releases/download/v0.1.0/install.sh | sh
```

## Shape repo checks

The Shape repository itself also runs Bun workspace tests, typechecking, docs verification, and release smoke tests. Those are contributor checks, not required for application repos that only consume `shp`.

See [Local Development](../reference/local-development) for the contributor commands.
