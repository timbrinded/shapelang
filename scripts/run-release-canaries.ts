import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

type LoadedCanaryCase = {
  skill: string;
  id: string;
  commands: string[];
};

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
      commands: record.required_commands
    };
  });
}

export type CanaryCommandResult = {
  skill: string;
  id: string;
  command: string;
  rewritten: string;
  status: number | null;
  stdout: string;
  stderr: string;
};

export function rewriteCanaryCommand(command: string, shpBin: string): string {
  const quoted = /[\s"]/.test(shpBin) ? `"${shpBin.replaceAll('"', '\\"')}"` : shpBin;
  return command
    .replaceAll("bun shp", quoted)
    .replaceAll("bun ../../../../packages/shp-cli/src/index.ts", quoted);
}

export function expectedCanaryStatuses(id: string): { allow: number[]; requireNonZero?: boolean } {
  if (id === "visualiser-deterministic-nested-model") {
    return { allow: [0] };
  }
  if (id === "visualiser-unignored-output") {
    return { allow: [1, 2], requireNonZero: true };
  }
  return { allow: [0, 1, 2] };
}

export function runReleaseCanaries(
  shpBin: string,
  options?: {
    cwd?: string;
    spawn?: typeof spawnSync;
  }
): CanaryCommandResult[] {
  const cwd = options?.cwd ?? resolve(import.meta.dir, "..");
  const spawn = options?.spawn ?? spawnSync;
  const results: CanaryCommandResult[] = [];

  for (const canary of loadReleaseCanaryCases(cwd)) {
    for (const command of canary.commands) {
      const rewritten = rewriteCanaryCommand(command, shpBin);
      const spawned = spawn("bash", ["-lc", rewritten], {
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
        stdout: spawned.stdout,
        stderr: spawned.stderr
      });
    }
  }

  return results;
}

export function canaryFailureMessage(results: readonly CanaryCommandResult[]): string | undefined {
  for (const result of results) {
    const expected = expectedCanaryStatuses(result.id);
    if (result.status === null) {
      return `${result.id} crashed while running: ${result.rewritten}\n${result.stderr}`;
    }
    if (result.status === 127) {
      return `${result.id} could not execute: ${result.rewritten}\n${result.stderr}`;
    }
    if (expected.requireNonZero && result.status === 0) {
      return `${result.id} expected a non-zero exit, got 0 for: ${result.rewritten}`;
    }
    if (!expected.allow.includes(result.status)) {
      return `${result.id} exited ${result.status} for: ${result.rewritten}\n${result.stderr}`;
    }
  }
  return undefined;
}

function main(): void {
  const { values } = parseArgs({
    options: {
      shp: { type: "string" }
    },
    strict: true
  });
  if (!values.shp) {
    throw new Error("Usage: bun scripts/run-release-canaries.ts --shp PATH");
  }
  const shpBin = resolve(values.shp);
  const results = runReleaseCanaries(shpBin);
  const failure = canaryFailureMessage(results);
  for (const result of results) {
    console.log(`${result.id}: exit ${result.status} :: ${result.rewritten}`);
  }
  if (failure) {
    throw new Error(failure);
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
