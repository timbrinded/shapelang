---
title: Shape
description: Shape is a small language for architecture claims, and shp is the checker that accepts or rejects them in pull requests and CI.
template: splash
hero:
  tagline: Architecture claims as text files, reviewed by people, checked by shp in CI.
  actions:
    - text: Quickstart
      link: /shapelang/learn/quickstart/
      variant: primary
    - text: Design Rationale
      link: /shapelang/inside-shape/design-rationale/
      variant: secondary
---

## The problem

Architecture decisions often live only in people's heads, chat threads, or outdated diagrams. Code review then depends on someone noticing that a pull request deletes audit rows, exposes a private store on a public path, or breaks a dependency rule the team already agreed.

Tests check behaviour and typecheckers check types. Neither is a natural place to state a durable decision such as "audit events are append-only" or "only the gateway may provide this endpoint", and to keep that decision visible and enforced as the code changes.

## What Shape is

Shape is a small language for writing those decisions down as claims, and `shp` is the checker that accepts or rejects them. A claim is a declaration the author asserts, such as "`AuditEvent` is append-only" or "`AuditStore.appendEvent` appends audit events and does nothing else".

Claims live in `.shape` files under `shape/`. Together the files form the Shape model: the checker loads every `.shape` file it finds there and checks them as one model. People, and optionally coding agents, write the claims. Reviewers read them in the pull request like any other change.

## The boundary

Shape judges only the declared Shape model. `shp check` reads `.shape` files and, when given, a changed-file list. It never opens or runs the application source that `source` and `evidence` refs name. It does not prove that the implementation matches the claims, and it does not replace tests, typechecks, or code review.

