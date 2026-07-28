# Releasing Shape

Shape ships two coordinated public surfaces from one commit:

- the `shp` CLI and setup action under `vX.Y.Z`;
- the bundled Shape plugin under `shapelang--vX.Y.Z`.

The CLI package and both plugin manifests use the same `X.Y.Z`. Release tags
must point at the same clean, pushed `master` commit.

## 1. Prepare the release change

Choose the semver version, then update:

- `packages/shp-cli/package.json`;
- `plugins/shapelang/.codex-plugin/plugin.json`;
- `plugins/shapelang/.claude-plugin/plugin.json`;
- pinned installer and action examples in `README.md` and the docs site;
- `docs/releases/vX.Y.Z.md`.

Validate synchronization:

```bash
bun run release:metadata
bun run skills:check
```

Review every shipped skill, including references and `agents/openai.yaml`, against
the current CLI and language behavior. The review must cover commands and
patterns, not syntax alone:

- draft unknowns followed by a strict final check;
- explicit `graph all|show|stats` commands;
- final forbids, forbidden paths, guards, coverage, and bindings remaining hard;
- domain-pack discovery and import/name-resolution behavior;
- generated AST and analyzer output as navigation/advisory evidence only;
- stable `file#symbol` or file-only source/evidence references;
- provider-neutral author and critic workflows;
- LSP/editor behavior; and
- evidence-backed preflight, index, guard, and code-review decisions.

## 2. Regenerate and validate

From the release-prep branch:

```bash
bun install --frozen-lockfile
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

Confirm generated Langium and AST changes are committed. Smoke-test the local
Linux archive:

```bash
mkdir -p /tmp/shp-release-smoke
tar -xzf dist/release/shp-linux-x64.tar.gz -C /tmp/shp-release-smoke
/tmp/shp-release-smoke/shp --version
/tmp/shp-release-smoke/shp --help
/tmp/shp-release-smoke/shp check
```

Commit and push the release-prep branch, open a PR, wait for every required
check, review the complete diff, and merge it. Do not tag a PR branch or dirty
worktree.

## 3. Run the blocking skills gate

The repository environment `skills-release-approval` must have the maintainer as
a required reviewer. Dispatch the release-candidate workflow on `master`:

```bash
gh workflow run release-candidate.yml --ref master
gh run list --workflow release-candidate.yml --branch master --limit 5
```

The workflow:

1. validates metadata, generated artifacts, skills, source, Shape, docs, and
   release assets;
2. runs a structured behavioral evaluation across all five shipped skills;
3. uploads `skill-release-report-<commit>`; and
4. waits at `Skill Release Approval`.

Inspect the report and job summary. A human must approve the protected
environment. A model pass alone is insufficient. If any scenario or instruction
is wrong, reject the deployment, fix it in a new PR, merge, and dispatch a new
candidate for the new commit.

The candidate run must finish successfully for the exact current `master` SHA.
Do not reuse approval from an older commit.

## 4. Create both tags

Only after the exact commit has a successful, manually approved candidate run:

```bash
git switch master
git pull --ff-only
git status --short
git rev-parse HEAD
bun scripts/check-release-metadata.ts --tag vX.Y.Z
git tag vX.Y.Z
git tag shapelang--vX.Y.Z
git push origin vX.Y.Z shapelang--vX.Y.Z
```

The release workflow fails closed unless `vX.Y.Z` is current `master` and has a
successful approved candidate run for the same SHA. Never move or replace a
published release tag.

## 5. Verify the publication

Wait for the `Release` workflow. It reruns validation, builds archives,
smoke-tests the packaged binary, publishes the GitHub release, then installs the
published version through the setup action on Linux and Windows.

Verify:

- the release is non-draft and non-prerelease;
- all four platform archives, both installers, and `checksums.txt` are present;
- archive checksums match;
- `shp --version` reports `X.Y.Z`;
- the release-hosted installers default to `vX.Y.Z`;
- the setup action installs `vX.Y.Z`;
- `vX.Y.Z` and `shapelang--vX.Y.Z` resolve to the same commit; and
- the published notes match `docs/releases/vX.Y.Z.md`.

If publication fails, fix forward from a new commit and version. Do not silently
retag a version users may already have fetched.
