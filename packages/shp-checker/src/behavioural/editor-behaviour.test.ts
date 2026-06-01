// #63 — Editor behaviour: exact go-to-definition positions, completion
// filter/sort/dedup with prelude parity, parser-error diagnostics, hover, and
// the #48 change-declaration go-to-definition regression.
//
// The editor surface (getDefinitionLocation/getCompletions/getHoverText/
// getEditorDiagnostics) shares its prelude with the checker and authoring
// helpers (shape/checker.shape:453 PreludeMetadataContract). These tests pin
// EXACT 1-based positions derived from the fixture source — never `> 1` ordinal
// checks — and compare the completion/hover prelude surface against the single
// PRELUDE_* source of truth rather than a hand-copied list, so editor/checker
// drift is caught.

import { describe, expect, test } from "bun:test";
import {
  getCompletions,
  getDefinitionLocation,
  getEditorDiagnostics,
  getHoverText
} from "../index.ts";
import {
  PRELUDE_COMPLETION_SYMBOLS,
  PRELUDE_CONTEXT_REQUIREMENTS,
  PRELUDE_CONTEXT_RULES
} from "../prelude.ts";
import { characterization, lockedIntended, shouldBe } from "./harness.ts";

// A small known source whose declaration positions are counted in the comments
// to the right. Lines are 1-based; columns are 1-based (column of the first
// character of the line for top-level decls, or the `fn` keyword for members).
const KNOWN_SOURCE = [
  "module m", // line 1
  "", // line 2
  "resource Ledger", // line 3, "resource" starts at column 1
  "", // line 4
  "component Bookkeeper {", // line 5, "component" starts at column 1
  "  owns Ledger", // line 6
  "  fn record", // line 7, "fn" starts at column 3 (two leading spaces)
  "    effects unknown", // line 8
  "}" // line 9
].join("\n");

// Two components each declaring `fn handle`, to exercise qualified scoping.
const SCOPED_SOURCE = [
  "module m", // line 1
  "", // line 2
  "component Alpha {", // line 3
  "  fn handle", // line 4, "fn" at column 3
  "    effects unknown", // line 5
  "}", // line 6
  "", // line 7
  "component Beta {", // line 8
  "  fn handle", // line 9, "fn" at column 3
  "    effects unknown", // line 10
  "}" // line 11
].join("\n");

describe("#63 editor go-to-definition exact positions", () => {
  test(
    lockedIntended(
      "top-level resource resolves to its EXACT declaration line and column",
      "shape/checker.shape:453 PreludeMetadataContract; packages/shp-checker/src/editor.ts getDefinitionLocation"
    ),
    () => {
      // Derivation: `resource Ledger` is line 3 of KNOWN_SOURCE; the `resource`
      // keyword starts at column 1 (no indentation).
      const ledger = getDefinitionLocation(KNOWN_SOURCE, "Ledger");
      expect(ledger).toEqual({ symbol: "Ledger", line: 3, column: 1 });

      // Derivation: `component Bookkeeper {` is line 5, keyword at column 1.
      const bookkeeper = getDefinitionLocation(KNOWN_SOURCE, "Bookkeeper");
      expect(bookkeeper).toEqual({ symbol: "Bookkeeper", line: 5, column: 1 });
    }
  );

  test(
    lockedIntended(
      "qualified Component.fn resolves to the EXACT member position in the right scope",
      "packages/shp-checker/src/editor.ts definitionLocationForDeclaration component branch"
    ),
    () => {
      // Derivation: in KNOWN_SOURCE the member `fn record` is line 7; the `fn`
      // keyword starts at column 3 (two leading spaces of indentation). A bare
      // and a qualified lookup must resolve to the same member position.
      const bare = getDefinitionLocation(KNOWN_SOURCE, "record");
      const qualified = getDefinitionLocation(KNOWN_SOURCE, "Bookkeeper.record");
      expect(bare).toEqual({ symbol: "record", line: 7, column: 3 });
      expect(qualified).toEqual({ symbol: "Bookkeeper.record", line: 7, column: 3 });

      // Derivation: SCOPED_SOURCE has Alpha.handle at line 4 and Beta.handle at
      // line 9, both `fn` at column 3. The qualified lookup must land in the
      // matching component, not the first `handle` it finds.
      expect(getDefinitionLocation(SCOPED_SOURCE, "Alpha.handle")).toEqual({
        symbol: "Alpha.handle",
        line: 4,
        column: 3
      });
      expect(getDefinitionLocation(SCOPED_SOURCE, "Beta.handle")).toEqual({
        symbol: "Beta.handle",
        line: 9,
        column: 3
      });
    }
  );

  test(
    lockedIntended(
      "an unknown symbol resolves to undefined, never a stray declaration",
      "packages/shp-checker/src/editor.ts getDefinitionLocation returns undefined when no decl matches"
    ),
    () => {
      expect(getDefinitionLocation(KNOWN_SOURCE, "Nonexistent")).toBeUndefined();
    }
  );
});

