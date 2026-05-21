import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

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
    const result = await runCli([
      "update",
      "--dry-run",
      "--version",
      manifest.version,
      "--path",
      "fixtures/shp"
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(`shp ${manifest.version} is already installed\n`);
    expect(result.stderr).toBe("");
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
