---
title: TypeScript content mapping
description: Opt in to native TypeScript checking of reviewed Shape signatures and coverage of selected TypeScript source files.
---

TypeScript content mapping checks whether reviewed Shape signatures agree with
the statically callable exports of selected TypeScript files. It does not prove
that function bodies implement their Shape effects. It is an optional check;
ordinary Shape checking and projects that have not opted in keep their existing
behaviour.

This is a **source preview**, not a feature of the released `v0.10.0` binary.
The mapper is a private workspace package; it is not published to npm. Use a
source checkout containing this implementation for both the mapper and CLI.

## Opt in

Version 1 requires Bun 1.4.2 and Node 24 or later on `PATH`, plus the exact native
`typescript@7.1.0-beta` compiler resolved locally from each selected project.
Install the source checkout's dependencies, then link its mapper into the
consumer project:

```bash
cd /path/to/shapelang
bun install --frozen-lockfile
cd packages/shp-ts-contract
bun link

cd /path/to/project
bun add --dev --exact typescript@7.1.0-beta
bun link @shape/shp-ts-contract
```

The local link must point to the package in the installed source checkout, so
its workspace dependencies remain available. An equivalent local directory
symlink at `node_modules/@shape/shp-ts-contract` is also supported; native
integration tests exercise that layout. For a monorepo, install the compiler
and link where each selected tsconfig can resolve them.

Register the mapper in each selected project's own `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noCheck": false,
    "noEmit": true
  },
  "contentMappers": [
    {
      "package": "@shape/shp-ts-contract",
      "extensions": [".shape"],
      "options": { "repoRoot": "." }
    }
  ],
  "include": ["src/**/*"]
}
```

The mapper's `repoRoot` is relative to the directory containing that tsconfig.
Version 1 requires the registration in the selected tsconfig itself, rather
than relying on an inherited registration. Its only mapper option is
`repoRoot`.

Native TypeScript does not allow content mappers to register `.ts` or `.tsx`.
The mapper therefore translates `.shape` contracts into virtual TypeScript
checks that import the ordinary source module. No generated code is executed
or written into the application.

Run native checking with the explicit execution permission:

```bash
node node_modules/typescript/bin/tsc --project tsconfig.json --noEmit --runExternalCode
```

Without `--runExternalCode`, native TypeScript rejects the configured mapper.
Editor integration additionally depends on the editor using a compatible native
TypeScript version, workspace trust, and permission to run the mapper. Native
diagnostics map back to the `.shape` contract; this integration does not promise
diagnostics on an unrelated `.ts` document.

The compiler feature is described in the
[TypeScript 7.1 beta announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-7-1-beta/)
and the [native content-mapper protocol](https://github.com/microsoft/typescript-go/pull/4712).

## Contract layout

The version 1 convention pairs a selected source with a sibling contract:
`src/math.ts` has `src/math.shape`. Source references are repository-relative,
and their anchor names the exported value, including an alias, `default`, or a
string-named export.

```ts
// src/math.ts
export function answer(): number {
  return 42;
}
```

```shape
module math

component Math {
  fn answer
    source ts("src/math.ts#answer")
    signature ts("() => number")
    effects complete {}
}
```

The `signature` member follows `source` and precedes `effects`. It contains a
TypeScript callable type expression, not a statement or an executable snippet.
Comments, compiler-suppression directives and template-literal substitutions in
the fragment are rejected. Generated AST drafts cannot serve as reviewed
contracts. Shape imports and change blocks are not supported by this mapper
version and are rejected explicitly.
TypeScript `typeof` queries and references to the mapper's private `__Shape*`
identifiers are also rejected, including escaped identifier spellings. A
signature must not copy its expected type directly from the value being checked.

## Exact signatures

The native compiler compares the entire callable type with the reviewed
signature. Changing `void` to `number`, changing an earlier overload, changing
the relationship between generic inputs and outputs, or changing an explicit
`this` parameter fails the check. Generic type-variable names and parameter
labels do not themselves form part of the contract.

Overload order is significant. This is deliberately stricter than ordinary
TypeScript assignment compatibility, including its treatment of `void`.
Comparing only `Parameters` and `ReturnType` is insufficient because it loses
earlier overloads and generic relationships.

“Exact” means this compiler type-equality check, not identical syntax or identical
inference at every call site. For example, `<const T>(value: T) => T` and
`<T>(value: T) => T` can compare equal even though array arguments infer
differently. Keep call-site tests for inference behaviour.

Declared exports must exist. Callable aliases, re-exports, default exports and
string-named exports are resolved through native TypeScript. Unresolved imports
remain native compiler errors; the mapper must not turn an incomplete program
into a passing inventory.

## Export coverage

Every statically callable top-level value export of the paired source requires
a reviewed function declaration in its sibling contract. Adding an unregistered
callable export fails even when existing signatures still match. An empty
contract still checks the source's export inventory and therefore cannot hide
callable exports.

Exports typed `any`, `unknown`, `never`, broad `Function`, or ambiguous callable unions are
reported explicitly rather than disappearing from coverage. This policy does
not claim to recover a runtime function hidden by a noncallable annotation such
as `object`. Methods within exported objects or classes, private
helpers, callbacks and module initialization are outside this top-level export
scope.

## Selected-source gate

A mapper runs only for contract files included in the TypeScript program. A
missing sibling contract can therefore vanish from a wildcard `include`
without producing a native error. Use the independent selected-source gate in
CI; do not use native mapper success alone as proof that every governed source
has a contract.

For a repository-root `shape/ts-contract.json`:

```json
{
  "version": 1,
  "repoRoot": "..",
  "compiler": {
    "package": "typescript",
    "version": "7.1.0-beta"
  },
  "projects": [
    {
      "name": "application",
      "tsconfig": "tsconfig.json",
      "include": ["src/**/*.ts"],
      "exclude": ["src/**/*.test.ts"]
    }
  ]
}
```

```bash
bun /path/to/shapelang/packages/shp-cli/src/index.ts ts-contract \
  --config /path/to/project/shape/ts-contract.json --run-external-code
