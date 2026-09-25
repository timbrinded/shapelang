---
title: Domain Packs
description: Vendor a versioned directory of ordinary Shape modules under shape/vendor, import its declarations, and update it as a reviewed dependency.
---

A domain pack is a versioned directory of ordinary `.shape` modules committed under the project's `shape/` directory. Shape has no registry, downloader, manifest, or lockfile for packs: the committed files are the pinned dependency, and the checker treats them like every other file in the Shape model.

## Layout

Put each pack under `shape/vendor/`, so that default discovery (`shape/**/*.shape`) loads it with the project's own files:

```text
shape/
├── project.shape
└── vendor/
    └── audit-policy/
        └── v1/
            └── audit-policy.shape
```

The pack declares a stable, versioned module name:

```shape
module domain.audit.v1

trait DurableAudit<T: Resource> {
  forbid final HardDelete<T>
}
```

The project imports that module and applies the pack's trait beside a local one:

```shape
module checkout

import domain.audit.v1

trait CheckoutRetention<T: Resource> {
  forbid final Truncate<T>
}

resource CheckoutAudit : CheckoutRetention, DurableAudit

component CheckoutStore {
  owns CheckoutAudit
  grants Append<CheckoutAudit>
  fn recordCheckout
    source ts("src/checkout/audit.ts#recordCheckout")
    effects complete {
      Append<CheckoutAudit>
        evidence ts("src/checkout/audit.ts#recordCheckout")
    }
}
```

`shp check` passes, and `shp explain CheckoutAudit` shows each trait under its module name, with the final forbids the two traits derive:

```text
CheckoutAudit
  kind: resource
  traits:
    checkout::CheckoutRetention
    domain.audit.v1::DurableAudit

  final forbidden effects:
    Truncate<CheckoutAudit>
    HardDelete<CheckoutAudit>
```

## Installing and importing

Vendoring installs a pack, and importing only references it:

- Default discovery loads every file under `shape/`, including `shape/vendor/`, whether or not any module imports it. A pack's resources, components, and rules join the Shape model as soon as its files are under `shape/`, and its rules run without an import.
- `import domain.audit.v1` lets a module refer to that module's declarations by bare name. A qualified reference such as `domain.audit.v1::DurableAudit` works without the import. Importing a module that no file declares is not itself an error.
- When two imported modules declare the same name, a bare reference to it is reported as ambiguous (for example `ambiguous trait`) and must be qualified.
- A bare prelude trait name such as `AppendOnly` resolves to the prelude even when an imported pack declares a trait with that name. Only a declaration in the same module, or in a file with no `module` line, shadows a prelude trait.

Traits suit policy that each project opts into: the project applies them to its own resources, as in the example above. A pack-level rule instead governs every model that installs the pack. For example, a vendored file containing this rule rejects any cycle of `calls` relations in the project, and the `caused by:` block of the resulting `forbidden hypercycle` cites the vendored file:

```shape
module domain.no_cycles.v1

rule no_call_cycles {
  forbid hypercycle over calls
}
```

Explicit file arguments replace discovery. `shp check shape/project.shape` loads only that file, so the pack's rules do not run and references to pack declarations fail. For the checkout project, it exits 1:

```text
error: unknown trait

trait DurableAudit is referenced but not declared.

caused by:
  - shape/project.shape: resource CheckoutAudit : DurableAudit
```

Discovery is relative to the working directory and does not search parent directories. From a directory with no `shape/` subdirectory, `shp check` loads nothing and passes, so run commands from the project root. See the [CLI Reference](/shapelang/reference/cli/).

## Changing a pack

Shape has no override keyword. A local declaration with the same name as an imported one silently wins: a module that imports `domain.audit.v1` and declares its own `trait DurableAudit` gets the local trait, with none of the pack's forbids and no diagnostic. Local policy therefore needs its own names, applied alongside the pack's traits as `CheckoutRetention` is above.

To change a pack's contract, vendor a new reviewed revision under a new module version, such as `domain.audit.v2`, and update the imports. A pack's final forbids stay final after import; see [Effect Model](/shapelang/concepts/effect-model/#nothing-waives-a-final-forbid).

## Pinning and updates

Vendor an exact upstream release or commit, and record the upstream source and revision in the vendoring commit or an adjacent README. CI then reads the same bytes as local development. Do not point CI at a floating branch or download a pack during the check: a moving source would make the Shape model differ between runs.

To update a pack:

1. Replace the vendored directory with one exact, reviewed revision.
2. Review the `.shape` diff for weakened traits, widened effects, and removed final forbids.
3. Update the imports when the pack changes its module version.
4. Run `shp fmt --check`, `shp check`, and the changed-file gate from [Run Shape in CI](/shapelang/guides/ci/). Default `shp fmt` discovery includes vendored files, and the formatter rebuilds each file and drops comments. A pack that is not in canonical form therefore fails `shp fmt --check`, and `shp fmt` rewrites it, changing the pinned bytes.
