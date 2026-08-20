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
- `.agents/plugins/marketplace.json` and `.claude-plugin/marketplace.json`:
  marketplace indexes that expose the local Shape plugin.
- `plugins/shapelang/.codex-plugin/plugin.json` and
  `plugins/shapelang/.claude-plugin/plugin.json`: dual-compatible plugin
  manifests for publishing the bundled Shape skills to Codex and Claude Code.
- `shape`: Shape's own architecture model for the language, checker, tooling, and
  delivery pipeline.
- `fixtures/pass` and `fixtures/fail`: focused semantic examples used by tests.
- `docs-site`: Astro/Starlight documentation site. Complete `shape` code fences
  are parsed by the docs verifier unless marked `shape no-verify`.
- `plugins/shapelang/skills`: downstream agent skills for using Shape in other
  repositories. Keep new skills in `plugins/shapelang/skills/<skill-name>/SKILL.md`
  so both plugin manifests expose them.
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
- When a code change adds, removes, or moves functionality, assume the Shape
  model may need to change too. Inspect `shape/*.shape`, update the relevant
  component/function/effect/relation claims, or add a narrow current attestation
  only when the architecture contract truly did not change.
- Use the existing files under `shape/` as the best local guide for Shape syntax,
  modeling style, source/evidence references, relations, memory, and
  reevaluations before inventing new patterns.
- Shape-affecting files with docs bindings require a docs update or current
  `attest docs_not_needed`.
- For guarded targets, inspect obligations with `bun shp obligations` and memory
  with `bun shp memory`; then add a real `reevaluation` or preserve the protected
  shape.
- Represent structural dependencies as top-level `relation` declarations. Prefer
  prelude relation kinds such as `calls`, `callbacks`, `provides`, and
  `coordinated_call`.
- Use `bun shp graph stats` before editing relation-heavy models, and
  `bun shp graph show SYMBOL --kind KIND` for focused investigation.

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

Public releases coordinate the CLI/setup action tag `vX.Y.Z` and plugin tag
`shapelang--vX.Y.Z` from the same commit. These files must all contain `X.Y.Z`:

- `packages/shp-cli/package.json`
- `plugins/shapelang/.codex-plugin/plugin.json`
- `plugins/shapelang/.claude-plugin/plugin.json`

Run `bun run release:metadata` and `bun run skills:check` during preparation.
Update pinned public examples, all affected skill entrypoints/references/agent
metadata, and `docs/releases/vX.Y.Z.md`.

Only release from a clean, pushed, current `master` commit. Before any tag,
dispatch `.github/workflows/release-candidate.yml` on that exact commit. Its
deterministic release suite plus blocking six-skill static conformance and
focused behavioral canaries must
pass, then a human must approve the protected `skills-release-approval`
environment. Automated skill output alone does not authorize a release. Any
fix requires a new merged commit and a new candidate run.

After the exact commit's candidate run succeeds, create and push both lightweight
tags together. The release workflow rejects non-current-master tags, missing or
mismatched plugin tags, unsynchronized versions, and commits without a successful
approved candidate run.

Follow `RELEASING.md` for the command-by-command preparation, manual gate,
tagging, asset smoke tests, and post-publication checklist.

Release assets produced by `scripts/build-release-assets.sh`:

- `shp-linux-x64.tar.gz`
- `shp-linux-arm64.tar.gz`
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
    version: v0.7.0
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
