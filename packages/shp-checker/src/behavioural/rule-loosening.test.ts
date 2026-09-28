// Rule loosening: `checkLoosening` reports an edit to the rule layer when putting
// that edit back to its base version makes the check fail. Each case is a
// committed before/after pair under fixtures/loosening, written in the docs'
// writing-app example. Every reported case is paired with a control: the same
// head passes without `checkLoosening`, so the failure comes from this check,
// and the base passes, so the silenced error is new in the change.

import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { Glob } from "bun";
import {
  checkShapeModules,
  requireIsoCalendarDate,
  type CheckModuleInput,
  type CheckOptions,
  type CheckResult,
  type SemanticDiagnostic
} from "../index.ts";
import {
  characterization,
  expectOrderedFragments,
  lockedIntended,
  parseModuleOrThrow,
  render,
  requireDiagnostic,
  requireNoDiagnostic
} from "./harness.ts";

const repoRoot = resolve(import.meta.dir, "../../../..");
const CLI_DOCS = "docs-site/src/content/docs/reference/cli.md (Rule loosening)";

async function side(fixture: string, which: "base" | "head"): Promise<CheckModuleInput[]> {
  const directory = resolve(repoRoot, "fixtures/loosening", fixture, which, "shape");
  const inputs: CheckModuleInput[] = [];
  for await (const path of new Glob("*.shape").scan({ cwd: directory })) {
    const filePath = `shape/${basename(path)}`;
    const source = await readFile(resolve(directory, path), "utf8");
    inputs.push({ module: parseModuleOrThrow(source, filePath), filePath, origin: "authored" });
  }
  return inputs.toSorted((left, right) =>
    (left.filePath ?? "").localeCompare(right.filePath ?? "")
  );
}

