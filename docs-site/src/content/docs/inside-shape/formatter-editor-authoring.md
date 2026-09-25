---
title: Helper APIs
description: How the formatter, editor, language server, authoring, critic, and analyzer helpers in @shape/shp-checker present checker results without deciding them.
---

Besides `parseShapeModule` and `checkShapeModules`, `@shape/shp-checker` exports the helpers behind `shp fmt`, `shp lsp`, `shp author`, and `shp analyze`. One invariant governs all of them: **helpers present checker results; they never decide them.** Any behaviour that changes whether a model passes belongs in the grammar or the checker. Editor diagnostics come from the same parser and checker as `shp check`, so an editor reports the same problems as `shp check` run without a changed-file list, with the one exception described under [Editor helpers](#editor-helpers).

The user workflows are in [Author Updates with an Agent](/shapelang/guides/authoring/) and [Analyzer Hints](/shapelang/guides/analyzer/); `shp fmt` behaviour and editor setup are in the [CLI Reference](/shapelang/reference/cli/).

## API

| Module | Export | Behaviour | Uses |
| --- | --- | --- | --- |
| `formatter.ts` | `formatShapeSource(source, filePath?)` | Returns `{ ok: true, formatted }`, or `{ ok: false, diagnostics }` when the source does not parse | Parser |
| | `formatShapeModule(module)` | Prints a parsed module in canonical form | |
| `editor.ts` | `getEditorDiagnostics(source, filePath?)` | Parse diagnostics with line and column, or the checker's diagnostics for that one module | Parser, checker |
| | `getEditorDiagnosticsForDocuments(documents)` | Sorts the documents by path and checks them as one model, so imports resolve across files. If any document fails to parse, it returns only parse diagnostics. Each diagnostic keeps its file path | Parser, checker |
| | `getHoverText(source, symbol, filePath?)` | Help text for a prelude shape trait; otherwise `explain` output for the symbol in that document | Prelude metadata, `explainShapeModules` |
| | `getDefinitionLocation(source, symbol)` | One-based line and column of the symbol's declaration in that document | Parser |
| | `getCompletions(source, prefix?)` | Keywords, prelude names, and the document's declared names, sorted | Parser, prelude metadata |
| | `formatOnSave(source, filePath?)` | The same result as `formatShapeSource` | Formatter |
| `authoring.ts` | `generateShapeUpdateDraft(input)` | The conservative draft that `shp author` prints | |
| | `buildShapeAuthorPrompt(input)` | The author prompt text | Prelude metadata |
| | `buildShapeAuthoringBundle(input)` | `{ draft, authorPrompt }`, with each context file labelled by its path | |
| `critic.ts` | `buildShapeCriticPrompt(input)` | The critic prompt text for a typed `ShapeCriticInput` | Prelude metadata |
| | `reviewShapeAuthoringProposal(input)` | Parse diagnostics, or the critic prompt with sorted advisories | Parser, analyzer, module resolution |
| | `formatShapeCriticAdvisories(advisories)` | Stable advisory text | |
| `analyzer.ts` | `analyzeSourceText(path, source)` | Hints for one source file | |
| | `compareAnalyzerHintsToShape(hints, modules)` | Warnings for parsed modules | |
| | `formatAnalyzerWarnings(warnings)` | Warning text, or `Shape analyzer found no mismatches.` | |

`shp fmt` calls the formatter, `shp lsp` (`packages/shp-cli/src/lsp/server.ts`) calls the editor helpers and the formatter, `shp author` calls the authoring and critic helpers, and `shp analyze` calls the analyzer. None of the authoring, critic, or analyzer helpers calls `checkShapeModules`, a model provider, a subprocess, or a network service. Completion and definition lookup only parse. Hover's `explain` output lowers the document into facts but runs no rules.

Analyzer hints are plain data. A hint's `targetIdentity` records each SQL segment and whether it was quoted, so target comparison keeps quoted-identifier semantics after a hint is cloned, or serialised and parsed.

## Shared metadata

Three package-local modules hold the facts that more than one helper needs, so no helper keeps its own copy:

- `prelude.ts` holds the prelude traits and their final forbids, the shape-trait context rules (`PRELUDE_CONTEXT_RULES`, flattened per target kind into `PRELUDE_CONTEXT_REQUIREMENTS`), effect names, relation kinds with their traversal, and the completion symbols. Checker lowering and rules read it, and so do editor completion and hover, the author prompt (destructive effects, context traits, and relation kinds), and the critic (relation kinds and the reevaluation requirement).
- `shape-strings.ts` holds source-path normalisation (drop the `#anchor` and any `:line` suffix, turn backslashes into `/`, remove a leading `./`), string unquoting, and codepoint ordering. The checker, formatter, analyzer, and critic use it.
- `module-resolution.ts` holds module-reference precedence: a qualified `module::Name` first, then a declaration in the same module, then exactly one imported module that declares the name. More than one imported match is ambiguous, and none is unknown. Checker lowering and the critic share it.

A new prelude trait, context type, or relation kind therefore reaches completions, hover, and the prompts that list it without separate edits.

## Formatter

`formatShapeSource` parses the text and `formatShapeModule` rebuilds the file from the AST. Nothing from the original layout survives, and a file that does not parse is never partly formatted. Because `//` and `/* */` comments are hidden terminals in the grammar, they never reach the AST, and the formatter drops them.

The canonical form is:

- `module`, then `import` lines sorted by path, then declarations grouped by kind in this order: traits, resources, components, relations, candidate effects, implementations, bindings, rules, roles, policies, rationale, memory, reevaluations, attestations, and `change` blocks. Within a group, declarations are sorted by name in codepoint order; attestations are sorted by kind and keep their source order within a kind.
- Inside a component, `owns` lines, then `grants` lines, then `fn` members, each group sorted. Effect entries, implementation paths, binding globs, relation roles, and `expects` lines are sorted too.
- Graph rules are written as `forbid path A -> B over k1 or k2`, with one spaced arrow and an explicit kind filter.
- Rationale, memory, and reevaluation members follow a fixed order per kind. For `memory` it is `applies_to`, `status`, `confidence`, `sensitive`, `summary`, `who`, `when`, `protects`, `guards`, `observed`, `evidence`. Repeated `protects` or `guards` blocks merge into one block of each kind with sorted entries, repeated `who` or `when` blocks collapse to one that keeps the last owner or review date, and every block is written across several lines.
- The entries of a `change` block are sorted by their formatted text in codepoint order, so their original order is not kept.

For example, this input puts the memory on one line with its members out of order and two `guards` blocks, and carries a comment:

```shape
module gateway

memory DecisionRefactorConstraint : RefactorConstraint<fn Gateway.derivePolicyDecision> { summary "Previous refactors broke error normalisation." guards { on_change require ReEvaluation<Self> } status Unexplained guards { forbid transform Inline } applies_to fn Gateway.derivePolicyDecision who { owner GatewayTeam } confidence High }

// Policy reads only.
component Gateway {
  fn derivePolicyDecision : RefactorSensitive
    effects complete { Read<PolicySnapshot> }
  grants Read<PolicySnapshot>
  owns PolicySnapshot
}

resource PolicySnapshot
```

`shp fmt` rewrites it as follows, dropping the comment:

```shape
module gateway

resource PolicySnapshot

component Gateway {
  owns PolicySnapshot
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
  summary "Previous refactors broke error normalisation."
  who {
    owner GatewayTeam
  }
  guards {
    forbid transform Inline
    on_change require ReEvaluation<Self>
  }
}
```

## Editor helpers

Definition lookup and completion collect names from the declarations in one document:

- components, and each function under both `Component.fn` and its bare name;
- resources, traits, relations, implementations, bindings, rules, reevaluations, and `change` declarations;
- rationale and memory, under their own names and under their context type, both bare (`RefactorConstraint`) and complete (`RefactorConstraint<fn Gateway.derivePolicyDecision>`);
- declarations and functions introduced by `add` entries in `change` blocks. `modify` and `remove` entries refer to existing symbols, so they are not definition sites. Attestations have no names.

Context references are therefore target-aware. A definition query for `InlineRationale<fn Gateway.derivePolicyDecision>` finds the rationale or memory for that target, not the first declaration that uses `InlineRationale`. A reevaluation's `satisfies` target still resolves by the context's declared name.

Completion candidates are the keywords, including phrases such as `effects complete`, `forbid final`, `forbid path`, `forbid provides`, and `allow attest`; the prelude effect names, traits, context types, and relation kinds; and the document's declared names when it parses.

An editor diagnostic for a semantic problem carries the checker's complete formatted text, including `caused by:`, and no position. Every editor diagnostic has error severity.

The editor helpers pass `{ module, filePath }` inputs to `checkShapeModules` without an `origin`, so every module counts as authored. The generated-AST exemption therefore never applies in the editor: a generated file under `shape/generated/ast/` that `shp check` accepts shows `error: unknown effects` for each of its functions. `shp check` assigns the origin through `checkShapeFiles`, which applies the module-name and path test.

## Language server

`shp lsp` (`packages/shp-cli/src/lsp/server.ts`) is a stdio transport around the editor helpers and has no parser or checker of its own. Its capabilities, workspace discovery, validation triggers, lookup order, and formatting behaviour are in the [CLI Reference](/shapelang/reference/cli/#shp-lsp). The internals are:

- **Positions.** The transport converts between LSP's zero-based UTF-16 positions and the helpers' one-based lines and columns.
- **Snapshot.** Each validation builds one snapshot, the discovered files with every open document overlaid, and passes it, sorted by path, to `getEditorDiagnosticsForDocuments`.
- **Publication.** A generation counter discards the results of superseded validations. Each run publishes a diagnostic set, possibly empty, for every document in the snapshot and for every URI it published before, which clears fixed and closed files.
- **Placement.** Parse diagnostics appear at their position. Semantic diagnostics have none, so they appear on the first character of the file named in the diagnostic, or of the first snapshot document when the diagnostic names none.
- **Reference under the cursor.** Hover and definition take a complete context reference such as `RefactorConstraint<fn Gateway.derivePolicyDecision>` when the cursor is inside one, and otherwise the qualified identifier there. Definitions return a zero-width range.
- **Completion.** Candidates are the union of `getCompletions` over the last validated snapshot and the open documents. The replacement range is derived from the chosen candidate, so accepting a phrase such as `forbid path` replaces the whole typed prefix.

## Critic

`reviewShapeAuthoringProposal` parses the existing Shape files and the proposal. Any parse error returns `{ ok: false, diagnostics }`, which `shp author` prints as `error: failed to parse ...` and exits `2`. Otherwise it computes two kinds of advisory:

- **Guarded target without reevaluation.** For each `memory` or `rationale` in the existing Shape with an `fn` target and a reevaluation guard, the critic resolves the target's component through `module-resolution.ts`. The function must be found in exactly one matching component and must have a `source`. When the normalised `source` path is in the changed-file list, the advisory is raised unless the proposal declares a `reevaluation` whose `satisfies` name resolves, with the same precedence, to the context's qualified name.
- **Destructive effect omission.** The critic reads the diff's `+++ b/path` sections and keeps only files in the changed-file list; a `+++ /dev/null` section contributes nothing. Each run of consecutive added lines is analysed as its own source text, so a hint gets a function anchor only when the run contains the whole function. Hints are deduplicated by effect, path, and evidence, then compared with the existing and proposed modules together. Only missing-effect warnings survive, and a warning is dropped when any single module declares the effect on its own. Advisory evidence is the source text, never a diff coordinate.

Advisories sort by kind (guarded targets first), then by path, then by target and context or by effect and evidence, in codepoint order.
