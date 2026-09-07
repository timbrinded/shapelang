---
title: Releasing Shape
description: Prepare synchronized CLI and plugin versions, pass the manual skills gate, tag, and verify a Shape release.
sidebar:
  order: 6
---

Shape releases coordinate the `shp` binary/setup action and the bundled
Codex/Claude plugin from one commit. The CLI package and both plugin manifests
must use the same `X.Y.Z` version. The tags are:

- `vX.Y.Z` for the CLI GitHub release and setup action;
- `shapelang--vX.Y.Z` for the plugin; and
- both tags must resolve to the same current `master` commit.

## Prepare

Update the three versions, pinned installer/action examples, skill corpus, and
release notes. Then run:

```bash
bun run release:metadata
bun run skills:check
bun run langium:generate
bun run ast:generate
bun run changed-files
bun run format:check
bun run lint
bun test
bun run typecheck
bun run shape:ci
bun run docs:check
SHAPE_RELEASE_VERSION=vX.Y.Z bun run build:release
```

Commit generated changes, publish a PR, wait for all checks, and merge. Releases
must never be cut from a dirty worktree, detached head, or unmerged branch.

## Blocking skills approval

Dispatch `Release Candidate: Skills` on the exact `master` commit. It validates
the complete release candidate and evaluates all six shipped skills against
current CLI and language behavior, including:

- draft-to-strict validation;
- explicit graph commands;
- final forbids, forbidden paths, guards, coverage, and bindings;
- domain-pack discovery and resolution;
- stable source/evidence references;
- generated AST and analyzer evidence boundaries;
- author/critic prompts and LSP; and
- evidence-backed preflight, indexing, Guard, and code review.

The candidate smoke-tests packed archives before the model evaluation: Linux x64
on the builder, including skill-canary commands against that binary, then Linux
ARM64, macOS ARM64, and Windows x64 on native runners.

The workflow uploads the structured report, then pauses at the protected
`skills-release-approval` environment. A human must inspect and approve it. An
automated pass alone cannot authorize a release.

The candidate has three separate controls:

- `bun run skills:check` lints the shipped skill corpus deterministically.
- The candidate JSON report is a model evaluation with schema and evidence
  gates. It is not proof that every skill works on every supported model.
- Held-out forward tests on supported models, including Codex, remain a human
  process when skill instructions change. Store raw artifacts under
  `.research/`. The read-only canaries are smoke tests, not that evidence.

If the skills-relevant tree is unchanged, the candidate may reuse an approved
ancestor skills report instead of calling the model again. Validate, archive
smoke, and human approval still run on the current `master` SHA. Publishing
still requires a successful approved candidate run on the exact tag commit.

If the candidate changes in a skills-relevant way, merge the fix and rerun the
gate.

## Tag and verify

After manual approval, create and push both tags together:

```bash
git tag vX.Y.Z
git tag shapelang--vX.Y.Z
git push origin vX.Y.Z shapelang--vX.Y.Z
```

The release workflow verifies current `master`, the coordinated plugin tag,
synchronized metadata, and the successful approved candidate run for that exact
SHA. It builds and smoke-tests the archives, creates the GitHub release, then
verifies installation through the setup action on Linux, Linux ARM64, macOS
ARM64, and Windows.

Confirm the release contains all platform archives, both installers, and
`checksums.txt`; verify checksums and `shp --version`; and confirm both tags
resolve to the same SHA. Never move a published tag—fix forward with a new
version.

The maintainer command-by-command checklist lives in the repository root
`RELEASING.md`.
