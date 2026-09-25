---
title: Analyzer Hints
description: Scan source files for obvious hard deletes, truncates, and table drops with shp analyze, and compare them with the effects the Shape model declares.
---

`shp analyze` scans source files lexically for a small set of obvious destructive operations (hard deletes, truncates, and table drops) and reports each one as a hint. Given Shape files, it compares each hint with the effects the model declares and warns where the two disagree. Its output is advisory. `shp check` never reads it, and a clean run does not show that a model's effects are complete; the checker still judges only the declared model.

## Two modes

| Mode | Command | Output | Exit |
| --- | --- | --- | --- |
| Hints only | `shp analyze FILES...` | One line per hint on stdout: `path:line Effect[ target=T] evidence` | `0` |
| Comparison | `shp analyze --shape-files a.shape,b.shape FILES...` | Warnings on stderr, or `Shape analyzer found no mismatches.` on stdout | `1` on any warning, otherwise `0` |

`--shape-files` takes a comma-separated list. Only the listed files are compared; the analyzer does not discover `shape/**/*.shape`. A parse error in a listed file exits `2`. The [CLI Reference](/shapelang/reference/cli/) lists the flags.

## Worked example

`src/audit/purge.ts` deletes rows from the `audit_events` table:

```typescript
export async function purgeOldEvents(db: { deleteFrom: (table: string) => unknown }) {
  return db.deleteFrom("audit_events");
}
```

Hint mode reports the delete, with the table as its static target:

```text
$ shp analyze src/audit/purge.ts
src/audit/purge.ts:2 HardDelete target=audit_events return db.deleteFrom("audit_events");
```

The model in `shape/audit.shape` does not mention the purge yet:

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

Comparison mode warns and exits `1`. No declared function has a `source` or `evidence` reference to `src/audit/purge.ts`, so nothing in the model can account for the hint:

```text
$ shp analyze --shape-files shape/audit.shape src/audit/purge.ts
warning: analyzer hint missing from shape effects

src/audit/purge.ts:2 suggests HardDelete.
suspected target: audit_events
evidence: return db.deleteFrom("audit_events");
```

The fix declares the function with the same path the command scanned, and gives the resource a `storage` value that names the table:

```shape
module audit

resource AuditEvent : AppendOnly {
  storage postgres.table("audit_events")
}

component AuditStore {
  owns AuditEvent
  grants Append<AuditEvent>
  fn appendEvent
    source ts("src/audit/store.ts#appendEvent")
    effects complete {
      Append<AuditEvent>
        evidence ts("src/audit/store.ts#appendEvent")
    }
  fn purgeOldEvents
    source ts("src/audit/purge.ts#purgeOldEvents")
    effects complete {
      HardDelete<AuditEvent>
        evidence ts("src/audit/purge.ts#purgeOldEvents")
    }
}
```

```text
$ shp analyze --shape-files shape/audit.shape src/audit/purge.ts
Shape analyzer found no mismatches.
```

Both changes are needed. Without the `storage` line the effect is found but its target is not, because `audit_events` and `AuditEvent` are different names and the analyzer never pluralises:

```text
warning: analyzer hint target does not match shape effects

src/audit/purge.ts:2 suggests HardDelete.
suspected target: audit_events
declared targets: AuditEvent
evidence: return db.deleteFrom("audit_events");
```

The analyzer's work ends once the model states the effect. `shp check` then judges the claim, and it rejects this one, exiting `1`:

```text
$ shp check shape/audit.shape
error: forbidden effect

AuditStore.purgeOldEvents emits HardDelete<AuditEvent>.
AuditEvent has trait AppendOnly.
AppendOnly forbids final HardDelete<AuditEvent>.
evidence: ts("src/audit/purge.ts#purgeOldEvents")

caused by:
  - shape/audit.shape: effect AuditStore.purgeOldEvents emits HardDelete<AuditEvent>
  - shape/audit.shape: resource AuditEvent : AppendOnly
  - standard prelude: trait AppendOnly forbids final HardDelete<T>
```

