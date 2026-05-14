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
      "fixtures/fail/append_only_hard_delete/audit.shp"
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("error: forbidden effect");
    expect(result.stderr).toContain("AuditStore.purgeOldEvents");
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
