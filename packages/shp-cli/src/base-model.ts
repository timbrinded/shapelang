import { Glob } from "bun";
import { join, relative, resolve } from "node:path";
import { parseShapeModule, type CheckModuleInput } from "@shape/shp-checker";
import type { CliContext } from "./context";
import { CliDiagnosticError } from "./errors";
import { git } from "./git";
import { stderr } from "./io";
import { readCliTextFile } from "./shape-files";

export type BaseModelFlags = {
  readonly baseRef?: string;
  readonly baseModel?: string;
};

// Generated AST modules never declare attestations, so the base model skips them.
const GENERATED_AST_PREFIX = "shape/generated/ast/";

/**
 * Loads the `.shape` files the check compares attestations against: those under
 * `shape/` plus the files named on the command line, at their repository paths.
 * Reading all of `shape/` even for a narrower check still finds an attestation
 * that moved out of a file the current check does not name. `--base-ref` reads
 * the files from git at the merge base of REF and HEAD; `--base-model` reads
 * them from a directory that mirrors the repository. Returns undefined when
 * neither is given, or when a base file cannot be parsed, in which case
 * attestations fall back to the declaring-file rule.
 */
export async function loadBaseModules(
  context: CliContext,
  flags: BaseModelFlags,
  providedFiles: readonly string[]
): Promise<CheckModuleInput[] | undefined> {
  if (flags.baseRef !== undefined && flags.baseModel !== undefined) {
    throw new CliDiagnosticError("error: --base-ref and --base-model cannot be combined\n");
  }
  const selection = [
    "shape",
    ...providedFiles.map((file) => relative(process.cwd(), resolve(file)).replace(/\\/g, "/"))
  ];
  const selected = (path: string): boolean =>
    path.endsWith(".shape") &&
    !path.startsWith(GENERATED_AST_PREFIX) &&
    selection.some((entry) => path === entry || path.startsWith(`${entry}/`));

  let sources: { filePath: string; text: string }[];
  if (flags.baseRef !== undefined) {
    sources = await readBaseRefSources(flags.baseRef, selected);
  } else if (flags.baseModel !== undefined) {
    sources = await readBaseModelSources(flags.baseModel, selected);
    // An empty base would count every attestation as new without a word.
    if (sources.length === 0) {
      throw new CliDiagnosticError(
        `error: --base-model ${flags.baseModel} holds no .shape files at their repository paths, such as shape/\n`
      );
    }
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
  selected: (path: string) => boolean
): Promise<{ filePath: string; text: string }[]> {
  const commit = (await git(["merge-base", ref, "HEAD"], `resolve --base-ref ${ref}`)).trim();
  const listing = await git(
    ["ls-tree", "-r", "-z", "--name-only", commit],
    `list .shape files at ${commit}`
  );
  const paths = listing.split("\0").filter(selected).sort();
  return Promise.all(
    paths.map(async (path) => ({
      filePath: path,
      text: await git(["show", `${commit}:./${path}`], `read ${path} at ${commit}`)
    }))
  );
}

async function readBaseModelSources(
  directory: string,
  selected: (path: string) => boolean
): Promise<{ filePath: string; text: string }[]> {
  const paths: string[] = [];
  for await (const path of new Glob("**/*.shape").scan({ cwd: directory, onlyFiles: true })) {
    const repositoryPath = path.replace(/\\/g, "/");
    if (selected(repositoryPath)) {
      paths.push(repositoryPath);
    }
  }
  return Promise.all(
    paths.sort().map(async (path) => ({
      filePath: path,
      text: await readCliTextFile(join(directory, path))
    }))
  );
}
