# Current CLI Authoring

Use these `shp 0.7` patterns when building an authored whole-repository model. Prefer the repository's checked authored files when local conventions differ.

## Claim Mapping

| Source evidence | Shape representation |
| --- | --- |
| Owned persistent or sensitive data | `resource`, `owns`, storage when known |
| Function reads, appends, updates, or deletes a resource | component grant plus function effect with matching evidence |
| One component invokes another | `relation` with `kind calls` |
| A component exposes a resource/capability | `relation` with `kind provides` |
| Order across two or more endpoints matters | `relation` with `kind coordinated_call` |
| Source paths implement a component | `implementation` with `on_change require shape_update` |
| Source/model changes require docs review | `binding` |
| Important source-supported behavior is not checker-enforceable | typed `rationale` or `memory`; do not call it an enforced invariant |

Use typed review context only for a concrete behavior that source inspection supports and the current checker cannot represent as an effect, relation, rule, implementation, or binding. Non-enforceable does not mean unimportant or omitted.

## Stable Evidence

Use a stable symbol whenever one exists:

```shape
source ts("src/audit/store.ts#appendEvent")
```

Use the same stable anchor for an effect it supports:

```shape
effects complete {
  Append<AuditEvent>
    evidence ts("src/audit/store.ts#appendEvent")
}
```

Use a file-only reference only when the source has no stable symbol. Never use line numbers or ranges.

## Resources, Ownership, Grants, And Effects

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

Use `effects unknown` while material effects remain unresolved. Do not use an empty `effects complete` as a substitute for inspection.

## Relations And Coordination

Relations are top-level declarations:

```shape
component CheckoutApi {
}

component InventoryService {
}

resource StockRecord

relation CheckoutCallsInventory {
  kind calls
  connects CheckoutApi -> InventoryService
}

relation InventoryProvidesStock {
  kind provides
  connects InventoryService -> StockRecord
}

relation StockReadPath {
  kind coordinated_call
  connects CheckoutApi -> InventoryService -> StockRecord
  summary "Checkout stock reads are coordinated through InventoryService."
}
```

Use `calls`, `callbacks`, and `provides` only for binary directed relations. Use `coordinated_call` for a meaningful ordered path with two or more endpoints.

## Implementation Coverage

```shape
implementation AuditStoreImpl {
  paths {
    "src/audit/**/*.ts"
  }
  conforms_to AuditStore
  on_change require shape_update
}
```

Architecture-significant governed source should not be left with bare path evidence when an implementation declaration can express coverage.

## Documentation Binding

```shape
binding AuditDocs {
  when_changed paths {
    "src/audit/**/*.ts"
    "shape/audit.shape"
  }
  require_changed paths {
    "docs/architecture/audit.md"
  }
  allow attest docs_not_needed
}
```

Use a binding when source or model changes require review of a named documentation surface. Do not add one merely because documentation exists.

## Typed Review Context

Attach source-supported but non-enforceable behavior to the narrowest relevant target:

```shape
resource ReportTemplate

component ReportRenderer {
  grants Read<ReportTemplate>
  fn renderSummary : RefactorSensitive
    source ts("src/reports/renderer.ts#renderSummary")
    description "Produces the stable summary layout consumed by export adapters."
    effects complete {
      Read<ReportTemplate>
        evidence ts("src/reports/renderer.ts#renderSummary")
    }
}

memory SummaryLayoutBoundary : RefactorConstraint<fn ReportRenderer.renderSummary> {
  applies_to fn ReportRenderer.renderSummary
  status Explained
  confidence High
  summary "Export adapters rely on the current section ordering and labels."
  who { owner ReportingTeam }
  guards { on_change require ReEvaluation<Self> }
}
```

Keep enforceable resource effects and coordination facts separate from typed review context. Memory makes the supported behavior reviewable; it does not prove runtime correctness.

## Validation

Format authored files, use draft validation only for explicit unknown effects, then finish strictly:

```bash
<SHAPE_CMD> fmt shape/index.shape
<SHAPE_CMD> check --allow-unknown-effects
<SHAPE_CMD> check
```

When an exact changed-file list exists, finish with:

```bash
<SHAPE_CMD> check --changed-files changed.txt
```
