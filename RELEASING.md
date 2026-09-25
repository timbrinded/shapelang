# Releasing Shape

One commit ships two public surfaces:

- the `shp` CLI and the setup action, under the tag `vX.Y.Z`;
- the bundled Shape plugin, under the tag `shapelang--vX.Y.Z`.

Four versions must agree on `X.Y.Z`: `packages/shp-cli/package.json`,
`plugins/shapelang/.codex-plugin/plugin.json`,
`plugins/shapelang/.claude-plugin/plugin.json`, and the `# Shape vX.Y.Z` heading
in `docs/releases/vX.Y.Z.md`.

A release moves through six steps: prepare the change, validate it locally, merge
it, run the release candidate on the merged `master` commit, tag that commit, and
confirm the publication. Both tags go on the commit that has a successful,
manually approved candidate run, and that commit must be current `master`. The
workflows reject anything else.

## Prerequisites

One-time repository setup:

- The repository environment `skills-release-approval` has the maintainer as a
  required reviewer.
- The repository secret `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN` is set.
  The candidate's skills job fails without one, even when it copies an earlier
  report. `ANTHROPIC_BASE_URL` is optional, for a gateway.

On the maintainer's machine:

- the contributor prerequisites in [CONTRIBUTING.md](CONTRIBUTING.md),
  including `zstd` and `sha256sum` for `bun run build:release`;
- an authenticated `gh` CLI;
- a Linux x64 host, because the local smoke commands in step 2 test
  `shp-linux-x64.tar.gz`.

## 1. Prepare the release change

Choose the semver version `X.Y.Z`, then, on a release-prep branch:

1. Set `X.Y.Z` in `packages/shp-cli/package.json`,
   `plugins/shapelang/.codex-plugin/plugin.json`, and
   `plugins/shapelang/.claude-plugin/plugin.json`.
2. Write `docs/releases/vX.Y.Z.md`. It must contain the heading line
   `# Shape vX.Y.Z`, from which the metadata check reads the release-notes
   version. The file becomes the GitHub release notes verbatim, and the Release
   workflow fails if the published notes differ from it.
3. Run `bun run release:metadata`. It fails when the four versions disagree,
   and it lists every file that is missing its snippet for the new version.
   The pins come from `releaseVersionPins` in
   `scripts/check-release-metadata.ts`, and they include files outside the
   docs: `AGENTS.md`, `.github/prompts/shape-skills-release.md`,
   `plugins/shapelang/skills/shape-lang/SKILL.md`, and `shape/delivery.shape`.
   In each pinned file, replace every occurrence of the old version, not just
   the one the check names: the check confirms only that one occurrence of each
   snippet exists, so a second, stale copy still passes. Rerun until it prints
   `Release metadata is synchronized at vX.Y.Z.` Plain `bun test` also fails on
   a missing pin.
4. Review every shipped skill, including its references and
   `agents/openai.yaml`, against the current CLI and language behaviour. Update
   any affected skill entrypoint, reference, or agent metadata. The review
   covers commands and patterns, not syntax alone:
   - draft unknowns followed by a strict final check;
   - explicit `graph all|show|stats` commands;
   - final forbids, forbidden paths, guards, coverage, and bindings remaining
     hard;
   - domain-pack discovery and import and name-resolution behaviour;
   - generated AST and analyzer output as navigation or advisory evidence only;
   - stable `file#symbol` or file-only source and evidence references;
   - provider-neutral author and critic workflows;
   - LSP and editor behaviour;
   - evidence-backed preflight, index, guard, and code-review decisions.

   This review is broader than the candidate's fixed static checks, which do
   not replace it.
5. When skill instructions change, collect fresh held-out forward-test evidence
   on the supported models, including Codex. Approval in step 4 requires it, and
   no CI job produces it, so run the tests now and fix any failure in this
   change. A task stops being held out once its labels, structure, expected
   answer, or failure-specific wording has been copied into the skill. Keep the
   raw artifacts under `.research/`.

## 2. Validate locally

From the release-prep branch:

```bash
bun install --frozen-lockfile
bun run langium:generate
bun run ast:generate
bun run changed-files
bun run format:check
bun run lint
bun run skills:check
bun test
bun run typecheck
bun run shape:ci
bun run docs:check
SHAPE_RELEASE_VERSION=vX.Y.Z bun run build:release
scripts/smoke-release-binary.sh \
  --expected-version X.Y.Z \
  dist/release/shp-linux-x64.tar.gz
bun scripts/run-release-canaries.ts --archive dist/release/shp-linux-x64.tar.gz
```

The last two commands are the same archive smoke test and canaries that CI runs.
Commit any regenerated Langium and AST files.

## 3. Merge

Commit and push the release-prep branch, open a pull request, wait for every
required check, review the complete diff, and merge it.

## 4. Run the release candidate

