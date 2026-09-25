---
title: Design Rationale
description: Why Shape is a small, explicit, deterministic language, and the questions a proposed feature must answer.
---

This page records the reasons behind Shape's design, for contributors and for evaluators who want them. The boundary itself, what `shp check` reads and what it leaves to other tools, is stated on the [home page](/shapelang/).

## Why the checker stops at the model

Checking that source code performs only its declared effects would need a compiler or theorem prover with deep knowledge of each application's semantics. Shape instead records the material architectural effects in `.shape` files and rejects records that contradict each other. Application correctness stays with tests, code review, and other tools.

Within that boundary, the model makes these facts reviewable:

- which resources a function claims to read, append, delete, or export;
- which effects a component may exercise;
- durable resource invariants, such as append-only storage;
- why an unusual function shape must be handled carefully;
- the source path a reviewer can open next to each claim.

Two extensions stay out of scope. Shape does not derive an authoritative model from source: `shp ast` and `shp author` emit conservative drafts that leave uncertain effects as `effects unknown`, and a person promotes reviewed claims into authored modules (see [Generate Drafts from Source](/shapelang/guides/ast-drafts/)). Nor can rationale, memory, reevaluation, or a grant waive a `forbid final` (see [Effect Model](/shapelang/concepts/effect-model/)). These limits keep the language small enough for a reviewer to understand the model and for the checker to produce useful diagnostics.

## Why explicit claims

The workflow assumes a technical reviewer who may not know every subsystem. Explicit claims reduce what that reviewer must infer.

```shape
module audit

resource AuditEvent : AppendOnly

component AuditStore {
  owns AuditEvent
  grants Append<AuditEvent>
  fn appendEvent
    source ts("src/audit/store.ts#appendEvent")
    effects complete {
      Append<AuditEvent>
        evidence ts("src/audit/store.ts#appendEvent")
    }
}
```

This model states that:

- `AuditEvent` is modelled as append-only;
- `AuditStore` owns the resource;
- `AuditStore.appendEvent` claims one material effect;
- the claim is complete, not partial;
- the source and the evidence can be inspected.

An expert could often recover the same information from source. Shape makes it available to tools and to less familiar readers as typed, checkable text.

## Why explicit syntax

The files are review surfaces, so the syntax stays explicit and stable. A compressed notation could state the claim above in one line:

```shape no-verify
AuditStore.appendEvent -> Append(AuditEvent) @ src/audit/store.ts#appendEvent
```

The compact form is shorter but loses structure. Is `AuditStore` a component? Is `AuditEvent` a resource? Is this a complete effect summary or a hint? Where would a rationale attach? Where would the formatter put evidence? The explicit form answers each question with a keyword, which gives the checker and the reviewer stable handles.

## Why memory is typed

Generic prose comments tend to rot. Shape memory is typed because the checker needs to know what a memory applies to and what obligations it creates.

```shape
module gateway

resource PolicySnapshot

component Gateway {
  owns PolicySnapshot
  grants Read<PolicySnapshot>
  fn derivePolicyDecision : RefactorSensitive
    effects complete {
      Read<PolicySnapshot>
    }
}

memory DecisionRefactorConstraint : RefactorConstraint<fn Gateway.derivePolicyDecision> {
  applies_to fn Gateway.derivePolicyDecision
  status Unexplained
  confidence High
  summary "Previous refactors broke error normalisation."
  who {
    owner GatewayTeam
  }
  protects {
    shape CheckOrder
  }
  guards {
    on_change require ReEvaluation<Self>
  }
}
```

The checker acts on the memory's context type, target, protected property, and guard. Because `derivePolicyDecision` carries the `RefactorSensitive` shape trait, the model must contain a `RefactorConstraint` memory that applies to it; without one, `shp check` fails with `missing required context`. The guard then requires a `reevaluation` whenever a `change` declaration modifies or removes the function. The owner, `status`, and `confidence` are recorded for reviewers, and the checker does not interpret them. [Design Memory](/shapelang/concepts/design-memory/) describes the whole mechanism.

That is the difference between a note in a comment and a review obligation in the model.

## Why diagnostics matter

Checker output is part of the product. A rejection should read as a causal path from a source-backed function claim to the architecture constraint it breaks. Suppose a change adds a purge function and its grant to `AuditStore` in the audit model above:

```shape no-verify
  grants HardDelete<AuditEvent>
  fn purgeOldEvents
    source ts("src/audit/purge.ts#purgeOldEvents")
    effects complete {
      HardDelete<AuditEvent>
        evidence ts("src/audit/purge.ts#purgeOldEvents")
    }
```

`shp check` then exits 1 with this output:

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

Each sentence is one step of the chain, and `caused by:` names the declaration behind each step. The checker judges the effect against the final forbids of its resource's traits before it looks at the component's grants. When a final forbid matches, the grant check is skipped, so the output reports the one real cause and no `missing grant` beside it. The diagnostic makes the model legible instead of only failing the build.

## Agents draft; humans review

Shape is designed so that agents can help draft architecture claims without being trusted unsupervised.

Agents are useful for scanning diffs, producing first drafts, and applying checklists. They can also invent confident but wrong summaries. The language uses agents where they help and forces uncertainty into visible states:

- `effects unknown` is better than pretending a summary is complete, and strict `shp check` rejects it in authored modules until someone resolves it.
- `evidence` makes an effect reviewable against source.
- `rationale` and `memory` turn design discussion into typed context.
- `reevaluation` records a review when a `change` declaration modifies or removes a guarded target.
- Final forbids remain final, whatever prose argues.

Agents scaffold, humans review, and the checker rejects incoherent claims. That split is intentional.

## Design pressure

When evaluating a new Shape feature, ask:

- Does it make architecture claims clearer to a human reviewer?
- Can an agent draft it without hiding uncertainty?
- Can the checker reject contradictions deterministically?
- Can diagnostics explain the failure without requiring internal knowledge?
- Does it preserve the boundary between reviewed claims and source-code proof?

If the answer is no, the feature probably belongs in docs, authoring prompts, analyzer hints, or tests rather than in the core language.
