import { Glob } from "bun";
import { join } from "node:path";
import { parseShapeModule, type CheckModuleInput } from "@shape/shp-checker";
import type { CliContext } from "./context";
import { CliDiagnosticError, EXIT_USAGE } from "./errors";
import { stderr } from "./io";
import { readCliTextFile } from "./shape-files";

export type BaseModelFlags = {
  readonly baseRef?: string;
  readonly baseModel?: string;
};

// Generated AST modules never declare attestations, so the base model skips them.
const GENERATED_AST_PREFIX = "shape/generated/ast/";

/**
 * Loads the `.shape` files the check compares attestations against. `--base-ref`
 * reads them from git at the merge base of REF and HEAD; `--base-model` reads a
 * directory that already holds them. Returns undefined when neither is given, or
 * when a base file cannot be parsed, in which case attestations fall back to the
 * declaring-file rule.
 */
export async function loadBaseModules(
  context: CliContext,
  flags: BaseModelFlags,
  providedFiles: readonly string[]
): Promise<CheckModuleInput[] | undefined> {
  if (flags.baseRef !== undefined && flags.baseModel !== undefined) {
    throw new CliDiagnosticError("error: --base-ref and --base-model cannot be combined\n");
  }
  let sources: { filePath: string; text: string }[];
  if (flags.baseRef !== undefined) {
    sources = await readBaseRefSources(flags.baseRef, providedFiles);
  } else if (flags.baseModel !== undefined) {
    sources = await readBaseModelSources(flags.baseModel);
  } else {
    return undefined;
  }

  const modules: CheckModuleInput[] = [];
  for (const source of sources) {
    const parsed = parseShapeModule(source.text, source.filePath);
    if (!parsed.ok) {
      stderr(
        context,
        `warning: could not parse base model file ${source.filePath}; attestations count when their .shape file changed\n`
      );
      return undefined;
    }
    modules.push({ module: parsed.module, filePath: source.filePath, origin: "authored" });
  }
  return modules;
}

async function readBaseRefSources(
  ref: string,
  providedFiles: readonly string[]
): Promise<{ filePath: string; text: string }[]> {
  const commit = (await git(["merge-base", ref, "HEAD"], `resolve --base-ref ${ref}`)).trim();
  const pathspecs = providedFiles.length > 0 ? [...providedFiles] : ["shape"];
  const listing = await git(
    ["ls-tree", "-r", "-z", "--name-only", commit, "--", ...pathspecs],
    `list .shape files at ${commit}`
  );
  const paths = listing
    .split("\0")
    .filter((path) => path.endsWith(".shape") && !path.startsWith(GENERATED_AST_PREFIX))
    .sort();
  return Promise.all(
    paths.map(async (path) => ({
      filePath: `${ref}:${path}`,
      text: await git(["show", `${commit}:./${path}`], `read ${path} at ${commit}`)
    }))
  );
}

async function readBaseModelSources(
  directory: string
): Promise<{ filePath: string; text: string }[]> {
  const paths: string[] = [];
  for await (const path of new Glob("**/*.shape").scan({ cwd: directory, onlyFiles: true })) {
    if (!path.replace(/\\/g, "/").startsWith(GENERATED_AST_PREFIX)) {
      paths.push(path);
    }
  }
  return Promise.all(
    paths.sort().map(async (path) => {
      const filePath = join(directory, path);
      return { filePath, text: await readCliTextFile(filePath) };
    })
  );
}

async function git(args: string[], action: string): Promise<string> {
  const child = Bun.spawn(["git", ...args], { stdout: "pipe", stderr: "pipe" });
  const [output, errorOutput, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited
  ]);
  if (exitCode !== 0) {
    throw new CliDiagnosticError(
      `error: failed to ${action}\n\n${errorOutput.trim()}\n`,
      EXIT_USAGE
    );
  }
  return output;
}
