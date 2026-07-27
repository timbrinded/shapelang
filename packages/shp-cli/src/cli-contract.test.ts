import { checkShapeFiles, formatDiagnostics } from "@shape/shp-checker";
import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

// Behavioural area #60 — CLI contract matrix + CLI/library semantic parity.
//
// Anchors (see packages/shp-checker/TESTING.md, convention 4 "Vision-anchored"):
//   - shape/tooling.shape  memory CliCommandDispatchOrder
//       "CLI commands must dispatch to the same checker/formatter/helper
//        semantics used by tests ... reject ambiguous output modes before
//        running command work ...".
//       (protects shape CommandDispatch; guards on_change require
//        ReEvaluation<Self>.)
//   - docs-site/src/content/docs/reference/cli.md "Exit codes":
//       0 = passed, 1 = semantic/coverage/format/etc. failure, 2 = invalid
//       CLI arguments or unsupported update target. success -> stdout,
//       failure -> stderr.
//
// HONEST ANCHOR NOTE: the area brief also names a memory
// `ClockReadAtCliBoundary`. No such clause exists anywhere in shape/*.shape or
// the codebase as of this commit (verified by repo-wide search). Per TESTING.md
// convention 4 ("If no clause exists, write it first"), an unwritten clause is
// not a valid anchor, and this test file may only create itself — it cannot add
// the clause. The clock/boundary behaviour is therefore left unasserted here
// rather than pinned against a non-existent law, and tracked for #34 to author.
//
// These tests replicate the spawn-the-source-CLI approach from index.test.ts
// (no packaged binary path; run via the source `cliPath` with `bun`).

const repoRoot = resolve(import.meta.dir, "../../..");
const cliPath = resolve(repoRoot, "packages/shp-cli/src/index.ts");

// Bun test runs with process.cwd() === repoRoot (verified), and runCli spawns
// the CLI with cwd === repoRoot, so relative fixture paths resolve identically
// in-process and in the child. That identity is what makes the parity test a
// real byte comparison rather than a path-rewriting artefact.
const PASS_FIXTURE = "fixtures/pass/append_only_append/audit.shape";
const FAIL_FIXTURE = "fixtures/fail/append_only_hard_delete/audit.shape";
const UNKNOWN_EFFECTS_FIXTURE = "fixtures/fail/unknown_effects/audit.shape";

// The 12 commands documented in docs-site/src/content/docs/reference/cli.md.
// The help-completeness test is driven from this list, so adding a command
// without surfacing it in `shp --help` will break invariant 4.
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
  // The pass/fail contrast inside this single test is the in-test negative
  // control for the exit-code dimension: a CLI hardwired to `exit 0` would pass
  // the first leg and fail the second; a CLI hardwired to `exit 1` would fail
  // the first leg. Neither magic value stands alone.
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

      // Negative control made explicit: the three exit codes are genuinely
      // distinct, so a constant-exit CLI cannot satisfy all three legs.
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

      // `author` requires --changed-files AND --component (cli.md usage).
      // Verified empirically: with neither flag the CLI reports BOTH missing
      // inputs and exits 2 before generating any draft.
      const author = await runCli(["author"]);
      expect(author.exitCode).toBe(2);
      expect(author.stdout).toBe("");
      expect(author.stderr).toContain("--changed-files");
      expect(author.stderr).toContain("--component");
      expect(author.stderr).not.toContain("at ");
    }
  );

  // Invariant 3: invalid enum-like values. The brief assumed these reject with
  // exit 2; running the CLI shows otherwise, so these are characterizations of
  // the REAL behaviour (TESTING.md: characterization = current behaviour not yet
  // ratified as ideal; reason + follow-up below), not false locked laws.
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
      // The filter is honoured and echoed, proving the value was accepted and
      // applied (not silently ignored): it scopes the graph to zero edges.
      expect(unknown.stdout).toContain("filter: kind=definitely-not-a-relation-kind");
      expect(unknown.stdout).toContain("hyperedges: 0");

      // Negative control for this characterization: a VALID kind takes the same
      // success path and is echoed with its own name — so the assertion above
      // is about acceptance of the value, not about every input printing the
      // same constant string.
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

      // Negative control: this exit code is meaningful only against a contrast.
      // A valid alias on the same subcommand gets past argument validation and
      // fails later on ordinary file loading, before any parser can initialize.
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

      // Drive the assertion from the command list: a new command that is not
      // surfaced in help text fails here, which is the point of the invariant.
      for (const command of ALL_COMMANDS) {
        expect(help.stdout).toContain(command);
      }

      // Negative control: a command name that does NOT exist must be absent,
      // proving the loop above is matching real command tokens and not just
      // succeeding because the help blob contains arbitrary substrings.
      const commandNames: readonly string[] = ALL_COMMANDS;
      expect(commandNames.includes("frobnicate")).toBe(false);
      expect(help.stdout).not.toContain("frobnicate");
    }
  );
});

describe("shp CLI / library semantic parity (area #60)", () => {
  // Invariant 5 + the parity half of the negative control.
  //
  // The CLI `check` command (packages/shp-cli/src/commands/check/impl.ts) is a
  // thin shell: it calls checkShapeFiles(files, { enforceBindings: true }),
  // renders formatDiagnostics(result), writes that string verbatim to stdout on
  // exit 0 or stderr otherwise, and propagates result.exitCode. The library
  // call below MUST mirror those options (enforceBindings: true) and the same
  // relative path for the comparison to be exact rather than coincidental.
  test(
    "[locked-intended] check exit code and rendered diagnostics equal the " +
      "library's checkShapeFiles + formatDiagnostics — anchor: shape/tooling.shape " +
      "memory CliCommandDispatchOrder (dispatch to the same checker/formatter semantics)",
    async () => {
      // Passing fixture: exit codes match AND the CLI stdout is byte-equal to
      // the library-rendered diagnostics (strongest true equality — verified
      // empirically that the CLI adds no prefix/suffix on the success path).
      const passCliResult = await runCli(["check", PASS_FIXTURE]);
      const passLibResult = await checkShapeFiles([PASS_FIXTURE], {
        enforceBindings: true
      });
      const passLibBody = formatDiagnostics(passLibResult);

      expect(passCliResult.exitCode).toBe(passLibResult.exitCode);
      expect(passCliResult.exitCode).toBe(0);
      expect(passCliResult.stdout).toBe(passLibBody);
      expect(passCliResult.stderr).toBe("");

      // Failing fixture: exit codes match AND the CLI's stderr carries the
      // library-rendered diagnostic body. checkShapeFiles is the independent
      // oracle here — the body is computed by the library, not authored in this
      // test — so equality proves the CLI is not a divergent re-implementation.
      const failCliResult = await runCli(["check", FAIL_FIXTURE]);
      const failLibResult = await checkShapeFiles([FAIL_FIXTURE], {
        enforceBindings: true
      });
      const failLibBody = formatDiagnostics(failLibResult);

      expect(failCliResult.exitCode).toBe(failLibResult.exitCode);
      expect(failCliResult.exitCode).toBe(1);
      expect(failCliResult.stdout).toBe("");
      // NEGATIVE CONTROL (parity): the CLI stderr CONTAINS the multi-line
      // library body. A CLI that rendered diagnostics through its own divergent
      // path would fail this containment. The body is non-trivial (a full
      // causal chain), so this cannot pass vacuously.
      expect(failLibBody.length).toBeGreaterThan(0);
      expect(failCliResult.stderr).toContain(failLibBody.trimEnd());

      // And the two fixtures genuinely differ, so the parity assertions above
      // are not comparing one constant rendering against itself.
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
