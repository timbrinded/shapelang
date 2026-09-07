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

The candidate smoke-tests the Linux x64 archive on the builder, then runs
`run-release-canaries.ts` against that archive. Native runners smoke Linux
ARM64, macOS ARM64, and Windows x64 with `smoke-release-binary.sh --quick`
(version, help, check, AST). Native archive smokes and the skills job are both
required. Approval waits for both.

The workflow uploads the structured report, then pauses at the protected
`skills-release-approval` environment. A human must inspect and approve it. An
automated pass alone cannot authorize a release.

Do not treat `skills:check`, the candidate JSON report, and held-out tests as
the same check:

- `bun run skills:check` lints the shipped skill corpus.
- The candidate JSON report is a model evaluation. Schema and evidence markers
  are checked. The rationale text is still model-written. It is not proof that
  every skill works on every supported model.
- When skill instructions change, approval also requires fresh held-out
  forward tests on the supported models, including Codex. They are not a CI
  job. A task is not held out after its labels, structure, expected answer, or
  failure-specific wording has been copied into the skill. Store raw artifacts
  under `.research/`. The Linux x64 archive canaries and the model fixture
  cases are smoke tests, not that evidence.

The skills job may copy an approved report from this SHA or from an ancestor
when `git diff --name-only --no-renames` has no path in the list in
`RELEASING.md`. Docs-only commits skip the Opus job only. The new SHA still
needs validate, archive smoke, and human approval. Publishing still requires a
successful approved candidate run on the exact tag commit.

If the run fails, or if `master` moves, merge the fix and dispatch a new
candidate for the new commit.

## Tag and verify

After manual approval, create and push both tags together:

```bash
git tag vX.Y.Z
git tag shapelang--vX.Y.Z
git push origin vX.Y.Z shapelang--vX.Y.Z
```

The release workflow verifies current `master`, the coordinated plugin tag,
synchronized metadata, and the successful approved candidate run for that exact
SHA. It rebuilds archives, smoke-tests Linux x64, creates the GitHub release,
then installs the published version through the setup action on Linux x64,
Linux ARM64, macOS ARM64, and Windows x64.

Confirm the release contains all platform archives, both installers, and
`checksums.txt`; verify checksums and `shp --version`; and confirm both tags
resolve to the same SHA. Never move a published tag—fix forward with a new
version.

The maintainer command-by-command checklist lives in the repository root
`RELEASING.md`.