describe("#63 #48 regression: definitions inside change entries", () => {
  // A change block that ADDS a fn and a resource. The change NAME resolves
  // today; the symbols introduced INSIDE the change do not (GitHub issue #48).
  const CHANGE_SOURCE = [
    "module m", // line 1
    "", // line 2
    "component AuditStore {", // line 3
    "  fn existing", // line 4
    "    effects unknown", // line 5
    "}", // line 6
    "", // line 7
    "change AddAudit {", // line 8, "change" keyword at column 1
    "  add fn AuditStore.appendEvent", // line 9
    "    effects unknown", // line 10
    "}" // line 11
  ].join("\n");

  const CHANGE_RESOURCE_SOURCE = [
    "module m", // line 1
    "", // line 2
    "change AddAudit {", // line 3
    "  add resource AuditEvent", // line 4
    "}" // line 5
  ].join("\n");

  test(
    lockedIntended(
      "the change declaration name itself resolves to its EXACT position",
      "packages/shp-checker/src/editor.ts isChangeDecl top-level name branch (PR #47)"
    ),
    () => {
      // Derivation: `change AddAudit {` is line 8 of CHANGE_SOURCE; the `change`
      // keyword starts at column 1. This part of the editor already works.
      expect(getDefinitionLocation(CHANGE_SOURCE, "AddAudit")).toEqual({
        symbol: "AddAudit",
        line: 8,
        column: 1
      });
    }
  );

  // FINDING: run against the current implementation, the symbols added INSIDE a
  // change block (the fn `appendEvent` / `AuditStore.appendEvent`, and the
  // resource `AuditEvent`) BOTH return `undefined`. The #48 bug is still open:
  // definitionLocationForDeclaration treats a ChangeDecl as a leaf and never
  // inspects change.entries. These are recorded as `shouldBe` todos that pin the
  // EXACT location the fix must produce, so they do not hard-fail the suite.
  test.todo(
    shouldBe(
      "a fn added inside a change block resolves to its position inside the change (issue #48)",
      "GitHub issue #48; packages/shp-checker/src/editor.ts definitionLocationForDeclaration"
    ),
    () => {
      // Derivation: `add fn AuditStore.appendEvent` is line 9 of CHANGE_SOURCE;
      // the `add` keyword begins at column 3 (two-space indent inside the block).
      expect(getDefinitionLocation(CHANGE_SOURCE, "AuditStore.appendEvent")).toEqual({
        symbol: "AuditStore.appendEvent",
        line: 9,
        column: 3
      });
      expect(getDefinitionLocation(CHANGE_SOURCE, "appendEvent")).toEqual({
        symbol: "appendEvent",
        line: 9,
        column: 3
      });
    }
  );

  test.todo(
    shouldBe(
      "a resource added inside a change block resolves to its position (issue #48)",
      "GitHub issue #48; packages/shp-checker/src/editor.ts definitionLocationForDeclaration"
    ),
    () => {
      // Derivation: `add resource AuditEvent` is line 4 of CHANGE_RESOURCE_SOURCE;
      // the `add` keyword begins at column 3 (two-space indent inside the block).
      expect(getDefinitionLocation(CHANGE_RESOURCE_SOURCE, "AuditEvent")).toEqual({
        symbol: "AuditEvent",
        line: 4,
        column: 3
      });
    }
  );

  // Characterization of the CURRENT (buggy) behaviour, so the regression is
  // pinned and visible until #48 lands. When the shouldBe todos above start
  // passing, these characterizations will fail and must be deleted.
  test(
    characterization("change-added symbols currently resolve to undefined", {
      reason:
        "definitionLocationForDeclaration does not inspect ChangeDecl.entries, so symbols introduced inside a change block are skipped",
      followUp: "GitHub issue #48"
    }),
    () => {
      expect(getDefinitionLocation(CHANGE_SOURCE, "AuditStore.appendEvent")).toBeUndefined();
      expect(getDefinitionLocation(CHANGE_SOURCE, "appendEvent")).toBeUndefined();
      expect(getDefinitionLocation(CHANGE_RESOURCE_SOURCE, "AuditEvent")).toBeUndefined();
    }
  );
});

