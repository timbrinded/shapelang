import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderCheckReport } from "./report-pr-check.ts";

test("reports source coverage and stale evidence as readable, located failures", () => {
  const result = renderCheckReport(
    {
      ok: false,
      diagnostics: [
        {
          kind: "attestation_error",
          code: "stale",
          message: "Attestation base/head does not match the checked transition."
        },
        {
          kind: "missing_shape_update",
          changedFile: "src/audit.ts",
          implementation: "audit::AuditStore",
          glob: "src/**",
          filePath: "shape/audit.shape",
          causedBy: ["shape/audit.shape: implementation AuditStore"]
        }
      ]
    },
    1
  );
  expect(result.text).toContain("Attestation base/head does not match");
  expect(result.text).toContain("Governed by: audit::AuditStore");
  expect(result.annotations[0]).not.toContain("file=");
  expect(result.annotations[1]).toContain("file=src/audit.ts::");
  expect(result.annotations[1]).not.toContain("line=");
  expect(result.markdown).toContain("caused by:");
  expect(result.markdown).not.toContain('"diagnostics"');
});

test("preserves parser locations, warning severity and empty failure status", () => {
  expect(
    renderCheckReport(
      {
        ok: false,
        diagnostics: [
          {
            kind: "parse",
            filePath: "shape/app.shape",
            line: 3,
            column: 7,
            message: "Unexpected token"
          }
        ]
      },
      2
    ).annotations[0]
  ).toContain("file=shape/app.shape,line=3,col=7::");
  const warning = renderCheckReport(
    {
      ok: true,
      diagnostics: [
        {
          kind: "unknown_effects",
          severity: "warning",
          component: "app::App",
          functionName: "run",
          causedBy: []
        }
      ]
    },
    0
  );
  expect(warning.text).toContain("check: passed");
  expect(warning.annotations[0]).toStartWith("::warning ");
  expect(renderCheckReport({ ok: true, diagnostics: [] }, 1).text).toContain("check: failed");
  expect(() => renderCheckReport({}, 0)).toThrow("Missing or invalid check.json");
});

test("escapes command properties, message newlines and Markdown fences", () => {
  const report = renderCheckReport(
    {
      ok: false,
      diagnostics: [
        {
          kind: "check_input_error",
          filePath: "src/a%,:b\r\nc.ts",
          message: "```\n::error::injected\n100%\r\n```"
        }
      ]
    },
    2
  );
  expect(report.annotations).toHaveLength(1);
  expect(report.annotations[0]).toContain("file=src/a%25%2C%3Ab%0D%0Ac.ts");
  expect(report.annotations[0]).toContain("%0A::error::injected%0A100%25%0D%0A");
  expect(report.annotations[0]).not.toContain("\n");
  expect(report.markdown).toContain("````text\n");
});

test("workflow preserves failing exit codes, prints safely and publishes a summary even without JSON", async () => {
  const directory = await mkdtemp(join(tmpdir(), "shape-ci-report-"));
  try {
    const workflow = Bun.YAML.parse(
      await Bun.file(join(import.meta.dir, "../docs/examples/pr-enforcement.yml")).text()
    ) as { jobs: { deterministic: { steps: { name?: string; run?: string }[] } } };
    const checkStep = workflow.jobs.deterministic.steps.find(
      (step) => step.name === "Check exact transition and current PR body"
    )!.run!;
    const summaryStep = workflow.jobs.deterministic.steps.find(
      (step) => step.name === "Publish deterministic result"
    )!.run!;
    const output = join(directory, "shape-enforcement");
    const env = {
      ...process.env,
      SHAPE_OUTPUT_DIR: output,
      RUNNER_TEMP: directory,
      GITHUB_STEP_SUMMARY: join(directory, "summary.md"),
      GITHUB_ACTIONS: "true"
    };
    for (const status of [0, 1, 2]) {
      await Bun.write(
        join(output, "check.json"),
        JSON.stringify({
          ok: status === 0,
          diagnostics: status
            ? [{ kind: "check_input_error", message: "Example failure\n::error::injected" }]
            : []
        })
      );
      const run = Bun.spawnSync(
        ["bash", "-e", "-c", checkStep.replace("bun scripts/check-pr.ts", `(exit ${status})`)],
        { cwd: join(import.meta.dir, ".."), env }
      );
      expect(run.exitCode).toBe(status);
      const log = run.stdout.toString();
      expect(log).toContain("::stop-commands::");
      expect(log).toContain(status ? "check: failed" : "check: passed");
      const token = log.split("\n")[0]!.replace("::stop-commands::", "");
      const commands = log.split(`::${token}::\n`)[1]!;
      expect(commands.includes("::error title=")).toBe(status !== 0);
      expect(commands).not.toContain("\n::error::injected");
      expect(Bun.spawnSync(["bash", "-e", "-c", summaryStep], { env }).exitCode).toBe(0);
    }
    await rm(join(output, "check.json"));
    const missing = Bun.spawnSync(
      [process.execPath, join(import.meta.dir, "report-pr-check.ts"), "0"],
      { env }
    );
    expect(missing.exitCode).toBe(1);
    expect(await Bun.file(join(output, "check.md")).text()).toContain("check: failed");
    expect(await Bun.file(env.GITHUB_STEP_SUMMARY).text()).toContain("Example failure");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
