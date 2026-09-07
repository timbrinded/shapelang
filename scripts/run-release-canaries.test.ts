import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import {
  canaryFailureMessage,
  loadReleaseCanaryCases,
  rewriteCanaryCommand,
  type CanaryCommandResult
} from "./run-release-canaries";

function result(
  partial: Pick<CanaryCommandResult, "id" | "status" | "allowedExits"> &
    Partial<CanaryCommandResult>
): CanaryCommandResult {
  return {
    skill: "shape-lang",
    command: "bun shp check fixtures/fail/unknown_effects/audit.shape",
    rewritten: "/tmp/shp check fixtures/fail/unknown_effects/audit.shape",
    stderr: "",
    ...partial
  };
}

describe("loadReleaseCanaryCases", () => {
  test("loads every committed skill canary command and expected exits", () => {
    const cases = loadReleaseCanaryCases(resolve(import.meta.dir, ".."));
    const draft = cases.find((item) => item.id === "lang-draft-strict");
    expect(draft?.expectedExits).toEqual([[0], [1]]);
    expect(cases.some((item) => item.id === "visualiser-unignored-output")).toBe(true);
    expect(
      cases.flatMap((item) => item.commands).some((command) => command.startsWith("bun shp"))
    ).toBe(true);
  });
});

describe("rewriteCanaryCommand", () => {
  test("points bun shp and visualiser --shape-command at the packed binary", () => {
    expect(
      rewriteCanaryCommand("bun shp check fixtures/fail/unknown_effects/audit.shape", "/tmp/shp")
    ).toBe("/tmp/shp check fixtures/fail/unknown_effects/audit.shape");
    expect(
      rewriteCanaryCommand(
        'bun plugins/shapelang/skills/unix-system-visualiser/scripts/generate.mjs --shape-command "bun ../../../../packages/shp-cli/src/index.ts"',
        "/tmp/shp"
      )
    ).toBe(
      'bun plugins/shapelang/skills/unix-system-visualiser/scripts/generate.mjs --shape-command "/tmp/shp"'
    );
  });
});

describe("canaryFailureMessage", () => {
  test("rejects a pass exit on a fail fixture", () => {
    expect(
      canaryFailureMessage([
        result({
          id: "lang-final-forbid",
          status: 0,
          allowedExits: [1]
        })
      ])
    ).toContain("exited 0, expected 1");
  });

  test("accepts the configured fail-fixture exit", () => {
    expect(
      canaryFailureMessage([
        result({
          id: "lang-final-forbid",
          status: 1,
          allowedExits: [1],
          stderr: "unknown effects"
        })
      ])
    ).toBeUndefined();
  });

  test("rejects a missing executable", () => {
    expect(
      canaryFailureMessage([
        result({
          id: "lang-draft-strict",
          status: 127,
          allowedExits: [0],
          stderr: "not found"
        })
      ])
    ).toContain("could not execute");
  });
});