async function lines(fixture: string, file: string): Promise<string[] | undefined> {
  const path = resolve(repoRoot, "fixtures/loosening", fixture, file);
  const text = await readFile(path, "utf8").catch(() => undefined);
  return text
    ?.split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

type Checked = { base: CheckResult; head: CheckResult; loosening: CheckResult };

async function checkFixture(fixture: string, options: CheckOptions = {}): Promise<Checked> {
  const base = await side(fixture, "base");
  const head = await side(fixture, "head");
  const changedFiles = await lines(fixture, "changed-files.txt");
  const shared: CheckOptions = { changedFiles, repoRoot, ...options };
  return {
    // The base on its own, before this change's files changed.
    base: checkShapeModules(base, { repoRoot, ...options }),
    head: checkShapeModules(head, { ...shared, baseModules: base }),
    loosening: checkShapeModules(head, { ...shared, baseModules: base, checkLoosening: true })
  };
}

function loosenings(
  result: CheckResult
): Extract<SemanticDiagnostic, { kind: "rule_loosening" }>[] {
  return result.diagnostics.filter(
    (diagnostic): diagnostic is Extract<SemanticDiagnostic, { kind: "rule_loosening" }> =>
      diagnostic.kind === "rule_loosening"
  );
}

describe("rule loosening", () => {
  // Each sidestep removes or edits one piece of the rule layer so that the
  // change it carries passes. `edit` is what the checker must say the change
  // did; `silenced` is the error the base version of that piece raises, with
  // the field that ties it to this fixture's change.
  const sidesteps: {
    fixture: string;
    edit: string;
    silenced: SemanticDiagnostic["kind"];
    subject: (diagnostic: SemanticDiagnostic) => string | undefined;
    expected: string;
  }[] = [
    {
      fixture: "trait_removed_from_resource",
      edit: "removes trait AppendOnly from resource Revision",
      silenced: "final_forbidden_effect",
      subject: (d) => (d.kind === "final_forbidden_effect" ? d.functionName : undefined),
      expected: "purgeOldRevisions"
    },
    {
      fixture: "rule_removed",
      edit: "removes rule protected_revisions_are_not_deleted",
      silenced: "final_forbidden_effect",
      subject: (d) => (d.kind === "final_forbidden_effect" ? d.functionName : undefined),
      expected: "purgeOldRevisions"
    },
    {
      fixture: "draft_trait_removed",
      edit: "removes trait DraftOnly from resource PrivateDraft",
      silenced: "final_forbidden_effect",
      subject: (d) => (d.kind === "final_forbidden_effect" ? d.effect : undefined),
      expected: "Export"
    },
    {
      fixture: "path_rule_removed",
      edit: "removes rule no_feed_to_drafts",
      silenced: "forbidden_path",
      subject: (d) =>
        d.kind === "forbidden_path" ? d.steps.map((step) => step.relation).join(",") : undefined,
      expected: "feed::FeedCallsRecommender,feed::RecommenderProvidesDrafts"
    },
    {
      fixture: "path_rule_narrowed",
      edit: "edits rule no_feed_to_drafts",
      silenced: "forbidden_path",
      subject: (d) => (d.kind === "forbidden_path" ? d.kinds.join(",") : undefined),
      expected: "calls,provides"
    },
    {
      fixture: "memory_guard_removed",
      edit: "edits memory MergeRefactorConstraint",
      silenced: "guarded_shape_changed",
      subject: (d) => (d.kind === "guarded_shape_changed" ? d.target : undefined),
      expected: "editor::Editor.mergeAutosaves"
    },
    {
      fixture: "memory_and_trait_removed",
      edit: "removes memory MergeRefactorConstraint",
      silenced: "guarded_shape_changed",
      subject: (d) => (d.kind === "guarded_shape_changed" ? d.target : undefined),
      expected: "editor::Editor.mergeAutosaves"
    },
    {
      fixture: "governed_paths_narrowed",
      edit: "edits implementation SharingImpl",
      silenced: "missing_shape_update",
      subject: (d) => (d.kind === "missing_shape_update" ? d.changedFile : undefined),
      expected: "src/share/button.ts"
    }
  ];

  for (const sidestep of sidesteps) {
    test(
      lockedIntended(
        `${sidestep.fixture}: the edit is reported with the ${sidestep.silenced} it silences`,
        CLI_DOCS
      ),
      async () => {
        const { base, head, loosening } = await checkFixture(sidestep.fixture);
        // Controls: the base is a passing model, and the head passes without
        // the loosening check, so the edit is what lets the change through.
        expect(base.exitCode).toBe(0);
        expect(head.exitCode).toBe(0);

        expect(loosening.exitCode).toBe(1);
        const [reported, ...rest] = loosenings(loosening);
        expect(rest).toHaveLength(0);
        expect(reported?.edit).toBe(sidestep.edit);
        const silenced = reported?.silenced.find((item) => item.kind === sidestep.silenced);
        expect(silenced === undefined ? undefined : sidestep.subject(silenced)).toBe(
          sidestep.expected
        );
      }
    );
  }

  test(
    lockedIntended(
      "the report quotes the silenced error between the edit and the fix, then cites the base and head declarations",
      "docs-site/src/content/docs/reference/diagnostics.md (error: rule loosening)"
    ),
    async () => {
      const { loosening } = await checkFixture("trait_removed_from_resource");
      requireDiagnostic(loosening, "rule_loosening");
      expectOrderedFragments(render(loosening), [
        "error: rule loosening",
        "This change removes trait AppendOnly from resource Revision.",
        "With the base version restored, the check fails:",
        "  error: forbidden effect",
        "  RevisionLog.purgeOldRevisions emits HardDelete<Revision>.",
        "Restore the base version",
        "caused by:",
        "  - base shape/history.shape: resource Revision : AppendOnly",
        "  - shape/history.shape: resource Revision"
      ]);
    }
  );

  test(
    lockedIntended(
      "a removed rule that the change does not depend on is not reported, while the same removal under a change that needs it is",
      CLI_DOCS
    ),
    async () => {
      const unused = await checkFixture("unused_rule_removed");
      expect(unused.loosening.exitCode).toBe(0);
      requireNoDiagnostic(unused.loosening, "rule_loosening");

      // Control: the same rule removed alongside a new feed-to-recommender call.
      const used = await checkFixture("path_rule_removed");
      expect(loosenings(used.loosening).map((diagnostic) => diagnostic.edit)).toEqual([
        "removes rule no_feed_to_drafts"
      ]);
    }
  );

  test(
    lockedIntended("added rules and neutral additions are never reported", CLI_DOCS),
    async () => {
      for (const fixture of ["rule_added", "read_only_function_added"]) {
        const { loosening } = await checkFixture(fixture);
        expect(loosening.exitCode).toBe(0);
        requireNoDiagnostic(loosening, "rule_loosening");
      }
    }
  );

  test(
    lockedIntended(
      "a rule moved to another file of its module, or renamed along with the component it names, is not reported",
      CLI_DOCS
    ),
    async () => {
      for (const fixture of ["rule_moved_between_files", "renamed_component"]) {
        const { loosening } = await checkFixture(fixture);
        expect(loosening.exitCode).toBe(0);
        requireNoDiagnostic(loosening, "rule_loosening");
      }
    }
  );

  test(
    lockedIntended(
      "errors that return only when several edits are restored together are reported once, naming every edit",
      CLI_DOCS
    ),
    async () => {
      const { head, loosening } = await checkFixture("rule_and_trait_removed_together");
      expect(head.exitCode).toBe(0);
      const reported = loosenings(loosening);
      expect(reported).toHaveLength(1);
      expect(reported[0]?.edit).toBe(
        "makes these rule changes together: removes trait Protected from resource Revision; removes rule protected_revisions_are_not_deleted"
      );
      expect(reported[0]?.silenced.map((item) => item.kind)).toEqual(["final_forbidden_effect"]);
    }
  );

  test(
    lockedIntended(
      "with the repository file list, narrowing governed paths away from deleted files is not reported; without it, it is",
      CLI_DOCS
    ),
    async () => {
      const repositoryFiles = await lines("governed_directory_moved", "repository.txt");
      expect(repositoryFiles).not.toContain("src/share/public.ts");
      const withList = await checkFixture("governed_directory_moved", { repositoryFiles });
      requireNoDiagnostic(withList.loosening, "rule_loosening");

      const withoutList = await checkFixture("governed_directory_moved");
      const silenced = requireDiagnostic(withoutList.loosening, "rule_loosening").silenced;
      expect(
        silenced.map((item) =>
          item.kind === "missing_shape_update" ? item.changedFile : item.kind
        )
      ).toEqual(["src/share/public.ts"]);
    }
  );

  test(
    lockedIntended(
      "rules untouched: a change that fails, or a model that leaves out or misdescribes the code, reports no loosening",
      CLI_DOCS
    ),
    async () => {
      const grant = await checkFixture("grant_added");
      requireDiagnostic(grant.loosening, "final_forbidden_effect");
      requireNoDiagnostic(grant.loosening, "rule_loosening");

      const unknown = await checkFixture("effects_unknown");
      requireDiagnostic(unknown.loosening, "unknown_effects");
      requireNoDiagnostic(unknown.loosening, "rule_loosening");

      for (const fixture of [
        "relation_left_out",
        "claim_misdescribes_code",
        "guarded_fn_edited_in_place"
      ]) {
        const { loosening } = await checkFixture(fixture);
        expect(loosening.exitCode).toBe(0);
      }
    }
  );

  test(
    characterization(
      `a rule narrowed in the same change that renames the component it names is not compared (${CLI_DOCS})`,
      {
        reason:
          "the restored base rule names the old component, which reports unknown_name, and name errors do not count",
        followUp: "resolve renames before restoring a rule"
      }
    ),
    async () => {
      const { head, loosening } = await checkFixture("renamed_component_and_narrowed_rule");
      // The change adds a calls relation from the renamed feed, which the base
      // rule's "calls or provides" would forbid, yet nothing is reported.
      expect(head.exitCode).toBe(0);
      requireNoDiagnostic(loosening, "rule_loosening");
    }
  );

  const staleMemoryBase = `module editor

resource Autosave

component Editor {
  owns Autosave
  grants Read<Autosave>
  fn mergeAutosaves : RefactorSensitive
    effects complete {
      Read<Autosave>
    }
}

memory MergeRefactorConstraint : RefactorConstraint<fn Editor.mergeAutosaves> {
  applies_to fn Editor.mergeAutosaves
  status Explained
  confidence High
  summary "The sync library sends autosaves out of order, so keep the sort."
  when {
    review_by "2026-03-01"
  }
}
`;

  test(
    lockedIntended(
      "moving review_by forward after a review is not reported, though the base version is stale",
      CLI_DOCS
    ),
    () => {
      const base = [
        {
          module: parseModuleOrThrow(staleMemoryBase, "shape/editor.shape"),
          filePath: "shape/editor.shape"
        }
      ];
      const reviewed = staleMemoryBase.replace('"2026-03-01"', '"2027-03-01"');
      const head = [
        {
          module: parseModuleOrThrow(reviewed, "shape/editor.shape"),
          filePath: "shape/editor.shape"
        }
      ];
      const options: CheckOptions = {
        baseModules: base,
        freshnessDate: requireIsoCalendarDate("2026-06-01"),
        repoRoot
      };

      // Control: the base memory is stale on this date, so the error is live.
      requireDiagnostic(checkShapeModules(base, options), "stale_memory");
      const result = checkShapeModules(head, { ...options, checkLoosening: true });
      expect(result.exitCode).toBe(0);
      requireNoDiagnostic(result, "rule_loosening");
    }
  );

  test(lockedIntended("checkLoosening needs a base model", CLI_DOCS), async () => {
    const head = await side("trait_removed_from_resource", "head");
    expect(() => checkShapeModules(head, { checkLoosening: true })).toThrow(
      "CheckOptions.checkLoosening requires CheckOptions.baseModules"
    );
  });
});
