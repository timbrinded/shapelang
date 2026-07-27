---
title: Domain Packs
description: Reuse source-controlled Shape declarations without hiding project policy.
sidebar:
  order: 9
---

A domain pack is a versioned directory of ordinary `.shape` modules vendored into a
project. Shape needs no registry, downloader, manifest, or separate lockfile for
packs: the committed files are the pinned dependency. Vendoring installs the
module into the checked model, while normal `import` declarations make project
references to its declarations explicit.

## Layout

Place packs below the project's normal `shape/` directory so the default
`shape/**/*.shape` scan includes both project policy and vendored declarations:

```text
shape/
├── project.shape
└── vendor/
    └── audit-policy/
        └── v1/
            └── audit-policy.shape
```

The pack owns a stable, qualified module name:

```shape
module domain.audit.v1

trait DurableAudit<T: Resource> {
  allow Append<T>
  allow Read<T>
  forbid final HardDelete<T>
}
```

The project imports that module and layers local policy onto the imported trait:

```shape
module checkout

import domain.audit.v1

trait CheckoutRetention<T: Resource> {
  forbid final Truncate<T>
}

resource CheckoutAudit : CheckoutRetention, DurableAudit
```

Default discovery loads every `.shape` file below `shape/`, including pack files,
whether another module imports them or not. An import permits unqualified
references; it is not an activation boundary. Pack-owned resources, components,
and rules are therefore part of the checked model as soon as the pack is vendored,
and pack-level rules are evaluated without a project import.

Treat vendoring as installing the pack and importing as referencing it. Prefer
traits for policy that each project should opt into, then apply the imported trait
to local resources as above. Include pack-level rules only when they should govern
the model immediately on installation. Add project-specific constraints with
local declarations and apply both traits.

Shape has no override keyword. Do not shadow an imported declaration with a local
declaration of the same name. If a pack's contract must change, fork or update the
vendored files under a new reviewed module version and update the project's import.
Final forbids remain final after import.

## Pinning and updates

Vendor an exact upstream release or commit and commit the resulting `.shape` files.
Record the upstream source and revision in the vendoring commit or an adjacent
README. CI then reads exactly the same bytes as local development.

Treat a pack update like a dependency and policy change:

1. Replace the vendored directory with one exact reviewed revision.
2. Review the `.shape` diff, including weakened traits, widened effects, and removed
   final forbids.
3. Update the module import when the pack changes its major module version.
4. Run `shp fmt --check`, `shp check`, and relevant coverage checks.

Do not point CI at a floating branch or download a pack during the check. A moving
remote would make the effective architecture model differ across runs.

## CLI behavior

Because packs remain ordinary Shape source below `shape/`, the default commands
operate on them without pack-specific flags:

```bash
shp fmt --check
shp check
shp explain CheckoutAudit
```

Run default discovery from the project root. It is relative to the current
working directory and does not search parent directories; from elsewhere, pass
the intended `.shape` files explicitly.

`check` evaluates the installed pack and resolves project imports against its
modules, `fmt` formats both project and pack files, and `explain` reports pack
declarations with their qualified module names.

See `fixtures/projects/domain-pack-consumer` for the packaged end-to-end example.
