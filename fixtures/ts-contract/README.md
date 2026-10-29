# TypeScript contract fixture projects

Each directory is a small TypeScript project whose sibling `.shape` contract is
checked by the native content mapper. `expected.txt` holds the exact output of
`tsc --pretty false --runExternalCode`; an empty file means the project
type-checks cleanly.

| Case | What it shows |
| --- | --- |
| `matching-contract` | Sources that agree with their contract produce no errors. |
| `unregistered-export` | A new callable export with no `fn` in the contract is a type error. |
| `signature-drift` | An export whose type moves away from its reviewed signature is a type error. |
| `missing-export` | A reviewed `fn` whose export no longer exists is a type error at its source anchor. |
| `imported-type-drift` | A change to an imported type breaks the contract of a module that did not change. |
| `untyped-export` | An export the compiler cannot type is reported as uncertain and fails its signature. |
| `weakened-strictness` | A project that turns off strict checking is refused. |

A source with no contract at all is not a type error: the mapper only runs on
contracts in the program. The `shp ts-contract` gate reports it as
`missing_contract` (see `packages/shp-ts-contract/src/gate/native-gate.test.ts`).

Run the cases with:

```bash
bun test packages/shp-ts-contract/src/fixture-projects.test.ts
```

The test copies each case into a temporary directory that links this checkout's
mapper, the pinned `typescript@7.1.0-beta` compiler and `bun`, then compares the
compiler output with `expected.txt`. To add a case, create a directory with a
`tsconfig.json`, its `src/` files and `expected.txt`, and list it in
`fixture-projects.test.ts`.
