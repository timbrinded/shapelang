import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import {
  canaryFailureMessage,
  expectedCanaryStatuses,
  loadReleaseCanaryCases,
  rewriteCanaryCommand,
  type CanaryCommandResult
} from "./run-release-canaries";

describe("loadReleaseCanaryCases", () => {
  test("loads every committed skill canary command", () => {
    const cases = loadReleaseCanaryCases(resolve(import.meta.dir, ".."));
    expect(cases.some((item) => item.id === "lang-draft-strict")).toBe(true);
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
  test("accepts configured non-zero exits for fail fixtures", () => {
    const result: CanaryCommandResult = {
      skill: "shape-lang",
      id: "lang-final-forbid",
      command:
        "bun shp check fixtures/fail/memory_guard_does_not_override_final_forbid/audit.shape",
      rewritten:
        "/tmp/shp check fixtures/fail/memory_guard_does_not_override_final_forbid/audit.shape",
      status: 1,
      stdout: "",
      stderr: "unknown effects"
    };
    expect(canaryFailureMessage([result])).toBeUndefined();
    expect(expectedCanaryStatuses("visualiser-unignored-output").requireNonZero).toBe(true);
  });

  test("rejects a missing executable", () => {
    const result: CanaryCommandResult = {
      skill: "shape-lang",
      id: "lang-draft-strict",
      command: "bun shp check fixtures/fail/unknown_effects/audit.shape",
      rewritten: "/tmp/shp check fixtures/fail/unknown_effects/audit.shape",
      status: 127,
      stdout: "",
      stderr: "not found"
    };
    expect(canaryFailureMessage([result])).toContain("could not execute");
  });
});