The purge conflicts with the append-only claim, so either the source change or the claim has to change. Declaring the delete does not make it allowed: no grant, design memory, or analyzer result waives a [final forbid](/shapelang/concepts/effect-model/).

## How comparison works

Comparison matches a hint to declared effects in three steps: by file path, then by function anchor, then by target.

**Path.** A hint carries the source path as it was typed on the command line, with backslashes turned into `/` and a leading `./` removed. It is compared with the path of every `source` and `evidence` reference in the listed Shape files, after dropping the `#anchor` and any `:line` suffix. Any other spelling of the same file, such as an absolute path, does not match, and every hint in that file becomes a missing effect. Run the command from the repository root with repository-relative paths, as the references are written.

Only effect entries inside `effects complete` count, including those in `add fn` and `modify fn` entries of `change` blocks. An entry counts under its function's `source` reference and under its own `evidence` reference; a file-only `evidence` reference to the same file as an anchored `source` counts under that anchor. A function with `effects unknown` declares nothing, so a hint in its file is reported as missing.

**Anchor.** In a TypeScript file, the analyzer attributes each hint to the innermost enclosing function it recognises: a named function declaration, a class or object method, or a block-bodied arrow function assigned with `const`, `let`, or `var`. The hint's anchor is the bare function name. A class method's anchor is `purgeMethod`, never `Store.purgeMethod`. The declarations for the file are then selected in this order:

1. If the hint has an anchor and a reference to the file has an equal `#anchor`, only the effects declared under that anchor count.
2. Otherwise, if a file-only reference (no `#anchor`) declares the hint's effect, those declarations count. If the hint has a target and an anchored reference also declares the effect, the hint is unattributable instead.
3. Otherwise, an unanchored hint uses the one anchored reference in the file that declares the effect. If two or more declare it, or if the hint has an anchor that matched none of them in step 1, the hint is unattributable.
4. If nothing in the file declares the effect, the hint is missing.

A function referenced as `#AuditStore.purge`, the form `shp ast` writes for TypeScript methods, therefore never matches a hint from inside `purge` in step 1, and the hint falls through to steps 2 to 4.

**Target.** When the effect is found and the hint has a static target, the target must match one of the resources those declarations target, either by the resource name or by one of its `storage` values. A declared target that is not a declared resource never matches. A hint without a static target matches any declaration of its effect.

- Targets read from library calls (Kysely, Prisma, Drizzle) compare case-insensitively with underscores removed, so `auditEvents` matches a `storage` value of `audit_events`. Hyphens and dots stay significant.
- Targets read from SQL compare segment by segment across `schema.table`. Unquoted segments compare case-insensitively; quoted segments must match exactly. The segment counts must agree, so `public.audit_events` does not match a `storage` value of `audit_events`.

## Warnings

Every warning names the hint as `path:line suggests Effect.` and ends with an `evidence:` line that quotes the source.

| Headline | Printed when | Extra lines |
| --- | --- | --- |
| `warning: analyzer hint missing from shape effects` | Nothing selected for the hint declares its effect, including when no declared function references the file | `suspected target:` when the hint has one |
| `warning: analyzer hint target does not match shape effects` | The effect is declared, but none of its targets matches the hint's static target | `suspected target:`, `declared targets:` |
| `warning: analyzer hint could not be attributed to a shape function` | The hint cannot be attributed to a single declaration (steps 2 and 3 above) | `declared anchors:`, `suspected target:` when present, `declared targets:` |

## Recognised patterns

A file ending in `.sql` (in any case) is read with the SQL scanner. Every other file, whatever its language, is read with the TypeScript lexer and the library-call matchers below. The three effects the analyzer can report are exactly the final forbids of the prelude `AppendOnly` trait.

