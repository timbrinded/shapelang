---
title: CI Workflow
description: Install the released Shape typechecker and run conformance checks in CI.
sidebar:
  order: 6
---

Shape is meant to run in review. In application repos, install a pinned `shp` release and run the checker directly.

![PR change review workflow showing shape system files, shape changes, changed files, coverage, shp check, and CI result.](../../../assets/infographics/pr-change-review.png)

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

Coverage checks compare changed source paths with implementation blocks. A governed source change must be represented by a current `shape` update, or by a narrow attestation changed in the same PR:

```yaml
- name: Changed files
  run: git diff --name-only origin/main...HEAD > changed.txt

- name: Shape coverage
  run: shp coverage --changed-files changed.txt
```

If a governed source path changes without a Shape update or current attestation, the checker rejects the change.

## Contract review assistant

CI can also ask an LLM reviewer to check source semantics against the Shape model. Keep the instruction short and make `shape/` the authority:

```md
# Shape contract review

Review the PR diff against the Shape model in `shape/**/*.shape`.

1. Read repository instructions.
2. Determine the changed source files.
3. Load the Shape model.
4. Decide whether each changed source file alters the architecture contract.
5. If it does, verify the committed `shape` changes faithfully represent the new behavior.
6. If it does not, verify any `attest no_shape_change` is narrow, reasoned, and changed in this PR.
7. Run `shp fmt --check` and `shp check`.

Return JSON:

{
  "status": "pass | drift | error",
  "summary": "one short sentence",
  "findings": [
    {
      "severity": "warning | error",
      "target": "changed file",
      "shape_source": "shape/file.shape | missing-shape-claim",
      "issue": "short label",
      "reason": "why the Shape model and source diff disagree",
      "suggested_fix": "minimal shape change or source change"
    }
  ]
}
```

## Shape repo workflow

The Shape repository dogfoods this workflow more strictly than a normal consumer repo. CI generates `changed.txt`, then runs formatting, semantic checks, coverage, obligations, and memory output:

```bash
bun run changed-files
bun run shape:ci
```

`shape:ci` runs `bun shp check --changed-files changed.txt`, so implementation coverage and bindings are checked together. Bindings are used for documentation coupling: if Shape-affecting code or model files change, the associated docs must change too, unless the PR includes a narrow current `docs_not_needed` attestation.

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
