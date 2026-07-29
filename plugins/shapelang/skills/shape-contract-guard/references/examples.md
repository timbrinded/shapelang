# Guard Examples

Use these as normalized calibration cases. Return the canonical JSON fields from the skill.

## Constraint Removal Plus Destructive Effect

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

Expected:

```json
{
  "impact": "high",
  "support": "none",
  "disposition": "suspicious",
  "signal": "constraint-removal-plus-destructive-effect",
  "symbol": "AuditEvent / AuditStore.deleteEvent",
  "before": "resource AuditEvent : AppendOnly",
  "after": "resource AuditEvent; HardDelete<AuditEvent> is granted and emitted",
  "replacement": ""
}
```

## Supported High-Impact Loosening

```diff
-resource ExportBundle : Protected
+resource ExportBundle

+rationale ExportBundleLifecycle {
+  summary "ExportBundle is ephemeral; retention remains on AuditEvent."
+  evidence issue("123")
+}
```

Expected: `impact: high`, `support: specific`, and `disposition: supported`. Do not lower impact because decision evidence exists. Do not call the change necessary.

## Equivalent Relocation

Base file:

```shape
rule audit_no_delete {
  forbid final HardDelete<AuditEvent>
}
```

Candidate moves the identical rule to another authored file.

Expected: no removal finding. Record the candidate as disproved after locating the semantically identical declaration.

## Equal Replacement

```diff
-resource AuditEvent : Protected
+resource AuditEvent : AppendOnly
```

When `AppendOnly` supplies an equal or stronger relevant constraint, record the replacement and do not report an unsupported removal.

## Forbidden Path Weakened

```diff
 rule no_gateway_to_secrets {
-  forbid path Gateway -> SecretStore over calls or provides
+  forbid path Gateway -> SecretStore over calls
 }
```

Expected: high-impact suspicious change when `provides` is a real declared route or is added by the same candidate.

## Vendored Pack Final Forbid Removal

```diff
 trait DurableAudit<T: Resource> {
   allow Append<T>
-  forbid final HardDelete<T>
 }
```

Expected: high-impact suspicious change. Default discovery keeps the vendored module active even when imports are unchanged.

## Generic Attestation

```shape
attest no_shape_change {
  source ts("src/audit/store.ts")
  reason "No changes."
}
```

Expected: medium impact, generic support, suspicious disposition, and an attestation-credibility signal when the changed-path list triggers this attestation.

## False Completeness

```diff
 fn exportPolicyBundle
-  effects unknown
+  effects complete {
+  }
```

Expected: high-impact suspicious epistemic regression unless reviewed evidence supports a genuinely complete empty effect set.
