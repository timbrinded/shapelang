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

  test("fails guard gate on a high-impact suspicious finding", async () => {
    const result = await runSkillGate("guard", {
      status: "advisory",
      summary: "AppendOnly was removed while HardDelete was granted.",
      findings: [guardFinding("high", "none", "suspicious")]
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("high-impact suspicious");
  });

  test("passes guard gate for supported high impact and lower-impact findings", async () => {
    const result = await runSkillGate("guard", {
      status: "advisory",
      summary: "Broad authority was added with generic justification.",
      findings: [
        guardFinding("high", "specific", "supported"),
        guardFinding("medium", "generic", "suspicious"),
        guardFinding("low", "none", "informational")
      ]
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("non-blocking");
    expect(result.summary).toContain("Status: `advisory`");
    expect(result.summary).toContain("high: 1, medium: 1, low: 1");
    expect(result.summary).toContain("suspicious: 1, supported: 1");
  });

  test("fails guard gate when a pass result includes findings", async () => {
    const result = await runSkillGate("guard", {
      status: "pass",
      summary: "No loosening found.",
      findings: [guardFinding("low", "none", "informational")]
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("pass status cannot include findings");
  });

  test("fails guard gate on schema-violating impact", async () => {
    const result = await runSkillGate("guard", {
      status: "advisory",
      summary: "Bad impact.",
      findings: [{ ...guardFinding("low", "none", "informational"), impact: "error" }]
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("impact must be one of");
  });

  test("preflight helper separates guarded proposal diagnostics from a valid baseline", async () => {
    const result = await runPrecheck(
      "fixtures/skills/preflight/guarded-unknown/shape",
      "fixtures/skills/preflight/guarded-unknown/proposal.shape"
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      mode: "contract-simulation",
      decision: "blocked_by_contract",
      baseline: { status: "valid", exit_code: 0 },
      proposal: { status: "blocked", exit_code: 1 }
    });
  });

  test("preflight helper stops on an invalid baseline before checking the proposal", async () => {
    const result = await runPrecheck(
      "fixtures/skills/preflight/invalid-baseline/shape",
      "fixtures/skills/preflight/invalid-baseline/proposal.shape"
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      mode: "contract-simulation",
      decision: "baseline_invalid",
      baseline: { status: "invalid", exit_code: 1 },
      proposal: null
    });
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

  test("passes the skills release gate only when all six skills pass", async () => {
    const result = await runSkillGate("release", skillsReleaseResult());

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.summary).toContain("Shape Skills Release Evaluation");
    expect(result.summary).toContain("**shape-review**: `pass`");
    expect(result.summary).toContain("**unix-system-visualiser**: `pass`");
  });

  test("fails the skills release gate when a shipped skill is missing or duplicated", async () => {
    const missing = skillsReleaseResult();
    missing.skills.pop();
    const missingResult = await runSkillGate("release", missing);
    expect(missingResult.exitCode).toBe(1);
    expect(missingResult.stderr).toContain("missing unix-system-visualiser");

    const duplicate = skillsReleaseResult();
    const firstSkill = duplicate.skills[0];
    if (!firstSkill) {
      throw new Error("skills release fixture is empty");
    }
    duplicate.skills[4] = { ...firstSkill };
    const duplicateResult = await runSkillGate("release", duplicate);
    expect(duplicateResult.exitCode).toBe(1);
    expect(duplicateResult.stderr).toContain("duplicate or unknown skill shape-lang");
  });

  test("fails the skills release gate when pass carries a blocking finding", async () => {
    const release = skillsReleaseResult();
    release.findings.push({
      skill: "shape-lang",
      severity: "high",
      scenario: "CLI syntax",
      problem: "Legacy graph syntax is taught.",
      evidence: "The entrypoint uses graph --stats.",
      recommended_change: "Teach graph stats."
    });

    const result = await runSkillGate("release", release);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("pass status cannot include findings");
  });

  test("fails the skills release gate on vacuous or incomplete conformance evidence", async () => {
    const vacuous = skillsReleaseResult();
    vacuous.summary = "";
    for (const skill of vacuous.skills) {
      skill.summary = "";
      skill.static_checks = [];
      skill.cases = [];
    }
    const vacuousResult = await runSkillGate("release", vacuous);
    expect(vacuousResult.exitCode).toBe(1);
    expect(vacuousResult.stderr).toContain("summary must not be empty");

    const incomplete = skillsReleaseResult();
    incomplete.skills[0]?.static_checks.pop();
    const incompleteResult = await runSkillGate("release", incomplete);
    expect(incompleteResult.exitCode).toBe(1);
    expect(incompleteResult.stderr).toContain("missing static checks drift-review");

    const unsupported = skillsReleaseResult();
    const firstStaticCheck = unsupported.skills[0]?.static_checks[0];
    if (!firstStaticCheck) {
      throw new Error("skills release static-check fixture is empty");
    }
    firstStaticCheck.evidence = "";
    const unsupportedResult = await runSkillGate("release", unsupported);
    expect(unsupportedResult.exitCode).toBe(1);
    expect(unsupportedResult.stderr).toContain("evidence must not be empty");
  });

  test("fails the skills release gate on empty case outcomes or missing command evidence", async () => {
    const emptyOutcome = skillsReleaseResult();
    const firstCase = emptyOutcome.skills[0]?.cases[0];
    if (!firstCase) {
      throw new Error("skills release case fixture is empty");
    }
    firstCase.outcome = "";
    const emptyOutcomeResult = await runSkillGate("release", emptyOutcome);
    expect(emptyOutcomeResult.exitCode).toBe(1);
    expect(emptyOutcomeResult.stderr).toContain("outcome must not be empty");

    const missingCommand = skillsReleaseResult();
    const commandCase = missingCommand.skills[0]?.cases[0];
    if (!commandCase) {
      throw new Error("skills release command fixture is empty");
    }
    commandCase.commands.pop();
    const missingCommandResult = await runSkillGate("release", missingCommand);
    expect(missingCommandResult.exitCode).toBe(1);
    expect(missingCommandResult.stderr).toContain("missing command evidence");

    const missingMarker = skillsReleaseResult();
    const indexSkill = missingMarker.skills.find((skill) => skill.name === "shape-index");
    const indexCase = indexSkill?.cases.find((item) => item.id === "index-coverage-gaps");
    if (!indexCase) {
      throw new Error("skills release evidence-marker fixture is empty");
    }
    indexCase.evidence = "The candidate is incomplete.";
    const missingMarkerResult = await runSkillGate("release", missingMarker);
    expect(missingMarkerResult.exitCode).toBe(1);
    expect(missingMarkerResult.stderr).toContain("evidence must include UploadApi");
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

  test("recovers a prose-wrapped result from the execution log when structured output is missing", async () => {
    const review = { status: "pass", summary: "No drift found.", findings: [] };
    const result = await runSkillGateWithExecutionLog("review", [
      { type: "system", subtype: "init" },
      {
        type: "result",
        subtype: "success",
        result: `Here is the final review:\n${JSON.stringify(review)}`
      }
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Recovered the Shape Claude review");
    expect(result.summary).toContain("Status: `pass`");
  });

  test("fails closed when the execution log result text is not schema-valid", async () => {
    const result = await runSkillGateWithExecutionLog("review", [
      { type: "result", subtype: "success", result: "I was unable to produce the JSON object." }
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("did not contain a valid Shape Claude review");
  });

  test("prefilter emits the prompt and sonnet-default claude_args for the review skill", async () => {
    const result = await runNodeModuleProbe(`
      import { prefilterOutputs } from ${JSON.stringify(pathToFileURL(skillRunnerPath).href)};

      const outputs = prefilterOutputs("review", {
        GITHUB_BASE_REF: "master",
        GITHUB_SHA: "abc123"
      });
      const releaseOutputs = prefilterOutputs("release", {
        GITHUB_SHA: "abc123",
        SHAPE_RELEASE_VERSION: "0.7.0"
      });

      console.log(JSON.stringify({
        skip: outputs.skip,
        promptReadsPolicy: outputs.prompt.includes(".github/prompts/shape-contract-review.md"),
        promptScopesSha: outputs.prompt.includes("HEAD_SHA=abc123"),
        defaultsToSonnet: outputs.claude_args.includes("--model claude-sonnet-4-6"),
        inlinesSchema: outputs.claude_args.includes("--json-schema '{"),
        quotesAllowedTools: outputs.claude_args.includes("--allowedTools 'Read,"),
        disallowsWrites: outputs.claude_args.includes("--disallowedTools Write,Edit"),
        releaseCanRunPrecheck: releaseOutputs.claude_args.includes(
          "Bash(plugins/shapelang/skills/shape-contract-preflight/scripts/precheck.sh --shape-root fixtures/skills/preflight/guarded-unknown/shape --json fixtures/skills/preflight/guarded-unknown/proposal.shape)"
        ),
        releaseCanRunCompleteRoute: releaseOutputs.claude_args.includes(
          "Bash(plugins/shapelang/skills/shape-contract-preflight/scripts/precheck.sh --shape-root fixtures/skills/preflight/complete-route/shape --json fixtures/skills/preflight/complete-route/proposal.shape)"
        ),
        releaseCanGenerateVisualiser: releaseOutputs.claude_args.includes(
          'Bash(bun plugins/shapelang/skills/unix-system-visualiser/scripts/generate.mjs --repo fixtures/skills/unix-system-visualiser/connected --output .research/atlas-a.html --shape-command "bun ../../../../packages/shp-cli/src/index.ts")'
        ),
        releaseCanCompareVisualisers: releaseOutputs.claude_args.includes(
          "Bash(cmp fixtures/skills/unix-system-visualiser/connected/.research/atlas-a.html fixtures/skills/unix-system-visualiser/connected/.research/atlas-b.html)"
        ),
        releaseHidesExpectedOutcomes:
          !releaseOutputs.prompt.includes("draft_only") &&
          !releaseOutputs.prompt.includes("single_code_comment"),
        releaseRejectsArbitraryShapeCommand: !releaseOutputs.claude_args.includes("SHAPE_CMD=*")
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
      disallowsWrites: true,
      releaseCanRunPrecheck: true,
      releaseCanRunCompleteRoute: true,
      releaseCanGenerateVisualiser: true,
      releaseCanCompareVisualisers: true,
      releaseHidesExpectedOutcomes: true,
      releaseRejectsArbitraryShapeCommand: true
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

function guardFinding(
  impact: "high" | "medium" | "low",
  support: "none" | "generic" | "specific",
  disposition: "suspicious" | "supported" | "tightening" | "informational"
) {
  return {
    impact,
    support,
    disposition,
    signal: "constraint-removal-plus-destructive-effect",
    symbol: "AuditEvent / AuditStore.deleteEvent",
    before: "resource AuditEvent : AppendOnly",
    after: "resource AuditEvent with HardDelete<AuditEvent>",
    replacement: "",
    evidence: "AppendOnly was removed from AuditEvent; HardDelete<AuditEvent> was added.",
    model_context: "AuditStore owns AuditEvent; no reevaluation references the change.",
    recommended_action: "Restore or replace the constraint, or provide specific review evidence."
  };
}

function skillsReleaseResult() {
  const staticChecks = {
    "shape-lang": ["mode-boundaries", "draft-strict", "current-cli", "stable-refs", "drift-review"],
    "shape-contract-preflight": [
      "baseline-separation",
      "unknown-plan",
      "decision-contract",
      "current-cli"
    ],
    "shape-contract-guard": [
      "impact-support-separation",
      "semantic-normalization",
      "source-boundary",
      "structured-output"
    ],
    "shape-index": ["explicit-only", "clean-baseline", "no-invariant-quota", "ast-navigation"],
    "shape-review": [
      "code-first",
      "all-incident-relations",
      "false-positive-challenge",
      "drift-separation"
    ],
    "unix-system-visualiser": [
      "semantic-inspection",
      "ignored-output-safety",
      "deterministic-offline-artifact",
      "browser-and-evidence-boundary"
    ]
  };
  const cases = {
    "shape-lang": [
      {
        id: "lang-draft-strict",
        status: "pass",
        outcome: "Draft checking warns and passes; strict checking rejects the unknown effect.",
        evidence: "Draft check warns and exits zero; strict check rejects unknown effects.",
        commands: [
          "bun shp check --allow-unknown-effects fixtures/fail/unknown_effects/audit.shape",
          "bun shp check fixtures/fail/unknown_effects/audit.shape"
        ]
      },
      {
        id: "lang-final-forbid",
        status: "pass",
        outcome: "blocked",
        evidence: "The checker reports the final forbid despite Memory Guard context.",
        commands: [
          "bun shp check fixtures/fail/memory_guard_does_not_override_final_forbid/audit.shape"
        ]
      }
    ],
    "shape-contract-preflight": [
      {
        id: "preflight-guarded-unknown",
        status: "pass",
        outcome: "blocked_by_contract",
        evidence: "The valid baseline is separate; the proposal reports its guard obligation.",
        commands: [
          "plugins/shapelang/skills/shape-contract-preflight/scripts/precheck.sh --shape-root fixtures/skills/preflight/guarded-unknown/shape --json fixtures/skills/preflight/guarded-unknown/proposal.shape"
        ]
      },
      {
        id: "preflight-invalid-baseline",
        status: "pass",
        outcome: "baseline_invalid",
        evidence: "Strict baseline validation fails before the proposal is checked.",
        commands: [
          "plugins/shapelang/skills/shape-contract-preflight/scripts/precheck.sh --shape-root fixtures/skills/preflight/invalid-baseline/shape --json fixtures/skills/preflight/invalid-baseline/proposal.shape"
        ]
      },
      {
        id: "preflight-complete-route",
        status: "pass",
        outcome: "blocked_by_contract",
        evidence:
          "SubmissionApi can reach PublishedArchive only through ArchiveWorker, so the omitted second leg completes the forbidden route.",
        commands: [
          "plugins/shapelang/skills/shape-contract-preflight/scripts/precheck.sh --shape-root fixtures/skills/preflight/complete-route/shape --json fixtures/skills/preflight/complete-route/proposal.shape"
        ]
      }
    ],
    "shape-contract-guard": [
      {
        id: "guard-policy-removal",
        status: "pass",
        outcome: "high_suspicious",
        evidence:
          "AppendOnly is present in the base and absent without replacement in the candidate.",
        commands: ["bun shp check fixtures/skills/guard/policy-removal/candidate/contract.shape"]
      },
      {
        id: "guard-equivalent-relocation",
        status: "pass",
        outcome: "no_finding",
        evidence: "The candidate retains the identical AppendOnly declaration in a relocated file.",
        commands: [
          "bun shp check fixtures/skills/guard/equivalent-relocation/candidate/retention.shape"
        ]
      }
    ],
    "shape-index": [
      {
        id: "index-missing-ast",
        status: "pass",
        outcome: "continue_without_ast",
        evidence:
          "AuthService remains source-inspectable; missing generated navigation is recorded.",
        commands: ["bun shp check fixtures/skills/index/missing-ast/shape/system.shape"]
      },
      {
        id: "index-no-invariant",
        status: "pass",
        outcome: "no_evidence_backed_invariant",
        evidence: "The formatting helper supports no enforceable architecture claim.",
        commands: []
      },
      {
        id: "index-coverage-gaps",
        status: "pass",
        outcome: "incomplete_with_explicit_gaps",
        evidence:
          "UploadApi calls ThumbnailWorker, while docs/images.md requires a missing binding.",
        commands: ["bun shp check fixtures/skills/index/coverage-gaps/shape/system.shape"]
      }
    ],
    "shape-review": [
      {
        id: "review-cross-object",
        status: "pass",
        outcome: "code_comment",
        evidence:
          "A missing record now throws before the RecordPresenter not-found branch can run.",
        commands: ["bun shp check fixtures/skills/review/cross-object/shape/model.shape"]
      },
      {
        id: "review-stale-model",
        status: "pass",
        outcome: "model_warning_only",
        evidence: "Source returns local config and does not make the authored remote call.",
        commands: ["bun shp check fixtures/skills/review/stale-model/shape/model.shape"]
      },
      {
        id: "review-root-cause-grouping",
        status: "pass",
        outcome: "single_code_comment",
        evidence:
          "RangeNormalizer.normalizeRange via shp explain RangeNormalizer.normalizeRange changes end to end - 1; both downstream symptoms share that correction.",
        commands: [
          "bun shp check fixtures/skills/review/root-cause-grouping/shape/model.shape",
          "bun shp explain RangeNormalizer.normalizeRange fixtures/skills/review/root-cause-grouping/shape/model.shape",
          "bun shp graph show RangeNormalizer fixtures/skills/review/root-cause-grouping/shape/model.shape"
        ]
      }
    ],
    "unix-system-visualiser": [
      {
        id: "visualiser-deterministic-nested-model",
        status: "pass",
        outcome: "complete",
        evidence:
          "The nested authored SystemEvent model contains 1 resource, 2 components, 2 functions, and 2 relations. It generated identical offline HTML files with 1 authored journey and 1 inferred dependency tour; authored claims are not runtime proof.",
        commands: [
          "bun shp check fixtures/skills/unix-system-visualiser/connected/shape/nested/system.shape",
          'bun plugins/shapelang/skills/unix-system-visualiser/scripts/generate.mjs --repo fixtures/skills/unix-system-visualiser/connected --output .research/atlas-a.html --shape-command "bun ../../../../packages/shp-cli/src/index.ts"',
          'bun plugins/shapelang/skills/unix-system-visualiser/scripts/generate.mjs --repo fixtures/skills/unix-system-visualiser/connected --output .research/atlas-b.html --shape-command "bun ../../../../packages/shp-cli/src/index.ts"',
          "cmp fixtures/skills/unix-system-visualiser/connected/.research/atlas-a.html fixtures/skills/unix-system-visualiser/connected/.research/atlas-b.html"
        ]
      },
      {
        id: "visualiser-unignored-output",
        status: "pass",
        outcome: "blocked_unignored_output",
        evidence: "The default path was not ignored, so generation stopped before any HTML write.",
        commands: [
          'bun plugins/shapelang/skills/unix-system-visualiser/scripts/generate.mjs --repo fixtures/skills/unix-system-visualiser/unignored-output --shape-command "bun ../../../../packages/shp-cli/src/index.ts"'
        ]
      }
    ]
  };
  return {
    status: "pass",
    summary: "All shipped skills passed static conformance and behavioral cases.",
    skills: [
      "shape-lang",
      "shape-contract-preflight",
      "shape-contract-guard",
      "shape-index",
      "shape-review",
      "unix-system-visualiser"
    ].map((name) => ({
      name,
      status: "pass",
      summary: "Current commands and behavioral patterns are correct.",
      static_checks: (staticChecks[name as keyof typeof staticChecks] ?? []).map((id) => ({
        id,
        status: "pass",
        evidence: `The shipped skill and current CLI satisfy ${id}.`
      })),
      cases: (cases[name as keyof typeof cases] ?? []).map((item) => ({
        ...item,
        commands: [...item.commands]
      }))
    })),
    findings: [] as Array<{
      skill: string;
      severity: string;
      scenario: string;
      problem: string;
      evidence: string;
      recommended_change: string;
    }>
  };
}

// Runs the unified skill runner in gate-only mode against an execution log,
// exercising the structured-output fallback path used when a proxy gateway
// drops structured output.
async function runSkillGateWithExecutionLog(skill: string, messages: unknown[]) {
  const tempDir = await mkdtemp(join(tmpdir(), "shape-skill-execution-"));
  try {
    const executionPath = join(tempDir, "claude-execution-output.json");
    await Bun.write(executionPath, JSON.stringify(messages));
    return await runSkillGate(skill, undefined, { CLAUDE_EXECUTION_FILE: executionPath });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

// Runs the unified skill runner in gate-only mode: CLAUDE_SKILL_RESULT (or an
// execution log via extraEnv) replaces the model call, so this exercises
// validation, summary rendering, and the gate exit code as a real process.
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

    const env: Record<string, string | undefined> = {
      ...process.env,
      GITHUB_STEP_SUMMARY: summaryPath,
      ...extraEnv
    };
    if (result !== undefined) {
      env.CLAUDE_SKILL_RESULT = typeof result === "string" ? result : JSON.stringify(result);
    }

    const child = Bun.spawn(["node", skillRunnerPath, skill], {
      cwd: repoRoot,
      env,
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

async function runPrecheck(
  shapeRoot: string,
  proposal: string
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const child = Bun.spawn(
    [
      "plugins/shapelang/skills/shape-contract-preflight/scripts/precheck.sh",
      "--shape-root",
      shapeRoot,
      "--json",
      proposal
    ],
    {
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe"
    }
  );
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text()
  ]);
  return { exitCode, stdout, stderr };
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
