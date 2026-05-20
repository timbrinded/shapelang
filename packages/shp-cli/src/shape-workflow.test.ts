import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "../../..");
const gateScriptPath = resolve(repoRoot, ".github/scripts/check-copilot-shape-review.mjs");

describe("Shape workflow", () => {
  test("fails Copilot review gate when a pass result includes findings", async () => {
    const result = await runCopilotReviewGate({
      status: "pass",
      summary: "No drift found.",
      findings: [
        {
          path: "shape/audit.shape",
          message: "Shape contract drift was reported."
        }
      ]
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("findings");
  });

  test("fails Copilot review gate when findings are missing", async () => {
    const result = await runCopilotReviewGate({
      status: "pass",
      summary: "No drift found."
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("findings must be an array");
  });

  test("passes Copilot review gate when a pass result has no findings", async () => {
    const result = await runCopilotReviewGate({
      status: "pass",
      summary: "No drift found.",
      findings: []
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.summary).toContain("Status: `pass`");
    expect(result.summary).toContain("Findings: 0");
  });
});

async function runCopilotReviewGate(review: unknown): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
  summary: string;
}> {
  const tempDir = await mkdtemp(join(tmpdir(), "shape-copilot-review-"));
  try {
    const summaryPath = join(tempDir, "summary.md");

    await Bun.write(join(tempDir, "copilot-shape-review.json"), JSON.stringify(review));
    await Bun.write(summaryPath, "");

    const child = Bun.spawn(["node", gateScriptPath], {
      cwd: tempDir,
      env: {
        ...process.env,
        GITHUB_STEP_SUMMARY: summaryPath
      },
      stdout: "pipe",
      stderr: "pipe"
    });

    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text()
    ]);

    return {
      exitCode,
      stdout,
      stderr,
      summary: await Bun.file(summaryPath).text()
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
