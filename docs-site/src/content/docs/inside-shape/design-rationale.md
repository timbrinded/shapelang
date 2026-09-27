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
module history

resource Revision : AppendOnly

component RevisionLog {
  owns Revision
  grants Append<Revision>
  fn appendRevision
    source ts("src/history/log.ts#appendRevision")
    effects complete {
      Append<Revision>
        evidence ts("src/history/log.ts#appendRevision")
    }
}
```

This model states that:

- `Revision` is modelled as append-only;
- `RevisionLog` owns the resource;
- `RevisionLog.appendRevision` claims one material effect;
- the claim is complete, not partial;
- the source and the evidence can be inspected.

An expert could often recover the same information from source. Shape makes it available to tools and to less familiar readers as typed, checkable text.

## Why explicit syntax

The files are review surfaces, so the syntax stays explicit and stable. A compressed notation could state the claim above in one line:

```shape no-verify
RevisionLog.appendRevision -> Append(Revision) @ src/history/log.ts#appendRevision
```

The compact form is shorter but loses structure. Is `RevisionLog` a component? Is `Revision` a resource? Is this a complete effect summary or a hint? Where would a rationale attach? Where would the formatter put evidence? The explicit form answers each question with a keyword, which gives the checker and the reviewer stable handles.

## Why memory is typed

Generic prose comments tend to rot. Shape memory is typed because the checker needs to know what a memory applies to and what obligations it creates.

```shape
module editor

resource Autosave

component Editor {
  owns Autosave
  grants Read<Autosave>
  fn mergeAutosaves : RefactorSensitive
    effects complete {
      Read<Autosave>
    }
}

memory MergeRefactorConstraint : RefactorConstraint<fn Editor.mergeAutosaves> {
  applies_to fn Editor.mergeAutosaves
  status Explained
  confidence High
  summary "The sync library sends autosaves out of order, so keep the sort."
  who {
    owner EditorTeam
  }
  protects {
    shape CheckOrder
  }
  guards {
    on_change require ReEvaluation<Self>
  }
}
```

The checker acts on the memory's context type, target, protected property, and guard. Because `mergeAutosaves` carries the `RefactorSensitive` shape trait, the model must contain a `RefactorConstraint` memory that applies to it; without one, `shp check` fails with `missing required context`. The guard then requires a `reevaluation` whenever a `change` declaration modifies or removes the function. The owner, `status`, and `confidence` are recorded for reviewers, and the checker does not interpret them. [Design Memory](/shapelang/concepts/design-memory/) describes the whole mechanism.

That is the difference between a note in a comment and a review obligation in the model.

## Why diagnostics matter

Checker output is part of the product. A rejection should read as a causal path from a source-backed function claim to the architecture constraint it breaks. Suppose a change adds a purge function and its grant to `RevisionLog` in the history model above:

```shape no-verify
  grants HardDelete<Revision>
  fn purgeOldRevisions
    source ts("src/history/purge.ts#purgeOldRevisions")
    effects complete {
      HardDelete<Revision>
        evidence ts("src/history/purge.ts#purgeOldRevisions")
    }
```

`shp check` then exits 1 with this output:

```text
error: forbidden effect

RevisionLog.purgeOldRevisions emits HardDelete<Revision>.
Revision has trait AppendOnly.
AppendOnly forbids final HardDelete<Revision>.
evidence: ts("src/history/purge.ts#purgeOldRevisions")

caused by:
  - shape/history.shape: effect RevisionLog.purgeOldRevisions emits HardDelete<Revision>
  - shape/history.shape: resource Revision : AppendOnly
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
