---
title: Local Development
description: Set up the Shape repository for contributor work.
sidebar:
  order: 5
---

Use the Bun workspace when contributing to Shape itself. Application repos should usually install the released `shp` binary instead.

## Setup

```bash
bun install --frozen-lockfile
bun run langium:generate
```

## Checks

```bash
bun shp check
bun run changed-files
bun run shape:ci
bun test
bun run typecheck
bun run docs:check
```

`bun run docs:check` runs Astro/Starlight validation, verifies complete `shape` code fences with the repo parser, and builds the static docs site.

Docs verification walks Markdown-family docs files under the content tree (`.md`, `.mdx`, and `.mdoc`) and verifies only complete `shape` fences. Fences marked `no-verify` stay visible to readers but are skipped by the parser check.

`bun run shape:ci` is the local version of the repo's Shape gate. It uses `changed.txt` to enforce governed source coverage and bindings. A governed source change needs a faithful `shape` update or current `attest no_shape_change`; a Shape-affecting source/model change with a docs binding also needs a docs update or current `attest docs_not_needed`.

Incomplete docs snippets must opt out explicitly:

````markdown
```shape no-verify
fn fragmentOnly
  effects unknown
```
````

Complete examples should remain parseable so readers can trust them.

## Docs site

```bash
bun run docs:dev
```

## Release assets

```bash
bun run build:release
```

Release assets are written under `dist/release/`. The tag-triggered release workflow runs the same builder, smoke-tests the Linux binary including `shp ast source`, and uploads checksummed archives to GitHub Releases.
