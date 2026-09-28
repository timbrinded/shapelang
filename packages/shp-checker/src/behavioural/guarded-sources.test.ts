// Guards on edited function sources: an `on_change require ReEvaluation` guard
// on a function fires when the function's `source` file is in the changed-file
// list, and only a reevaluation written for this change clears it. Each firing
// case is paired with a control that differs only in the changed files or in
// whether the reevaluation is new, so a check that ignored either would fail.

import { describe, expect, test } from "bun:test";
import { checkShapeModules, type CheckModuleInput, type CheckOptions } from "../index.ts";
import {
  lockedIntended,
  parseModuleOrThrow,
  render,
  expectOrderedFragments,
  requireDiagnostic,
  requireNoDiagnostic
} from "./harness.ts";

const ANCHOR =
  "docs-site/src/content/docs/concepts/design-memory.md (When the guarded code changes)";

const editor = (extra = "", protects = "") => `module editor

resource Autosave

component Editor {
  owns Autosave
  grants Read<Autosave>
  fn listAutosaves
    source ts("src/editor/list.ts#listAutosaves")
    effects complete {
      Read<Autosave>
    }
  fn mergeAutosaves : RefactorSensitive
    source ts("src/editor/merge.ts#mergeAutosaves")
    effects complete {
      Read<Autosave>
    }
}

memory MergeRefactorConstraint : RefactorConstraint<fn Editor.mergeAutosaves> {
  applies_to fn Editor.mergeAutosaves
  status Explained
  confidence High
  summary "The sync library sends autosaves out of order, so keep the sort."
  who {
    owner EditorTeam
  }
${protects}  guards {
    on_change require ReEvaluation<Self>
  }
}
${extra}`;

const reevaluation = (summary: string, evidence = 'evidence test("src/editor/merge.test.ts")') => `
reevaluation MergeRechecked {
  satisfies memory MergeRefactorConstraint
  outcome Confirmed
  summary "${summary}"
  reviewer EditorTeam
  decided_on "2026-09-28"
  ${evidence}
}
`;

const modifyMerge = `
change RefactorMerge {
  modify fn Editor.mergeAutosaves : RefactorSensitive
    source ts("src/editor/merge.ts#mergeAutosaves")
    effects complete {
      Read<Autosave>
    }
}
`;

const input = (source: string, filePath = "shape/editor.shape"): CheckModuleInput[] => [
  { module: parseModuleOrThrow(source, filePath), filePath }
];

const check = (source: string, options: CheckOptions = {}) =>
  checkShapeModules(input(source), { repoRoot: "/repo", ...options });