```

Inside the source checkout, `bun shp ts-contract --config /path/to/project/shape/ts-contract.json --run-external-code`
is equivalent. The released `shp` binary does not provide this preview command.

The gate's `repoRoot` is relative to its configuration file. Project paths and
source selectors are relative to that repository root. The gate checks the
selected source inventory independently of contract discovery, rejects missing
contracts and unsupported compiler setup, then runs native contract checking.
The selected compiler package and version are explicit; this feature does not
upgrade the repository's ordinary compiler or silently fall back to another
version.
The mapper also supports projects that enable `noUnusedLocals` and
`noUnusedParameters`; generated assertions do not create unused-code errors.

The gate configuration is strict JSON: comments, trailing commas, duplicate keys
and unknown settings are errors. Selectors must choose at least one source;
different projects may not claim the same source. Version 1 supports `.ts`
implementation files only. Explicitly exclude selected `.d.ts`, `.tsx`, `.mts`
and `.cts` files. New files and Git-ignored files still count; `.git` and
`node_modules` directories do not. Selected sources and contracts must be regular
files inside the repository and must appear in the native compiler's resolved
root files.
The selected tsconfig must not include additional `.shape` root files outside
the selected sources' sibling contracts; use a dedicated tsconfig if the project
also contains ordinary architecture models.

The resolved compiler options must retain `strict: true`, including inherited
options. `noCheck: true`, `strictFunctionTypes: false` and
`strictNullChecks: false` are rejected because they disable required checking.
`moduleSuffixes` must be absent or exactly `[""]`; entries such as `".native"`
could make a check import `math.native.ts` instead of the selected `math.ts`.
These requirements apply only to this optional contract gate. They do not
replace or weaken the repository's existing compiler or Shape checks.

Each compiler invocation has a two-minute timeout. On POSIX systems, cancellation
also terminates its mapper descendants. The Windows preview terminates only the
direct compiler process; descendant cleanup is not guaranteed there.

Listing a contract explicitly in `tsconfig.files` also makes its deletion a
native file-not-found error, but does not ensure that newly added source files
receive contracts.

## Diagnostics and freshness

Signature errors point to the reviewed signature in the `.shape` file. Mapper
diagnostics identify invalid contracts or unsupported fragments without
pretending to be TypeScript's own diagnostics. Position mapping uses negotiated
UTF-16 offsets correctly across Unicode characters and CRLF line endings.

Incremental checks must observe changes to imported source and dependencies,
even when the contract text is unchanged. Their result must agree with a clean
check of the same inputs. A warm check need not re-transform unchanged Shape
text: the native compiler tracks the imported TypeScript dependencies.

After changing the linked mapper implementation or updating its source checkout,
delete the project's TypeScript `.tsbuildinfo` cache before checking again. This
source preview uses a static package version, so native incremental caching
does not detect edits to the mapper's own implementation.

## Effects remain a separate obligation

A matching signature establishes a type contract, not purity, permitted effects,
or faithful implementation of the architecture. The mapper never infers
`effects complete`. An authored `effects unknown` remains unknown; ordinary
strict Shape checking continues to reject it. Keep running the normal Shape
gate alongside this optional TypeScript contract check.

Reviewed signatures may refer to imported type aliases. If an alias changes with
the implementation, both sides can change together without a mismatch. Authors
must choose independent, reviewed expectations; the mapper does not establish
where a transitive alias ultimately gets its type.
