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
its workspace dependencies remain available. The
[selected-source gate](#selected-source-gate) enforces this. Native TypeScript
loads the mapper from the nearest `node_modules/@shape/shp-ts-contract`
directory at or above each selected tsconfig, without applying tsconfig `paths`
or package `exports`. The gate finds that directory the same way and requires
it to be, after following symbolic links, the package the gate runs from. A
link left pointing at another checkout or worktree fails as `invalid_mapper`,
naming both directories, even when a `paths` alias or an `exports` map would
resolve the package name elsewhere. An equivalent local directory symlink at
`node_modules/@shape/shp-ts-contract` is also supported; native integration
tests exercise that layout. For a monorepo, install the compiler and link where
each selected tsconfig can resolve them.

Register the mapper in each selected project's own `tsconfig.json`, and keep
that tsconfig check-only with `noEmit: true`:

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

The mapper requires strict checking. When a project sets `strict: false`,
`strictNullChecks: false`, `strictFunctionTypes: false` or `noCheck: true`,
directly or through `extends`, every contract in that project reports
`shape-ts1006` at line 1, column 1 and no signature is compared, because these
options let real signature drift compare equal. Omitting `strict` is accepted:
TypeScript 7 checks strictly by default.

Native TypeScript does not allow content mappers to register `.ts` or `.tsx`.
The mapper therefore translates `.shape` contracts into virtual TypeScript
checks that import the ordinary source module. The checks are type-only and
never executed. Under `noEmit` nothing is written; a build that registers the
mapper and emits declarations writes each contract's generated assertions to
`<name>.d.shape.ts` in its output directory, so keep the registration out of
build tsconfigs.

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
    effects complete {
    }
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
A signature must be exactly one callable type; `never`, `any`, a noncallable
type or a union of callables is reported once at the signature as
`Shape signature: the reviewed signature for 'answer' must be exactly one callable type`.

Anchors and signatures are read as the Shape parser decodes them. A signature
may span several lines in either quote style. Shape strings do not decode
`\uXXXX` or `\xXX` escapes: the parser drops the backslash, so `\u0041` reads
as `u0041`. The mapper therefore rejects both escapes, as `shape-ts1003` in a
source anchor and `shape-ts1004` in a signature. Write the character itself, or
`\\u` where the TypeScript type text needs a `\u` escape. Formatting a
contract with `shp fmt` therefore does not change what it checks, except for a
control character such as a vertical tab or NUL, which `shp fmt` writes as a
`\u` escape that the mapper then rejects.

## Exact signatures

The native compiler compares the entire callable type with the reviewed
signature. Changing `void` to `number`, changing an earlier overload or the
order of overloads, changing the relationship between generic inputs and
outputs, or changing the type of an existing `this` parameter fails the check.
Generic type-variable names and parameter labels do not themselves form part of
the contract.

This is deliberately stricter than ordinary TypeScript assignment
compatibility, including its treatment of `void`. Comparing only `Parameters`
and `ReturnType` is insufficient because it loses earlier overloads and generic
relationships.

A mismatch is reported as TS2344 at the reviewed signature. The message shows
the export's type, marked `exact: false`, against the reviewed type, marked
`exact: true`, followed by TypeScript's account of the difference. Very long
types are shortened by TypeScript's ordinary type printing.

```text
src/math.shape(6,19): error TS2344: Type '{ export: "answer"; signature: () => string; exact: false; }' does not satisfy the constraint '{ export: "answer"; signature: () => number; exact: true; }'.
  The types returned by 'signature()' are incompatible between these types.
    Type 'string' is not assignable to type 'number'.
```

“Exact” means this compiler type-equality check, not identical syntax or
identical behaviour at every call site. The check differs from what callers see
in both directions.

Some real changes compare equal, so keep call-site tests for them:

- `<const T>(value: T) => T` and `<T>(value: T) => T` compare equal even though
  array arguments infer differently.
- Adding or removing a `this` parameter is not compared; only the type of a
  `this` parameter present on both sides is.
- Member form is not compared: a method `{ run(x: string): void }` equals a
  function-valued property `{ run: (x: string) => void }`, although method
  parameters are checked bivariantly.
- Accessor write types are not compared: a setter that accepts more than its
  getter returns goes unnoticed.

Some equivalent types compare unequal, and the check fails closed:

- The comparison sees how a type is composed. An intersection such as
  `{ a: string } & { b: number }` does not equal the flattened
  `{ a: string; b: number }`, and a union written member by member does not
  equal one object with a union-typed discriminant. Write a parameter typed
  `Base & { ... }` or `Omit<T, "k"> & { ... }` in the same form, or refer to
  the implementation's exported alias, subject to the
  [alias caveat](#effects-remain-a-separate-obligation). Refactoring such an
  alias into `interface ... extends` can fail the contract although callers see
  no change.
- On `typescript@7.1.0-beta`, a distributive conditional over the signature's
  own type parameter never compares equal when written inline, even as a
  verbatim copy: `<T>(value: T) => T extends string ? 1 : 2` fails against an
  identical declaration. Put the conditional in an exported generic alias and
  refer to it, as in `<U>(value: U) => import("./types.js").IsText<U>`; a change
  to the implementation's conditional still fails.

Every registered export must exist and be callable. Callable aliases,
re-exports, default exports and string-named exports are resolved through
native TypeScript. A registration whose export is missing is reported once, at
its source anchor:

```text
src/math.shape(5,16): error TS2344: Type '"Shape source anchor: src/math.ts has no export named 'answer'; correct the anchor or restore the export"' does not satisfy the constraint 'true'.
```

A noncallable export, such as a string constant, is reported at the same place
as `export 'answer' of src/math.ts is not callable`.

Unresolved imports remain native compiler errors; the mapper must not turn an
incomplete program into a passing inventory. A missing sibling source is TS2307
at line 1, column 1 of the contract, together with coverage errors that list
`any`. An export whose type the compiler cannot determine has the compiler's
error type, which the check treats like `any`: the export is reported as
uncertain, its signature fails, and the coverage of the file's other exports
still applies. This happens, for example, when `skipLibCheck` hides a broken
dependency declaration, when `// @ts-ignore` suppresses an untyped import, or
under `noImplicitAny: false`.

## Export coverage

Every statically callable top-level value export of the paired source requires
a reviewed function declaration in its sibling contract. Adding an unregistered
callable export fails even when existing signatures still match. An empty
contract still checks the source's export inventory and therefore cannot hide
callable exports. Unregistered exports are listed in one diagnostic at line 1,
column 1 of the contract:

```text
src/math.shape(1,1): error TS2344: Type '{ unregisteredCallableExports: "extra" | "reset"; }' does not satisfy the constraint 'true'.
```

TypeScript abbreviates a long list, for example as `... 34 more ...`. Set
`noErrorTruncation: true` in the selected tsconfig, or pass
`--noErrorTruncation` to `tsc`, to print every name; the same applies to the
`uncertainExportTypes` list below.

Exports typed `any`, `unknown`, `never`, broad `Function`, or ambiguous callable
unions are reported explicitly rather than disappearing from coverage, as
`{ uncertainExportTypes: "name" }` at the same position. The members of a
CommonJS `export =` object are the module's exports. An optional callable
member may be absent at runtime, so its type includes `undefined`: it still
requires a registration, and it is reported as uncertain. This policy does not
claim to recover a runtime function hidden by a noncallable annotation such as
`object`. Methods within exported objects or classes, private helpers,
callbacks and module initialization are outside this top-level export scope.

Coverage reads the module's type, not its runtime exports. An ambient
`export declare function` and a `declare module` augmentation in another file
both count as exports and can satisfy a registration although no such value
exists at runtime. Names that reach the module only through `export type * from`
are types and add no obligations.

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
bun --cwd /path/to/shapelang shp ts-contract \
  --config /path/to/project/shape/ts-contract.json --run-external-code
```

Run the gate with the source checkout as Bun's working directory, as above, and
pass an absolute `--config` path. Bun reads `bunfig.toml` from its working
directory, so a run from the project directory would load the project's
preload scripts into the gate's own process, where they could change its exit
status. The released `shp` binary does not provide this preview command.

The gate's `repoRoot` is relative to its configuration file. Project paths and
source selectors are relative to that repository root. The gate checks the
selected source inventory independently of contract discovery, rejects missing
contracts, contracts the mapper would reject (reported as `invalid_contract`
with each problem's line, column and `shape-ts` code), and unsupported compiler
setup, then runs native contract checking.
The selected compiler package and version are explicit; this feature does not
upgrade the repository's ordinary compiler or silently fall back to another
version. The gate checks that the resolved compiler package is named
`typescript`, has that version and declares `bin.tsc` inside the package; it
does not verify the package's contents, so it trusts the project's
`node_modules/typescript`.
The mapper also supports projects that enable `noUnusedLocals` and
`noUnusedParameters`; generated assertions do not create unused-code errors.

The gate configuration is strict JSON: comments, trailing commas, duplicate keys
and unknown settings are errors. Selectors must choose at least one source;
different projects may not claim the same source. Version 1 supports `.ts`
implementation files only. Explicitly exclude selected `.d.ts`, `.tsx`, `.mts`
and `.cts` files. Each path is also tested under its `.ts` spelling, so a `.ts`
selector such as `src/**/*.ts` still selects `src/math.mts` and reports it as
`unsupported_source` until it is excluded, for example with `src/**/*.mts`.
Excludes are tested under both spellings, so `src/**/*.test.ts` also excludes
`src/a.test.mts`. When `allowJs` adds `.js`, `.jsx`, `.mjs` or `.cjs` root files
in the selected tree, each is reported the same way until it is excluded. Other
JavaScript files, including symbolic links to them, are not governed sources.
New files and Git-ignored files still count; `.git` and `node_modules`
directories do not. Selected sources and contracts must be regular files inside
the repository and must appear in the native compiler's resolved root files.
The selected tsconfig must not include additional `.shape` root files outside
the selected sources' sibling contracts; use a dedicated tsconfig if the project
also contains ordinary architecture models.

Strict checking must stay on. `strict` may be omitted, because TypeScript 7
enables it by default, or set to `true`. An explicit or inherited
`strict: false`, `noCheck: true`, `strictFunctionTypes: false` or
`strictNullChecks: false` is rejected as `invalid_compiler` before native
checking; the mapper refuses the same options, so a plain `tsc` run fails too.
`moduleSuffixes` must be absent or exactly `[""]`; entries such as `".native"`
could make a check import `math.native.ts` instead of the selected `math.ts`.
Version 1 rejects project `references`, because the compiler reads referenced
projects' built `.d.ts` outputs and the result would depend on whether those
builds are current. None of these requirements changes the repository's other
compiler or Shape checks.

Each compiler invocation has a two-minute timeout. On POSIX systems, cancellation
also terminates its mapper descendants. The Windows preview terminates only the
direct compiler process; descendant cleanup is not guaranteed there.

Listing a contract explicitly in `tsconfig.files` also makes its deletion a
native file-not-found error, but does not ensure that newly added source files
receive contracts.

## Diagnostics and freshness

Signature mismatches and unsupported signatures point to the reviewed signature
in the `.shape` file. A missing or noncallable export points to its source
anchor. Coverage failures, refused project options and an unresolved sibling
source point to line 1, column 1 of the contract. Mapper diagnostics, with
`shape-ts` codes, identify invalid contracts, unsupported fragments and refused
options without pretending to be TypeScript's own diagnostics. Position mapping
uses negotiated UTF-16 offsets correctly across Unicode characters and CRLF line
endings.

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
