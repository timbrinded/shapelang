---
title: Langium Grammar
description: Where the Shape grammar lives and how it is regenerated, why every keyword is global, which grammar decisions to preserve, and the checklist for a grammar change.
---

The Langium grammar at `packages/shp-checker/src/language/shape.langium` defines which text parses into a `ShapeModule` AST. Its entry rule, `ShapeModule`, is an optional `module` name, then `import` declarations, then any number of top-level declarations; the `Declaration` rule lists the 15 declaration kinds. The grammar decides only what parses: lowering and rules give the parsed claims their meaning. The syntax users write is documented in [Language Syntax](/shapelang/reference/language-syntax/).

## Location and regeneration

`langium-config.json` at the repository root points Langium at the grammar. `bun run langium:generate` (`langium-cli generate`) writes three files to `packages/shp-checker/src/language/generated/`:

- `ast.ts`: the AST node types and their `is*` type guards;
- `grammar.ts`: the serialized grammar;
- `module.ts`: the generated Langium service modules.

`language/shape-module.ts` is hand-written. Its `createShapeServices` injects the generated modules into the Langium core services, and `parseShapeModule` in `packages/shp-checker/src/parser.ts` uses those services to return either a `ShapeModule` or `parse` diagnostics.

Never hand-edit the generated files: change the grammar and regenerate. CI reruns `bun run langium:generate` and then `git diff --exit-code -- packages/shp-checker/src/language/generated`, so a stale or edited generated file fails the build.

## Keywords are global

Every ID-shaped quoted literal in `shape.langium`, such as `'role'` or `'transform'`, becomes a keyword everywhere in the language. It can no longer appear as a bare identifier, such as a module-name segment or a lowercase function name: `module policy.audit` and `fn role` both fail to parse. Keywords are case-sensitive, so PascalCase names such as `Policy` are unaffected. A rule that must accept a keyword where an identifier is expected lists it explicitly, as `ProtectsPropertyKind` does with `'description'` and `RelationKindName` does with the prelude relation kinds.

Add every new keyword to `SHAPE_RESERVED_WORDS` in `packages/shp-checker/src/ast-generation-utils.ts`. The AST generator escapes generated names that match an entry, so it never emits an unparsable bare keyword. The test "reserved words cover every ID-shaped grammar keyword" in `packages/shp-checker/src/checker.guard-syntax.test.ts` extracts every quoted literal from the grammar and fails when one is missing from the set.

## Grammar decisions to preserve

- **Grouped context blocks are the only guard-member syntax.** `RationaleMember` and `MemoryMember` accept `ProtectsBlock`, `GuardsBlock`, `WhoBlock`, and `WhenBlock`, so there is one canonical on-disk form. `lowerContextMember` flattens block entries into the shared context info, and the formatter merges repeated blocks of one kind into one.
- **`ProtectsBlock` entries are comma-separated.** A `ProtectsEntry` has an optional value, which would otherwise swallow the next entry's kind. The value-bearing form is `protects { shape PreserveInline }` and the valueless form is `protects { description }`; both can share one block.
- **`ProtectsPropertyKind` is `'description' | ID`.** Only `description`, which is already a keyword, is listed. Listing `'shape'` would reserve it globally and break identifiers such as the module segments in `shape.generated.ast`.
- **`GuardsBlock` entries are self-delimiting.** Each starts with `on_change` (`'on_change' 'require' ContextTypeName`) or `forbid` (`'forbid' 'transform' ID`), so they need no separator.
- **`WhoBlock` and `WhenBlock` are single-valued.** Each holds at most one `OwnerDecl` or `ReviewByDecl`, matching the single-valued lowering, so the formatter cannot reorder repeated entries into a different winner.
- **`transform` belongs to `ModifyFunctionChange`.** A `modify fn` entry may carry `TransformDecl` (`'transform' ID (',' ID)*`) after its shape-trait list; the labels feed `forbid transform` guards.
- **Rule headers are plain names.** The subject of a rule-derived final forbid is introduced by a `when T has TraitName` member, not by rule-level type parameters.
- **`effect candidate` stays separate from `effects complete`.** A candidate carries generated evidence for review, and authored Shape remains responsible for final effect claims.
- **Bindings are a language feature, not CI shell logic.** A binding is an architecture claim: one surface cannot change without another being reviewed.

## Grammar change checklist

Make every change in the same branch as the grammar edit:

1. Edit `shape.langium`, then run `bun run langium:generate` and commit the regenerated files.
2. Add each new ID-shaped keyword to `SHAPE_RESERVED_WORDS`.
3. Add each new keyword to the docs highlighter, `docs-site/src/syntax/shape-language.mjs`, and to `KEYWORD_COMPLETIONS` in `packages/shp-checker/src/editor.ts` when users type it. Add hovers for user-facing constructs.
4. Add parser tests (`packages/shp-checker/src/parser.test.ts`) for the accepted and rejected forms.
5. Update the formatter (`packages/shp-checker/src/formatter.ts`) so its output stays canonical and round-trips.
6. Lower new semantic concepts into the `Model` ([Fact Lowering](/shapelang/inside-shape/fact-lowering/)). Add a rule only if the syntax has semantic meaning ([Rule Evaluation](/shapelang/inside-shape/rule-evaluation/#adding-a-rule)).
7. Update the AST generator and authoring helpers if they emit the construct.
8. Update `docs-site/src/content/docs/reference/language-syntax.md` and this page. The `GrammarDocs` binding requires one of them when the grammar, the generated files, `docs-site/src/syntax/**`, or `shape/language.shape` changes. Every complete `shape` block in the docs must parse; mark an intentional fragment `shape no-verify`.
9. Update `shape/language.shape` if the modeled grammar surface changes, and add or update bindings when the syntax affects docs, CLI behaviour, or another review surface.
10. Run `bun run langium:generate`, `bun test`, `bun run typecheck`, and `bun run docs:check`. [`CONTRIBUTING.md`](https://github.com/timbrinded/shapelang/blob/master/CONTRIBUTING.md) lists the full local check sequence.
