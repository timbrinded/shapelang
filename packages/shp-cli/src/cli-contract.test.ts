import { checkShapeFiles, formatDiagnostics } from "@shape/shp-checker";
import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

// CLI contract matrix and CLI/library semantic parity (behavioural area #60).
//
// Anchors (packages/shp-checker/TESTING.md, "Vision-anchored" convention):
//   - shape/tooling.shape memory CliCommandDispatchOrder, which protects shape
//     CommandDispatch and requires a reevaluation on change:
//       "CLI commands must dispatch to the same checker/formatter/helper
//        semantics used by tests ... reject ambiguous output modes before
//        running command work ...".
//   - docs-site/src/content/docs/reference/cli.md "Exit codes":
//       0 = passed, 1 = semantic, coverage, formatting, or similar failure,
//       2 = invalid CLI arguments or unsupported update target.
//
// Like index.test.ts, these tests spawn the source CLI (`cliPath`) with `bun`
// rather than a packaged binary.

const repoRoot = resolve(import.meta.dir, "../../..");
const cliPath = resolve(repoRoot, "packages/shp-cli/src/index.ts");

// `bun test` runs from the repository root, and runCli spawns the CLI with
// cwd === repoRoot, so these relative paths resolve identically in-process and
// in the child. The parity test depends on this to compare output byte for byte
// without rewriting paths.
const PASS_FIXTURE = "fixtures/pass/append_only_append/audit.shape";
const FAIL_FIXTURE = "fixtures/fail/append_only_hard_delete/audit.shape";
const UNKNOWN_EFFECTS_FIXTURE = "fixtures/fail/unknown_effects/audit.shape";

// Top-level commands from docs-site/src/content/docs/reference/cli.md. The
// help-completeness test (invariant 4) requires `shp --help` to list each one.
const ALL_COMMANDS = [
  "check",
  "coverage",
  "fmt",
  "explain",
  "graph",
  "lsp",
  "memory",
  "obligations",
  "author",
  "analyze",
  "ast",
  "update"
] as const;

