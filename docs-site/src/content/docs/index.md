---
title: Shape
description: Record architecture rules as reviewable text files and check them automatically in pull requests and CI.
template: splash
hero:
  tagline: Architecture rules as text files, reviewed by people, checked by a tool in CI.
  actions:
    - text: Install and run a check
      link: /shapelang/learn/quickstart/
      variant: primary
    - text: What this tool is
      link: /shapelang/learn/what-is-shape/
      variant: secondary
---

## The problem

Important architecture decisions often live only in people’s heads, chat threads, or outdated diagrams. Code review then depends on whether someone notices that a pull request deleted audit rows, opened a private store to a public path, or broke a dependency rule that the team already agreed on.

Tests check behavior. Typecheckers check types. Neither is a natural place to state durable rules such as “this store is append-only” or “only the gateway may expose this endpoint,” and keep those rules visible and enforceable as the codebase changes.

## What Shape is

Shape is a small language and a checker for **architecture rules you write down and keep next to the repo**.

You put short declarations in files under `shape/` (extension `.shape`). Those files describe things the system is allowed or forbidden to do at an architectural level—for example which parts of the system may read or write which data, and which operations are banned for a given store. Humans (and optionally coding agents) draft and edit those files. Reviewers read them like any other change. A command-line checker either accepts the file set or rejects it with a concrete error message.

Shape does **not** run your application, replace unit tests, or prove that production code is correct. It checks whether the **declared rules are consistent with each other** and whether the process rules you attached (for example “if these source files change, update the architecture description”) are satisfied.

![Shape review loop: write rules, review, check, CI gate, diagnose, with failures returning to review.](../../assets/infographics/shape-model-loop.png)

## A concrete example

Suppose audit events must never be hard-deleted. You record that rule once, name the store that owns those events, and list the operations you allow:

```shape
module audit

resource AuditEvent : AppendOnly

component AuditStore {
  owns AuditEvent
  grants Append<AuditEvent>
  grants Read<AuditEvent>
  fn appendEvent
    effects complete {
      Append<AuditEvent>
    }
  fn listEvents
    effects complete {
      Read<AuditEvent>
    }
}
```

In plain terms: there is an audit-event store; the audit component may append and read; the two listed functions only claim those operations. The built-in “append-only” rule also bans hard delete, truncate, and dropping storage for that store.

If someone later claims a purge function that hard-deletes audit events—even if they also claim the component is allowed to delete—the checker fails:

```shape
module audit

resource AuditEvent : AppendOnly

component AuditStore {
  owns AuditEvent
  grants Append<AuditEvent>
  grants HardDelete<AuditEvent>
  grants Read<AuditEvent>
  fn purgeOldEvents
    source ts("src/audit/purge.ts#purgeOldEvents")
    effects complete {
      HardDelete<AuditEvent>
        evidence ts("src/audit/purge.ts#purgeOldEvents")
    }
}
```

```bash
shp check shape/audit.shape
```

The tool reports that the purge function claims a hard delete, the audit store is marked append-only, and hard delete is not allowed for that store. A grant on the component does not override a final ban on the store.

You can attach file references (for example a TypeScript path) so reviewers know where to look in source. The checker does not execute that code; the reference is for humans.

## How it fits a normal workflow

1. The team keeps architecture rules in `shape/**/*.shape`.
2. Pull requests update those files when the change affects architecture (or record a short, reviewable reason when a governed path changed but the rules did not).
3. Reviewers read the rule files the same way they read code and design notes.
4. CI installs a pinned `shp` binary and runs the checker (and, when configured, checks that changed source paths still match the architecture description).

Default discovery with no file arguments:

```bash
shp check
```

That scans `shape/**/*.shape`.

## Where it helps

- Making store and boundary rules explicit and reviewable in git, not only in wikis
- Catching contradictory or forbidden architecture claims before merge
- Requiring that certain source-tree changes come with an architecture-file update
- Recording “why this fragile path looks the way it does” so later refactors need an explicit review note
- Checking structural rules between named parts of the system (for example who may provide an endpoint)
- Producing stable, machine-checkable failures suitable for CI

## Where it does not help

- Proving that application logic is correct at runtime
- Replacing tests, typechecks, or careful code review of implementations
- Inferring a complete architecture description from source with no human-written rules
- Softening a hard ban by adding a comment, grant, or review note—those bans stay final
- Pretending “we listed no operations” means “we know there are none” when you are still unsure

Optional source scanners can warn about suspicious deletes or similar patterns. Warnings are advisory; the written rule files remain the contract the checker enforces.

## What to read next

Start here if you are new:

1. [What this tool is](./learn/what-is-shape) — boundary, workflow, and limits in more detail
2. [Install and run a check](./learn/quickstart) — binary install and first `shp check`
3. [First architecture file](./learn/first-shape-file) — smallest useful example step by step
4. [Append-only walkthrough](./learn/append-only-walkthrough) — from a rule to a failing check

Then, as needed:

- [CI workflow](./learn/ci-workflow) — pin the tool and gate pull requests
- [Keep the model current](./learn/global-model-updates) — when source changes, update `shape/`
- [Command reference](./reference/cli) — full command list

Later pages introduce the formal vocabulary (resources, traits, effects, relations, and so on). You do not need that vocabulary to understand the problem Shape addresses or to run the first check.
