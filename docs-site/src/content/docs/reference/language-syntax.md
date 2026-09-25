---
title: Language Syntax
description: Lookup for every Shape declaration form, with a minimal parseable example, its members, and the constraints the checker enforces.
---

Each entry gives a minimal example that parses and passes `shp check` (the `effect candidate` example only under `shape/generated/ast/`), a table of its members, and the constraints that the parser or the checker enforces, linked to the diagnostic each one produces. What the declarations mean is explained on the concept pages that the entries link to. The examples are in the canonical form that `shp fmt` writes.

## Files and names

### File layout

```shape
module audit.store

import shared.resources

resource AuditEvent : AppendOnly
```

A file holds an optional `module` line, then any number of `import` lines, then declarations. An `import` after a declaration is a parse error. `shp fmt` sorts imports, and sorts declarations by kind and then by name. Every `.shape` file the checker loads belongs to one Shape model; which files those are is set by [file discovery](/shapelang/reference/cli/#file-discovery).

### Modules and references

A module name is a dotted path of identifiers, such as `audit.store`. Every declaration belongs to its file's module, so two modules can both declare `Store`. Files without a `module` line share one unnamed module.

References are resolved in this order:

1. A qualified reference, `audit.store::AuditEvent`, names that module's declaration directly. The module need not be imported.
2. An unqualified reference resolves to a declaration in the referencing module first.
3. Otherwise it resolves to the one imported module that declares the name. Two or more matches are [`ambiguous <kind>`](/shapelang/reference/diagnostics/#error-ambiguous-kind), and none is [`unknown <kind>`](/shapelang/reference/diagnostics/#error-unknown-kind).

An unqualified prelude trait name, such as `AppendOnly`, resolves to the prelude unless the referencing module declares a trait with that name, which then shadows the prelude trait. An `import` only enables unqualified references; importing a module that no file declares is not an error. A function is referenced as `Component.fn` or `module::Component.fn`.

### Lexical rules

- **Identifiers** match `[_a-zA-Z][\w_]*`: a letter or underscore, then letters, digits, or underscores. They are case-sensitive.
- **Strings** are single- or double-quoted, and a backslash escapes the next character. `shp fmt` rewrites them with double quotes.
- **Comments** are `// …` to the end of the line, or `/* … */`. `shp fmt` drops both.
- **Whitespace**, including newlines, only separates tokens.

### Reserved keywords

Every keyword of the grammar is reserved and cannot be used as an identifier, including as a module path segment: `module experiment.evidence` is a parse error. Keywords are lowercase, so capitalized forms such as `Summary` are ordinary identifiers. The 83 keywords are:

`add`, `allow`, `applies_to`, `approver`, `as`, `attest`, `binding`, `callbacks`, `calls`, `candidate`, `change`, `complete`, `component`, `confidence`, `conforms_to`, `connects`, `coordinated_call`, `decided_on`, `description`, `effect`, `effects`, `evidence`, `except`, `expects`, `expires`, `final`, `fingerprint`, `fn`, `forbid`, `grants`, `guards`, `has`, `hypercycle`, `implementation`, `import`, `kind`, `memory`, `modify`, `module`, `observed`, `on_change`, `or`, `outcome`, `over`, `owner`, `owns`, `path`, `paths`, `pin`, `policy`, `protects`, `provides`, `rationale`, `reason`, `reevaluation`, `relation`, `remove`, `require`, `require_changed`, `require_context`, `required`, `requires`, `resource`, `review_by`, `reviewer`, `role`, `roles`, `rule`, `satisfied_by`, `satisfies`, `sensitive`, `source`, `status`, `storage`, `summary`, `trait`, `transform`, `unknown`, `unsafe`, `when`, `when_changed`, `who`, `why`.

A few positions accept specific keywords as values: `kind` and `over` accept `calls`, `callbacks`, `provides`, and `coordinated_call`; a `protects` entry accepts `description`; `satisfies` and `satisfied_by` accept `memory` and `rationale`; and a declaration target accepts its kind keyword.

## Shared forms

### Effect terms

An effect term is `Name` or `Name<Target>`. It appears in effect entries, `grants`, `requires`, trait `allow`, `forbid`, and `require` members, rule `forbid` members, and an `effect candidate`'s `effect`.

- `Name` is any identifier and is matched literally; the checker gives no effect name a built-in meaning. The editor completes the prelude names `Read`, `Append`, `Update`, `Redact`, `LogicalDelete`, `HardDelete`, `Truncate`, `DropStorage`, `Export`, and `Import`, and the prelude `AppendOnly` trait forbids three of them.
- `Target` is a resource reference; inside a trait it may be a type parameter, and inside a rule the `when` subject. In an effect entry it must name a declared resource, otherwise [`unknown resource`](/shapelang/reference/diagnostics/#error-unknown-kind).
- An effect entry without a target skips both the final-forbid check and the grant check.

The check order is explained in [Effect Model](/shapelang/concepts/effect-model/).

### Source references

A source reference is `tag("path#symbol")`. It follows `source` (in functions, attestations, and effect candidates), `evidence`, and `observed`.

- The tag, such as `ts`, `rust`, `md`, or `test`, is any identifier and is never validated.
- The checker neither opens the path nor validates the anchor.
- For coverage matching it drops the `#anchor` and any `:line` or `:line-line` suffix.
- Prefer a `#symbol` anchor, use a file-only reference when no stable symbol exists, and avoid line numbers.

### Declaration targets

A target is `KIND Name`, where `KIND` is `fn`, `component`, `resource`, `implementation`, `rule`, or `relation`. Targets appear in context types (`RefactorConstraint<fn Gateway.derivePolicyDecision>`) and in `applies_to`.

### Type parameters and bounds

A trait may declare type parameters: `<T>` or `<T: Bound>`, separated by commas.

- `require_context` uses the bound to choose the target kind: `Fn` or `Function` for functions, `Component`, or `Resource`. An unbound parameter targets functions.
- A rule's `when … has` trait must have no type parameter, or exactly one bounded by `Resource`.
- Bounds are compared case-insensitively, but `fn`, `component`, and `resource` are keywords, so write `Fn`, `Component`, and `Resource`.
- Any other bound parses and is rejected only where one of these uses applies ([`invalid require_context`](/shapelang/reference/diagnostics/#error-invalid-require_context), [`invalid rule`](/shapelang/reference/diagnostics/#error-invalid-rule)).

### Dates and value types

`review_by` and `decided_on` are strings. `review_by` is compared only when freshness is on, and only when it is a real ISO `YYYY-MM-DD` date; other values are ignored ([Freshness](/shapelang/reference/cli/#freshness)). `decided_on` (required on `reevaluation`) and `expires` (required on `unsafe` functions) are never parsed as dates.

`why`, `status`, `confidence`, `outcome`, `owner`, `reviewer`, and `approver` take a single identifier, so `status "Unexplained"` is a parse error. `summary`, `description`, `reason`, `expires`, `review_by`, and `decided_on` take a string.

### Path globs

The `paths` blocks of `implementation` and `binding` hold quoted globs, matched against repository-relative paths:

- `**/` matches zero or more directories, and `**` elsewhere matches any characters, including `/`.
- `*` matches any characters except `/`.
- `?` matches any single character.
- Braces and character classes are not supported.

## Model declarations

### `resource`

```shape
module audit

resource AuditEvent : AppendOnly, Persistent {
  storage postgres.table("audit_events")
}

resource AuditStoreAstAnchor {
  fingerprint ast.semantic_subtree_v1("sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
}
```

| Member | Required | Form | Notes |
| --- | --- | --- | --- |
| Name | Yes | `resource Name` | Unique per module ([`duplicate resource`](/shapelang/reference/diagnostics/#error-duplicate-kind)). |
| Traits | No | `: Trait, Trait` | Each must resolve ([`unknown trait`](/shapelang/reference/diagnostics/#error-unknown-kind)). |
| Body | No | `{ … }` | Holds the two members below. |
| `storage` | No | `storage provider.name("value")` | Repeatable. The checker ignores it; `shp analyze` compares source table names with it. |
| `fingerprint` | No | `fingerprint provider.name("value")` | One per provider ([`duplicate fingerprint`](/shapelang/reference/diagnostics/#error-duplicate-fingerprint)). Read by `expects` and `pin`. |

The prelude supplies the resource traits `AppendOnly`, whose only members are final forbids of `HardDelete<T>`, `Truncate<T>`, and `DropStorage<T>`, and the markers `Persistent`, `Ephemeral`, `PII`, `Secret`, `Public`, `External`, and `Internal`, which have no members. See [Effect Model](/shapelang/concepts/effect-model/).

### `trait`

```shape
module audit

trait NeedsBoundaryNote<T: Component> {
  require_context BoundaryNote<T> satisfied_by rationale
}

trait Sealed<T: Resource> {
  forbid final HardDelete<T>
  forbid final Truncate<T>
}

resource AuditArchive : Sealed
```

| Member | Checked | Form | Notes |
| --- | --- | --- | --- |
| Name and type parameters | — | `trait Name<T: Bound, …>` | Required name; parameters optional. Unique per module. |
| `forbid final` | Yes | `forbid final Effect<T>` | A final forbid on every resource that bears the trait. A target of `<T>` or no target applies to the bearing resource; a concrete resource target takes effect only when that resource itself bears the trait, and must be declared. |
| `require_context` | Yes | `require_context Type<T> [satisfied_by rationale or memory]` | A context obligation on every bearer of the parameter's target kind. `T` must be a declared parameter ([`invalid require_context`](/shapelang/reference/diagnostics/#error-invalid-require_context)). Without `satisfied_by`, either kind satisfies it. |
| `allow`, `require`, `forbid` | No | `allow Effect<T>` | Parsed and formatted, but not enforced. |

Only `forbid final` and `require_context` affect checking. A plain `forbid` does not reject anything, `require` does not demand an effect, and `allow` grants nothing; grants come only from a component's `grants`. A trait declared with a prelude trait's name shadows the prelude trait within its module. Final forbids are explained in [Effect Model](/shapelang/concepts/effect-model/), and context obligations in [Design Memory](/shapelang/concepts/design-memory/).

### `component`

```shape
module audit

resource AuditEvent : AppendOnly

component AuditStore {
  owns AuditEvent
  grants Append<AuditEvent>
  grants Read<AuditEvent>
  fn appendEvent
    source ts("src/audit/store.ts#appendEvent")
    effects complete {
      Append<AuditEvent>
        evidence ts("src/audit/store.ts#appendEvent")
    }
  fn listEvents
    source ts("src/audit/store.ts#listEvents")
    effects complete {
      Read<AuditEvent>
        evidence ts("src/audit/store.ts#listEvents")
    }
}
```

| Member | Required | Form | Notes |
| --- | --- | --- | --- |
| Name | Yes | `component Name` | Unique per module. |
| Shape traits | No | `: Trait, Trait` | Each must resolve. The prelude shape traits that apply to components are `RefactorSensitive`, `NonIdiomatic`, and `TestOnly`. |
| `owns` | No | `owns Resource` | Repeatable. The resource must be declared; `owns` has no other effect on checking. |
| `grants` | No | `grants Effect<Resource>` | Repeatable. Matches an effect entry only with the same name and target. The target is not name-checked. |
| `fn` | No | See [`fn`](#fn) | Repeatable. |

A component body holds only these members. Structural links between components and resources are top-level [`relation`](#relation) declarations; see [Relations and Graph Rules](/shapelang/concepts/relations/).

### `fn`

A function summary lives inside a component, and its members come in this fixed order:

```text
fn NAME [: Trait, …]
  [source REF]
  [description [required] "TEXT"]
  [unsafe] effects complete { EFFECT [evidence REF] … } | effects unknown
  [requires EFFECT | reason "TEXT" | expires "TEXT"] …
```

```shape
module audit

resource LegacyEvent

component AuditStore {
  grants Import<LegacyEvent>
  fn importLegacyEvents
    source ts("src/audit/import.ts#importLegacyEvents")
    description "Copies the legacy audit table into AuditStore once."
    unsafe effects complete {
      Import<LegacyEvent>
        evidence ts("src/audit/import.ts#importLegacyEvents")
    }
    expires "2026-12-31"
    reason "One-off migration from the legacy store."
    requires MigrationWindow
}
```

| Member | Required | Form | Notes |
| --- | --- | --- | --- |
| Name | Yes | `fn name` | Unique within its component; a second `fn` with the same name silently replaces the first. |
| Shape traits | No | `: Trait, Trait` | Each must resolve. |
| `source` | No | `source REF` | At most one. Counts toward coverage. |
| `description` | No | `description "TEXT"` or `description required "TEXT"` | `description required ""` and a `RequiresDescription` trait without text fail ([`missing required description`](/shapelang/reference/diagnostics/#error-missing-required-description)). |
| `unsafe` | No | `unsafe` before `effects` | Requires `reason`, `expires`, and at least one `requires` ([`unsafe effects missing policy metadata`](/shapelang/reference/diagnostics/#error-unsafe-effects-missing-policy-metadata)). |
| Effects | Yes | `effects complete { … }` or `effects unknown` | Exactly one. Strict checking rejects `effects unknown` in authored modules ([`unknown effects`](/shapelang/reference/diagnostics/#error-unknown-effects)). `effects complete {}` claims no effects. |
| Effect entry | No | `Effect<Resource>` then optional `evidence REF` | At most one `evidence` per entry, which counts toward coverage. |
| `requires` | Only with `unsafe` | `requires Capability` | Repeatable. The capability is any effect term and is not name-checked. |
| `reason` | Only with `unsafe` | `reason "TEXT"` | |
| `expires` | Only with `unsafe` | `expires "TEXT"` | Not parsed as a date. |

Out-of-order members, a missing effects block, and two effects blocks are parse errors. `shp fmt` prints `unsafe` on the effects line, sorts effect entries, and sorts the trailing members by their text. What complete and unknown summaries claim is explained in [Effect Model](/shapelang/concepts/effect-model/).

### `relation`

```shape
module gateway

resource AuditEvent

component AuditStore {
}

component Gateway {
}

relation AuditWritePath {
  kind coordinated_call
  connects Gateway -> AuditStore -> AuditEvent
  summary "Audit writes flow Gateway -> AuditStore -> AuditEvent."
}

relation GatewayCallsAudit {
  kind calls
  connects Gateway -> AuditStore
  roles { AuditStore as callee, Gateway as caller }
}
```

| Member | Required | Form | Notes |
| --- | --- | --- | --- |
| Name | Yes | `relation Name` | Unique per module. |
| `kind` | Yes | `kind KIND` | Once. |
| `connects` | Yes | `connects A -> B [-> …]` (ordered) or `connects { A, B, … }` (unordered) | Once. At least two endpoints, enforced by the parser. Endpoints are distinct components or resources. |
| `roles` | No | `roles { A as role, … }` | Once. Each name is a `connects` endpoint with at most one role. |
| `expects` | No | `expects Endpoint fingerprint provider.name("value")` | Repeatable. Pins a resource endpoint's fingerprint. |
| `summary` | No | `summary "TEXT"` | Once. Printed by `shp graph` and `shp explain`. |

The prelude kinds constrain `connects`:

| Kind | Endpoints |
| --- | --- |
| `calls`, `callbacks` | Exactly two, ordered `A -> B`. |
| `provides` | Exactly two, ordered, from a component to a resource. |
| `coordinated_call` | Two or more, ordered. |
| Any other identifier | Any number, in either form. |

An `expects` endpoint must be one of the relation's `connects` endpoints and must be a resource, otherwise [`invalid relation`](/shapelang/reference/diagnostics/#error-invalid-relation). When that resource lacks the provider's fingerprint, or its value differs, the result is [`stale fingerprint expectation`](/shapelang/reference/diagnostics/#error-stale-fingerprint-expectation). Every malformed relation is reported as `invalid relation`, with the reasons listed in its entry. How kinds become traversal steps is explained in [Relations and Graph Rules](/shapelang/concepts/relations/).

### `rule`

```shape
module gateway

resource JsonRpcEndpoint

resource SecretStore

component Gateway {
}

rule GatewayBoundary {
  forbid provides JsonRpcEndpoint except Gateway
}

rule NoPiiPurge {
  forbid final HardDelete<T>
  when T has PII
  when T has Persistent
}

rule NoRuntimeCycle {
  forbid hypercycle over calls or callbacks
}

rule NoSecretRoute {
  forbid path Gateway -> SecretStore over calls or provides
}
```

A rule header takes no type parameters. Every member is optional and repeatable:

| Member | Form | Notes |
| --- | --- | --- |
| `when` | `when T has Trait` | Binds the subject `T` for final forbids. Repeated clauses on one subject are a conjunction. The trait must resolve. In rules with `forbid final`, it must also have no type parameter or one `Resource`-bound parameter, and only one subject may be bound. |
| `forbid final` | `forbid final Effect<T>` | A final forbid on every resource that has all the `when` traits. Needs exactly one subject. |
| `forbid` | `forbid Effect<T>` | Parsed and formatted, but not enforced. |
| `forbid provides` | `forbid provides Resource [except Component]` | Rejects every `provides` relation for the resource from a provider other than the `except` component, or from any provider without `except`. |
| `forbid hypercycle` | `forbid hypercycle [over KIND or KIND …]` | Rejects a directed cycle among relations of the listed kinds, or of every kind without `over`. Only the four prelude kinds contribute steps. |
| `forbid path` | `forbid path Source -> Target over KIND [or KIND …]` | `over` is required. The endpoints are distinct and the kinds must be `calls`, `callbacks`, `provides`, or `coordinated_call`. |

A rule that breaks these constraints is reported as [`invalid rule`](/shapelang/reference/diagnostics/#error-invalid-rule). Only the offending part goes inert: an invalid final-forbid set derives no forbid and an invalid `forbid path` clause is not evaluated; the rule's other clauses still run. What each clause rejects is explained in [Relations and Graph Rules](/shapelang/concepts/relations/) and, for final forbids, [Effect Model](/shapelang/concepts/effect-model/).

### `implementation`

```shape
module audit

component AuditStore {
}

implementation AuditStoreImpl {
  paths {
    "src/audit/**/*.ts"
  }
  conforms_to AuditStore
  on_change require shape_update
}
```

| Member | Required | Form | Notes |
| --- | --- | --- | --- |
| Name | Yes | `implementation Name` | Not checked for duplicates. |
| `paths` | No | `paths { "glob" … }` | Repeatable. See [path globs](#path-globs). |
| `conforms_to` | No | `conforms_to Component` | The component must be declared. Coverage never reads it. |
| `on_change` | No | `on_change require shape_update` | Only `shape_update` has an effect; any other identifier parses and is ignored. |

An implementation with `on_change require shape_update` makes its paths governed. How a changed governed path is covered is described in [Keep the Model Current](/shapelang/guides/keep-model-current/).

## Change-set declarations

### `binding`

```shape
module repo

binding CheckerDocs {
  when_changed paths {
    "packages/shp-checker/src/checker/**/*.ts"
  }
  require_changed paths {
    "docs-site/src/content/docs/reference/diagnostics.md"
  }
  allow attest docs_not_needed
}
```

| Member | Required | Form | Notes |
| --- | --- | --- | --- |
| Name | Yes | `binding Name` | Unique per module. |
| `when_changed` | No | `when_changed paths { "glob" … }` | Repeatable. Without it the binding never triggers. |
| `require_changed` | No | `require_changed paths { "glob" … }` | Repeatable. |
| `allow attest` | No | `allow attest KIND` | Repeatable. Without it, an attestation cannot satisfy the binding. |

Only `shp check --changed-files` enforces bindings. The rule for a satisfied binding is in [Keep the Model Current](/shapelang/guides/keep-model-current/).

### `attest`

```shape
module repo

attest docs_not_needed {
  source ts("packages/shp-checker/src/checker/rules.ts")
  reason "Internal extraction only; no documented behaviour changed."
}

attest no_shape_change {
  source ts("src/audit/store.ts")
  reason "Renamed a local variable; the architecture is unchanged."
}
```

An attestation is `attest KIND { source REF reason "TEXT" }`. Both members are required, in that order, and the declaration has no name. `KIND` is any identifier: coverage accepts only `no_shape_change`, and a binding accepts the kinds its `allow attest` lists. An attestation counts only when its `source` path equals the changed path, ignoring anchor and line suffixes, its `reason` is not empty, and its own `.shape` file is in the changed-file list. An attestation never satisfies a guard. See [Keep the Model Current](/shapelang/guides/keep-model-current/).

### `change`

```shape
module gateway

resource PolicySnapshot

component Gateway {
  grants Read<PolicySnapshot>
  fn derivePolicyDecision
    effects complete {
      Read<PolicySnapshot>
    }
}

change RefactorDecision {
  modify fn Gateway.derivePolicyDecision
    transform ExtractHelper
    source ts("src/gateway/policy.ts#derivePolicyDecision")
    effects complete {
      Read<PolicySnapshot>
    }
}
```

A `change` block holds any number of entries:

| Entry | Form | Notes |
| --- | --- | --- |
| `add fn` | `add fn Component.fn …` | The full function members, as in [`fn`](#fn). |
| `modify fn` | `modify fn Component.fn [: Trait, …] [transform Label, …] …` | Restates the complete function. Shape traits or a description it omits count as removed. `transform` goes after the shape traits and before `source`. |
| `remove fn` | `remove fn Component.fn` | |
| `add` | `add DECLARATION` | A `resource`, `trait`, `component`, `relation`, `implementation`, `binding`, `attest`, or `rule` declaration. |
| `modify` | `modify DECLARATION` | The same kinds. Replaces the declaration with the same name; `modify attest` adds the attestation, as `add` does. |
| `remove` | `remove KIND Name` | `resource`, `trait`, `component`, `relation`, `implementation`, `binding`, or `rule`. |

The checker applies `change` blocks after every ordinary declaration, entry by entry, and checks the resulting model. A function target is `Component.fn` or `module::Component.fn`; for `add fn` and `modify fn`, the component must be declared ([`unknown component`](/shapelang/reference/diagnostics/#error-unknown-kind)). `modify` and `remove` entries on a `fn`, `component`, `resource`, or `relation` are the only events that trigger guards ([`guarded shape changed`](/shapelang/reference/diagnostics/#error-guarded-shape-changed)). `shp fmt` sorts entries by their text, so give each target at most one entry; see [`shp fmt`](/shapelang/reference/cli/#shp-fmt). Guards and reevaluation are explained in [Design Memory](/shapelang/concepts/design-memory/).

## Design memory

`rationale` and `memory` attach typed context to a declaration target. Their headers name a context type and its target, and both accept the grouped guard blocks described below. What they mean is explained in [Design Memory](/shapelang/concepts/design-memory/).

### `rationale`

```shape
module gateway

resource PolicySnapshot

component Gateway {
  grants Read<PolicySnapshot>
  fn derivePolicyDecision : PreserveInline
    effects complete {
      Read<PolicySnapshot>
    }
}

rationale PolicyInline : InlineRationale<fn Gateway.derivePolicyDecision> {
  applies_to fn Gateway.derivePolicyDecision
  why CognitiveLocality
  summary "Branches stay inline so the check order is reviewable."
  evidence test("gateway/policy.test.ts")
}
```

| Member | Required | Form | Notes |
| --- | --- | --- | --- |
| Header | Yes | `rationale Name : ContextType<KIND Target>` | Unique per module. The target must exist ([`invalid context target`](/shapelang/reference/diagnostics/#error-invalid-context-target)). Any context type name parses. |
| `applies_to` | No | `applies_to KIND Target` | Defaults to the header's target; when present, it must be identical ([`context target mismatch`](/shapelang/reference/diagnostics/#error-context-target-mismatch)). |
| `why` | No | `why Identifier` | Not interpreted. |
| `summary` | No | `summary "TEXT"` | Not interpreted. |
| `evidence` | No | `evidence REF` | Repeatable. |
| Guard blocks | No | `protects`, `guards`, `who`, `when` | See [guard blocks](#guard-blocks). |

### `memory`

```shape
module gateway

resource PolicySnapshot

component Gateway {
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
  sensitive
  summary "Previous refactors changed error normalisation behaviour."
  who {
    owner GatewayTeam
  }
  guards {
    on_change require ReEvaluation<Self>
  }
  observed ts("src/gateway/policy.ts#derivePolicyDecision")
}
```

`memory` accepts the `rationale` members except `why`, plus:

| Member | Required | Form | Notes |
| --- | --- | --- | --- |
| `status` | No | `status Identifier` | Not interpreted. |
| `confidence` | No | `confidence Identifier` | Not interpreted. |
| `sensitive` | No | `sensitive` | With a `policy { require approver }`, a reevaluation that satisfies this memory needs an `approver`. Only `memory` accepts it. |
| `observed` | No | `observed REF` | Repeatable. |

The checker requires none of these members.

### Guard blocks

Guard members are written only as grouped blocks. This is their canonical syntax:

```shape
module gateway

component Gateway {
  fn derivePolicyDecision : PreserveInline
    description "Branches stay inline so the check order is reviewable."
    effects complete {
    }
}

rationale PolicyInline : InlineRationale<fn Gateway.derivePolicyDecision> {
  who {
    owner GatewayTeam
  }
  when {
    review_by "2026-08-18"
  }
  protects {
    description,
    shape PreserveInline
  }
  guards {
    forbid transform ExtractHelper
    on_change require ReEvaluation<Self>
  }
}
```

| Block | Entries | Notes |
| --- | --- | --- |
| `protects { … }` | Comma-separated: `description`, `shape Trait`, or any `label [Value]` | Which entries are detectable, and how that narrows when the guard fires, is in [Design Memory](/shapelang/concepts/design-memory/). |
| `guards { … }` | One action per line: `on_change require ReEvaluation<Self>` or `forbid transform Label` | `ReEvaluation<Self>` and `ReEvaluation` are the only requirements that act; any other parses and is inert. `forbid transform Label` fires only on a `modify fn` that declares `transform Label`. |
| `who { … }` | At most one `owner Identifier` | Shown by `shp memory`. |
| `when { … }` | At most one `review_by "YYYY-MM-DD"` | Enforced only under [freshness](/shapelang/reference/cli/#freshness). |

A block may be empty. `shp fmt` writes context members in this order: `applies_to`; then `why` (rationale) or `status`, `confidence`, and `sensitive` (memory); then `summary`, `who`, `when`, `protects`, `guards`, `observed` (memory only), and `evidence`. It sorts the entries within a block and merges repeated blocks of the same kind. When a guard fires, and what satisfies it, is explained in [Design Memory](/shapelang/concepts/design-memory/).

### `reevaluation`

```shape
module gateway

component Gateway {
  fn derivePolicyDecision : RefactorSensitive
    effects complete {
    }
}

role GatewayTeam

role Security

policy RequireApprover {
  require approver
}

memory DecisionRefactorConstraint : RefactorConstraint<fn Gateway.derivePolicyDecision> {
  sensitive
  guards {
    on_change require ReEvaluation<Self>
  }
}

reevaluation DecisionShapeRechecked {
  satisfies memory gateway::DecisionRefactorConstraint
  outcome Confirmed
  summary "Refactor preserves error-normalisation behaviour."
  reviewer GatewayTeam
  approver Security
  decided_on "2026-06-02"
  evidence test("gateway/error-normalisation.test.ts")
}
```

| Member | Required | Form | Notes |
| --- | --- | --- | --- |
| Name | Yes | `reevaluation Name` | Unique per module. |
| `satisfies` | Yes | `satisfies memory Name` or `satisfies rationale Name` | The context must exist. The name may be module-qualified. |
| `outcome` | Yes | `outcome Identifier` | Not interpreted. |
| `summary` | Yes | `summary "TEXT"` | Not blank. |
| `evidence` | Yes | `evidence REF` | At least one; repeatable. |
| `reviewer` | Yes | `reviewer Identifier` | Must be a declared `role` once any role exists. |
| `approver` | When required by policy | `approver Identifier` | Required when a `policy { require approver }` exists and the satisfied memory is `sensitive`. Must be a declared `role` once any role exists. |
| `decided_on` | Yes | `decided_on "TEXT"` | Presence only; not parsed as a date. |

A reevaluation that misses a requirement is reported, one diagnostic per reason, as [`invalid reevaluation`](/shapelang/reference/diagnostics/#error-invalid-reevaluation), and satisfies nothing.

### `role` and `policy`

```shape
module gateway

role GatewayTeam

policy RequireApprover {
  require approver
}
```

`role Name` declares a reviewer or approver identity. Roles match by local name from any module, and declaring any role turns on role validation for every reevaluation. `policy Name { … }` holds zero or more `require approver` members; one policy with `require approver` anywhere in the Shape model makes approvers required for reevaluations of `sensitive` memory. Policies with the same name merge.

## Generated forms

### `effect candidate`

```shape
module shape.generated.ast.src.audit.store

resource AuditEvent

resource AuditStoreAppendEventAstAnchor {
  fingerprint ast.semantic_subtree_v1("sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
}

component AuditStore {
  fn appendEvent
    source ts("src/audit/store.ts#AuditStore.appendEvent")
    effects unknown
}

effect candidate AppendEventCandidate {
  fn AuditStore.appendEvent
  effect Append<AuditEvent>
  source ts("src/audit/store.ts#AuditStore.appendEvent")
  confidence low
  pin AuditStoreAppendEventAstAnchor fingerprint ast.semantic_subtree_v1("sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
}
```

`shp ast` writes these declarations. This example passes `shp check` only at a path under `shape/generated/ast/`, where the generated-AST exemption allows `effects unknown`. An `effect candidate` is a hint, not a reviewed effect claim: it grants and forbids nothing.

| Member | Required | Form | Notes |
| --- | --- | --- | --- |
| Name | Yes | `effect candidate Name` | Unique per module. |
| `fn` | Yes, once | `fn Component.fn` | The function must be declared. |
| `effect` | Yes, once | `effect Effect<Resource>` | The target must be declared. |
| `source` | Yes, once | `source REF` | |
| `confidence` | Yes, once | `confidence Identifier` | |
| `pin` | Yes, once | `pin Resource fingerprint provider.name("value")` | Must match that resource's fingerprint ([`stale candidate effect pin`](/shapelang/reference/diagnostics/#error-stale-candidate-effect-pin)). |

A missing or repeated member is reported as [`invalid candidate effect`](/shapelang/reference/diagnostics/#error-invalid-candidate-effect). How drafts are generated and promoted is described in [Generate Drafts from Source](/shapelang/guides/ast-drafts/).
