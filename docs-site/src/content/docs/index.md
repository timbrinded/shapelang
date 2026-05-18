---
title: Shape
description: Shape is a typed architecture conformance language for making architectural claims explicit and checkable.
template: splash
hero:
  tagline: Typed architecture conformance for reviewable systems.
  image:
    file: ../../assets/shape-workflow.png
    alt: Shape workflow from code diff to shape delta to deterministic checker.
  actions:
    - text: Start with Shape
      link: /shapelang/learn/quickstart/
      variant: primary
    - text: Read the model
      link: /shapelang/concepts/resources-traits-effects/
      variant: secondary
---

Shape gives a codebase a small human-readable model in `.shape` files. Humans and LLMs write reviewable claims about resources, components, effects, ownership, dependencies, and changes. The deterministic checker accepts or rejects those claims.

The checker does not prove that application code is correct. It checks whether the declared architecture model is coherent enough to enforce in review and CI.

## The first demo

An append-only resource can allow reads and appends while forbidding final destructive effects:

```shape
module audit

trait AppendOnly<T: Resource> {
  allow Append<T>
  allow Read<T>
  forbid final DropStorage<T>
  forbid final HardDelete<T>
  forbid final Truncate<T>
}

resource AuditEvent : AppendOnly

component AuditStore {
  owns AuditEvent
  grants Append<AuditEvent>
  grants Read<AuditEvent>
  fn appendEvent
    effects complete {
      Append<AuditEvent>
    }
}
```

If a PR adds a function whose shape summary says it hard-deletes `AuditEvent`, Shape rejects the model before the change becomes architectural fact.

## What to read first

- [Quickstart](./learn/quickstart/) gets the repo installed and runs the checker.
- [First Shape File](./learn/first-shape-file/) explains the smallest useful model.
- [Append-Only Walkthrough](./learn/append-only-walkthrough/) follows the core failure from declaration to diagnostic.
- [CLI Reference](./reference/cli/) lists the commands this repo exposes today.