| Source form | Effect | Target taken from |
| --- | --- | --- |
| SQL `DELETE ... FROM t` | `HardDelete` | Each table after `FROM`, skipping `ONLY` |
| SQL `TRUNCATE [TABLE] [ONLY] t` | `Truncate` | Each listed table |
| SQL `DROP TABLE [IF EXISTS] t` | `DropStorage` | Each listed table |
| `.deleteFrom("t")` on any receiver (Kysely style) | `HardDelete` | The string literal argument |
| `.truncate("t")` on any receiver | `Truncate` | The string literal argument |
| `.dropTable("t")` on any receiver, such as `db.schema.dropTable` | `DropStorage` | The string literal argument |
| `prisma.model.delete(...)` or `.deleteMany(...)`, also on `tx` | `HardDelete` | The model property |
| `db.delete(t)`, `tx.delete(t)`, or `trx.delete(t)` (Drizzle style) | `HardDelete` | The identifier argument |
| Raw SQL passed to `db`, `tx`, or `trx` `.execute(...)` or `.executeQuery(...)`, or to `prisma`, `tx`, or `trx` `.$executeRaw` or `.$executeRawUnsafe` | As for the SQL forms | As for the SQL forms |

These details decide whether a hint appears and whether it carries a target:

- A comma-separated SQL target list produces one hint per table, in source order.
- For the literal and identifier forms, a target is recorded only when the first argument is a static string literal (or, for Drizzle, an identifier) followed by `)` or `,`. Otherwise the hint appears without `target=`.
- In TypeScript, matches count only outside comments and string literals. SQL text inside a string is scanned only when the literal is the first argument of a raw-SQL sink and is followed by `)` or `,`. Any sink also accepts a `sql`-tagged template there, and `$executeRaw` and `$executeRawUnsafe` also accept a tagged template directly.
- A raw-SQL literal must be closed and static. A template containing `${...}` produces no hint at all.
- In SQL, the destructive keyword must be the first token of its statement; statements end at `;`. Whitespace, newlines, and comments (`--`, `#`, `/* */`) may separate the keywords, so a multiline `DELETE ... FROM` is found. Quoted text is ignored, and quoted identifiers keep their quoting for target comparison.

## Limits

The analyzer is a lexical scanner. The cases below produce no hint, a wrong hint, or a hint without a target or anchor, and they still need review of the source and its declared effects:

- Effects other than the three above. The analyzer never reports reads, appends, updates, or exports.
- Destructive SQL that does not start its statement, such as a CTE-prefixed `WITH ... DELETE`.
- SQL held in a variable, built at runtime, or interpolated into a template.
- Raw SQL sent through other calls, such as `$queryRawUnsafe` or Kysely's `` sql`...`.execute(db) `` form, and receivers under other names, including project aliases and dynamic call targets.
- Control flow, which is never evaluated. A delete in a branch that never runs is still reported.
- Singular and plural forms of names, which never match each other.
- JavaScript regular-expression literals, which are not masked, so their contents are scanned as code.
- Language-aware analysis outside SQL and TypeScript. Python, Go, Rust, and Swift files are read with the TypeScript matchers, so an empty result for them says nothing about their effects. Swift support in [`shp ast`](/shapelang/guides/ast-drafts/) adds no Swift effect analysis.
- Function forms the anchor pass does not recognise: concise arrow functions, callbacks passed to other calls, literal return types such as `function f(): "done" {`, assigned arrows with a line break between `=` and the parameter list, and malformed scopes. Hints inside them stay unanchored.

## Responding to a warning

- **Missing effect that the source really performs:** declare it in the owning function's `effects complete` block, with `evidence` naming the scanned path, then run `shp check`. Final forbids still apply.
- **Target mismatch:** correct the declared target, or add a `storage` value that names the table or model.
- **Unattributable hint:** if the hint comes from a recognised function, give that function a `source` whose `#anchor` is its bare name, so that step 1 selects it.
- **False positive:** leave the model unchanged.
- **No hints:** do not write an empty `effects complete` block because the analyzer found nothing. Keep `effects unknown` until the function is reviewed.

`shp author --critic-prompt` runs the same analyzer over the added lines of a diff; see [Author Updates with an Agent](/shapelang/guides/authoring/).
