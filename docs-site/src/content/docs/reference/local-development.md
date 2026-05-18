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
bun test
bun run typecheck
bun run docs:check
```

`bun run docs:check` runs Astro/Starlight validation, verifies complete `shape` code fences with the repo parser, and builds the static docs site.

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

Release assets are written under `dist/release/`. The tag-triggered release workflow runs the same builder, smoke-tests the Linux binary, and uploads checksummed archives to GitHub Releases.