The `Release Candidate: Skills` workflow (`.github/workflows/release-candidate.yml`)
runs only when dispatched on `master`. It has four jobs:

| Job | Needs | Does |
| --- | --- | --- |
| Validate release candidate (`validate`) | — | Requires `master`, then checks release metadata, `skills:check`, the regenerated Langium artifacts, `ast:check`, format, lint, tests, typecheck, `changed-files` plus `shape:ci`, and `docs:check`. Builds the release assets with `SHAPE_RELEASE_VERSION` set to the tag, runs the full smoke test and `run-release-canaries.ts` on the Linux x64 archive, and uploads the other three archives. |
| Smoke packed archive (`smoke-archives`) | `validate` | Runs `scripts/smoke-release-binary.sh --quick` (version, help, check, AST generation) on native Linux ARM64, macOS ARM64, and Windows x64 runners. |
| Evaluate skill conformance and behavior (`skills`) | `validate` | Requires Claude credentials. Evaluates all six shipped skills against their static checks and fixture cases, or copies an approved report (see [Skills report reuse](#skills-report-reuse)). Uploads `skill-release-report-<commit>`. |
| Skill Release Approval (`approval`) | all three | Waits in the protected environment `skills-release-approval` for a human, then records the version, both tags, the commit, and the report name in the job summary. |

`smoke-archives` and `skills` both depend only on `validate`, so they run in
parallel.

1. Dispatch the candidate and find its run:

   ```bash
   gh workflow run release-candidate.yml --ref master
   gh run list --workflow release-candidate.yml --branch master --limit 5
   ```

   The run tests the commit that `master` points at when you dispatch it. Note
   that commit; step 5 tags exactly it.

   From dispatch until the Release workflow publishes, merge nothing to
   `master`. Tagging requires the candidate's commit to be current `master`,
   and publication checks it again.
2. Wait until `validate`, every `smoke-archives` leg, and `skills` pass.
3. Inspect the skills report artifact and the job summary.
4. Approve `skills-release-approval` only when every static check, fixture case,
   and instruction is right and, if skill instructions changed, the held-out
   evidence from step 1 exists. A model pass alone is not enough. Otherwise
   reject the deployment, fix the problem in a new pull request, merge it, and
   dispatch a new candidate for the new commit.

## 5. Tag

Tag only the commit that the approved candidate ran on, never a pull request
branch, a detached `HEAD`, or a dirty worktree. The first three lines below
check this.

```bash
git switch master && git pull --ff-only
git status --short        # must print nothing
git rev-parse HEAD        # must equal the approved candidate run's commit
bun scripts/check-release-metadata.ts --tag vX.Y.Z   # prints: Release metadata is synchronized at vX.Y.Z.
git tag vX.Y.Z && git tag shapelang--vX.Y.Z
git push origin vX.Y.Z shapelang--vX.Y.Z
```

Both tags are lightweight. Push them in one command: the `vX.Y.Z` push starts the
`Release` workflow, whose first job runs
`bun scripts/check-release-approval.ts --require-exact`. That check stops the
release unless `shapelang--vX.Y.Z` already resolves to the same commit, that
commit is current `master`, and it has a successful, manually approved candidate
run. An approved run on an ancestor commit does not count.

The `master` freeze from step 4 lasts until the Release workflow has published.
The publish step repeats `--require-exact` immediately before
`gh release create`, so a merge during the run fails publication, and rerunning
the workflow on the same tag fails the same check.

Never move or replace a published release tag.

## 6. Confirm publication

Wait for the `Release` run (`.github/workflows/release.yml`, triggered by tags
matching `v*.*.*`) and confirm that every job passed. The jobs run in this
order, except that the last two run in parallel:

| Job | Checks |
| --- | --- |
| Verify skill release approval (`approval`) | The tag commit is current `master`, `shapelang--vX.Y.Z` points at it, and it has a successful, approved candidate run. |
| Validate (`validate`) | `check-release-metadata.ts --tag` against the pushed tag, `skills:check`, the regenerated Langium artifacts, `ast:check`, format, lint, tests, typecheck, `format:shape:check`, `shp check`, `shp obligations`, `shp memory`, and `docs:check`. |
| Release (`release`) | Rebuilds the assets, runs the full smoke test and `run-release-canaries.ts` on the Linux x64 archive, repeats the approval check, and publishes the GitHub release with every asset and the notes from `docs/releases/vX.Y.Z.md`. |
| Verify published release (`verify`) | On Linux x64, Linux ARM64, macOS ARM64, and Windows x64: installs `vX.Y.Z` through the setup action, checks that `shp --version` reports `X.Y.Z`, and runs `shp check`. On Linux and Windows it also runs the release-hosted installer and checks the installed version. |
| Verify published release metadata and assets (`verify-publication`) | The release is neither a draft nor a prerelease, has exactly the seven assets, carries notes equal to `docs/releases/vX.Y.Z.md`, passes `sha256sum --check checksums.txt`, and both installers contain the tag. |

## If a step fails

- **Local validation or pull request checks fail.** Fix the release-prep branch
  before merging.
- **A candidate job fails, or the skills report is wrong.** Reject the approval
  deployment if it is waiting, fix the problem in a new pull request, merge it,
  and dispatch a new candidate for the new commit.
- **`master` moves after the candidate.** Dispatch a new candidate for the new
  commit. Do not tag the ancestor.
- **Publication fails.** Fix forward from a new commit and version. Do not
  silently retag a version that users may already have fetched.

## Reference

### Skills report reuse

The skills job normally runs a fresh model evaluation. First, though, it runs
`bun scripts/check-release-approval.ts --reuse-if-eligible` and copies an
approved report instead when either of these holds:

- a successful, manually approved candidate run exists for the same commit;
- such a run exists for an ancestor commit, and
  `git diff --name-only --no-renames ANCESTOR HEAD` lists no path under
  `SKILLS_RELEVANT_PATH_PREFIXES` in `scripts/check-release-approval.ts`.

Only candidate runs dispatched on `master` count. A same-commit run takes
precedence over an ancestor, and among eligible runs of one kind the highest run
number wins. If the lookup fails, the job falls back to a fresh
evaluation.

`SKILLS_RELEVANT_PATH_PREFIXES` is the authority for the path list. An entry
ending in `/` matches everything under that directory, and any other entry
matches one exact path. It currently holds:

- `plugins/shapelang/`, `packages/`, `fixtures/`
- `.github/prompts/`, `.github/scripts/`, `.github/actions/`,
  `.github/shape-contract/`
- `.github/workflows/release-candidate.yml`, `.github/workflows/release.yml`
- `scripts/`, `package.json`, `bun.lock`, `action.yml`, `install.sh`,
  `install.ps1`

Because `--no-renames` lists both sides of a move, renaming a file out of those
paths still forces a fresh evaluation.

Reuse is not limited to docs changes: a commit whose diff from the approved
ancestor touches only paths outside the list, such as `shape/*.shape`,
`docs-site/`, `docs/releases/`, or `experiments/`, can copy the report. A
release-prep commit always changes `plugins/shapelang/` (the manifest versions),
so it can never copy an ancestor's report; its first candidate always runs a
fresh evaluation.

Copying replaces only the model evaluation. The skills job still runs and still
needs Claude credentials, and the new commit still needs its own `validate` job,
archive smoke tests, and human approval.

### Three kinds of skill evidence

These checks answer different questions, and none substitutes for another:

- **`bun run skills:check`** (`scripts/check-skills.ts`) lints the shipped skill
  corpus. CI's Lint job, the candidate, and the Release workflow all run it.
- **The candidate JSON report** is a model evaluation. It covers the fixed
  static-check IDs for each skill (`.github/prompts/shape-skills-release.md` and
  `.github/scripts/skills-release-config.mjs`) and the behavioural cases in
  `fixtures/skills/cases.json`, run with `bun shp`. The gate validates the
  report's schema, its skill, static-check, and case IDs, the required command
  evidence, and the evidence markers. The rationale text is still model-written
  and does not prove that every skill works on every supported model, so a human
  must approve `skills-release-approval`.
- **Held-out forward tests** (step 1) on the supported models, including Codex,
  are required when skill instructions change. They are not a CI job.

`run-release-canaries.ts` runs the same fixture-case commands against the packed
Linux x64 archive and checks their exit codes. Those canaries and the model's
fixture cases are smoke tests, not held-out evidence.

### Release assets

`scripts/build-release-assets.sh` writes the assets to `dist/release/`, which Git
ignores:

- `shp-linux-x64.tar.gz`
- `shp-linux-arm64.tar.gz`
- `shp-darwin-arm64.tar.gz`
- `shp-windows-x64.tar.gz`
- `install.sh`
- `install.ps1`
- `checksums.txt`

The archive targets come from `packages/shp-checker/src/tree-sitter-native-targets.ts`.
Each archive holds `shp` (`shp.exe` on Windows), `LICENSE`, and the
`tree-sitter-language-pack` parser assets that `shp ast source` uses for
TypeScript, TSX, JavaScript/JSX, Rust, Go, Python, and Swift. `checksums.txt`
holds the SHA-256 of every other asset.

### Installer version injection

The builder replaces `__SHAPE_DEFAULT_VERSION__` in both installers with
`SHAPE_RELEASE_VERSION`, or else `GITHUB_REF_NAME`, or else `latest`. The
candidate sets `SHAPE_RELEASE_VERSION` to the tag. The Release workflow leaves
it unset, so the builder injects `GITHUB_REF_NAME`, which GitHub sets to the
pushed tag, and a release-hosted installer defaults to the release it came
from. An installer taken straight from the repository has no injected version
and defaults to `latest`. `SHAPE_VERSION` overrides the default at install
time.
