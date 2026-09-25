---
title: Run Shape in CI
description: A pinned GitHub Actions job that gates each pull request on shp check with a changed-file list, plus direct install, a model export, and an optional Claude review.
---

CI needs one deterministic gate: `shp check --changed-files changed.txt`. It runs conformance, coverage, and bindings in one command, as described in [Keep the Model Current](/shapelang/guides/keep-model-current/). Run it strict, without `--allow-unknown-effects`, so that an unresolved `effects unknown` fails the build; that flag is for local drafting only.

## The job

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
        with:
          fetch-depth: 0
      - uses: timbrinded/shapelang@v0.9.0
      - run: shp fmt --check
      - name: Write changed.txt
        env:
          BASE_REF: ${{ github.base_ref }}
        run: |
          if [ -n "$BASE_REF" ]; then
            git diff --name-only "origin/$BASE_REF...HEAD" > changed.txt
          else
            touch changed.txt
          fi
      - run: shp check --changed-files changed.txt
```

- `fetch-depth: 0` fetches the full history, including the base branch. The default shallow checkout has no `origin/<base>`, so the diff fails.
- On a pull request, the diff against the base branch lists every file the pull request changes, including the `.shape` files that make its Shape updates and attestations current.
- `shp fmt --check` fails on any `.shape` file that is not in canonical format. The formatter drops `//` and `/* */` comments, so a file that contains comments never passes; see the [CLI Reference](/shapelang/reference/cli/).
- `shp check --changed-files changed.txt` is the only gate needed; it replaces separate `shp check` and `shp coverage` steps.
- Design-memory freshness is off by default. To enforce it, add `--as-of YYYY-MM-DD`, which gives the same result on every run, rather than `--strict-freshness`, which uses today's date (UTC). Both flags are in the [CLI Reference](/shapelang/reference/cli/).

A push has no base ref, so this job writes an empty list on push. The push run then checks conformance only, because coverage and bindings check nothing with an empty list; pull requests carry the change-set gate. To check pushes as well, diff `${{ github.event.before }}` against `HEAD`. That SHA is all zeros when the push creates the branch, and the diff then fails.

## Pin the version

Pin the setup action to an explicit release tag such as `v0.9.0`, in every workflow. With a version tag as its ref, `timbrinded/shapelang@v0.9.0` installs that release. The optional `version` input selects a different release; with a branch ref and no `version`, the action installs the latest release. Do not install with `shp update` in CI: that command replaces a local developer binary.

The action verifies the download against the release's `checksums.txt` when `sha256sum` or `shasum` is available, as it is on GitHub-hosted runners; otherwise it warns and skips the check. It supports Linux x64 and ARM64, macOS ARM64, and Windows x64 runners.

## Install without the action

Run the installer from the pinned release instead:

```yaml
- name: Install shp
  run: curl --proto '=https' --tlsv1.2 -LsSf https://github.com/timbrinded/shapelang/releases/download/v0.9.0/install.sh | sh
```

An installer downloaded from a release URL installs that release unless `SHAPE_VERSION` names another. It verifies the archive's SHA-256 against `checksums.txt` and installs into `~/.local/bin`, or into the directory that `SHAPE_INSTALL_DIR` or the installer's `--install-dir` argument names. Under GitHub Actions it also appends the install directory to `GITHUB_PATH`, so later steps find `shp`.

## Export the model (optional)

After the gate passes, a workflow can export the Shape model for a visualizer or another reporting tool:

```yaml
- run: shp check --changed-files changed.txt
- run: shp inspect --json > shape-model.json
```

`shp inspect --json` uses the same `shape/**/*.shape` discovery and canonical lowering as the model queries. Its output has a versioned schema (`schemaVersion`), records the `shapeVersion` that produced it, uses module-qualified IDs, and has no current-time field. Identical inputs and the same pinned `shp` version therefore produce identical bytes. The export is not a gate: it exits `0` whenever the input parses, even when `shp check` would fail, so keep the check before it. Downstream consumers should reject a `schemaVersion` they do not support.

## Claude contract review (optional)

Coverage confirms that the model changed alongside the code, not that the new claims are true. A separate pull-request job can ask Claude Code whether the Shape changes faithfully describe the source changes. The job is policy-gated: its last step fails on drift. Its verdict comes from a model, so it does not replace `shp check` or change what the checker decides.

Add this job under `jobs:` in the workflow above; its `if` skips it on push.

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
    - uses: timbrinded/shapelang@v0.9.0
      if: steps.claude-token.outputs.available == 'true'
    - name: Write changed.txt
      if: steps.claude-token.outputs.available == 'true'
      env:
        BASE_REF: ${{ github.base_ref }}
      run: git diff --name-only "origin/$BASE_REF...HEAD" > changed.txt
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
          Review changed.txt against the Shape model in shape/**/*.shape.
          For changed source behavior that affects the architecture contract,
          require a faithful current Shape update or a current attestation.
          Do not count an unchanged .shape file as a current Shape update.
          Run `shp check --changed-files changed.txt`, `shp obligations`, and
          `shp memory`; run `shp explain <symbol>` when a symbol needs context.
          Return status "pass" with no findings only when the model faithfully
          covers the change. Otherwise return "drift" or "error" with terse,
          evidence-backed findings.
        claude_args: |
          --model claude-sonnet-4-6
          --max-turns 100
          --allowedTools 'Read,Glob,Grep,Bash(shp check --changed-files changed.txt),Bash(shp obligations),Bash(shp memory),Bash(shp explain *)'
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

- **Action.** The job runs the official [`anthropics/claude-code-action`](https://github.com/anthropics/claude-code-action), which installs Claude Code and runs the prompt headless.
- **Result.** With `--json-schema` in `claude_args`, the action validates Claude's final answer against the schema and exposes it as the `structured_output` step output. The gate step fails the job on any status other than `pass` or on any finding.
- **Tools.** Claude Code runs no shell commands unless `--allowedTools` lists them. This job allows only the read-only `shp` commands that the prompt names, and installs `shp` so that they can run. `--disallowedTools Write,Edit` blocks file edits. If your repository runs the CLI through a package script, such as `bun shp`, use that form in both the prompt and `--allowedTools`.
- **Credentials.** The action's credential check accepts an `anthropic_api_key` or `claude_code_oauth_token` input. A proxy-backed repository can authenticate with `ANTHROPIC_AUTH_TOKEN` and `ANTHROPIC_BASE_URL` instead: the action forwards its environment to Claude Code, so set both on the step and pass the token through `anthropic_api_key` to satisfy the credential check. Through a proxy gateway the structured-output channel can degrade to plain text; the action then reports the review step as failed even when the model run succeeded, which fails this job. The Shape repository's own workflow sets `continue-on-error` on that step and recovers the result from the action's `execution_file` log.
- **Forks.** Pull requests from forks receive no secrets. The first step detects whether a credential is available, and every later step is skipped without one, so those pull requests skip the review instead of failing.

A longer review policy can live in a committed file, for example `.github/prompts/shape-contract-review.md`, with the inline `prompt` telling Claude to read it.
