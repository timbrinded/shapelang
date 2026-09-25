# Contributing to Shape

This guide covers work on the Shape repository itself: the checker, the `shp`
CLI, the docs site, the agent skills, and the release tooling. To use Shape in
another repository, install the released `shp` binary
(currently `0.9.0` / `v0.9.0`) as the
[Quickstart](https://timbrinded.github.io/shapelang/learn/quickstart/) describes;
that needs none of this workspace.

## Prerequisites

- Bun. The root `package.json` records the expected version in
  `packageManager`, and `bun.lock` is the lockfile.
- Node 24 or later on `PATH`. `bun run langium:generate` and `bun run docs:check` invoke
  tooling through Node, and CI pins Node 24. The repository ships an `.nvmrc`,
  so `nvm use` selects the right version.
- Git. The changed-file and generated-AST scripts call it.
- For release builds (`bun run build:release`): `zstd`, without which the
  builder exits, and `sha256sum`, which writes `checksums.txt`.

The semantic-kernel prototype also needs Rust through `rustup`, which reads the
pinned `rust-toolchain.toml`; see
[experiments/semantic-kernel/README.md](experiments/semantic-kernel/README.md).

## Set up

```bash
bun install --frozen-lockfile
bun run langium:generate
```

`langium:generate` regenerates the parser artifacts under
`packages/shp-checker/src/language/generated` from the grammar. The artifacts are
committed, and CI's Codegen job fails when regenerating them produces a diff.

## Repository layout

| Path | Contents |
| --- | --- |
| `packages/shp-checker` | Parser, formatter, fact lowering, semantic checker, graph/explain/memory helpers, authoring helpers, editor helpers, and analyzer hints. The checker lives under `src/checker/` (`rules/`, `lowering/`, `diagnostics.ts`); `src/checker.ts` re-exports it. Behavioural tests live in `src/behavioural/`. |
| `packages/shp-checker/src/language/shape.langium` | The Langium grammar. |
| `packages/shp-checker/src/language/generated` | Generated Langium artifacts. Regenerate them with `bun run langium:generate`; never hand-edit them. |
| `packages/shp-cli` | The `shp` command-line wrapper around `@shape/shp-checker`. Each command lives in `src/commands/<command>/` (`command.ts` for flags, `impl.ts` for behaviour) and is registered in `src/app.ts`. The language server is in `src/lsp/`. |
| `shape/` | Shape's own model of the language, checker, tooling, runtime, and delivery pipeline: `checker.shape`, `delivery.shape`, `incremental-checker.shape`, `language.shape`, `runtime.shape`, and `tooling.shape`. |
| `shape/generated/ast/` | Committed generated AST context and its `manifest.json` (see [Generated AST context](#generated-ast-context)). |
| `fixtures/pass`, `fixtures/fail` | Focused semantic examples used by tests, one directory per case. |
| `fixtures/changed`, `fixtures/diffs`, `fixtures/projects`, `fixtures/source`, `fixtures/skills` | Changed-file lists, authoring diffs, multi-file projects, analyzer and AST source samples, and the skill release cases (`fixtures/skills/cases.json`). |
| `docs-site/` | The Astro/Starlight documentation site: pages in `src/content/docs/`, diagrams in `src/assets/diagrams/`, Shape syntax highlighting in `src/syntax/`, and the Shape-fence verifier in `scripts/verify-shape-blocks.ts`. |
| `docs/releases/` | Release notes, one `vX.Y.Z.md` per release. |
| `plugins/shapelang/skills` | Agent skills for using Shape in other repositories. Keep each new skill in `plugins/shapelang/skills/<skill-name>/SKILL.md` so both plugin manifests expose it. |
| `plugins/shapelang/.codex-plugin/plugin.json`, `plugins/shapelang/.claude-plugin/plugin.json` | Plugin manifests that publish the bundled skills to Codex and Claude Code. |
| `.agents/plugins/marketplace.json`, `.claude-plugin/marketplace.json` | Marketplace indexes that expose the local Shape plugin. |
| `experiments/semantic-kernel` | An isolated Rust/WebAssembly prototype. The checker, CLI, and release archives do not depend on it. |
| `scripts/` | Repository scripts: release building, smoke tests, and canaries (`build-release-assets.sh`, `smoke-release-binary.sh`, `run-release-canaries.ts`); release gates (`check-release-metadata.ts`, `check-release-approval.ts`); `check-skills.ts`; `generate-ast-shapes.ts`; and `write-changed-files.sh`, which writes `changed.txt` and `changed-base.txt`. |
| `.github/` | Workflows (`shape.yml`, `docs-pages.yml`, `release-candidate.yml`, `release.yml`), the `claude-skill-review` composite action, the Claude job runner in `scripts/`, its prompts in `prompts/`, and result schemas in `shape-contract/schemas/`. |
| `action.yml`, `install.sh`, `install.ps1` | The GitHub setup action and the installers for released `shp` binaries. |
| `AGENTS.md` | Instructions for coding agents. `CLAUDE.md` is a symlink to it. |
| `DESIGN.md`, `RELEASING.md` | Diagram and visual rules; the release procedure. |
| `.research/` | Ignored local research material. Nothing tracked may depend on it. |

## Checks before a pull request

Run these from the repository root before opening a pull request:

<!-- AGENTS.md and RELEASING.md step 2 repeat this list; change all three together. -->

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

| Command | What it checks | CI job |
| --- | --- | --- |
| `bun run changed-files` | Writes `changed.txt`, the changed-file list that `shape:ci` reads, and `changed-base.txt`, the commit it was diffed against. | Shape |
| `bun run format:check` | `oxfmt --check .`, then `shp fmt --check` on every `.shape` file in the repository, fixtures included, except under `./node_modules/` and `./.research/`. | Format |
| `bun run lint` | `oxlint --deny-warnings .` | Lint |
| `bun run skills:check` | Lints the shipped skill corpus (`scripts/check-skills.ts`). | Lint |
| `bun test` | Every workspace test. Behavioural tests follow [packages/shp-checker/TESTING.md](packages/shp-checker/TESTING.md). | Test |
| `bun run typecheck` | `tsgo -p tsconfig.json --noEmit` | Typecheck |
| `bun run shape:ci` | The Shape gate, described [below](#the-shape-gate). | Shape |
| `bun run docs:check` | `astro check`, the Shape-fence verifier, and the static site build. | Docs |

These commands cover the CI jobs that you reproduce locally. The other jobs are
listed in [CI in this repository](#ci-in-this-repository) and need no local run,
with two exceptions:

- After a grammar change, run `bun run langium:generate` and commit the output,
  because Codegen fails on any diff under
  `packages/shp-checker/src/language/generated`.
- After a release or install change, run the Build job's check on a Linux x64
  host, with `X.Y.Z` set to the version in `packages/shp-cli/package.json`:

  ```bash
  bun run build:release
  scripts/smoke-release-binary.sh --expected-version X.Y.Z dist/release/shp-linux-x64.tar.gz
  ```

## The Shape gate

`bun run shape:ci` is the Shape gate that CI runs. Run `bun run changed-files`
first: it writes `changed.txt` and `changed-base.txt`, which the gate reads. The gate stops at the first
failing step:

1. `bun run ast:check` checks that the generated AST context is fresh.
2. `bun run format:shape:check` runs the same `shp fmt --check` pass over every
   `.shape` file that `format:check` runs.
3. `bun shp check --changed-files changed.txt --base-ref "$(cat changed-base.txt)" --check-cited-paths`
   runs the semantic checks, coverage, and docs bindings, counts only
   attestations written for this change, and fails if the model cites a file
   that no longer exists. Docs pages are mapped to `DocsSite` without a coverage
   obligation, so a docs-only edit needs no attestation; the cited-path check
   catches a cited page being renamed or deleted.
4. `bun shp obligations` and `bun shp memory` print open obligations and design
   memory.

`changed.txt` lists the files changed against a base, plus unstaged, staged, and
untracked files. In CI the base is the pull request's base branch or, on a
push, the commit the branch pointed at before the push. Locally it is the merge base with `origin/$BASE_REF`
when `BASE_REF` is set, otherwise with `origin/HEAD`, `origin/main`, or
`origin/master`.

The gate fails in two common cases:

- **Coverage**, reported as
  `error: governed source changed without current Shape update`. A path is
  governed when an `implementation` in `shape/*.shape` matches it and declares
  `on_change require shape_update`. Update the Shape
  claims in the same change: a function's `source`, or an `evidence` on one of
  its effect entries, must name the changed path exactly (an `#anchor` or
  `:line` suffix is ignored), in a `.shape` file that is itself in
  `changed.txt`. If the architecture contract did not change, add a narrow
  `attest no_shape_change` whose `source` names the exact path and whose
  `reason` is non-empty.
- **Docs bindings**, reported as `error: bound docs change missing`. A `binding`
  (for example `CliDocs` in `shape/delivery.shape`) couples source and model
  files to docs. When a `when_changed` path changes, change at least one of the
  binding's `require_changed` paths. Otherwise each triggering path needs a
  current attestation of a kind the binding's `allow attest` lists; every
  binding in this repository allows `docs_not_needed`.

The checker treats every attestation and every `source` or `evidence` ref in a
`.shape` file listed in `changed.txt` as current, including old ones. When you
touch a file that holds many attestations, such as `shape/delivery.shape`, check
which of them still apply. Functions in generated AST modules never count as a
Shape update.

The [Keep the Model Current](https://timbrinded.github.io/shapelang/guides/keep-model-current/)
guide explains coverage, bindings, and attestations in full.

## What to update per change type

A semantic change is complete only when the grammar, generated artifacts,
checker rules, fixtures, docs, and Shape model agree. Docs paths below are
relative to `docs-site/src/content/docs/`.

| Change | Code and tests | Docs and Shape model |
| --- | --- | --- |
| Grammar or parser | `packages/shp-checker/src/language/shape.langium`; the regenerated files under `language/generated`; `parser.ts`; `formatter.ts`, which rebuilds files from the AST; the highlighter in `docs-site/src/syntax/shape-language.mjs`; parser, formatter, and lowering tests. | `reference/language-syntax.md` and `inside-shape/langium-grammar.md` (the `GrammarDocs` binding); `shape/language.shape`. |
| Checker rule | `packages/shp-checker/src/checker/rules/*.ts`, ordered in `checker/rules.ts`; lowering under `checker/lowering/`; rendered output in `checker/diagnostics.ts`; cases under `fixtures/pass` and `fixtures/fail`; `src/checker*.test.ts` and `src/behavioural/`. | The concept or reference page that teaches the behaviour; `reference/diagnostics.md` for a new or changed diagnostic; `inside-shape/rule-evaluation.md`; `shape/checker.shape`. |
| CLI | `packages/shp-cli/src/commands/<command>/`, and `src/app.ts` for a new command; `src/index.test.ts` and `src/cli-contract.test.ts`. | `reference/cli.md` and `guides/ci.md` (a change to either satisfies the `CliDocs` binding), and `README.md` where it describes the changed behaviour. `shape/tooling.shape`. |
| Docs | The page; for a new page, the sidebar in `docs-site/astro.config.mjs`. | Nothing in the model: `DocsContent` in `shape/delivery.shape` maps pages to `DocsSite` without `on_change`. When a renamed or deleted page is cited as `source` or `evidence`, update the citation, or `--check-cited-paths` fails. |
| Release or install | `install.sh`, `install.ps1`, `action.yml`, `scripts/build-release-assets.sh`, `scripts/smoke-release-binary.sh`, `.github/workflows/release.yml`, and `.github/workflows/release-candidate.yml`. | The README Quick Start snippets and `learn/quickstart.md`; `shape/delivery.shape`; [RELEASING.md](RELEASING.md). |

A new platform target starts in
`packages/shp-checker/src/tree-sitter-native-targets.ts`, which the release
builder, runtime parser selection, and `shp update` read. `install.sh`,
`install.ps1`, and `action.yml` map platforms to assets separately, and
`release.yml` and `release-candidate.yml` list the archives by name, so add the
target in each of them too.

## Docs site

```bash
bun run docs:dev       # dev server
bun run docs:build     # static build into docs-site/dist
bun run docs:preview   # serve the static build
```

Pages live under `docs-site/src/content/docs/`. Each has frontmatter with a
`title` and a one-sentence `description`, and the sidebar in
`docs-site/astro.config.mjs` lists every page explicitly.

**Shape fences.** `bun run docs:check` parses every ` ```shape ` fence in the
`.md`, `.mdx`, and `.mdoc` files under `docs-site/src/content/docs` with the repo
parser, and fails on any fence that does not parse. It skips a fence only when
its info string contains `no-verify`, so mark an intentional fragment:

````markdown
```shape no-verify
fn fragmentOnly
  effects unknown
```
````

The fence still renders for readers. The verifier matches only fences that open
at the start of a line, so an indented fence, such as one inside a list item, is
not parsed. It checks syntax only and never runs `shp check`: run each example
you present as passing or failing, and copy its real output.

**Links.** The site is served under the base `/shapelang/` with trailing
slashes. Link between pages with root-absolute URLs that include the base and
the trailing slash, for example `[CLI Reference](/shapelang/reference/cli/)`.
Relative links break on the built site. Repository-root Markdown files link to
the site with full `https://timbrinded.github.io/shapelang/...` URLs.

**Diagrams.** Diagrams are hand-authored SVG files in
`docs-site/src/assets/diagrams/` that follow [DESIGN.md](DESIGN.md). Embed one
with Markdown image syntax and a relative asset path (from a page one directory
deep, `../../../assets/diagrams/NAME.svg`). The alt text states the diagram's
assertion in one sentence.

**Release pins.** Some pages carry literal version snippets that
`bun run release:metadata` and `bun test` check. The list is
`releaseVersionPins` in `scripts/check-release-metadata.ts`. Keep those snippets
verbatim; if one has to move, update the list in the same change.

**Deployment.** `.github/workflows/docs-pages.yml` runs `bun run docs:check` and
deploys `docs-site/dist` to https://timbrinded.github.io/shapelang/ on every
push to `master`, or when run manually. The repository's Pages source must be
set to GitHub Actions.

## Generated AST context

This repository commits generated AST context under `shape/generated/ast/`,
with a `manifest.json` that records each generated module and its source file.

```bash
bun run ast:generate   # regenerate the committed files
bun run ast:check      # exit 1 if any manifest-owned file is stale, missing, or extra
```

Both scripts run `shp ast source --out-dir shape/generated/ast` over one source
set: tracked and untracked, non-ignored files
(`git ls-files --cached --others --exclude-standard`) with the extensions `.ts`,
`.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.rs`, `.go`, `.py`, or
`.swift`. The set excludes any `node_modules/` or `dist/` directory,
`docs-site/.astro/`,
`packages/shp-checker/src/language/generated/`, and `shape/generated/`, and it
skips files that Git lists but the working tree no longer has.

Two source paths can normalize to the same module name, for example Python
`__init__.py` and `init.py`. Generation processes sources in codepoint order of
their repository-relative paths: the first keeps the module name, and each later
one gets a `_g<8 hex>` suffix hashed from its path, so the result is
deterministic. Two source paths that map to the same output file, such as
`foo.ts` and `foo.tsx`, fail with
`error: generated AST output path collision` and exit code 2 before any file is
written.

CI's Codegen and Shape jobs, `bun run shape:ci`, and both release workflows run
`ast:check`. A source change that stales the context therefore fails until you
run `bun run ast:generate` and commit the result.

## CI in this repository

`.github/workflows/shape.yml` (workflow name `CI`) runs on every pull request and
on every push to `master`:

| Job | Runs |
| --- | --- |
| Codegen | `langium:generate` with a diff check, then `ast:check` |
| Format | `format:check` |
| Lint | `lint`, then `skills:check` |
| Typecheck | `typecheck` |
| Test | `bun test` |
| Semantic Kernel Prototype | `kernel:check`, `kernel:build`, `kernel:e2e`; uploads the browser WASM build |
| Shape | `changed-files`, then `shape:ci` |
| Docs | `docs:check` |
| Build | `build:release`, then `smoke-release-binary.sh` on the Linux x64 archive |
| Links | lychee over the repository, including `#fragment` anchors; docs-site, published-site, and `master` links resolve against the checkout |
| Typos | `crate-ci/typos` |

On pull requests, three Claude-powered jobs also run. One script drives them all:
`.github/scripts/run-claude-skill.mjs`, invoked through the
`.github/actions/claude-skill-review` composite action. Each job first looks for
an `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN` secret and skips cleanly when
neither is set. The script then runs twice:

1. A `--prefilter` pass either finishes the job deterministically or emits the
   prompt and `claude_args` for `anthropics/claude-code-action`, which runs the
   model (Sonnet by default) with structured output.
2. A gate pass validates the result against the job's JSON schema under
   `.github/shape-contract/schemas/`, writes the job summary, and applies the
   job's pass/fail policy. When a proxy gateway drops the structured output, the
   gate recovers the result from the action's execution log.

| Job | Checks | Fails when |
| --- | --- | --- |
| Shape Claude Review (`shape-claude-review`) | Source-to-model drift, following `.github/prompts/shape-contract-review.md`. | The status is not `pass`, or a `pass` carries findings. |
| Shape Contract Guard (`shape-guard`) | The authored `.shape` diff against the pull request base, following `plugins/shapelang/skills/shape-contract-guard/SKILL.md` and `.github/prompts/shape-guard.md`: removed final forbids, weakened traits, widened grants or effects, weakened relations or coverage, and weak attestations. The prefilter passes without calling Claude when no authored `.shape` file (outside `shape/generated/`) changed. | The review errors, a `pass` carries findings, or a finding is high-impact and suspicious. Other findings, including high-impact ones marked supported, are advisory. |
| Shape Index Coverage (`shape-index`) | Follows `plugins/shapelang/skills/shape-index/SKILL.md` and `.github/prompts/shape-index.md`. The prefilter lists changed source files that no `source` or `evidence` ref or `implementation` glob in `shape/*.shape` covers, passes without Claude when there are none, and otherwise asks Claude to judge that remainder for architecture-significant subsystems without coverage. | The review errors, a `pass` carries gaps, or it finds gaps while the Actions variable `SHAPE_INDEX_STRICT` is `true`. Otherwise gaps appear in the job summary but do not block. |

After these jobs, Shape PR Summary Comment (`shape-pr-comment`) upserts one
comment on the pull request. It reports the results of Shape, Shape Claude
Review, Shape Contract Guard, and Shape Index Coverage for the latest commit, and
links to the workflow run. It runs only for pull requests from branches of this
repository.

Releases add the `Release Candidate: Skills` workflow, a manual approval, and the
tag-triggered `Release` workflow; [RELEASING.md](RELEASING.md) describes them.
