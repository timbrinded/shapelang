---
title: What Shape Is
description: The product boundary, mental model, and core workflow for Shape.
sidebar:
  order: 1
---

Shape is a typed architecture conformance language. It describes the semantic shape of a system in files that reviewers can read and a checker can evaluate.

It is not a programming language in the usual sense. Shape files do not execute application logic, compile TypeScript, or infer arbitrary behavior from source code. They make claims explicit:

- this resource is append-only
- this component owns that resource
- this function emits these effects
- this implementation path is governed by a component shape
- this change file modifies the declared model for a PR

The contract is simple:

```text
LLM-authored semantic model
+ human-reviewed shape files
+ deterministic checker
+ CI enforcement
```

## Source of truth

`.shape` files are the source of architectural truth. Application code can be messy, implicit, or spread across many files; Shape gives the codebase a compact review surface.

The checker judges the claims in `.shape` files. Optional source analyzers can point out suspicious omissions, but analyzer hints do not replace the declared model.

## Core workflow

1. A baseline model lives under `shape/system/**/*.shape`.
2. PRs add change files under `shape/changes/**/*.shape`.
3. Reviewers inspect the source evidence attached to effects.
4. CI runs `shp check`, `shp coverage`, format checks, tests, and type checks.
5. Diagnostics explain the causal path behind each rejection.

## Product boundary

Shape is useful when the architecture question can be represented as a checkable claim. It is not a proof assistant, a replacement for tests, or a replacement for code review.

The useful boundary is: humans and LLMs write claims; humans review claims; the checker rejects incoherent claims.