async function runCli(
  args: string[],
  executable = cliPath,
  cwd = repoRoot
): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}> {
  const process = Bun.spawn(["bun", executable, ...args], {
    cwd,
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

describe("shp CLI contract matrix (area #60)", () => {
  // Invariant 1: the exit-code triple, with stream routing asserted each time.
  // Checking all three codes in one test is the negative control: a CLI
  // hardwired to any single exit code fails at least one leg.
  test(
    "[locked-intended] exit-code triple routes 0->stdout, 1->stderr, 2->stderr " +
      "— anchor: docs-site/src/content/docs/reference/cli.md Exit codes",
    async () => {
      const pass = await runCli(["check", PASS_FIXTURE]);
      expect(pass.exitCode).toBe(0);
      expect(pass.stdout.length).toBeGreaterThan(0);
      expect(pass.stderr).toBe("");

      const semanticFailure = await runCli(["check", FAIL_FIXTURE]);
      expect(semanticFailure.exitCode).toBe(1);
      expect(semanticFailure.stderr.length).toBeGreaterThan(0);
      expect(semanticFailure.stdout).toBe("");

      const usageError = await runCli(["check", "--not-a-real-flag"]);
      expect(usageError.exitCode).toBe(2);
      expect(usageError.stderr.length).toBeGreaterThan(0);
      expect(usageError.stdout).toBe("");

      expect(new Set([pass.exitCode, semanticFailure.exitCode, usageError.exitCode]).size).toBe(3);
    }
  );

  // Invariant 2: required flags fail with exit 2 BEFORE doing work, and stderr
  // names the missing input rather than dumping a stack trace.
  test(
    "[locked-intended] missing required flags exit 2 and name the problem " +
      "— anchor: shape/tooling.shape memory CliCommandDispatchOrder " +
      "(reject ambiguous output modes before running command work)",
    async () => {
      // `coverage` requires --changed-files (cli.md usage: `coverage
      // --changed-files changed.txt`). Running it on a real fixture but with no
      // flag must fail on the missing flag, not on the fixture contents.
      const coverage = await runCli(["coverage", PASS_FIXTURE]);
      expect(coverage.exitCode).toBe(2);
      expect(coverage.stdout).toBe("");
      expect(coverage.stderr).toContain("--changed-files");
      // Argument validation, not an exception leak.
      expect(coverage.stderr).not.toContain("at ");
      expect(coverage.stderr).not.toMatch(/Error: .*\n\s+at /);

      // `author` always requires --changed-files. Draft and author-prompt modes
      // additionally require --component; critic mode reviews an existing
      // proposal and therefore does not.
      const author = await runCli(["author"]);
      expect(author.exitCode).toBe(2);
      expect(author.stdout).toBe("");
      expect(author.stderr).toContain("--changed-files");
      expect(author.stderr).not.toContain("at ");

      const authorWithoutComponent = await runCli([
        "author",
        "--changed-files",
        "fixtures/changed/audit_purge.txt"
      ]);
      expect(authorWithoutComponent.exitCode).toBe(2);
      expect(authorWithoutComponent.stdout).toBe("");
      expect(authorWithoutComponent.stderr).toContain("--component");
      expect(authorWithoutComponent.stderr).not.toContain("at ");
    }
  );

  // Invariant 3: invalid enum-like values. `graph stats --kind` accepts any
  // value, so its test is a characterization (TESTING.md: current behaviour not
  // yet ratified as ideal, with a reason and follow-up) rather than a locked law.
  // `ast source --language` rejects an unknown value with exit 2.
  test(
    "[characterization] graph stats --kind <unknown> is tolerated (exit 0, " +
      "empty filtered view) rather than rejected " +
      "— anchor: docs-site/src/content/docs/reference/cli.md graph stats --kind KIND",
    async () => {
      // REASON: `--kind` is a free-text relation-kind filter, not a closed enum
      // at the argument layer; an unknown kind simply matches zero hyperedges.
      // FOLLOW-UP (#34/#60): decide whether an unknown relation kind SHOULD be a
      // usage error (exit 2) and, if so, promote this to a [shouldBe]/[locked].
      const unknown = await runCli([
        "graph",
        "stats",
        "--kind",
        "definitely-not-a-relation-kind",
        PASS_FIXTURE
      ]);
      expect(unknown.exitCode).toBe(0);
      expect(unknown.stderr).toBe("");
      // The echoed filter and the zero-edge count show that the value was
      // applied, not silently ignored.
      expect(unknown.stdout).toContain("filter: kind=definitely-not-a-relation-kind");
      expect(unknown.stdout).toContain("hyperedges: 0");

      // Negative control: a valid kind takes the same success path and echoes
      // its own name, so the assertions above test acceptance of the value
      // rather than a constant output string.
      const valid = await runCli(["graph", "stats", "--kind", "calls", PASS_FIXTURE]);
      expect(valid.exitCode).toBe(0);
      expect(valid.stdout).toContain("filter: kind=calls");
      expect(valid.stdout).not.toContain("filter: kind=definitely-not-a-relation-kind");
    }
  );

  test(
    "[locked-intended] ast source --language <unknown> fails as a usage error " +
      "(exit 2, stderr) before parser loading " +
      "— anchor: docs-site/src/content/docs/reference/cli.md ast source --language LANG",
    async () => {
      const unknown = await runCli([
        "ast",
        "source",
        "--language",
        "definitely-not-a-language",
        PASS_FIXTURE
      ]);
      expect(unknown.exitCode).toBe(2);
      expect(unknown.stdout).toBe("");
      expect(unknown.stderr.length).toBeGreaterThan(0);
      expect(unknown.stderr).toContain("definitely-not-a-language");
      expect(unknown.stderr).toContain("unsupported source language");
      expect(unknown.stderr).not.toContain("at ");

      // Negative control: a valid alias on the same subcommand passes argument
      // validation and fails later, on ordinary file loading, before any parser
      // can initialize.
      const alias = await runCli([
        "ast",
        "source",
        "--language",
        "ts",
        "fixtures/missing-source.ts"
      ]);
      expect(alias.exitCode).toBe(2);
      expect(alias.stderr).toContain("failed to read fixtures/missing-source.ts");
      expect(alias.stderr).not.toContain("unsupported source language");
    }
  );

  // Invariant 4: help completeness, driven from the hardcoded command list.
  test(
    "[locked-intended] --help exits 0, writes only stdout, and lists every " +
      "documented command — anchor: docs-site/src/content/docs/reference/cli.md Commands",
    async () => {
      const help = await runCli(["--help"]);
      expect(help.exitCode).toBe(0);
      expect(help.stderr).toBe("");
      expect(help.stdout.length).toBeGreaterThan(0);

      for (const command of ALL_COMMANDS) {
        expect(help.stdout).toContain(command);
      }

      // Negative control: a nonexistent command name is absent from both the
      // list and the help text, so the loop above is not passing on arbitrary
      // substrings.
      const commandNames: readonly string[] = ALL_COMMANDS;
      expect(commandNames.includes("frobnicate")).toBe(false);
      expect(help.stdout).not.toContain("frobnicate");
    }
  );
});

describe("shp CLI / library semantic parity (area #60)", () => {
  // Invariant 5: `shp check` reports exactly what the library computes.
  //
  // The CLI `check` command (commands/check/impl.ts, through check-runner.ts)
  // calls checkShapeFiles(files, { enforceBindings: true, ... }), writes
  // formatDiagnostics(result) verbatim to stdout on exit 0 or to stderr
  // otherwise, and sets result.exitCode. The library calls below must use the
  // same options and relative paths for the comparison to be exact rather than
  // coincidental.
  test(
    "[locked-intended] check exit code and rendered diagnostics equal the " +
      "library's checkShapeFiles + formatDiagnostics — anchor: shape/tooling.shape " +
      "memory CliCommandDispatchOrder (dispatch to the same checker/formatter semantics)",
    async () => {
      // Passing fixture: exit codes match, and CLI stdout is byte-equal to the
      // library-rendered diagnostics because the CLI adds no prefix or suffix
      // on the success path.
      const passCliResult = await runCli(["check", PASS_FIXTURE]);
      const passLibResult = await checkShapeFiles([PASS_FIXTURE], {
        enforceBindings: true
      });
      const passLibBody = formatDiagnostics(passLibResult);

      expect(passCliResult.exitCode).toBe(passLibResult.exitCode);
      expect(passCliResult.exitCode).toBe(0);
      expect(passCliResult.stdout).toBe(passLibBody);
      expect(passCliResult.stderr).toBe("");

      // Failing fixture: exit codes match, and CLI stderr carries the
      // library-rendered diagnostic body. checkShapeFiles is the independent
      // oracle: the library computes the expected body, not this test.
      const failCliResult = await runCli(["check", FAIL_FIXTURE]);
      const failLibResult = await checkShapeFiles([FAIL_FIXTURE], {
        enforceBindings: true
      });
      const failLibBody = formatDiagnostics(failLibResult);

      expect(failCliResult.exitCode).toBe(failLibResult.exitCode);
      expect(failCliResult.exitCode).toBe(1);
      expect(failCliResult.stdout).toBe("");
      // Negative control for parity: a CLI that rendered diagnostics through
      // its own path would fail this containment check. The body is a full
      // multi-line causal chain, so the check cannot pass vacuously.
      expect(failLibBody.length).toBeGreaterThan(0);
      expect(failCliResult.stderr).toContain(failLibBody.trimEnd());

      // The two fixtures render differently, so the parity assertions do not
      // compare one constant rendering with itself.
      expect(passLibResult.exitCode).not.toBe(failLibResult.exitCode);
      expect(passLibBody).not.toBe(failLibBody);
    }
  );

  test(
    "[locked-intended] draft validation only softens unknown effects " +
      "— anchor: docs-site/src/content/docs/reference/cli.md Draft validation",
    async () => {
      const strict = await runCli(["check", UNKNOWN_EFFECTS_FIXTURE]);
      expect(strict.exitCode).toBe(1);
      expect(strict.stdout).toBe("");
      expect(strict.stderr).toContain("error: unknown effects");

      const draft = await runCli(["check", "--allow-unknown-effects", UNKNOWN_EFFECTS_FIXTURE]);
      expect(draft.exitCode).toBe(0);
      expect(draft.stderr).toBe("");
      expect(draft.stdout).toContain("warning: unknown effects");
      expect(draft.stdout).toContain("Shape check passed with warnings.");

      const forbidden = await runCli(["check", "--allow-unknown-effects", FAIL_FIXTURE]);
      expect(forbidden.exitCode).toBe(1);
      expect(forbidden.stdout).toBe("");
      expect(forbidden.stderr).toContain("error: forbidden effect");
    }
  );
});
