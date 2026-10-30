import { readFile, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import {
  getNodeValue,
  parseTree,
  printParseErrorCode,
  type Node,
  type ParseError
} from "jsonc-parser";
import { object } from "../mapper/protocol.ts";
import {
  fail,
  compareText,
  TESTED_TYPESCRIPT_VERSION,
  type ContractConfig,
  type ContractProject
} from "./types.ts";

export function keys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string
): void {
  const extra = Object.keys(value)
    .filter((key) => !allowed.includes(key))
    .sort();
  if (extra.length) fail("invalid_config", path, `Unknown keys: ${extra.join(", ")}.`);
}

export async function readJson(path: string, jsonc = false): Promise<unknown> {
  const text = await readFile(path, "utf8").catch(() =>
    fail("unreadable_config", path, "Cannot read the configuration file.")
  );
  const errors: ParseError[] = [];
  const tree = parseTree(text, errors, { allowTrailingComma: jsonc, disallowComments: !jsonc });
  const first = errors[0];
  if (first || !tree) {
    fail(
      "invalid_config",
      path,
      first ? `${printParseErrorCode(first.error)} at offset ${first.offset}.` : "Expected JSON."
    );
  }
  rejectDuplicateKeys(tree, path);
  return getNodeValue(tree);
}

function rejectDuplicateKeys(node: Node, path: string): void {
  if (node.type === "object") {
    const seen = new Set<string>();
    for (const property of node.children ?? []) {
      const key = property.children?.[0]?.value;
      if (typeof key === "string") {
        if (seen.has(key))
          fail("invalid_config", path, `Duplicate JSON key ${JSON.stringify(key)}.`);
        seen.add(key);
      }
    }
  }
  for (const child of node.children ?? []) rejectDuplicateKeys(child, path);
}

export function relativePath(value: unknown, path: string, label: string): string {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    value.length === 0 ||
    value.includes("\\") ||
    value.includes("\0") ||
    isAbsolute(value) ||
    /^[A-Za-z]:/.test(value)
  ) {
    fail(
      "invalid_config",
      path,
      `${label} must be a nonempty relative path using forward slashes.`
    );
  }
  return value;
}

/** An include must select something; an exclude may be empty. */
function patterns(value: unknown, path: string, label: "include" | "exclude"): string[] {
  const required = label === "include";
  if (!Array.isArray(value) || (required && value.length === 0)) {
    fail(
      "invalid_config",
      path,
      `${label} must be ${required ? "a nonempty" : "an"} array of globs.`
    );
  }
  const result = value.map((entry: unknown) => {
    const pattern = relativePath(entry, path, label);
    if (
      pattern.startsWith("!") ||
      pattern.split("/").some((part) => part === ".." || part === ".")
    ) {
      fail(
        "invalid_config",
        path,
        `${label} cannot negate a glob or traverse parent/current segments.`
      );
    }
    return pattern;
  });
  if (new Set(result).size !== result.length)
    fail("invalid_config", path, `${label} contains duplicates.`);
  return result;
}

export function inside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

export async function loadConfig(configPath: string): Promise<ContractConfig> {
  const data = await readJson(configPath);
  if (!object(data)) fail("invalid_config", configPath, "Expected a configuration object.");
  keys(data, ["version", "repoRoot", "compiler", "projects"], configPath);
  if (data.version !== 1)
    fail("invalid_config", configPath, "Only configuration version 1 is supported.");
  const rootInput = relativePath(data.repoRoot, configPath, "repoRoot");
  const missingRoot = (): never =>
    fail("invalid_config", configPath, "repoRoot must resolve to an existing directory.");
  const repoRoot = await realpath(resolve(dirname(configPath), rootInput)).catch(missingRoot);
  if (!(await stat(repoRoot).then((info) => info.isDirectory(), missingRoot))) missingRoot();
  if (!object(data.compiler)) fail("invalid_config", configPath, "compiler must be an object.");
  keys(data.compiler, ["package", "version"], configPath);
  if (
    data.compiler.package !== "typescript" ||
    data.compiler.version !== TESTED_TYPESCRIPT_VERSION
  ) {
    fail(
      "unsupported_compiler",
      configPath,
      `Use compiler package typescript, version ${TESTED_TYPESCRIPT_VERSION}.`
    );
  }
  if (!Array.isArray(data.projects) || data.projects.length === 0) {
    fail("invalid_config", configPath, "projects must be a nonempty array.");
  }
  const names = new Set<string>();
  const configs = new Set<string>();
  const projects: ContractProject[] = data.projects.map((entry: unknown) => {
    if (!object(entry)) fail("invalid_config", configPath, "Each project must be an object.");
    keys(entry, ["name", "tsconfig", "include", "exclude"], configPath);
    if (
      typeof entry.name !== "string" ||
      !/^[A-Za-z0-9_-]+$/.test(entry.name) ||
      names.has(entry.name)
    ) {
      fail(
        "invalid_config",
        configPath,
        "Project names must be unique, nonempty letters, digits, underscores or hyphens."
      );
    }
    names.add(entry.name);
    const tsconfig = resolve(repoRoot, relativePath(entry.tsconfig, configPath, "tsconfig"));
    if (!inside(repoRoot, tsconfig) || configs.has(tsconfig)) {
      fail("invalid_config", configPath, "Each tsconfig must be unique and inside repoRoot.");
    }
    configs.add(tsconfig);
    return {
      name: entry.name,
      tsconfig,
      include: patterns(entry.include, configPath, "include"),
      exclude: patterns(entry.exclude ?? [], configPath, "exclude")
    };
  });
  return {
    repoRoot,
    projects: projects.sort((left, right) => compareText(left.name, right.name))
  };
}
