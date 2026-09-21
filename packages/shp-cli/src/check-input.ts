import { spawnSync } from "node:child_process";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { isRecord, type AttestationMode, type CheckTransition } from "@shape/shp-checker";
import { CliDiagnosticError } from "./errors";

export async function readAttestationMode(configPath?: string): Promise<AttestationMode> {
  const file = Bun.file(configPath ?? "shapelang.json");
  if (configPath === undefined && !(await file.exists())) return "repo";
  let config: unknown;
  try {
    config = await file.json();
  } catch {
    throw new CliDiagnosticError("error: cannot read ShapeLang project JSON configuration.\n");
  }
  if (!isRecord(config))
    throw new CliDiagnosticError("error: ShapeLang config must be an object.\n");
  if (config.attestations === undefined) return "repo";
  if (
    !isRecord(config.attestations) ||
    (config.attestations.mode !== "repo" && config.attestations.mode !== "pr")
  ) {
    throw new CliDiagnosticError("error: attestations.mode must be repo or pr.\n");
  }
  return config.attestations.mode;
}

function git(args: string[]): string {
  const result = spawnSync("git", args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (result.error || result.status !== 0)
    throw new CliDiagnosticError(
      `error: git ${args[0]} failed: ${result.error?.message ?? result.stderr}\n`
    );
  return result.stdout;
}

export function resolveCheckTransition(flags: {
  base?: string;
  head?: string;
  worktree?: boolean;
  changedFiles?: string;
}): { transition?: CheckTransition; changedFiles?: string[]; repoRoot?: string } {
  if (!flags.base) {
    if (flags.head || flags.worktree)
      throw new CliDiagnosticError("error: --head/--worktree requires --base.\n");
    return {};
  }
  if (flags.changedFiles)
    throw new CliDiagnosticError("error: --base cannot be combined with --changed-files.\n");
  if (flags.head && flags.worktree)
    throw new CliDiagnosticError("error: choose --head or --worktree.\n");
  const repoRoot = git(["rev-parse", "--show-toplevel"]).trim();
  if (resolve(repoRoot) !== resolve(process.cwd()))
    throw new CliDiagnosticError("error: transition checks must run from the repository root.\n");
  const revision = (ref: string) =>
    git(["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`]).trim();
  const base = revision(flags.base);
  const head = revision(flags.head ?? "HEAD");
  if (head !== revision("HEAD"))
    throw new CliDiagnosticError("error: checkout --head before checking its model.\n");
  // Exact commit binding cannot represent unstaged, staged, or untracked candidates.
  if (git(["status", "--porcelain", "--untracked-files=all"]).trim()) {
    throw new CliDiagnosticError(
      "error: transition checks require a clean worktree; commit changes before generating or consuming PR evidence. Keep temporary evidence outside the repository or ignored.\n"
    );
  }
  const changedFiles = git(["diff", "--name-only", "--no-renames", "-z", base, head, "--"])
    .split("\0")
    .filter(Boolean);
  return { transition: { base, head }, changedFiles, repoRoot };
}

/** Prevent an accidental explicit file outside the checked candidate. */
export function requireCandidateFiles(files: readonly string[], repoRoot: string): void {
  const tracked = new Map(
    git(["ls-files", "--stage", "-z"])
      .split("\0")
      .filter(Boolean)
      .map((entry) => {
        const tab = entry.indexOf("\t");
        return [entry.slice(tab + 1), entry.slice(0, 6)];
      })
  );
  for (const file of files) {
    const path = relative(repoRoot, resolve(file)).split(sep).join("/");
    if (
      path === ".." ||
      path.startsWith("../") ||
      isAbsolute(path) ||
      !tracked.has(path) ||
      tracked.get(path) === "120000"
    ) {
      throw new CliDiagnosticError(
        "error: transition shape files must be tracked regular files inside the repository.\n"
      );
    }
  }
}