describe("#63 completions: filter, sort, dedup, prelude parity", () => {
  const COMPLETION_SOURCE = [
    "module m",
    "",
    "resource AuditEvent : AppendOnly",
    "",
    "component AuditStore {",
    "  owns AuditEvent",
    "  grants Append<AuditEvent>",
    "  fn appendEvent",
    "    effects complete {",
    "      Append<AuditEvent>",
    "    }",
    "}"
  ].join("\n");

  test(
    lockedIntended(
      "completions are filtered by prefix, sorted, and deduplicated",
      "packages/shp-checker/src/editor.ts getCompletions filter/sort over a Set"
    ),
    () => {
      const all = getCompletions(COMPLETION_SOURCE, "");
      // Sorted: equal to its own ascending sort.
      expect(all).toEqual([...all].sort());
      // Deduplicated: a Set of the results has the same cardinality.
      expect(new Set(all).size).toBe(all.length);

      // Prefix filter: every result starts with the prefix, and the declared
      // symbols under that prefix are exactly these three (resource, component,
      // and the qualified fn). No prelude symbol starts with "Audit", so this
      // isolates the declared surface.
      const audit = getCompletions(COMPLETION_SOURCE, "Audit");
      expect(audit.every((name) => name.startsWith("Audit"))).toBe(true);
      expect(audit).toEqual(["AuditEvent", "AuditStore", "AuditStore.appendEvent"]);

      // A no-match prefix returns nothing spurious.
      expect(getCompletions(COMPLETION_SOURCE, "zzzNoSuchPrefix")).toEqual([]);
    }
  );

  test(
    lockedIntended(
      "the completion union includes BOTH declared symbols AND every prelude symbol (prelude parity)",
      "shape/checker.shape:453 PreludeMetadataContract; editor and checker share PRELUDE_COMPLETION_SYMBOLS"
    ),
    () => {
      const all = getCompletions(COMPLETION_SOURCE, "");
      const set = new Set(all);

      // Declared symbols are present.
      for (const declared of [
        "AuditEvent",
        "AuditStore",
        "AuditStore.appendEvent",
        "appendEvent"
      ]) {
        expect(set.has(declared)).toBe(true);
      }

      // Prelude parity: every symbol the checker/authoring layers know from the
      // shared prelude is offered by the editor. Compared against the source of
      // truth, not a hand-copied list, so editor/checker drift fails this test.
      for (const preludeSymbol of PRELUDE_COMPLETION_SYMBOLS) {
        expect(set.has(preludeSymbol)).toBe(true);
      }
    }
  );
});

describe("#63 prelude context-obligation set surfaced by the editor", () => {
  test(
    lockedIntended(
      "every prelude context trait is offered as a completion (parity with the shared prelude)",
      "shape/checker.shape:453 PreludeMetadataContract; PRELUDE_CONTEXT_REQUIREMENTS"
    ),
    () => {
      // Parity, not a literal pin: whatever the prelude defines, the editor must
      // surface. This stays correct when TODO #15 moves the obligations into
      // Shape syntax, because it reads from the same source.
      const offered = new Set(getCompletions("", ""));
      for (const requirement of PRELUDE_CONTEXT_REQUIREMENTS) {
        expect(offered.has(requirement.trait)).toBe(true);
      }
    }
  );

  test(
    characterization("the built-in context-obligation trait set has these exact members", {
      reason:
        "the context obligations are hardcoded in PRELUDE_CONTEXT_REQUIREMENTS, not yet authored in Shape",
      followUp:
        "specs/TODO.md: Move hardcoded context obligations into Shape syntax (item under Memory Guards)"
    }),
    () => {
      // Pinning the literal CONTENTS of the built-in set is characterization: it
      // documents today's hardcoded obligations and is expected to change when
      // they move into Shape syntax. Pinned as `trait targetKind` because the
      // same trait now derives obligations on fn, component, and resource
      // targets, so the trait name alone no longer identifies an entry.
      expect(
        PRELUDE_CONTEXT_REQUIREMENTS.map((rule) => `${rule.trait} ${rule.targetKind}`)
      ).toEqual([
        "PreserveInline fn",
        "RequiresDescription fn",
        "ProtectedCheckOrder fn",
        "RefactorSensitive fn",
        "NonIdiomatic fn",
        "TestOnly fn",
        "RefactorSensitive component",
        "NonIdiomatic component",
        "TestOnly component",
        "RefactorSensitive resource",
        "NonIdiomatic resource"
      ]);
    }
  );
});

