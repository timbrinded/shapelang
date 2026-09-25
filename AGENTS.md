# Shape Project Memory

This repository is the Shape language project. Shape is a typed architecture
conformance language for making architecture claims explicit, reviewable, and
checkable in CI.

Shape does not prove that arbitrary application code is correct. Its boundary is
the declared `.shape` model: humans and agents write typed claims about resources,
components, effects, relations, coverage, bindings, and design memory; the
deterministic checker accepts or rejects those claims.

`CLAUDE.md` is a symlink to this file. Keep shared agent instructions here. The
human contributor workflow is in `CONTRIBUTING.md`, the release procedure in
`RELEASING.md`, and the behavioural test conventions in
`packages/shp-checker/TESTING.md`.

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

`CONTRIBUTING.md` has the complete layout. The parts agents touch most:

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
- `docs-site`: Astro/Starlight documentation site.
- `plugins/shapelang/skills`: downstream agent skills for using Shape in other
  repositories. Keep new skills in `plugins/shapelang/skills/<skill-name>/SKILL.md`
  so both plugin manifests expose them.
- `scripts/build-release-assets.sh`: builds release archives and injects the
  release version into the installer scripts.
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
- When a code change adds, removes, or moves functionality, assume the Shape
  model may need to change too. A governed source change requires a faithful
  Shape update: inspect `shape/*.shape` and update the relevant
  component/function/effect/relation claims. Add a narrow current
  `attest no_shape_change` only when the architecture contract truly did not
  change.
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

- Before editing, find the change type in the "What to update per change type"
  table in `CONTRIBUTING.md` and update every file in its row, including the
  Shape model file and the docs binding it names.
- Docs pages under `docs-site/src/content/docs/` map to `DocsContent` in
  `shape/delivery.shape`, which has no `on_change`, so a page edit needs no
  Shape update or attestation. Renaming or deleting a page the model cites
  fails `shape:ci` with `missing cited path` until the citation is updated.
- Docs changes must keep every `shape` fence parseable. The docs verifier parses
  every unindented `shape` fence under `docs-site/src/content/docs` unless its
  info string contains `no-verify`; use `shape no-verify` only for intentional
  fragments.

## Release Rules

`RELEASING.md` is the release procedure; follow it step by step. The rules:

- Public releases coordinate the CLI/setup action tag `vX.Y.Z` and the plugin tag
  `shapelang--vX.Y.Z` on the same commit, which must be clean, pushed, current
  `master`.
- These must all carry `X.Y.Z`: `packages/shp-cli/package.json`,
  `plugins/shapelang/.codex-plugin/plugin.json`,
  `plugins/shapelang/.claude-plugin/plugin.json`, and the `# Shape vX.Y.Z`
  heading in `docs/releases/vX.Y.Z.md`.
- Run `bun run release:metadata` and `bun run skills:check` during preparation.
  `release:metadata` lists every public version pin from `releaseVersionPins` in
  `scripts/check-release-metadata.ts`; `bun test` also fails on a stale pin.
  Update the pinned public examples, all affected skill
  entrypoints/references/agent metadata, and `docs/releases/vX.Y.Z.md`.
- Keep pinned snippets verbatim when editing docs. If a pin must move, update
  `releaseVersionPins` in the same change.
- Before any tag, dispatch `.github/workflows/release-candidate.yml` on that
  exact commit. A human must approve the protected `skills-release-approval`
  environment. Automated skill output alone does not authorize a release.
- A copied skills report does not skip the candidate: the new commit still needs
  its own validate job, archive smoke tests, and human approval. Never tag an
  ancestor commit after `master` has moved.
- After the exact commit's candidate run succeeds and is approved, create and
  push both lightweight tags together, in one push.
- Merge nothing to `master` from candidate dispatch until the Release workflow
  has published.
- Never move or replace a published release tag; fix forward with a new version.

After the Release workflow finishes, confirm that its verify jobs passed. They
check the published assets and checksums, and install the published version
through the setup action on Linux x64, Linux ARM64, macOS ARM64, and Windows x64.

A consumer pins a release through the action's `version` input:

```yaml
- uses: timbrinded/shapelang@master
  with:
    version: v0.9.0
```

## CI Expectations

CI (`.github/workflows/shape.yml`) runs Langium codegen and generated-AST
freshness checks, formatting, linting plus `skills:check`, typechecking, tests,
the semantic-kernel prototype, Shape CI, docs checks, a release-asset build smoke
test, link checks, and typos checks. On pull requests it also runs the
Claude-powered Shape Claude Review, Shape Contract Guard, and Shape Index
Coverage jobs, then upserts a PR summary comment.

For local development, run this list after a code change. It is identical to the
list in `CONTRIBUTING.md` and repeated in `RELEASING.md` step 2; change all three
together.

```bash
bun run changed-files
bun run format:check
bun run lint
bun run skills:check
bun test
bun run typecheck
bun run shape:ci
bun run docs:check
```
