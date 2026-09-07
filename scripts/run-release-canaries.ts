import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

export type LoadedCanaryCase = {
  skill: string;
  id: string;
  commands: string[];
  expectedExits: number[][];
};

function parseExpectedExits(value: unknown, commandCount: number, id: string): number[][] {
  if (!Array.isArray(value) || value.length !== commandCount) {
    throw new Error(`${id} expected_exits must be an array matching required_commands`);
  }
  return value.map((entry, index) => {
    if (!Array.isArray(entry) || entry.length === 0) {
      throw new Error(`${id} expected_exits[${index}] must be a non-empty number array`);
    }
    const codes: number[] = [];
    for (const code of entry) {
      if (typeof code !== "number") {
        throw new Error(`${id} expected_exits[${index}] must be a non-empty number array`);
      }
      codes.push(code);
    }
    return codes;
  });
}

export function loadReleaseCanaryCases(repoRoot: string): LoadedCanaryCase[] {
  const parsed: unknown = JSON.parse(
    readFileSync(join(repoRoot, "fixtures/skills/cases.json"), "utf8")
  );
  if (!Array.isArray(parsed)) {
    throw new Error("fixtures/skills/cases.json must be a JSON array");
  }

  return parsed.map((item, index) => {
    if (typeof item !== "object" || item === null) {
      throw new Error(`fixtures/skills/cases.json[${index}] must be an object`);
    }
    // SAFETY: item was just checked to be a non-null object; fields are validated below.
    const record = item as Record<string, unknown>;
    if (typeof record.skill !== "string" || typeof record.id !== "string") {
      throw new Error(`fixtures/skills/cases.json[${index}] must declare string skill and id`);
    }
    if (
      !Array.isArray(record.required_commands) ||
      record.required_commands.some((command) => typeof command !== "string")
    ) {
      throw new Error(
        `fixtures/skills/cases.json[${index}] required_commands must be a string array`
      );
    }
    return {
      skill: record.skill,
      id: record.id,
      commands: record.required_commands,
      expectedExits: parseExpectedExits(
        record.expected_exits,
        record.required_commands.length,
        record.id
      )
    };
  });
}

export type CanaryCommandResult = {
  skill: string;
  id: string;
  command: string;
  rewritten: string;
  status: number | null;
  stderr: string;
  allowedExits: number[];
};

export function rewriteCanaryCommand(command: string, shpBin: string): string {
  const quoted = /[\s"]/.test(shpBin) ? `"${shpBin.replaceAll('"', '\\"')}"` : shpBin;
  return command
    .replaceAll("bun shp", quoted)
    .replaceAll("bun ../../../../packages/shp-cli/src/index.ts", quoted);
}

export function packedBinaryFromArchive(archive: string): { dir: string; shpBin: string } {
  const dir = mkdtempSync(join(tmpdir(), "shape-canary-"));
  const extracted = spawnSync("tar", ["-xzf", archive, "-C", dir], { encoding: "utf8" });
  if (extracted.status !== 0) {
    rmSync(dir, { recursive: true, force: true });
    throw new Error(extracted.stderr.trim() || `failed to extract ${archive}`);
  }
  const shpBin = existsSync(join(dir, "shp.exe")) ? join(dir, "shp.exe") : join(dir, "shp");
  if (!existsSync(shpBin)) {
    rmSync(dir, { recursive: true, force: true });
    throw new Error(`packed shp executable not found in ${archive}`);
  }
  return { dir, shpBin };
}

export function runReleaseCanaries(
  shpBin: string,
  cwd = resolve(import.meta.dir, "..")
): CanaryCommandResult[] {
  const results: CanaryCommandResult[] = [];

  for (const canary of loadReleaseCanaryCases(cwd)) {
    for (const [index, command] of canary.commands.entries()) {
      const rewritten = rewriteCanaryCommand(command, shpBin);
      if (rewritten.includes("packages/shp-cli/src/index.ts")) {
        throw new Error(`${canary.id} command was not rewritten to the packed binary: ${command}`);
      }
      const spawned = spawnSync("bash", ["-c", rewritten], {
        cwd,
        encoding: "utf8",
        env: { ...process.env, SHAPE_CMD: shpBin }
      });
      results.push({
        skill: canary.skill,
        id: canary.id,
        command,
        rewritten,
        status: spawned.status,
        stderr: spawned.stderr,
        allowedExits: canary.expectedExits[index] ?? []
      });
    }
  }

  return results;
}

export function canaryFailureMessage(results: readonly CanaryCommandResult[]): string | undefined {
  for (const result of results) {
    if (result.status === null) {
      return `${result.id} crashed while running: ${result.rewritten}\n${result.stderr}`;
    }
    if (result.status === 127) {
      return `${result.id} could not execute: ${result.rewritten}\n${result.stderr}`;
    }
    if (!result.allowedExits.includes(result.status)) {
      return `${result.id} exited ${result.status}, expected ${result.allowedExits.join(" or ")} for: ${result.rewritten}\n${result.stderr}`;
    }
  }
  return undefined;
}

function main(): void {
  const { values } = parseArgs({
    options: {
      shp: { type: "string" },
      archive: { type: "string" }
    },
    strict: true
  });
  if (Boolean(values.shp) === Boolean(values.archive)) {
    throw new Error("Usage: bun scripts/run-release-canaries.ts (--shp PATH | --archive ARCHIVE)");
  }

  const cwd = resolve(import.meta.dir, "..");
  const run = (shpBin: string) => {
    const results = runReleaseCanaries(shpBin, cwd);
    for (const result of results) {
      console.log(`${result.id}: exit ${result.status} :: ${result.rewritten}`);
    }
    const failure = canaryFailureMessage(results);
    if (failure) {
      throw new Error(failure);
    }
  };

  if (values.shp) {
    run(resolve(values.shp));
    return;
  }

  const extracted = packedBinaryFromArchive(resolve(values.archive ?? ""));
  try {
    run(extracted.shpBin);
  } finally {
    rmSync(extracted.dir, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
