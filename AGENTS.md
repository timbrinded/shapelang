# Shape Project Memory

This repository is the Shape language project. Shape is a typed architecture
conformance language for making architecture claims explicit, reviewable, and
checkable in CI.

Shape does not prove that arbitrary application code is correct. Its boundary is
the declared `.shape` model: humans and agents write typed claims about resources,
components, effects, relations, coverage, bindings, and design memory; the
deterministic checker accepts or rejects those claims.

`CLAUDE.md` is a symlink to this file. Keep shared agent instructions here.

## How To Think About This Repo

- Treat `.shape` files as source code, not prose. They are typed architectural
  claims with semantic consequences.
- Keep the product boundary clear: Shape checks model coherence and review
  obligations, not implementation correctness.
- Prefer explicit uncertainty over false precision. If effects are unknown, model
  them as `effects unknown` rather than pretending an empty complete summary is
  safe.
- Final forbids are final. Do not use rationale, memory, reevaluations, or grants
  to waive a `forbid final`.
- Preserve diagnostic quality. Diagnostics are a product surface and should tell a
  reviewer what failed, why it failed, and which declaration or evidence caused it.
- Preserve deterministic behavior. Formatting, graph output, hypercycle witnesses,
  coverage checks, and diagnostics should stay stable enough for review and CI.
- When changing semantics, update the grammar, generated artifacts, checker rules,
  fixtures, docs, and Shape model together. A checker feature is incomplete if the
  language reference and examples no longer teach the current behavior.
- Use the repo's existing abstractions before adding new ones. This is a small
  TypeScript/Bun codebase, not an enterprise service.

## Repository Layout

- `packages/shp-checker`: parser, formatter, fact lowering, semantic checker,
  graph/explain/memory helpers, authoring helpers, editor helpers, and analyzer
  hints.
- `packages/shp-cli`: the `shp` command-line wrapper around `@shape/shp-checker`.
- `packages/shp-checker/src/language/shape.langium`: Langium grammar source.
- `packages/shp-checker/src/language/generated`: generated Langium artifacts.
  Regenerate these with `bun run langium:generate`; do not hand-edit them.
- `shape`: Shape's own architecture model for the language, checker, tooling, and
  delivery pipeline.
- `fixtures/pass` and `fixtures/fail`: focused semantic examples used by tests.
- `docs-site`: Astro/Starlight documentation site. Complete `shape` code fences
  are parsed by the docs verifier unless marked `shape no-verify`.
- `skill/shape-lang`: the downstream Codex skill for using Shape in other repos.
- `scripts/build-release-assets.sh`: builds release archives and injects the tag
  version into installer scripts.
- `scripts/write-changed-files.sh`: writes `changed.txt` for local and CI Shape
  coverage/binding checks.
- `action.yml`: GitHub composite action that installs a released `shp` binary.

## Research Workflow

- Put raw research artifacts under `.research/`, including notes, scraped outputs,
  comparison tables, JSON captures, PDFs, and screenshots.
- Treat `.research/` as local working context, not product source. Do not make
  implementation, tests, docs, release assets, or Shape CI depend on files there.
- When research drives a decision, promote the durable conclusion into tracked
  docs, specs, code comments, Shape memory or reevaluations, or PR text. Leave the
  raw material in `.research/`.

## Toolchain

Use Bun for this repo. The root `package.json` defines the workspace and scripts;
there is a `bun.lock` lockfile.

The TypeScript project is strict (`strict`, `noUncheckedIndexedAccess`,
`noImplicitOverride`). Do not typecast to `any` to silence issues.

## Shape Workflow Notes

- Default CLI file discovery is `shape/**/*.shape`.
- Run `bun run format:shape:check` and `bun shp check` after editing `.shape`
  files.
- Run `bun run changed-files` before `bun run shape:ci` when validating coverage
  locally.
- Governed source changes require a faithful Shape update or a narrow current
  `attest no_shape_change`.
- Shape-affecting files with docs bindings require a docs update or current
  `attest docs_not_needed`.
- For guarded targets, inspect obligations with `bun shp obligations` and memory
  with `bun shp memory`; then add a real `reevaluation` or preserve the protected
  shape.
- Represent structural dependencies as top-level `relation` declarations. Prefer
  prelude relation kinds such as `calls`, `callbacks`, `provides`, and
  `coordinated_call`.
- Use `bun shp graph --stats` before editing relation-heavy models, and
  `bun shp graph SYMBOL --kind KIND` for focused investigation.

## Implementation Guidance

- Parser and grammar changes usually touch:
  - `packages/shp-checker/src/language/shape.langium`
  - generated files under `packages/shp-checker/src/language/generated`
  - `packages/shp-checker/src/parser.ts`
  - checker/lowering tests and docs syntax reference