describe("guards on edited function sources", () => {
  test(
    lockedIntended(
      "editing a guarded function's source file fires its guard; other files and no list do not",
      ANCHOR
    ),
    () => {
      const fired = check(editor(), { changedFiles: ["src/editor/merge.ts"] });
      const diagnostic = requireDiagnostic(fired, "guarded_source_changed");
      expect(diagnostic.changedFile).toBe("src/editor/merge.ts");
      expect(diagnostic.guard).toBe("editor::MergeRefactorConstraint");
      expect(diagnostic.target).toBe("editor::Editor.mergeAutosaves");
      expect(fired.exitCode).toBe(1);
      expectOrderedFragments(render(fired), [
        "error: guarded source changed",
        "src/editor/merge.ts changed. It is the source of fn Editor.mergeAutosaves",
        "add reevaluation satisfying memory MergeRefactorConstraint in this change",
        "caused by:",
        "shape/editor.shape: fn Editor.mergeAutosaves",
        "shape/editor.shape: memory MergeRefactorConstraint guards on_change require ReEvaluation<Self>"
      ]);

      // Controls: an unguarded file in the same component, and no list at all.
      expect(check(editor(), { changedFiles: ["src/editor/list.ts"] }).exitCode).toBe(0);
      expect(check(editor()).exitCode).toBe(0);
    }
  );

  test(
    lockedIntended(
      "with a base, only a reevaluation absent from the base clears it; one carried over does not",
      ANCHOR
    ),
    () => {
      const withReevaluation = editor(reevaluation("Sync library v5 delivers autosaves in order."));
      const changedFiles = ["src/editor/merge.ts", "shape/editor.shape"];

      const written = check(withReevaluation, {
        baseModules: input(editor()),
        changedFiles
      });
      expect(written.exitCode).toBe(0);

      const carried = check(withReevaluation, {
        baseModules: input(withReevaluation),
        changedFiles
      });
      requireDiagnostic(carried, "guarded_source_changed");

      // Rewriting the old reevaluation for a new review counts as new.
      const rewritten = check(editor(reevaluation("Rechecked after the v6 upgrade.")), {
        baseModules: input(withReevaluation),
        changedFiles
      });
      expect(rewritten.exitCode).toBe(0);
    }
  );

  test(
    lockedIntended(
      "without a base, a reevaluation counts only when its .shape file is in the changed-file list",
      ANCHOR
    ),
    () => {
      const withReevaluation = editor(reevaluation("Sync library v5 delivers autosaves in order."));
      expect(
        check(withReevaluation, { changedFiles: ["src/editor/merge.ts", "shape/editor.shape"] })
          .exitCode
      ).toBe(0);
      requireDiagnostic(
        check(withReevaluation, { changedFiles: ["src/editor/merge.ts"] }),
        "guarded_source_changed"
      );
    }
  );

  test(
    lockedIntended(
      "with a base, a guard whose memory the change adds does not fire on that change",
      ANCHOR
    ),
    () => {
      const unguarded = editor().replace(/\nmemory MergeRefactorConstraint[\s\S]*$/, "\n");
      const changedFiles = ["src/editor/merge.ts", "shape/editor.shape"];
      const added = check(editor(), { baseModules: input(unguarded), changedFiles });
      requireNoDiagnostic(added, "guarded_source_changed");

      // Control: the same memory already in the base fires.
      requireDiagnostic(
        check(editor(), { baseModules: input(editor()), changedFiles }),
        "guarded_source_changed"
      );
    }
  );

  test(lockedIntended("an invalid reevaluation does not clear it", ANCHOR), () => {
    const invalid = check(editor(reevaluation("No evidence given.", "")), {
      baseModules: input(editor()),
      changedFiles: ["src/editor/merge.ts", "shape/editor.shape"]
    });
    requireDiagnostic(invalid, "invalid_reevaluation");
    requireDiagnostic(invalid, "guarded_source_changed");
  });

  test(
    lockedIntended(
      "a guard narrowed to a description does not fire on a source edit, while an opaque protects entry does",
      ANCHOR
    ),
    () => {
      const changedFiles = ["src/editor/merge.ts"];
      const description = check(editor("", "  protects {\n    description\n  }\n"), {
        changedFiles
      });
      requireNoDiagnostic(description, "guarded_source_changed");

      const opaque = check(editor("", "  protects {\n    shape SyncOrdering\n  }\n"), {
        changedFiles
      });
      requireDiagnostic(opaque, "guarded_source_changed");
    }
  );

  test(
    lockedIntended(
      "a declared change with no reevaluation reports only guarded shape changed; with a carried-over reevaluation the source edit still fires",
      ANCHOR
    ),
    () => {
      const changedFiles = ["src/editor/merge.ts", "shape/editor.shape"];
      const declared = check(editor(modifyMerge), { changedFiles });
      requireDiagnostic(declared, "guarded_shape_changed");
      requireNoDiagnostic(declared, "guarded_source_changed");

      // An old reevaluation satisfies the declared change forever, but not the
      // edit to the guarded source.
      const old = editor(reevaluation("Reviewed in an earlier change."));
      const carried = check(`${old}${modifyMerge}`, {
        baseModules: input(old),
        changedFiles
      });
      requireNoDiagnostic(carried, "guarded_shape_changed");
      requireDiagnostic(carried, "guarded_source_changed");
    }
  );

  test(
    lockedIntended(
      "removing the guard while editing its source is reported as rule loosening",
      "docs-site/src/content/docs/reference/cli.md (Rule loosening)"
    ),
    () => {
      const unguarded = editor().replace(
        "  guards {\n    on_change require ReEvaluation<Self>\n  }\n",
        ""
      );
      const result = check(unguarded, {
        baseModules: input(editor()),
        changedFiles: ["src/editor/merge.ts", "shape/editor.shape"],
        checkLoosening: true
      });
      const loosening = requireDiagnostic(result, "rule_loosening");
      expect(loosening.edit).toBe("edits memory MergeRefactorConstraint");
      expect(loosening.silenced.map((item) => item.kind)).toEqual(["guarded_source_changed"]);
    }
  );
});
