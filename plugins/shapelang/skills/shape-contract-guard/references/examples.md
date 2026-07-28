# Guard Examples

Use these as calibration patterns. Cite exact changed symbols and diff evidence in the final review.

## Constraint Removal Plus Destructive Effect

Diff:

```diff
-resource AuditEvent : AppendOnly
+resource AuditEvent

 component AuditStore {
+  grants HardDelete<AuditEvent>
   fn deleteEvent
+    effects complete {
+      HardDelete<AuditEvent>
+    }
 }
```

Expected finding:

- Severity: high.
- Signal: `constraint-removal-plus-destructive-effect`.
- Outcome: `suspicious loosening`.
- Recommended action: restore `AppendOnly`, remove the destructive effect, or add a specific reevaluation/evidence and obtain explicit reviewer acceptance.

## Provider Boundary Widened

Diff:

```diff
-rule single_writer {
-  forbid provides AuditEvent except AuditStore
-}
+rule single_writer {
+  forbid provides AuditEvent except AuditStore or MaintenanceJob
+}

+relation MaintenanceProvidesAudit {
+  kind provides
+  connects MaintenanceJob -> AuditEvent
+}
```

Expected finding:

- Severity: high.
- Signal: `provider-boundary-widening`.
- Outcome: `suspicious loosening` unless a specific rationale explains the new provider.
- Model context: declared provider boundary widened.

## Justified Loosening

Diff:

```diff
-resource ExportBundle : Protected
+resource ExportBundle

+reevaluation ExportBundleScopeUpdated {
+  satisfies memory ExportBundleRetention
+  outcome Revised
+  summary "ExportBundle is now an ephemeral packaging artifact; retention is enforced on AuditEvent."
+  reviewer DataPlatform
+  decided_on "2026-06-07"
+  evidence issue("123")
+}
```

Expected finding:

- Severity: medium or low, depending on remaining capability changes.
- Signal: `constraint-removal`.
- Outcome: `justified loosening`.
- Recommended action: verify the reevaluation names the correct memory/rationale and cites reviewable evidence.

## Pure Tightening

Diff:

```diff
-resource AuditEvent
+resource AuditEvent : AppendOnly

 component AuditStore {
   grants Append<AuditEvent>
 }
```

Expected output:

```markdown
No deterministic Shape diagnostics and no advisory Guard risk findings from the authored contract diff reviewed.
```

An informational note is acceptable if the user asked for every material change.

## Forbidden Path Weakened

Diff:

```diff
 rule no_gateway_to_secrets {
-  forbid path Gateway -> SecretStore over calls or provides
+  forbid path Gateway -> SecretStore over calls
 }
```

Expected finding:

- Severity: high when a `provides` route exists or is added in the same diff.
- Signal: `forbidden-path-traversal-weakening`.
- Outcome: `suspicious loosening`.
- Evidence: `provides` was removed from the forbidden traversal kinds.

## Vendored Pack Upgrade

Diff:

```diff
 trait DurableAudit<T: Resource> {
   allow Append<T>
-  forbid final HardDelete<T>
 }
```

Expected finding:

- Severity: high.
- Signal: `domain-pack-final-forbid-removal`.
- Outcome: `suspicious loosening` unless a specific reviewed pack update and
  replacement constraint explains it.
- Model context: the vendored module is active under default discovery even
  when no project import changed.

## Deleted Authored Shape File

Deleted base file:

```shape
module audit.retention

resource AuditEvent : AppendOnly

rule audit_no_runtime_cycle {
  forbid hypercycle over calls or callbacks
}

implementation AuditStoreSource {
  component AuditStore
  source ts("src/audit/store.ts")
  on_change require shape_update
}
```

Expected finding:

- Severity: high.
- Signal: `deleted-authored-contract`.
- Outcome: `suspicious loosening` or `review-enforcement weakening`.
- Evidence: removed trait, hypercycle rule, and implementation coverage.
- Recommended action: restore the contract in another authored `.shape` file or provide explicit rationale and replacement coverage.

## Attestation Credibility Gap

Diff:

```diff
+attest no_shape_change {
+  source ts("src/audit/store.ts")
+  reason "No changes."
+}
```

Changed paths:

```text
src/audit/store.ts
shape/audit.shape
```

Expected finding:

- Severity: medium.
- Signal: `attestation-credibility-gap`.
- Outcome: `review-enforcement weakening`.
- Recommended action: replace the generic reason with a path-specific explanation or update the Shape model.

## Epistemic Regression

Diff:

```diff
 fn exportPolicyBundle
-  effects unknown
+  effects complete {
+  }
```

Expected finding:

- Severity: high.
- Signal: `false-completeness`.
- Outcome: `suspicious loosening`.
- Recommended action: keep `effects unknown` until effects are inspected, or list complete effects with evidence.
