import { lstat, readFile, readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { Glob } from "bun";
import { checkContract } from "../mapper/emit.ts";
import { inside } from "./config.ts";
import { compareText, fail, type ContractProject } from "./types.ts";

function maySelectDescendant(path: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => prefix.startsWith(`${path}/`) || `${path}/`.startsWith(prefix));
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
  // The literal leading text of each include, before its first glob character.
  const includes = project.include.map((pattern) => pattern.split(/[?*[{]/, 1)[0] ?? "");
  // Literal directories that an exclude ending in `/**` or `/**/*` removes entirely.
  const excludes = project.exclude
    .map((pattern) => /^(.*)\/\*\*(?:\/\*)?$/.exec(pattern)?.[1])
    .filter((prefix): prefix is string => prefix !== undefined && !/[?*[{]/.test(prefix));
  const excludedSubtree = (path: string): boolean =>
    excludes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
  const files: string[] = [];
  const walk = async (directory: string, parent: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true }).catch(() =>
      fail(
        "unsafe_path",
        directory,
        "Cannot inspect a directory in the governed filesystem.",
        project.tsconfig
      )
    );
    for (const entry of entries.sort((left, right) => compareText(left.name, right.name))) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      const absolute = join(directory, entry.name);
      const path = parent ? `${parent}/${entry.name}` : entry.name;
      if (excludedSubtree(path)) continue;
      if (entry.isSymbolicLink()) {
        // A selected dangling link is still a missing governed input.
        const directoryLink = await stat(absolute).then(
          (info) => info.isDirectory(),
          () => false
        );
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
      (path) =>
        JAVASCRIPT.test(path) &&
        inside(root, path) &&
        selected(relative(root, path).replaceAll("\\", "/"))
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

/** Requires a regular sibling contract that the mapper will accept, before any compiler runs. */
export async function validatePair(root: string, source: string): Promise<string> {
  const contract = `${source.slice(0, -3)}.shape`;
  const info = await lstat(contract).catch(() =>
    fail(
      "missing_contract",
      contract,
      "Every governed .ts file requires a sibling .shape contract.",
      source
    )
  );
  if (info.isSymbolicLink() || !info.isFile()) {
    fail(
      "unsafe_path",
      contract,
      "A sibling contract must be a regular file, not a symbolic link.",
      source
    );
  }
  // The mapper's own validation, so the gate stops on any contract the mapper would reject.
  const content = await readFile(contract, "utf8");
  const checked = checkContract({ fileName: contract, content, repoRoot: root });
  if (!checked.ok) {
    const located = checked.diagnostics.map(({ code, messageText, start }) => {
      const preceding = content.slice(0, start);
      const column = start - preceding.lastIndexOf("\n");
      return `${preceding.split("\n").length}:${column} shape-ts${code}: ${messageText}`;
    });
    fail("invalid_contract", contract, located.join("; "), source);
  }
  return contract;
}