A passing check means the claims are coherent with each other. When CI also supplies a changed-file list, a pass also covers the change-set checks described under [Where Shape sits in review](#where-shape-sits-in-review). Whether the claims describe the code truthfully is decided in review.

## Parts of a model

| Part | Keywords | What it claims | Read more |
| --- | --- | --- | --- |
| Resources and traits | `resource`, `trait` | The data that matters, and the effects that are finally forbidden on it | [Effect Model](/shapelang/concepts/effect-model/) |
| Components | `component`, `owns`, `grants` | Which component owns a resource, and which effects its functions may have | [Effect Model](/shapelang/concepts/effect-model/) |
| Function summaries | `fn`, `effects complete`, `effects unknown`, `source`, `evidence` | What each source function does to resources, with references to the code | [Effect Model](/shapelang/concepts/effect-model/) |
| Relations and rules | `relation`, `rule` | How components and resources connect, and which providers, paths, or cycles are forbidden | [Relations and Graph Rules](/shapelang/concepts/relations/) |
| Change governance | `implementation`, `binding`, `attest` | Which source paths need a model update when they change, and which files must change together | [Keep the Model Current](/shapelang/guides/keep-model-current/) |
| Design memory | `rationale`, `memory`, `guards`, `change`, `reevaluation` | Why a fragile target looks the way it does, and which changes to it need a recorded review | [Design Memory](/shapelang/concepts/design-memory/) |
| Modules and packs | `module`, `import` | Namespaces, and shared declarations vendored under `shape/vendor/` | [Domain Packs](/shapelang/guides/domain-packs/) |

## An example

Suppose audit events must never be hard-deleted. `AuditEvent` is an append-only resource. `AuditStore` is the component that owns it; it may append and read events, and its two functions claim only those effects:

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

`AppendOnly` comes from Shape's built-in prelude. Because `AuditEvent` carries it, hard delete, truncate, and drop are finally forbidden for that resource. Saved as `shape/audit.shape`, this model passes, and `shp check` prints `Shape check passed.`

Later, a pull request adds a purge job. Its author adds a grant and a function to `AuditStore`:

```shape no-verify
  grants HardDelete<AuditEvent>
  fn purgeOldEvents
    source ts("src/audit/purge.ts#purgeOldEvents")
    effects complete {
      HardDelete<AuditEvent>
        evidence ts("src/audit/purge.ts#purgeOldEvents")
    }
```

`shp check` now fails with exit code 1:

```text
error: forbidden effect

AuditStore.purgeOldEvents emits HardDelete<AuditEvent>.
AuditEvent has trait AppendOnly.
AppendOnly forbids final HardDelete<AuditEvent>.
evidence: ts("src/audit/purge.ts#purgeOldEvents")

caused by:
  - shape/audit.shape: effect AuditStore.purgeOldEvents emits HardDelete<AuditEvent>
  - shape/audit.shape: resource AuditEvent : AppendOnly
  - standard prelude: trait AppendOnly forbids final HardDelete<T>
```

The diagnostic names the claim that failed and the declarations that caused it. The grant does not help, because a final forbid on a resource's trait wins over any grant.

The `source` and `evidence` refs point at the purge code, but the checker never opens that file. Reviewers follow the refs to check the claim against the code, and coverage uses their paths to match changed source files to the model. The [Quickstart](/shapelang/learn/quickstart/) builds this model step by step and shows how to resolve the failure.

## Where Shape sits in review

![shp check reads only the authored .shape files and changed.txt and accepts or rejects them; the application source that evidence refs point at stays outside the checker, judged by tests, typechecks, and code review.](../../assets/diagrams/product-boundary.svg)

In a pull request that touches the architecture, three parties act on the same change:

- **The author** changes the code and the `.shape` claims that describe it. When a source file the model governs changes but its architecture does not, the author records an `attest no_shape_change` with a reason instead. `shp author`, `shp ast`, or a coding agent can draft the update; a draft is a suggestion until a person reviews it.
- **Reviewers** read the changed claims next to the code, follow the `source` and `evidence` refs, and read any rationale, memory, or reevaluation attached to guarded targets.
- **CI** runs `shp check --changed-files changed.txt`. It checks the whole model, requires a Shape update or attestation in the same change for each changed governed source file, and enforces bindings such as a paired docs change. On failure, the diagnostic names the failing claim and its causes, and the author changes the code, the design decision, or the claim that was wrong.

Tests, typechecks, and code review keep running beside Shape.

## Limits worth knowing

- **Final forbids are final.** Grants, rationale, memory, reevaluation, attestations, and imports cannot waive a `forbid final`. See [Effect Model](/shapelang/concepts/effect-model/).
- **Unknown effects must be explicit.** Write `effects unknown` while a function's effects are not known, because an empty `effects complete {}` claims the function has none. Strict `shp check` rejects `effects unknown` in authored modules, so unresolved analysis fails the check.
- **Coverage checks that the model changed, not that it is right.** A function `source` or effect `evidence` ref for the changed path satisfies coverage whenever its `.shape` file is part of the change, and so does a `no_shape_change` attestation that is new relative to the base model, whether or not the claim is accurate. See [Keep the Model Current](/shapelang/guides/keep-model-current/).
- **Guards fire only from `change` declarations.** A guard requires a `reevaluation` when a `change` declaration modifies or removes its target; editing the target's declaration in place in the Shape model triggers nothing. See [Design Memory](/shapelang/concepts/design-memory/).
- **Hints and drafts are advisory.** `shp analyze`, `shp ast`, and `shp author` inform the author; only `shp check` decides whether the model passes. `shp analyze --shape-files` exits 1 when it reports a warning, but it never changes the result of `shp check`. See [Analyzer Hints](/shapelang/guides/analyzer/).

## Reading paths

| You want to | Read |
| --- | --- |
| Decide whether Shape fits your team | This page, then [Design Rationale](/shapelang/inside-shape/design-rationale/) |
| Adopt Shape in a repository | [Quickstart](/shapelang/learn/quickstart/), [Keep the Model Current](/shapelang/guides/keep-model-current/), [Run Shape in CI](/shapelang/guides/ci/) |
| Write and maintain claims | [Effect Model](/shapelang/concepts/effect-model/), [Relations and Graph Rules](/shapelang/concepts/relations/), [Design Memory](/shapelang/concepts/design-memory/), [Language Syntax](/shapelang/reference/language-syntax/) |
| Look up a command or an error | [CLI Reference](/shapelang/reference/cli/), [Diagnostics](/shapelang/reference/diagnostics/), [Glossary](/shapelang/reference/glossary/) |
| Contribute to Shape | [CONTRIBUTING.md](https://github.com/timbrinded/shapelang/blob/master/CONTRIBUTING.md), then [Checker Pipeline](/shapelang/inside-shape/checker-pipeline/) |
