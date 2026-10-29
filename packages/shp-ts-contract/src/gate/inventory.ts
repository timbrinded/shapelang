import { lstat, readFile, readdir, realpath, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { Glob } from "bun";
import { isGeneratedAstModuleName, parseShapeModule } from "@shape/shp-checker";
import { stringValue } from "../mapper/strings.ts";
import { inside } from "./config.ts";
import { compareText, fail, GateFailure, type ContractProject } from "./types.ts";

export function slash(path: string): string {
  return path.replaceAll("\\", "/");
}

function maySelectDescendant(path: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    const prefix = pattern.split(/[?*[{]/, 1)[0] ?? "";
    return prefix.startsWith(`${path}/`) || `${path}/`.startsWith(prefix);
  });
}

/** Reads the filesystem, not Git or compiler inputs: new and ignored files count. */
export async function selectedSources(root: string, project: ContractProject): Promise<string[]> {
  const include = project.include.map((pattern) => new Glob(pattern));
  const exclude = project.exclude.map((pattern) => new Glob(pattern));
  const selected = (path: string): boolean =>
    include.some((glob) => glob.match(path)) && !exclude.some((glob) => glob.match(path));
  const excludedSubtree = (path: string): boolean =>
    project.exclude.some((pattern) => {
      const prefix = pattern.endsWith("/**/*")
        ? pattern.slice(0, -5)
        : pattern.endsWith("/**")
          ? pattern.slice(0, -3)
          : undefined;
      return (
        prefix !== undefined &&
        !/[?*[{]/.test(prefix) &&
        (path === prefix || path.startsWith(`${prefix}/`))
      );
    });
  const files: string[] = [];
  const walk = async (directory: string): Promise<void> => {
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
      const path = slash(relative(root, absolute));
      if (excludedSubtree(path)) continue;
      if (entry.isSymbolicLink()) {
        let directoryLink = false;
        try {
          directoryLink = (await stat(absolute)).isDirectory();
        } catch {
          // A selected dangling link is still a missing governed input.
        }
        if (selected(path) || (directoryLink && maySelectDescendant(path, project.include))) {
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
        if (maySelectDescendant(path, project.include)) await walk(absolute);
        continue;
      }
      if (!entry.isFile() || !selected(path) || !/\.(?:ts|tsx|mts|cts)$/.test(path)) continue;
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
  await walk(root);
  if (files.length === 0)
    fail(
      "empty_selection",
      project.tsconfig,
      "No supported source files match this project's include/exclude patterns."
    );
  return files.sort(compareText);
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
      const citation = fn.source?.ref;
      const path = stringValue(citation?.$cstNode);
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
