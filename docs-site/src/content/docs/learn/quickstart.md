---
title: Quickstart
description: Download the released Shape typechecker and run it against `.shape` files.
sidebar:
  order: 2
---

Shape ships a self-contained `shp` typechecker binary. You do not need Bun or Node to run it in a project that already has `.shape` files.

![Quickstart loop showing install shp, shape files, shp check, diagnostics, update model, and CI.](../../../assets/infographics/quickstart-loop.png)

## Install

Use a pinned version in scripts and CI:

```bash
curl --proto '=https' --tlsv1.2 -LsSf https://github.com/timbrinded/shapelang/releases/download/v0.1.0/install.sh | sh
```

On Windows:

```powershell
irm https://github.com/timbrinded/shapelang/releases/download/v0.1.0/install.ps1 | iex
```

The installer downloads the matching release archive, verifies its SHA-256 checksum, and installs `shp` into `~/.local/bin`. Replace `v0.1.0` with the release tag you want to pin.

If your shell cannot find `shp` after installation, add the install directory to your `PATH`:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

## Check a repo

```bash
shp check
```

With no file arguments, `shp check` scans:

```text
shape/**/*.shape
```

## Format shape files

```bash
shp fmt --check
```

Use `shp fmt` without `--check` to rewrite shape files with canonical formatting.

## Check changed files

```bash
git diff --name-only origin/main...HEAD > changed.txt
shp coverage --changed-files changed.txt
```

If a governed source path changes without a Shape update or current attestation, the checker rejects the change.

## GitHub Actions

```yaml
steps:
  - uses: actions/checkout@v4
  - uses: timbrinded/shapelang@v0.1.0
  - run: shp check
```

For contributor setup, see [Local Development](../reference/local-development).
