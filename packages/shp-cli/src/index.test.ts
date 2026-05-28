import { describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "../../..");
const cliPath = resolve(repoRoot, "packages/shp-cli/src/index.ts");

describe("shp CLI", () => {
  test("checks default shape files", async () => {
    const result = await runCli(["check"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Shape check passed");
    expect(result.stderr).toBe("");
  });

  test("returns exit code 1 for semantic violations", async () => {
    const result = await runCli(["check", "fixtures/fail/append_only_hard_delete/audit.shape"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("error: forbidden effect");
    expect(result.stderr).toContain("AuditStore.purgeOldEvents");
    expect(result.stdout).toBe("");
  });

  test("rejects unknown options without a stack trace", async () => {
    const result = await runCli(["check", "--not-a-real-option"]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--not-a-real-option");
    expect(result.stderr).toContain("No flag registered");
    expect(result.stderr).not.toContain("ArgumentScannerError");
    expect(result.stdout).toBe("");
  });

  test("reports missing changed-file lists without a stack trace", async () => {
    const result = await runCli([
      "coverage",
      "--changed-files",
      "fixtures/missing-changed-files.txt",
      "fixtures/pass/append_only_append/audit.shape"
    ]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("error: failed to read fixtures/missing-changed-files.txt");
    expect(result.stderr).not.toContain("readChangedFiles");
    expect(result.stdout).toBe("");
  });

  test("runs coverage with changed-file input", async () => {
    const result = await runCli([
      "coverage",
      "--changed-files",
      "fixtures/changed/audit_purge.txt",
      "fixtures/fail/missing_shape_update/audit.shape"
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("governed source changed without current Shape update");
    expect(result.stderr).toContain("src/audit/purge.ts");
    expect(result.stdout).toBe("");
  });

  test("does not enforce bindings during coverage-only runs", async () => {
    const result = await runCli([
      "coverage",
      "--changed-files",
      "fixtures/changed/audit_store_with_shape.txt",
      "fixtures/pass/coverage_binding_only/audit.shape"
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Shape check passed");
    expect(result.stderr).toBe("");
  });

  test("enforces bindings during changed-file checks", async () => {
    const result = await runCli([
      "check",
      "--changed-files",
      "fixtures/changed/audit_store_with_shape.txt",
      "fixtures/pass/coverage_binding_only/audit.shape"
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("bound docs change missing");
    expect(result.stderr).toContain("AuditDocs");
    expect(result.stdout).toBe("");
  });

  test("rejects empty changed-file path during checks", async () => {
    const result = await runCli([
      "check",
      "--changed-files",
      "",
      "fixtures/pass/coverage_binding_only/audit.shape"
    ]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("error: failed to read");
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
      "--module",
      "audit"
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("module audit");
    expect(result.stdout).toContain("component AuditStore");
    expect(result.stdout).toContain("effects unknown");
    expect(result.stderr).toBe("");
  });

  test("generates AST JSON shape drafts with raw trace sidecars", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "shp-cli-test-"));
    const astFile = join(tempDir, "ast.json");
    const rawFile = join(tempDir, "raw.shape");
    try {
      await writeFile(astFile, JSON.stringify(cliAstJson()));

      const result = await runCli([
        "ast",
        "json",
        "--module",
        "generated.audit",
        "--raw-out",
        rawFile,
        astFile
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("module generated.audit");
      expect(result.stdout).toContain("component AuditStore : GeneratedCandidate");
      expect(result.stdout).toContain("effects unknown");
      expect(result.stdout).not.toContain("GeneratedAstNode");
      expect(result.stderr).toBe("");

      const rawShape = await readFile(rawFile, "utf8");
      expect(rawShape).toContain("module generated.audit.raw");
      expect(rawShape).toContain("GeneratedAstNode");
      expect(rawShape).toContain("kind ast_child");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("embeds raw AST trace in AST JSON output on request", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "shp-cli-test-"));
    const astFile = join(tempDir, "ast.json");
    try {
      await writeFile(astFile, JSON.stringify(cliAstJson()));

      const result = await runCli([
        "ast",
        "json",
        "--module",
        "generated.audit",
        "--include-ast-layer",
        astFile
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("module generated.audit");
      expect(result.stdout).toContain("GeneratedAstNode");
      expect(result.stdout).toContain("kind ast_child");
      expect(result.stderr).toBe("");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("generates AST source drafts from source checkout", async () => {
    const result = await runCli([
      "ast",
      "source",
      "--language",
      "typescript",
      "--module",
      "generated.audit",
      "fixtures/source/audit_purge.ts"
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("module generated.audit");
    expect(result.stdout).toContain("component AuditPurgeModule : GeneratedCandidate");
    expect(result.stdout).toContain("GeneratedAstAnchor");
    expect(result.stdout).toContain('storage ast.anchor("fixtures/source/audit_purge.ts:1-3")');
    expect(result.stdout).not.toContain('storage ast.anchor("{\\"target\\"');
    expect(result.stdout).toContain("fingerprint ast.semantic_subtree_v1");
    expect(result.stdout).toContain("kind generated_from");
    expect(result.stdout).toContain("expects AuditPurgeModulePurgeOldEventsAstAnchor fingerprint");
    const anchorName = "AuditPurgeModulePurgeOldEventsAstAnchor";
    const resourceFingerprint = result.stdout.match(
      new RegExp(
        `resource ${anchorName} : GeneratedAstAnchor \\{[\\s\\S]*?fingerprint ast\\.semantic_subtree_v1\\("([^"]+)"\\)`
      )
    )?.[1];
    const expectedFingerprint = result.stdout.match(
      new RegExp(`expects ${anchorName} fingerprint ast\\.semantic_subtree_v1\\("([^"]+)"\\)`)
    )?.[1];
    expect(resourceFingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(expectedFingerprint).toBe(resourceFingerprint);
    expect(result.stderr).toBe("");
  });

  test("generates Rust AST source drafts from real source files", async () => {
    const result = await runCli([
      "ast",
      "source",
      "--language",
      "rust",
      "--module",
      "generated.audit",
      "fixtures/source/rust/audit_store.rs"
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("module generated.audit");
    expect(result.stdout).toContain("component AuditStore : GeneratedCandidate");
    expect(result.stdout).toContain("fn append_event");
    expect(result.stdout).toContain('source rust("fixtures/source/rust/audit_store.rs:16-18")');
    expect(result.stdout).toContain("AuditStoreAppendEventAstAnchor");
    expect(result.stdout).toContain("kind generated_from");
    expect(result.stdout).toContain("kind calls");
    expect(result.stdout).toContain("effect candidate AppendEventAppendAuditEventCandidateEffect");
    expect(result.stderr).toBe("");
  });

  test("generates source candidate effects from AST anchors", async () => {
    const result = await runCli([
      "ast",
      "source",
      "--language",
      "typescript",
      "--module",
      "generated.audit",
      "fixtures/source/audit_store.ts"
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("resource AuditEvent : GeneratedCandidate");
    expect(result.stdout).toContain("effect candidate AppendEventAppendAuditEventCandidateEffect");
    expect(result.stdout).toContain("  fn AuditStore.appendEvent");
    expect(result.stdout).toContain("  effect Append<AuditEvent>");
    expect(result.stdout).toContain("pin AuditStoreAppendEventAstAnchor fingerprint");
    expect(result.stdout).not.toContain("ConstructorAppendAuditEventCandidateEffect");
    expect(result.stderr).toBe("");
  });

  test("writes and freshness-checks generated AST source directory output", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "shp-cli-test-"));
    const outDir = join(tempDir, "shape/generated/ast");
    try {
      const writeResult = await runCli([
        "ast",
        "source",
        "--language",
        "typescript",
        "--out-dir",
        outDir,
        "fixtures/source/audit_store.ts",
        "fixtures/source/audit_purge.ts"
      ]);

      expect(writeResult.exitCode).toBe(0);
      expect(writeResult.stdout).toContain("Wrote 2 generated AST Shape file");

      const generated = await readFile(join(outDir, "fixtures/source/audit_purge.shape"), "utf8");
      expect(generated).toContain(
        "module shape.generated.ast.fixtures.generated_source.audit_purge"
      );
      expect(generated).toContain("GeneratedAstAnchor");
      expect(generated).toContain("kind generated_from");

      const manifest = await readFile(join(outDir, "manifest.json"), "utf8");
      expect(manifest).toContain("shape.generated.ast.fixtures.generated_source.audit_purge");
      expect(manifest.indexOf("audit_purge.ts")).toBeLessThan(manifest.indexOf("audit_store.ts"));

      const staleCheckResult = await runCli([
        "ast",
        "source",
        "--language",
        "typescript",
        "--out-dir",
        outDir,
        "--check",
        "fixtures/source/audit_purge.ts"
      ]);
      expect(staleCheckResult.exitCode).toBe(1);
      expect(staleCheckResult.stderr).toContain("generated AST Shape files are stale");
      expect(staleCheckResult.stderr).toContain("audit_store.shape");

      const rewriteResult = await runCli([
        "ast",
        "source",
        "--language",
        "typescript",
        "--out-dir",
        outDir,
        "fixtures/source/audit_purge.ts"
      ]);
      expect(rewriteResult.exitCode).toBe(0);
      expect(await Bun.file(join(outDir, "fixtures/source/audit_store.shape")).exists()).toBe(
        false
      );

      const checkResult = await runCli([
        "ast",
        "source",
        "--language",
        "typescript",
        "--out-dir",
        outDir,
        "--check",
        "fixtures/source/audit_purge.ts"
      ]);
      expect(checkResult.exitCode).toBe(0);
      expect(checkResult.stdout).toContain("up to date");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("preserves authored Shape files in broad generated AST output directories", async () => {
    const tempDir = await mkdtemp(join(repoRoot, ".tmp-shp-cli-test-"));
    const shapeDir = join(tempDir, "shape");
    const authoredShape = join(shapeDir, "model.shape");
    const sourcePath = join(tempDir, "audit.ts");
    try {
      await mkdir(shapeDir, { recursive: true });
      await writeFile(authoredShape, "module local.model\n\ncomponent AuthoredModel {\n}\n");
      await writeFile(sourcePath, "export function readAudit() { return 1; }\n");

      const writeResult = await runCli([
        "ast",
        "source",
        "--language",
        "typescript",
        "--out-dir",
        shapeDir,
        sourcePath
      ]);
      expect(writeResult.exitCode).toBe(0);
      expect(await readFile(authoredShape, "utf8")).toContain("component AuthoredModel");

      const checkResult = await runCli([
        "ast",
        "source",
        "--language",
        "typescript",
        "--out-dir",
        shapeDir,
        "--check",
        sourcePath
      ]);
      expect(checkResult.exitCode).toBe(0);
      expect(checkResult.stderr).not.toContain("model.shape");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("rejects generated AST output path and module collisions before writing", async () => {
    const tempDir = await mkdtemp(join(repoRoot, ".tmp-shp-cli-test-"));
    const outDir = join(tempDir, "shape/generated/ast");
    const tsFile = join(tempDir, "foo.ts");
    const tsxFile = join(tempDir, "foo.tsx");
    try {
      await writeFile(tsFile, "export function readAudit() { return 1; }\n");
      await writeFile(tsxFile, "export function readAudit() { return 2; }\n");

      const result = await runCli([
        "ast",
        "source",
        "--language",
        "typescript",
        "--out-dir",
        outDir,
        tsFile,
        tsxFile
      ]);

      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain("generated AST module collision");
      expect(result.stderr).toContain("foo.ts");
      expect(result.stderr).toContain("foo.tsx");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("rejects AST source freshness check without generated output directory", async () => {
    const result = await runCli([
      "ast",
      "source",
      "--language",
      "typescript",
      "--check",
      "fixtures/source/audit_purge.ts"
    ]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--check requires --out-dir");
  });

  test("rejects generated AST directory output outside the generated AST module namespace", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "shp-cli-test-"));
    try {
      const result = await runCli([
        "ast",
        "source",
        "--language",
        "typescript",
        "--out-dir",
        join(tempDir, "shape/generated/ast"),
        "--module",
        "shape.generated.astcustom",
        "fixtures/source/audit_purge.ts"
      ]);

      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain("shape.generated.ast or a child module");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("rejects conflicting AST source raw output flags", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "shp-cli-test-"));
    try {
      const result = await runCli([
        "ast",
        "source",
        "--include-ast-layer",
        "--raw-out",
        join(tempDir, "raw.shape"),
        "fixtures/source/audit_purge.ts"
      ]);

      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain("--include-ast-layer and --raw-out cannot be used together");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("rejects conflicting AST JSON raw output flags", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "shp-cli-test-"));
    const astFile = join(tempDir, "ast.json");
    try {
      await writeFile(astFile, JSON.stringify(cliAstJson()));

      const result = await runCli([
        "ast",
        "json",
        "--include-ast-layer",
        "--raw-out",
        join(tempDir, "raw.shape"),
        astFile
      ]);

      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain("--include-ast-layer and --raw-out cannot be used together");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("reports malformed AST JSON diagnostics without a stack trace", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "shp-cli-test-"));
    const astFile = join(tempDir, "ast.json");
    try {
      await writeFile(
        astFile,
        JSON.stringify({
          language: "rust",
          files: [
            {
              path: "src/broken.rs",
              root: "root",
              nodes: [
                {
                  id: "root",
                  kind: "source_file",
                  attributes: { nested: { unsupported: true } }
                }
              ]
            }
          ]
        })
      );

      const result = await runCli(["ast", "json", astFile]);

      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain("AST generation failed");
      expect(result.stderr).toContain("nested_attribute");
      expect(result.stderr).not.toContain("buildRouteScanner");
      expect(result.stdout).toBe("");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("rejects AST JSON without token data for semantic fingerprints", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "shp-cli-test-"));
    const astFile = join(tempDir, "ast.json");
    try {
      await writeFile(
        astFile,
        JSON.stringify({
          language: "rust",
          files: [
            {
              path: "src/main.rs",
              root: "root",
              nodes: [
                { id: "root", kind: "source_file", children: ["main"] },
                { id: "main", kind: "function_item", attributes: { name: "main" } }
              ]
            }
          ]
        })
      );

      const result = await runCli(["ast", "json", astFile]);

      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain("missing_fingerprint_tokens");
      expect(result.stdout).toBe("");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("reports missing AST source files without loading a parser", async () => {
    const result = await runCli([
      "ast",
      "source",
      "--language",
      "rust",
      "fixtures/source/missing.rs"
    ]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("error: failed to read fixtures/source/missing.rs");
    expect(result.stdout).toBe("");
  });

  test("lists memory guards", async () => {
    const result = await runCli([
      "memory",
      "fixtures/pass/memory_guard_modify_with_reevaluation/audit.shape"
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Memory Guards");
    expect(result.stdout).toContain("memory DecisionRefactorConstraint");
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
    expect(result.stdout).toContain(
      ["InlineRationale", "<", "fn Gateway.derivePolicyDecision", ">"].join("")
    );
    expect(result.stderr).toBe("");
  });

  test("runs source analyzer with shape comparison", async () => {
    const result = await runCli([
      "analyze",
      "--shape-files",
      "fixtures/pass/append_only_append/audit.shape",
      "fixtures/source/audit_purge.ts"
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("missing from shape effects");
    expect(result.stderr).toContain("HardDelete");
    expect(result.stdout).toBe("");
  });

  test("reports missing analyzer source files without a stack trace", async () => {
    const result = await runCli(["analyze", "fixtures/source/missing.ts"]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("error: failed to read fixtures/source/missing.ts");
    expect(result.stderr).not.toContain("analyzeFiles");
    expect(result.stdout).toBe("");
  });

  test("runs the declared package bin", async () => {
    const manifest = await readCliManifest();
    const result = await runCli(
      ["--help"],
      resolve(repoRoot, "packages/shp-cli", manifest.bin.shp)
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("USAGE");
    expect(result.stdout).toContain("COMMANDS");
    expect(result.stdout).toContain("--version");
    expect(result.stderr).toBe("");
  });

  test("prints command help", async () => {
    const result = await runCli(["check", "--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("USAGE");
    expect(result.stdout).toContain("--changed-files");
    expect(result.stdout).toContain("Run semantic checks");
    expect(result.stderr).toBe("");
  });

  test("prints update command help", async () => {
    const result = await runCli(["update", "--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Update the released shp binary in place");
    expect(result.stdout).toContain("--version");
    expect(result.stdout).toContain("--dry-run");
    expect(result.stdout).toContain("--path");
    expect(result.stderr).toBe("");
  });

  test("prints the CLI version", async () => {
    const manifest = await readCliManifest();
    const result = await runCli(["--version"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(manifest.version);
    expect(result.stderr).toBe("");
  });

  test("reports same-version update without network or mutation", async () => {
    const manifest = await readCliManifest();
    const tempDir = await mkdtemp(join(tmpdir(), "shp-cli-test-"));
    const fakeShp = join(tempDir, "shp");
    try {
      await writeFile(
        fakeShp,
        [
          "#!/usr/bin/env sh",
          'if [ "$1" = "--help" ]; then',
          "  echo 'USAGE'",
          "  echo '  shp check [--changed-files changed.txt] <files>...'",
          "  echo '  shp coverage (--changed-files changed.txt) <files>...'",
          "  echo '  shp fmt [--check] <files>...'",
          "  echo '  shp update [--version VERSION] [--dry-run] [--path PATH]'",
          "  echo 'When no files are provided, Shape file commands scan shape/**/*.shape by default.'",
          "else",
          `  echo "${manifest.version}"`,
          "fi",
          ""
        ].join("\n")
      );
      await chmod(fakeShp, 0o755);

      const result = await runCli([
        "update",
        "--dry-run",
        "--version",
        manifest.version,
        "--path",
        fakeShp
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe(`shp ${manifest.version} is already installed\n`);
      expect(result.stderr).toBe("");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("refuses to update the Bun runtime when run from source", async () => {
    const result = await runCli(["update"]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("refusing to update");
    expect(result.stderr).toContain("pass --path PATH");
    expect(result.stdout).toBe("");
  });

  test("reports unknown commands without a stack trace", async () => {
    const result = await runCli(["chek"]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("No command registered");
    expect(result.stderr).toContain("check");
    expect(result.stderr).not.toContain("buildRouteScanner");
    expect(result.stdout).toBe("");
  });

  test("reports missing required positionals as usage errors", async () => {
    const result = await runCli(["explain"]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("Expected at least 1 argument");
    expect(result.stderr).toContain("args");
    expect(result.stdout).toBe("");
  });

  test("documents reserved legacy graph symbols", async () => {
    const result = await runCli(["graph", "--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("symbols named all, show, or stats");
    expect(result.stdout).toContain("graph show SYMBOL");
    expect(result.stderr).toBe("");
  });

  test("preserves legacy graph invocation for a symbol named legacy", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "shp-cli-test-"));
    const shapeFile = join(tempDir, "legacy-symbol.shape");
    try {
      await writeFile(
        shapeFile,
        ["module legacy_symbol", "", "component legacy {", "}", ""].join("\n")
      );

      const result = await runCli(["graph", "legacy", shapeFile]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("legacy (component)");
      expect(result.stdout).toContain("(no incident relations)");
      expect(result.stdout).not.toContain("Hypergraph");
      expect(result.stderr).toBe("");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("prints the whole hypergraph", async () => {
    const result = await runCli(["graph", "fixtures/pass/hypercycle_acyclic/deps.shape"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Hypergraph");
    expect(result.stdout).toContain("coordinated_call AuditWritePath");
    expect(result.stdout).toContain("calls GatewayCallsAudit");
    expect(result.stderr).toBe("");
  });

  test("prints the whole hypergraph with the explicit all subcommand", async () => {
    const legacy = await runCli(["graph", "fixtures/pass/hypercycle_acyclic/deps.shape"]);
    const explicit = await runCli(["graph", "all", "fixtures/pass/hypercycle_acyclic/deps.shape"]);

    expect(explicit.exitCode).toBe(0);
    expect(explicit.stdout).toBe(legacy.stdout);
    expect(explicit.stderr).toBe("");
  });

  test("reports missing graph files without a stack trace", async () => {
    const result = await runCli(["graph", "fixtures/missing.shape"]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("error: parse error");
    expect(result.stderr).toContain("fixtures/missing.shape");
    expect(result.stderr).not.toContain("parseModules");
    expect(result.stdout).toBe("");
  });

  test("prints hypergraph stats", async () => {
    const result = await runCli([
      "graph",
      "--stats",
      "fixtures/pass/hypercycle_acyclic/deps.shape"
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Hypergraph stats");
    expect(result.stdout).toContain("hyperedges: 2");
    expect(result.stderr).toBe("");
  });

  test("prints hypergraph stats with the explicit stats subcommand", async () => {
    const legacy = await runCli([
      "graph",
      "--stats",
      "fixtures/pass/hypercycle_acyclic/deps.shape"
    ]);
    const explicit = await runCli([
      "graph",
      "stats",
      "fixtures/pass/hypercycle_acyclic/deps.shape"
    ]);

    expect(explicit.exitCode).toBe(0);
    expect(explicit.stdout).toBe(legacy.stdout);
    expect(explicit.stderr).toBe("");
  });

  test("rejects a symbol with hypergraph stats", async () => {
    const result = await runCli([
      "graph",
      "Gateway",
      "--stats",
      "fixtures/pass/hypercycle_acyclic/deps.shape"
    ]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("`shp graph --stats` does not accept a SYMBOL");
    expect(result.stdout).toBe("");
  });

  test("prints focused hypergraph incidence for a symbol", async () => {
    const result = await runCli([
      "graph",
      "Gateway",
      "fixtures/pass/hypercycle_acyclic/deps.shape"
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Gateway (component)");
    expect(result.stdout).toContain("coordinated_call AuditWritePath");
    expect(result.stdout).toContain("calls GatewayCallsAudit");
    expect(result.stderr).toBe("");
  });

  test("prints focused hypergraph incidence with the explicit show subcommand", async () => {
    const legacy = await runCli([
      "graph",
      "Gateway",
      "fixtures/pass/hypercycle_acyclic/deps.shape"
    ]);
    const explicit = await runCli([
      "graph",
      "show",
      "Gateway",
      "fixtures/pass/hypercycle_acyclic/deps.shape"
    ]);

    expect(explicit.exitCode).toBe(0);
    expect(explicit.stdout).toBe(legacy.stdout);
    expect(explicit.stderr).toBe("");
  });

  test("filters focused hypergraph incidence by relation kind", async () => {
    const result = await runCli([
      "graph",
      "Gateway",
      "--kind",
      "calls",
      "fixtures/pass/hypercycle_acyclic/deps.shape"
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Gateway (component)");
    expect(result.stdout).toContain("calls GatewayCallsAudit");
    expect(result.stdout).not.toContain("coordinated_call AuditWritePath");
    expect(result.stderr).toBe("");
  });

  test("filters whole hypergraph output by relation kind with the explicit all subcommand", async () => {
    const result = await runCli([
      "graph",
      "all",
      "--kind",
      "calls",
      "fixtures/pass/hypercycle_acyclic/deps.shape"
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("calls GatewayCallsAudit");
    expect(result.stdout).not.toContain("coordinated_call AuditWritePath");
    expect(result.stderr).toBe("");
  });

  test("filters hypergraph stats by relation kind with the explicit stats subcommand", async () => {
    const result = await runCli([
      "graph",
      "stats",
      "--kind",
      "calls",
      "fixtures/pass/hypercycle_acyclic/deps.shape"
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("filter: kind=calls");
    expect(result.stdout).toContain("calls: 1");
    expect(result.stderr).toBe("");
  });
});

type CliManifest = {
  version: string;
  bin: {
    shp: string;
  };
};

async function readCliManifest(): Promise<CliManifest> {
  const manifest: unknown = await Bun.file(
    resolve(repoRoot, "packages/shp-cli/package.json")
  ).json();
  if (!isCliManifest(manifest)) {
    throw new Error("packages/shp-cli/package.json is missing bin.shp");
  }
  return manifest;
}

function isCliManifest(value: unknown): value is CliManifest {
  if (typeof value !== "object" || value === null || !("version" in value) || !("bin" in value)) {
    return false;
  }

  const { bin } = value;
  return (
    typeof value.version === "string" &&
    typeof bin === "object" &&
    bin !== null &&
    "shp" in bin &&
    typeof bin.shp === "string"
  );
}

function cliAstJson(): unknown {
  return {
    language: "rust",
    files: [
      {
        path: "src/audit/store.rs",
        root: "root",
        nodes: [
          {
            id: "root",
            kind: "source_file",
            children: ["event", "store", "append"]
          },
          {
            id: "event",
            kind: "struct_item",
            attributes: { name: "AuditEvent" },
            text: "struct AuditEvent { id: String }"
          },
          {
            id: "store",
            kind: "struct_item",
            attributes: { name: "AuditStore" },
            text: "struct AuditStore { repo: AuditRepo }"
          },
          {
            id: "append",
            kind: "function_item",
            attributes: { name: "append_event" },
            text: "fn append_event(event: AuditEvent) {}"
          }
        ]
      }
    ]
  };
}

async function runCli(
  args: string[],
  executable = cliPath
): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}> {
  const process = Bun.spawn(["bun", executable, ...args], {
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
