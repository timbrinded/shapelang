import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = resolve(import.meta.dir, "../../..");
const skillRunnerPath = resolve(repoRoot, ".github/scripts/run-claude-skill.mjs");
const upsertCommentScriptPath = resolve(repoRoot, ".github/scripts/upsert-shape-ci-comment.mjs");

describe("Shape workflow", () => {
  test("fails review gate when a pass result includes findings", async () => {
    const result = await runSkillGate("review", {
      status: "pass",
      summary: "No drift found.",
      findings: [reviewFinding()]
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("pass status cannot include findings");
  });

  test("fails review gate when findings are missing", async () => {
    const result = await runSkillGate("review", {
      status: "pass",
      summary: "No drift found."
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("findings is required");
  });

  test("passes review gate when a pass result has no findings", async () => {
    const result = await runSkillGate("review", {
      status: "pass",
      summary: "No drift found.",
      findings: []
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.summary).toContain("Shape Claude Review");
    expect(result.summary).toContain("Status: `pass`");
    expect(result.summary).toContain("Findings: 0");
  });

  test("fails review gate on drift status and still renders the summary", async () => {
    const result = await runSkillGate("review", {
      status: "drift",
      summary: "Source changed without a Shape update.",
      findings: [reviewFinding()]
    });

    expect(result.exitCode).toBe(1);
    expect(result.summary).toContain("Status: `drift`");
  });

  test("fails guard gate on a high-severity finding", async () => {
    const result = await runSkillGate("guard", {
      status: "advisory",
      summary: "AppendOnly was removed while HardDelete was granted.",
      findings: [guardFinding("high")]
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("high-severity");
  });

  test("passes guard gate with only medium and low advisory findings", async () => {
    const result = await runSkillGate("guard", {
      status: "advisory",
      summary: "Broad authority was added with generic justification.",
      findings: [guardFinding("medium"), guardFinding("low")]
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("non-blocking");
    expect(result.summary).toContain("Status: `advisory`");
    expect(result.summary).toContain("high: 0, medium: 1, low: 1");
  });

  test("fails guard gate when a pass result includes findings", async () => {
    const result = await runSkillGate("guard", {
      status: "pass",
      summary: "No loosening found.",
      findings: [guardFinding("low")]
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("pass status cannot include findings");
  });

  test("fails guard gate on schema-violating severity", async () => {
    const result = await runSkillGate("guard", {
      status: "advisory",
      summary: "Bad severity.",
      findings: [{ ...guardFinding("low"), severity: "error" }]
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("severity must be one of");
  });

  test("passes index gate on gaps by default and fails when strict", async () => {
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

    const lenient = await runSkillGate("index", gapsResult);
    expect(lenient.exitCode).toBe(0);
    expect(lenient.stdout).toContain("non-blocking");
    expect(lenient.summary).toContain("payment adapter");

    const strict = await runSkillGate("index", gapsResult, { SHAPE_INDEX_STRICT: "true" });
    expect(strict.exitCode).toBe(1);
    expect(strict.stderr).toContain("SHAPE_INDEX_STRICT");
  });

  test("fails index gate on an error status", async () => {
    const result = await runSkillGate("index", {
      status: "error",
      summary: "Audit could not run.",
      gaps: []
    });

    expect(result.exitCode).toBe(1);
  });

  test("fails closed on garbage results and unknown skills", async () => {
    const garbage = await runSkillGate("guard", "this is not json");
    expect(garbage.exitCode).toBe(1);
    expect(garbage.stderr).toContain("Could not parse CLAUDE_SKILL_RESULT");

    const unknown = await runSkillGate("bogus", {
      status: "pass",
      summary: "",
      findings: []
    });
    expect(unknown.exitCode).toBe(1);
    expect(unknown.stderr).toContain("unknown skill");
  });

  test("fails the gate when the Claude action returns no structured output", async () => {
    const result = await runSkillGate("review", "");

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("CLAUDE_SKILL_RESULT is empty");
  });

  test("prefilter emits the prompt and sonnet-default claude_args for the review skill", async () => {
    const result = await runNodeModuleProbe(`
      import { prefilterOutputs } from ${JSON.stringify(pathToFileURL(skillRunnerPath).href)};

      const outputs = prefilterOutputs("review", {
        GITHUB_BASE_REF: "master",
        GITHUB_SHA: "abc123"
      });

      console.log(JSON.stringify({
        skip: outputs.skip,
        promptReadsPolicy: outputs.prompt.includes(".github/prompts/shape-contract-review.md"),
        promptScopesSha: outputs.prompt.includes("HEAD_SHA=abc123"),
        defaultsToSonnet: outputs.claude_args.includes("--model claude-sonnet-4-6"),
        inlinesSchema: outputs.claude_args.includes("--json-schema '{"),
        quotesAllowedTools: outputs.claude_args.includes("--allowedTools 'Read,"),
        disallowsWrites: outputs.claude_args.includes("--disallowedTools Write,Edit")
      }));
    `);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      skip: "false",
      promptReadsPolicy: true,
      promptScopesSha: true,
      defaultsToSonnet: true,
      inlinesSchema: true,
      quotesAllowedTools: true,
      disallowsWrites: true
    });
  });

  test("claude_args construction fails closed on unquotable values and bad models", async () => {
    const result = await runNodeModuleProbe(`
      import {
        prefilterOutputs,
        serializeGitHubOutputs,
        shellSingleQuote
      } from ${JSON.stringify(pathToFileURL(skillRunnerPath).href)};

      const messageOf = (fn) => {
        try {
          fn();
          return "";
        } catch (error) {
          return error.message;
        }
      };

      console.log(JSON.stringify({
        quoteError: messageOf(() => shellSingleQuote("don't")),
        modelError: messageOf(() => prefilterOutputs("review", { CLAUDE_SKILL_MODEL: "sonnet'; ls" })),
        delimiterError: messageOf(() => serializeGitHubOutputs({ prompt: "CLAUDE_SKILL_OUTPUT" })),
        multiline: serializeGitHubOutputs({ prompt: "line one\\nline two" })
      }));
    `);

    expect(result.exitCode).toBe(0);
    const probes = JSON.parse(result.stdout);
    expect(probes.quoteError).toContain("single quote");
    expect(probes.modelError).toContain("bare model id");
    expect(probes.delimiterError).toContain("reserved delimiter");
    expect(probes.multiline).toBe(
      "prompt<<CLAUDE_SKILL_OUTPUT\nline one\nline two\nCLAUDE_SKILL_OUTPUT\n"
    );
  });

  test("schema validator recurses and fails closed on unsupported keywords", async () => {
    const result = await runNodeModuleProbe(`
      import { schemaValidationErrors } from ${JSON.stringify(pathToFileURL(skillRunnerPath).href)};

      const schema = {
        type: "object",
        additionalProperties: false,
        required: ["findings"],
        properties: {
          findings: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["severity"],
              properties: { severity: { type: "string", enum: ["high", "medium", "low"] } }
            }
          }
        }
      };

      const nestedEnum = schemaValidationErrors({ findings: [{ severity: "nuclear" }] }, schema);
      const nestedExtra = schemaValidationErrors({ findings: [{ severity: "low", smuggled: 1 }] }, schema);
      const unsupported = schemaValidationErrors("x", { type: "string", pattern: "^x$" });

      console.log(JSON.stringify({
        nestedEnum: nestedEnum.join("; "),
        nestedExtra: nestedExtra.join("; "),
        unsupported: unsupported.join("; ")
      }));
    `);

    expect(result.exitCode).toBe(0);
    const probes = JSON.parse(result.stdout);
    expect(probes.nestedEnum).toContain("findings[0].severity must be one of high, medium, low");
    expect(probes.nestedExtra).toContain("findings[0].smuggled is not allowed");
    expect(probes.unsupported).toContain("unsupported schema keyword pattern");
  });

  test("guard prefilter keeps authored shape files and drops generated ones", async () => {
    const result = await runNodeModuleProbe(`
      import { changedAuthoredShapeFiles } from ${JSON.stringify(pathToFileURL(skillRunnerPath).href)};

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

  test("index prefilter matches authored refs and paths globs", async () => {
    const result = await runNodeModuleProbe(`
      import {
        authoredCoverageFromShapeSource,
        globToRegExp,
        isAuditableSourceFile,
        uncoveredChangedFiles
      } from ${JSON.stringify(pathToFileURL(skillRunnerPath).href)};

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
        auditsScripts: isAuditableSourceFile(".github/scripts/run-claude-skill.mjs")
      }));
    `);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      uncovered: ["packages/foo/src/unmodeled.ts"],
      auditsDocs: false,
      auditsScripts: true
    });
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
});

function reviewFinding() {
  return {
    severity: "warning",
    target: "packages/shp-checker/src/checker.ts",
    shape_source: "shape/checker.shape",
    issue: "Shape contract drift was reported.",
    reason: "The review cannot pass while carrying a finding.",
    source_quote: "changed source",
    shape_quote: "shape source",
    suggested_fix: "Update the Shape model."
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

// Runs the unified skill runner in gate-only mode: CLAUDE_SKILL_RESULT skips
// the model call, so this exercises validation, summary rendering, and the
// gate exit code as a real process.
async function runSkillGate(
  skill: string,
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

    const child = Bun.spawn(["node", skillRunnerPath, skill], {
      cwd: repoRoot,
      env: {
        ...process.env,
        GITHUB_STEP_SUMMARY: summaryPath,
        CLAUDE_SKILL_RESULT: typeof result === "string" ? result : JSON.stringify(result),
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
