import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { captureProcess } from "../../../../shp-ts-contract/src/gate/process.ts";

const root = resolve(import.meta.dir, "../../../../..");
const cli = resolve(root, "packages/shp-cli/src/index.ts");

async function invoke(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const result = await captureProcess(process.execPath, [cli, ...args], root);
  return { code: result.exitCode, stdout: result.stdout, stderr: result.stderr };
}

describe("TypeScript contract CLI opt-in", () => {
  test("registers a separate command with explicit configuration and execution consent", async () => {
    const help = await invoke(["ts-contract", "--help"]);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain("--config");
    expect(help.stdout).toContain("--run-external-code");
    const missing = await invoke(["ts-contract"]);
    expect(missing.code).toBe(2);
    expect(missing.stderr).toContain("config");
  });

  test("requires execution consent before trying to read the supplied configuration", async () => {
    const result = await invoke(["ts-contract", "--config", "missing-contract-config.json"]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("error: consent_required");
    expect(result.stderr).not.toContain("unreadable_config");
    expect(result.stdout).toBe("");
  });

  test("routes an unreadable gate input to stderr with a failing exit status", async () => {
    const result = await invoke([
      "ts-contract",
      "--config",
      "missing-contract-config.json",
      "--run-external-code"
    ]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("error: unreadable_config");
    expect(result.stderr).toContain("missing-contract-config.json");
    expect(result.stdout).toBe("");
  });

  test("ordinary Shape checking stays independent of TypeScript mapper registration", async () => {
    const result = await invoke(["check", "fixtures/pass/append_only_append/audit.shape"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("Shape check passed.\n");
    expect(result.stderr).toBe("");
  });
});
