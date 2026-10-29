import { lstat, readFile, readdir, realpath, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { Glob } from "bun";
import { isGeneratedAstModuleName, parseShapeModule } from "@shape/shp-checker";
import { inside } from "./config.ts";
import { compareText, fail, GateFailure, type ContractProject } from "./types.ts";

export function slash(path: string): string {
  return path.replaceAll("\\", "/");
}

/** The literal leading text of each include, before its first glob character. */
function includePrefixes(project: ContractProject): string[] {
  return project.include.map((pattern) => pattern.split(/[?*[{]/, 1)[0] ?? "");
}

function maySelectDescendant(path: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => prefix.startsWith(`${path}/`) || `${path}/`.startsWith(prefix));
}

/** Literal directories that an exclude ending in `/**` or `/**\/*` removes entirely. */
function excludedDirectories(project: ContractProject): string[] {
  return project.exclude
    .map((pattern) => /^(.*)\/\*\*(?:\/\*)?$/.exec(pattern)?.[1])
    .filter((prefix): prefix is string => prefix !== undefined && !/[?*[{]/.test(prefix));
}

const TYPESCRIPT_VARIANT = /\.(?:tsx|mts|cts)$/;
const JAVASCRIPT = /\.(?:js|jsx|mjs|cjs)$/;

/**
 * A path whose extension matches `renamed` is also tested under its .ts spelling,
 * so renaming a governed file cannot move it out of a .ts selector. Excludes see
 * both spellings, so an explicit .mts exclude still applies. JavaScript spellings
 * apply only to compiler roots: without allowJs a .js file is not governed.
 */
function projectSelection(project: ContractProject, renamed: RegExp): (path: string) => boolean {
  const include = project.include.map((pattern) => new Glob(pattern));
  const exclude = project.exclude.map((pattern) => new Glob(pattern));
  return (path) => {
    const spellings = [path, path.replace(renamed, ".ts")];
    return (
      spellings.some((spelling) => include.some((glob) => glob.match(spelling))) &&
      !spellings.some((spelling) => exclude.some((glob) => glob.match(spelling)))
    );
  };
}

/** Reads the filesystem, not Git or compiler inputs: new and ignored files count. */
export async function selectedSources(root: string, project: ContractProject): Promise<string[]> {
  const selected = projectSelection(project, TYPESCRIPT_VARIANT);
  const includes = includePrefixes(project);
  const excludes = excludedDirectories(project);
  const excludedSubtree = (path: string): boolean =>
    excludes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
  const files: string[] = [];
  const walk = async (directory: string, parent: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      fail(
        "unsafe_path",
        directory,
        "Cannot inspect a directory in the governed filesystem.",
        project.tsconfig
      );
    }
    for (const entry of entries.sort((left, right) => compareText(left.name, right.name))) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      const absolute = join(directory, entry.name);
      const path = parent ? `${parent}/${entry.name}` : entry.name;
      if (excludedSubtree(path)) continue;
      if (entry.isSymbolicLink()) {
        let directoryLink = false;
        try {
          directoryLink = (await stat(absolute)).isDirectory();
        } catch {
          // A selected dangling link is still a missing governed input.
        }
        if (selected(path) || (directoryLink && maySelectDescendant(path, includes))) {
          fail(
            "unsafe_path",
            absolute,
            "Governed source paths cannot traverse symbolic links.",
            project.tsconfig
          );
        }
        continue;
      }
      if (entry.isDirectory()) {
        if (maySelectDescendant(path, includes)) await walk(absolute, path);
        continue;
      }
      if (!entry.isFile() || !/\.(?:ts|tsx|mts|cts)$/.test(path) || !selected(path)) continue;
      if (!path.endsWith(".ts") || path.endsWith(".d.ts")) {
        fail(
          "unsupported_source",
          absolute,
          "Version 1 supports .ts implementation files only; exclude .tsx, .mts, .cts and .d.ts explicitly.",
          project.tsconfig
        );
      }
      files.push(absolute);
    }
  };
  await walk(root, "");
  if (files.length === 0)
    fail(
      "empty_selection",
      project.tsconfig,
      "No supported source files match this project's include/exclude patterns."
    );
  return files.sort(compareText);
}

/** allowJs can add selected-tree JavaScript to the program; version 1 checks .ts sources only. */
export function rejectJavaScriptRoots(
  root: string,
  project: ContractProject,
  roots: Iterable<string>
): void {
  const selected = projectSelection(project, JAVASCRIPT);
  const file = [...roots]
    .filter(
      (path) => JAVASCRIPT.test(path) && inside(root, path) && selected(slash(relative(root, path)))
    )
    .sort(compareText)[0];
  if (file) {
    fail(
      "unsupported_source",
      file,
      "Version 1 supports .ts implementation files only; this JavaScript compiler root lies in the selected tree, so exclude it explicitly.",
      project.tsconfig
    );
  }
}

export function contractFor(source: string): string {
  return `${source.slice(0, -3)}.shape`;
}

export async function validatePair(root: string, source: string): Promise<string> {
  const contract = contractFor(source);
  try {
    const info = await lstat(contract);
    if (info.isSymbolicLink() || !info.isFile()) {
      fail(
        "unsafe_path",
        contract,
        "A sibling contract must be a regular file, not a symbolic link.",
        source
      );
    }
  } catch (error) {
    if (error instanceof GateFailure) throw error;
    fail(
      "missing_contract",
      contract,
      "Every governed .ts file requires a sibling .shape contract.",
      source
    );
  }
  const canonical = await realpath(contract);
  if (!inside(root, canonical))
    fail("unsafe_path", contract, "The contract resolves outside repoRoot.", source);
  const parsed = parseShapeModule(await readFile(contract, "utf8"), contract);
  if (!parsed.ok) {
    fail(
      "invalid_contract",
      contract,
      parsed.diagnostics.map((diagnostic) => diagnostic.message).join("; "),
      source
    );
  }
  const contractPath = slash(relative(root, contract));
  if (
    isGeneratedAstModuleName(parsed.module.name ?? "") ||
    contractPath.startsWith("shape/generated/ast/")
  ) {
    fail(
      "generated_contract",
      contract,
      "Generated AST drafts cannot serve as authored TypeScript contracts.",
      source
    );
  }
  const expected = slash(relative(root, source));
  for (const component of parsed.module.declarations) {
    if (component.$type !== "ComponentDecl") continue;
    for (const fn of component.members) {
      if (fn.$type !== "FunctionSummary") continue;
      // Read the value Langium decoded, as shp check and shp fmt do.
      const citation = fn.source?.ref;
      const path = citation?.path;
      if (
        !citation ||
        !["ts", "typescript"].includes(citation.language) ||
        path?.split("#", 1)[0] !== expected ||
        !path.includes("#")
      ) {
        fail(
          "mismatched_source",
          contract,
          `${component.name}.${fn.name} must cite ts(${JSON.stringify(`${expected}#exportName`)}) in its sibling source.`,
          source
        );
      }
    }
  }
  return contract;
}