- Checker rule changes usually touch:
  - `packages/shp-checker/src/checker.ts`
  - fixtures under `fixtures/pass` and `fixtures/fail`
  - `packages/shp-checker/src/checker.test.ts`
  - relevant docs under `docs-site/src/content/docs`
  - `shape/*.shape` when governed implementation files changed
- CLI behavior changes usually touch:
  - `packages/shp-cli/src/index.ts`
  - `packages/shp-cli/src/index.test.ts`
  - README command examples and `docs-site/src/content/docs/reference/cli.md`
- Docs changes should keep complete Shape examples parseable. Use
  `shape no-verify` only for intentional fragments.
- Release/install changes usually touch:
  - `install.sh`
  - `install.ps1`
  - `scripts/build-release-assets.sh`
  - `action.yml`
  - `.github/workflows/release.yml`
  - README quick-start snippets

## Release Process

Public versions are Git tags such as `v0.2.0`. The CLI package version in
`packages/shp-cli/package.json` must match the release tag without the leading
`v`; the release workflow rejects mismatches such as tag `v0.3.0` with CLI
version `0.2.0`. Workspace packages remain private; package versions are used for
release consistency, not npm publishing.

Only release from committed branch state. Do not create a release tag from a
dirty worktree, detached `HEAD`, stash-only changes, or uncommitted local edits.
The tag must point at a pushed branch commit.

Before tagging a new release:

1. Pick the next semver tag, for example `v0.3.0`.
2. Update `packages/shp-cli/package.json` to the tag version without the leading
   `v`, then update user-facing pinned examples if needed, especially README
   install snippets, docs quick-start content, and action examples that mention
   an older release.
3. Install and regenerate:

   ```bash
   bun install --frozen-lockfile
   bun run langium:generate
   ```

4. Verify generated Langium files are committed when the grammar changed:

   ```bash
   git diff -- packages/shp-checker/src/language/generated
   ```

5. Run the local release-quality checks:

   ```bash
   bun run changed-files
   bun run format:check
   bun run lint
   bun test
   bun run typecheck
   bun run shape:ci
   bun run docs:check
   bun run build:release
   ```

6. Smoke-test at least the local Linux archive:

   ```bash
   mkdir -p /tmp/shp-smoke
   tar -xzf dist/release/shp-linux-x64.tar.gz -C /tmp/shp-smoke
   /tmp/shp-smoke/shp --help >/dev/null
   /tmp/shp-smoke/shp check
   ```

7. Commit any release-prep changes and push the branch:

   ```bash
   git status --short
   git add <changed-files>
   git commit -m "Prepare v0.3.0 release"
   git push
   ```

   If there are no release-prep changes, do not create an empty commit. The
   release still must point at a branch commit that is already pushed.

8. Confirm `HEAD` is a clean branch tip:

   ```bash
   git status --short
   git rev-parse --abbrev-ref HEAD
   git branch --contains HEAD
   git status --branch --short
   ```

9. Create and push the version tag from that branch tip:

   ```bash
   git tag v0.3.0
   git push origin v0.3.0
   ```

The `.github/workflows/release.yml` workflow runs on `v*.*.*` tags. It validates
the repo, builds release assets with `bun run build:release`, smoke-tests the
Linux x64 binary, and publishes a GitHub release with `gh release create
"$GITHUB_REF_NAME" dist/release/* --generate-notes --verify-tag`.

Release assets produced by `scripts/build-release-assets.sh`:

- `shp-linux-x64.tar.gz`
- `shp-linux-arm64.tar.gz`
- `shp-darwin-x64.tar.gz`
- `shp-darwin-arm64.tar.gz`
- `shp-windows-x64.tar.gz`
- `install.sh`
- `install.ps1`
- `checksums.txt`

The builder sets `SHAPE_RELEASE_VERSION` from `GITHUB_REF_NAME` by default and
replaces `__SHAPE_DEFAULT_VERSION__` in the installer scripts so release-hosted
installers default to the tag they came from. If no version is injected, the
installers fall back to `latest`.

After the workflow finishes, verify the GitHub release has all assets, checksum
verification works, and the setup action can install the new version:

```yaml
- uses: timbrinded/shapelang@master
  with:
    version: v0.3.0
```

## CI Expectations

CI runs codegen checks, formatting, linting, tests, typechecking, Shape CI, docs
checks, release-asset build smoke tests, link checks, and typos checks.

For local development, the usual minimum after a code change is:

```bash
bun run changed-files
bun run format:check
bun run lint
bun test
bun run typecheck
bun run shape:ci
```
