import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = resolve(import.meta.dir, "../../..");
const gateScriptPath = resolve(repoRoot, ".github/scripts/check-claude-shape-review.mjs");
const extractScriptPath = resolve(repoRoot, ".github/scripts/extract-claude-shape-review.mjs");
const upsertCommentScriptPath = resolve(repoRoot, ".github/scripts/upsert-shape-ci-comment.mjs");
const guardGateScriptPath = resolve(repoRoot, ".github/scripts/check-claude-shape-guard.mjs");
const indexGateScriptPath = resolve(repoRoot, ".github/scripts/check-claude-shape-index.mjs");
const guardRunScriptPath = resolve(repoRoot, ".github/scripts/run-claude-shape-guard.mjs");
const indexRunScriptPath = resolve(repoRoot, ".github/scripts/run-claude-shape-index.mjs");

describe("Shape workflow", () => {
  test("fails Claude review gate when a pass result includes findings", async () => {
    const result = await runClaudeReviewGate({
      status: "pass",
      summary: "No drift found.",
      findings: [
        {
          severity: "warning",
          target: "packages/shp-checker/src/checker.ts",
          shape_source: "shape/checker.shape",
          issue: "Shape contract drift was reported.",
          reason: "The review cannot pass while carrying a finding.",
          source_quote: "changed source",
          shape_quote: "shape source",
          suggested_fix: "Update the Shape model."
        }
      ]
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("findings");
  });

  test("fails Claude review gate when findings are missing", async () => {
    const result = await runClaudeReviewGate({
      status: "pass",
      summary: "No drift found."
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("findings must be an array");
  });

  test("passes Claude review gate when a pass result has no findings", async () => {
    const result = await runClaudeReviewGate({
      status: "pass",
      summary: "No drift found.",
      findings: []
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.summary).toContain("Status: `pass`");
    expect(result.summary).toContain("Findings: 0");
  });

  test("passes Claude review gate with an environment result override", async () => {
    const result = await runClaudeReviewGate(
      {
        status: "pass",
        summary: "No drift found.",
        findings: []
      },
      { useStructuredOutput: true }
    );

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.summary).toContain("Shape Claude Review");
  });

  test("extracts Claude structured output through the shared Shape review contract", async () => {
    const result = await runClaudeReviewExtractor({
      structured_output: passReview("No drift found.")
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("structured output source: structured_output");
    expect(result.githubOutput).toContain("structured_output=");
    expect(result.githubOutput).toContain('"status":"pass"');
  });

  test("rejects prose-wrapped Claude text instead of scraping braces from it", async () => {
    const result = await runClaudeReviewExtractor({
      result: `Here is the review: ${JSON.stringify(passReview("No drift found."))}`
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("did not include a valid Shape review object");
    expect(result.githubOutput).toBe("");
  });

  test("builds and upserts Shape CI comments through focused helpers", async () => {
    const result = await runNodeModuleProbe(`
      import {
        buildShapeCiComment,
        createGitHubClient,
        selectExistingShapeCiComment
      } from ${JSON.stringify(pathToFileURL(upsertCommentScriptPath).href)};

      const selected = selectExistingShapeCiComment([
        { id: 1, body: "<!-- shape-ci-summary -->", user: { login: "maintainer" } },
        { id: 2, body: "<!-- shape-ci-summary -->", user: { login: "github-actions[bot]" } }
      ]);
      const body = buildShapeCiComment({
        claudeAvailable: "false",
        headSha: "abcdef123456",
        prNumber: "72",
        repository: "timbrinded/shapelang",
        runId: "1234",
        serverUrl: "https://github.com",
        shapeClaudeReviewResult: "skipped",
        shapeResult: "success"
      });

      let contentType;
      const request = createGitHubClient({
        token: "token",
        fetchImpl: async (_url, options) => {
          contentType = options.headers["content-type"];
          return { ok: true, status: 200, json: async () => ({ id: 3 }) };
        }
      });
      await request("/repos/timbrinded/shapelang/issues/72/comments", {
        method: "POST",
        body: JSON.stringify({ body })
      });

      console.log(JSON.stringify({
        selectedId: selected?.id,
        contentType,
        bodyIncludesSkipped: body.includes("skipped (no Claude credential)")
      }));
    `);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      selectedId: 2,
      contentType: "application/json",
      bodyIncludesSkipped: true
    });
  });

  test("fails Shape guard gate on a high-severity finding", async () => {
    const result = await runResultGate(guardGateScriptPath, {
      status: "advisory",
      summary: "AppendOnly was removed while HardDelete was granted.",
      findings: [guardFinding("high")]
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("high-severity");
  });

  test("passes Shape guard gate with only medium and low advisory findings", async () => {
    const result = await runResultGate(guardGateScriptPath, {
      status: "advisory",
      summary: "Broad authority was added with generic justification.",
      findings: [guardFinding("medium"), guardFinding("low")]
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("non-blocking");
    expect(result.summary).toContain("Status: `advisory`");
    expect(result.summary).toContain("high: 0, medium: 1, low: 1");
  });

  test("fails Shape guard gate when a pass result includes findings", async () => {
    const result = await runResultGate(guardGateScriptPath, {
      status: "pass",
      summary: "No loosening found.",
      findings: [guardFinding("low")]
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("pass status cannot include findings");
  });

  test("fails Shape guard gate on schema-violating severity", async () => {
    const result = await runResultGate(guardGateScriptPath, {
      status: "advisory",
      summary: "Bad severity.",
      findings: [{ ...guardFinding("low"), severity: "error" }]
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("severity must be one of");
  });

  test("passes Shape index gate on gaps by default and fails when strict", async () => {
    const gapsResult = {
      status: "gaps",
      summary: "One subsystem lacks authored coverage.",
      gaps: [
        {
          subsystem: "payment adapter",
          files: ["packages/foo/src/payments.ts"],
          why_significant: "External integration with money movement.",
          suggested_shapes:
            "Author a PaymentsAdapter component with owned resources and forbid rules."
        }
      ]
    };

    const lenient = await runResultGate(indexGateScriptPath, gapsResult);
    expect(lenient.exitCode).toBe(0);
    expect(lenient.stdout).toContain("non-blocking");
    expect(lenient.summary).toContain("payment adapter");

    const strict = await runResultGate(indexGateScriptPath, gapsResult, {
      SHAPE_INDEX_STRICT: "true"
    });
    expect(strict.exitCode).toBe(1);
    expect(strict.stderr).toContain("SHAPE_INDEX_STRICT");
  });

  test("fails Shape index gate on an error status", async () => {
    const result = await runResultGate(indexGateScriptPath, {
      status: "error",
      summary: "Audit could not run.",
      gaps: []
    });

    expect(result.exitCode).toBe(1);
  });

  test("shape guard prefilter keeps authored shape files and drops generated ones", async () => {
    const result = await runNodeModuleProbe(`
      import { changedAuthoredShapeFiles } from ${JSON.stringify(pathToFileURL(guardRunScriptPath).href)};

      const files = changedAuthoredShapeFiles("origin/main", () =>
        [
          "shape/checker.shape",
          "shape/generated/ast/packages/foo.shape",
          "packages/shp-checker/src/checker.ts",
          "fixtures/pass/append_only_append/audit.shape"
        ].join("\\n")
      );
      console.log(JSON.stringify(files));
    `);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual([
      "shape/checker.shape",
      "fixtures/pass/append_only_append/audit.shape"
    ]);
  });

  test("shape index prefilter matches authored refs and paths globs", async () => {
    const result = await runNodeModuleProbe(`
      import {
        authoredCoverageFromShapeSource,
        globToRegExp,
        isAuditableSourceFile,
        uncoveredChangedFiles
      } from ${JSON.stringify(pathToFileURL(indexRunScriptPath).href)};

      const shapeSource = [
        'fn doWork',
        '  source ts("packages/foo/src/work.ts#doWork")',
        'implementation FooSource {',
        '  paths {',
        '    "packages/foo/src/jobs/**/*.ts"',
        '  }',
        '}'
      ].join("\\n");
      const fromSource = authoredCoverageFromShapeSource(shapeSource);
      const coverage = {
        refs: fromSource.refs,
        globMatchers: fromSource.globs.map(globToRegExp)
      };

      const uncovered = uncoveredChangedFiles(
        [
          "packages/foo/src/work.ts",
          "packages/foo/src/jobs/nested/queue.ts",
          "packages/foo/src/unmodeled.ts",
          "packages/foo/src/unmodeled.test.ts",
          "docs-site/src/content/docs/index.md",
          "packages/shp-checker/src/language/generated/ast.ts"
        ],
        coverage
      );

      console.log(JSON.stringify({
        uncovered,
        auditsDocs: isAuditableSourceFile("docs-site/src/index.md"),
        auditsScripts: isAuditableSourceFile(".github/scripts/run-claude-shape-guard.mjs")
      }));
    `);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      uncovered: ["packages/foo/src/unmodeled.ts"],
      auditsDocs: false,
      auditsScripts: true
    });
  });
});

function passReview(summary: string): unknown {
  return {
    status: "pass",
    summary,
    findings: []
  };
}

function guardFinding(severity: "high" | "medium" | "low") {
  return {
    severity,
    signal: "constraint-removal-plus-destructive-effect",
    outcome: "suspicious loosening",
    symbol: "AuditEvent / AuditStore.deleteEvent",
    evidence: "AppendOnly was removed from AuditEvent; HardDelete<AuditEvent> was added.",
    model_context: "AuditStore owns AuditEvent; no reevaluation references the change.",
    recommended_action: "Restore the constraint or add a specific reevaluation."
  };
}

async function runResultGate(
  scriptPath: string,
  result: unknown,
  extraEnv: Record<string, string> = {}
): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
  summary: string;
}> {
  const tempDir = await mkdtemp(join(tmpdir(), "shape-skill-gate-"));
  try {
    const summaryPath = join(tempDir, "summary.md");
    await Bun.write(summaryPath, "");

    const child = Bun.spawn(["node", scriptPath], {
      cwd: tempDir,
      env: {
        ...process.env,
        GITHUB_STEP_SUMMARY: summaryPath,
        CLAUDE_SKILL_RESULT: JSON.stringify(result),
        ...extraEnv
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

async function runClaudeReviewGate(
  review: unknown,
  options: { useStructuredOutput?: boolean } = {}
): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
  summary: string;
}> {
  const tempDir = await mkdtemp(join(tmpdir(), "shape-claude-review-"));
  try {
    const summaryPath = join(tempDir, "summary.md");

    await Bun.write(join(tempDir, "claude-shape-review.json"), JSON.stringify(review));
    await Bun.write(summaryPath, "");

    const child = Bun.spawn(["node", gateScriptPath], {
      cwd: tempDir,
      env: {
        ...process.env,
        GITHUB_STEP_SUMMARY: summaryPath,
        ...(options.useStructuredOutput
          ? { CLAUDE_SHAPE_REVIEW_RESULT: JSON.stringify(review) }
          : {})
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

async function runNodeModuleProbe(source: string): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}> {
  const child = Bun.spawn(["node", "--input-type=module", "-e", source], {
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe"
  });

  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text()
  ]);

  return { exitCode, stdout, stderr };
}

async function runClaudeReviewExtractor(output: unknown): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
  githubOutput: string;
}> {
  const tempDir = await mkdtemp(join(tmpdir(), "shape-claude-extract-"));
  try {
    const outputPath = join(tempDir, "github-output.txt");
    await Bun.write(join(tempDir, "claude-shape-review.json"), JSON.stringify(output));
    await Bun.write(outputPath, "");

    const child = Bun.spawn(["node", extractScriptPath], {
      cwd: tempDir,
      env: {
        ...process.env,
        GITHUB_OUTPUT: outputPath
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
      githubOutput: await Bun.file(outputPath).text()
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