describe("#63 editor diagnostics surface parse errors with a position", () => {
  test(
    lockedIntended(
      "a syntactically broken source yields a parse diagnostic carrying a defined line and column",
      "packages/shp-checker/src/editor.ts getEditorDiagnostics parse branch maps line/column"
    ),
    () => {
      // `component {` omits the required component name. Derivation: this is line
      // 3, and the `{` token is at column 11 (`component ` is 10 characters, the
      // brace is the 11th). This is a PARSE error, not a checker error, so it
      // exercises the early parse branch of getEditorDiagnostics.
      const source = ["module m", "", "component {", "  fn x", "    effects unknown", "}"].join(
        "\n"
      );
      const diagnostics = getEditorDiagnostics(source);

      expect(diagnostics).toHaveLength(1);
      const first = diagnostics[0];
      expect(first?.severity).toBe("error");
      expect(first?.line).toBe(3);
      expect(first?.column).toBe(11);
    }
  );
});

describe("#63 hover help for prelude traits and unknown symbols", () => {
  test(
    lockedIntended(
      "hover over each prelude context trait returns non-empty structured help naming its context type",
      "shape/checker.shape:453 PreludeMetadataContract; packages/shp-checker/src/editor.ts PRELUDE_SHAPE_TRAIT_HOVERS"
    ),
    () => {
      for (const rule of PRELUDE_CONTEXT_RULES) {
        const hover = getHoverText("", rule.trait);
        expect(hover.length).toBeGreaterThan(0);
        // Structured help: names the trait, declares it a shape trait, and names
        // the context type it requires for EVERY target kind it applies to, so a
        // multi-target trait (e.g. RefactorSensitive on fn/component/resource)
        // cannot collapse to a single target kind unnoticed.
        expect(hover).toContain(rule.trait);
        expect(hover).toContain("kind: shape trait");
        for (const targetKind of rule.targetKinds) {
          expect(hover).toContain(`requires: ${rule.contextType}<${targetKind} `);
        }
        // The requires-description flag is reflected exactly as the prelude says.
        expect(hover.includes("requires description")).toBe(rule.requiresDescription === true);
      }
    }
  );

  test(
    lockedIntended(
      "hover over an unknown symbol returns a defined not-found result, not empty or an error",
      "packages/shp-checker/src/editor.ts getHoverText explain fallback"
    ),
    () => {
      const hover = getHoverText("module m\n", "DoesNotExist");
      expect(hover).toContain("No shape facts found for DoesNotExist.");
    }
  );
});

describe("#63 NEGATIVE CONTROL", () => {
  test(
    lockedIntended(
      "an ambiguous unqualified name never resolves to the wrong scope; a wrong-scope qualified lookup is undefined",
      "packages/shp-checker/src/editor.ts symbolMatches scope discipline"
    ),
    () => {
      // SCOPED_SOURCE has Alpha.handle (line 4) and Beta.handle (line 9). The
      // unqualified `handle` is genuinely ambiguous: the resolver picks the first
      // matching declaration (Alpha, line 4). The control proves it never returns
      // the OTHER (wrong) target — Beta at line 9 — and lands on a real position.
      const ambiguous = getDefinitionLocation(SCOPED_SOURCE, "handle");
      expect(ambiguous).toBeDefined();
      expect(ambiguous).not.toEqual({ symbol: "handle", line: 9, column: 3 });
      expect(ambiguous).toEqual({ symbol: "handle", line: 4, column: 3 });

      // A qualified lookup naming a component that does not exist must NOT fall
      // back to the same-named member in some other component; it is undefined.
      // (Gamma is not declared; Alpha/Beta both have `handle`.)
      expect(getDefinitionLocation(SCOPED_SOURCE, "Gamma.handle")).toBeUndefined();
    }
  );

  test(
    lockedIntended(
      "the dedup assertion is real: a list with a duplicate fails the Set-size invariant",
      "epic #53 standard: negative control must be able to fail"
    ),
    () => {
      // A constructed completion-shaped list that DOES contain a duplicate. If
      // getCompletions ever stopped deduplicating, its output would look like
      // this, and `new Set(c).size === c.length` would be false. This proves the
      // dedup assertion above can actually fail.
      const withDuplicate = ["Append", "AppendOnly", "Append"];
      expect(new Set(withDuplicate).size).not.toBe(withDuplicate.length);

      // And the real editor output, by contrast, has no duplicate.
      const real = getCompletions("module m\n", "Append");
      expect(new Set(real).size).toBe(real.length);
    }
  );
});
