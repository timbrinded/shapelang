import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "../../..");
const cliPath = resolve(repoRoot, "packages/shp-cli/src/index.ts");

describe("shp CLI", () => {
  test("checks default shape/system files", async () => {
    const result = await runCli(["check"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Shape check passed");
    expect(result.stderr).toBe("");
  });

  test("returns exit code 1 for semantic violations", async () => {
    const result = await runCli([
      "check",
      "fixtures/fail/append_only_hard_delete/audit.shape"
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("error: forbidden effect");
    expect(result.stderr).toContain("AuditStore.purgeOldEvents");
    expect(result.stdout).toBe("");
  });

  test("runs coverage with changed-file input", async () => {
    const result = await runCli([
      "coverage",
      "--changed-files",
      "fixtures/changed/audit_purge.txt",
      "fixtures/fail/missing_shape_delta/audit.shape"
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("governed source changed without shape delta");
    expect(result.stderr).toContain("src/audit/purge.ts");
    expect(result.stdout).toBe("");
  });

  test("checks formatting", async () => {
    const result = await runCli(["fmt", "--check", "fixtures/pass/append_only_append/audit.shape"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Shape format check passed");
    expect(result.stderr).toBe("");
  });

  test("generates authoring scaffolds", async () => {
    const result = await runCli([
      "author",
      "--changed-files",
      "fixtures/changed/audit_purge.txt",
      "--component",
      "AuditStore",
      "--change",
      "ReviewAuditChange",
      "--module",
      "changes.PR_001"
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("module changes.PR_001");
    expect(result.stdout).toContain("change ReviewAuditChange");
    expect(result.stdout).toContain("effects unknown");
    expect(result.stderr).toBe("");
  });

  test("lists memory guards", async () => {
    const result = await runCli([
      "memory",
      "fixtures/pass/memory_guard_modify_with_reevaluation/audit.shape"
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Memory Guards");
    expect(result.stdout).toContain("memory DoNotTouchDecisionShape");
    expect(result.stdout).toContain("status: Unexplained");
    expect(result.stderr).toBe("");
  });

  test("lists open obligations", async () => {
    const result = await runCli([
      "obligations",
      "fixtures/fail/memory_guard_missing_rationale/audit.shape"
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Open Shape Obligations");
    expect(result.stdout).toContain("missing context");
    expect(result.stdout).toContain("InlineRationale<fn Gateway.derivePolicyDecision>");
    expect(result.stderr).toBe("");
  });

  test("runs source analyzer with shape comparison", async () => {
    const result = await runCli([
      "analyze",
      "--shape-files",
      "shape/system/audit.shape",
      "fixtures/source/audit_purge.ts"
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("missing from shape effects");
    expect(result.stderr).toContain("HardDelete");
    expect(result.stdout).toBe("");
  });
});

async function runCli(args: string[]): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}> {
  const process = Bun.spawn(["bun", cliPath, ...args], {
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe"
  });

  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text()
  ]);

  return { exitCode, stdout, stderr };
}
