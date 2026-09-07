import { describe, expect, test } from "bun:test";
import {
  amendReusedSkillsReport,
  findExactApprovedCandidate,
  findReusableSkillsApproval,
  isSkillsRelevantPath,
  peelGitObjectSha,
  runHasSkillsApproval,
  skillsRelevantChanges,
  type ApprovalLookup,
  type EnvironmentApproval,
  type WorkflowRun
} from "./check-release-approval";

const shaA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const shaB = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const shaC = "cccccccccccccccccccccccccccccccccccccccc";

const approved: EnvironmentApproval[] = [
  {
    state: "approved",
    environments: [{ name: "skills-release-approval" }]
  }
];

function run(partial: Partial<WorkflowRun> & Pick<WorkflowRun, "id" | "head_sha">): WorkflowRun {
  return {
    run_number: partial.id,
    head_branch: "master",
    conclusion: "success",
    ...partial
  };
}

function lookup(overrides: Partial<ApprovalLookup> & Pick<ApprovalLookup, "runs">): ApprovalLookup {
  return {
    tagSha: shaB,
    masterSha: shaB,
    pluginSha: shaB,
    approvalsForRun: () => approved,
    isAncestor: (sha, of) => sha === shaA && of === shaB,
    changedPaths: () => [],
    ...overrides
  };
}

describe("isSkillsRelevantPath", () => {
  test("treats CLI, skills, fixtures, and release-gate paths as relevant", () => {
    expect(isSkillsRelevantPath("packages/shp-cli/src/index.ts")).toBe(true);
    expect(isSkillsRelevantPath("plugins/shapelang/skills/shape-lang/SKILL.md")).toBe(true);
    expect(isSkillsRelevantPath("fixtures/fail/unknown_effects/audit.shape")).toBe(true);
    expect(isSkillsRelevantPath(".github/workflows/release.yml")).toBe(true);
    expect(isSkillsRelevantPath(".github/workflows/release-candidate.yml")).toBe(true);
    expect(isSkillsRelevantPath("scripts/check-release-approval.ts")).toBe(true);
    expect(isSkillsRelevantPath("package.json")).toBe(true);
    expect(isSkillsRelevantPath("bun.lock")).toBe(true);
  });

  test("allows docs, generated Shape, and unrelated CI to reuse an ancestor report", () => {
    expect(isSkillsRelevantPath("README.md")).toBe(false);
    expect(isSkillsRelevantPath("RELEASING.md")).toBe(false);
    expect(isSkillsRelevantPath("docs-site/src/content/docs/reference/releasing.md")).toBe(false);
    expect(isSkillsRelevantPath("docs/releases/v0.9.0.md")).toBe(false);
    expect(isSkillsRelevantPath("shape/delivery.shape")).toBe(false);
    expect(isSkillsRelevantPath(".github/workflows/shape.yml")).toBe(false);
    expect(isSkillsRelevantPath("experiments/semantic-kernel/src/lib.rs")).toBe(false);
  });
});

describe("findExactApprovedCandidate", () => {
  test("requires current master, matching plugin tag, and a successful approved run", () => {
    const selected = findExactApprovedCandidate(
      lookup({
        tagSha: shaB,
        masterSha: shaB,
        pluginSha: shaB,
        runs: [run({ id: 5, head_sha: shaA }), run({ id: 9, head_sha: shaB })]
      })
    );
    expect(selected.id).toBe(9);
  });

  test("rejects a tag that is not current master", () => {
    expect(() =>
      findExactApprovedCandidate(
        lookup({ tagSha: shaA, masterSha: shaB, pluginSha: shaA, runs: [] })
      )
    ).toThrow("not current master");
  });

  test("rejects a mismatched plugin tag", () => {
    expect(() =>
      findExactApprovedCandidate(
        lookup({ pluginSha: shaA, runs: [run({ id: 1, head_sha: shaB })] })
      )
    ).toThrow("Plugin tag");
  });

  test("rejects a successful run without skills-release-approval", () => {
    expect(() =>
      findExactApprovedCandidate(
        lookup({
          runs: [run({ id: 1, head_sha: shaB })],
          approvalsForRun: () => [{ state: "approved", environments: [{ name: "other" }] }]
        })
      )
    ).toThrow("No successful, manually approved");
  });
});

describe("findReusableSkillsApproval", () => {
  test("prefers an exact SHA run over an ancestor", () => {
    const selected = findReusableSkillsApproval(
      lookup({
        runs: [run({ id: 4, head_sha: shaA }), run({ id: 8, head_sha: shaB })]
      })
    );
    expect(selected).toEqual({
      run: run({ id: 8, head_sha: shaB }),
      mode: "exact"
    });
  });

  test("reuses an ancestor when the skills-relevant tree is unchanged", () => {
    const selected = findReusableSkillsApproval(
      lookup({
        runs: [run({ id: 4, head_sha: shaA })],
        changedPaths: () => ["README.md", "docs-site/src/content/docs/reference/releasing.md"]
      })
    );
    expect(selected?.mode).toBe("ancestor");
    expect(selected?.run.id).toBe(4);
  });

  test("does not reuse an ancestor when a skills-relevant path changed", () => {
    const selected = findReusableSkillsApproval(
      lookup({
        runs: [run({ id: 4, head_sha: shaA })],
        changedPaths: () => ["packages/shp-cli/src/app.ts", "README.md"]
      })
    );
    expect(selected).toBeUndefined();
  });

  test("does not reuse a non-ancestor SHA", () => {
    const selected = findReusableSkillsApproval(
      lookup({
        tagSha: shaC,
        runs: [run({ id: 4, head_sha: shaA })],
        isAncestor: () => false
      })
    );
    expect(selected).toBeUndefined();
  });
});

describe("peelGitObjectSha", () => {
  test("returns a lightweight tag commit directly", () => {
    expect(peelGitObjectSha({ object: { sha: shaA, type: "commit" } })).toBe(shaA);
  });

  test("peels an annotated tag to its commit", () => {
    expect(
      peelGitObjectSha(
        { object: { sha: "tagobject", type: "tag" } },
        { object: { sha: shaB, type: "commit" } }
      )
    ).toBe(shaB);
  });
});

describe("runHasSkillsApproval", () => {
  test("requires an approved review of skills-release-approval", () => {
    expect(runHasSkillsApproval(approved)).toBe(true);
    expect(
      runHasSkillsApproval([
        { state: "pending", environments: [{ name: "skills-release-approval" }] }
      ])
    ).toBe(false);
  });
});

describe("amendReusedSkillsReport", () => {
  test("prefixes the original summary without dropping it", () => {
    const amended = amendReusedSkillsReport(
      { status: "pass", summary: "All six skills passed." },
      { run: run({ id: 4, head_sha: shaA }), mode: "ancestor" }
    );
    expect(String(amended.summary)).toContain("All six skills passed.");
    expect(String(amended.summary)).toContain(shaA);
    expect(String(amended.summary)).toContain("ancestor");
  });
});

describe("skillsRelevantChanges", () => {
  test("deduplicates and sorts matching paths", () => {
    expect(
      skillsRelevantChanges([
        "README.md",
        "packages/shp-cli/src/index.ts",
        "packages/shp-cli/src/index.ts"
      ])
    ).toEqual(["packages/shp-cli/src/index.ts"]);
  });
});
