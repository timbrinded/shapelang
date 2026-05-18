---
title: Quickstart
description: Install the repo, generate grammar artifacts, and run the Shape checker.
sidebar:
  order: 2
---

Shape currently ships as a Bun workspace with a checker package and a CLI package.

## Install

```bash
bun install
bun run langium:generate
```

## Run the checker

```bash
bun shp check
```

With no file arguments, `shp check` scans:

```text
shape/system/**/*.shape
shape/changes/**/*.shape
```

## Run the test suite

```bash
bun test
bun run typecheck
```

## Try a failing fixture

```bash
bun shp check fixtures/fail/append_only_hard_delete/audit.shape
```

That fixture declares `AuditEvent : AppendOnly`, then adds a function that emits `HardDelete<AuditEvent>`. The checker rejects it because final forbids win over component grants.

## Format shape files

```bash
bun shp fmt --check fixtures/pass/append_only_append/audit.shape
```

Use `bun shp fmt` without `--check` to rewrite shape files with canonical formatting.

