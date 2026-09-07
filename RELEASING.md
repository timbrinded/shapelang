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
Linux archive with the same script CI uses:

```bash
scripts/smoke-release-binary.sh \
  --expected-version X.Y.Z \
  dist/release/shp-linux-x64.tar.gz
bun scripts/run-release-canaries.ts --archive dist/release/shp-linux-x64.tar.gz
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
2. smoke-tests the Linux x64 archive with `scripts/smoke-release-binary.sh`, then
   runs `bun scripts/run-release-canaries.ts --archive` against that archive;
3. smoke-tests Linux ARM64, macOS ARM64, and Windows x64 archives on native
   runners with `scripts/smoke-release-binary.sh --quick` (version, help, check,
   AST only);
4. runs static conformance and focused behavioral cases across all six shipped
   skills (`bun shp` on fixtures), or copies an approved skills report from this
   SHA or from an ancestor when the path list below is unchanged;
5. uploads `skill-release-report-<commit>`; and
6. waits at `Skill Release Approval`. Native archive smokes and the skills job
   both have to pass; they may run at the same time.

Inspect the report and job summary. A human must approve the protected
environment. A model pass alone is insufficient. If any static check, fixture
case, or instruction is wrong, reject the deployment, fix it in a new PR, merge,
and dispatch a new candidate for the new commit.

The skills job may copy an approved report when
`git diff --name-only --no-renames ANCESTOR HEAD` has no path under:

- `plugins/shapelang/`, `packages/`, `fixtures/`
- `.github/prompts/`, `.github/scripts/`, `.github/actions/`,
  `.github/shape-contract/`
- `.github/workflows/release-candidate.yml`, `.github/workflows/release.yml`
- `scripts/`, `package.json`, `bun.lock`, `action.yml`, `install.sh`,
  `install.ps1`

A file renamed out of that list still counts as a change. Docs-only commits
after a successful candidate skip the Opus job only. The new SHA still needs
validate, archive smoke, and human approval. Publishing still requires a
successful approved candidate run on the exact tag SHA. Do not tag an ancestor
while `master` has moved.

Do not treat `skills:check`, the candidate JSON report, and held-out forward
tests as substitutes for each other.

- `bun run skills:check` lints the shipped skill corpus.
- The candidate JSON report is a model evaluation. Schema, required IDs,
  required commands, and evidence markers are checked. The rationale text is
  still model-written. A human must approve `skills-release-approval` for that
  layer.
- When skill instructions change, approval also requires fresh held-out
  forward-test evidence on the supported models, including Codex. They are not
  a CI job. Do not reuse a held-out task after copying its labels, structure,
  expected answer, or failure-specific wording into the skill. Keep raw
  artifacts under `.research/`. The Linux x64 archive canaries and the model
  fixture cases are smoke tests, not that evidence.

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

The release workflow rejects the tag unless `vX.Y.Z` is current `master` and
has a successful approved candidate run for the same SHA. Never move or replace
a published release tag.

## 5. Verify the publication

Wait for the `Release` workflow. It reruns validation, rebuilds archives,
smoke-tests the Linux x64 binary (including `run-release-canaries.ts`),
publishes the GitHub release, then installs that published version through the
setup action on Linux x64, Linux ARM64, macOS ARM64, and Windows x64.

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
