import { readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

export const GENERATED_AST_MODULE_BASE = "shape.generated.ast";
export const GENERATED_AST_DIR = "shape/generated/ast";
export const GENERATED_AST_MANIFEST_FILE = `${GENERATED_AST_DIR}/manifest.json`;

export type GeneratedAstManifestEntry = {
  readonly module: string;
  readonly path: string;
  readonly sources: readonly string[];
};

export type GeneratedAstManifest = {
  readonly version: 1;
  readonly generatedAt: string;
  readonly entries: readonly GeneratedAstManifestEntry[];
};

export function isGeneratedAstModuleName(moduleName: string): boolean {
  return (
    moduleName === GENERATED_AST_MODULE_BASE ||
    moduleName.startsWith(`${GENERATED_AST_MODULE_BASE}.`)
  );
}

export function normalizeGeneratedAstPath(path: string, cwd = process.cwd()): string {
  const repoRelative = isAbsolute(path) ? relative(cwd, path) : path;
  return repoRelative.replace(/\\/g, "/").replace(/^\.\//, "");
}

export function isTrustedGeneratedAstModule(
  moduleName: string,
  filePath: string | undefined,
  cwd = process.cwd()
): boolean {
  if (!filePath || !isGeneratedAstModuleName(moduleName)) {
    return false;
  }

  const normalizedPath = normalizeGeneratedAstPath(filePath, cwd);
  if (
    normalizedPath !== GENERATED_AST_MANIFEST_FILE &&
    !normalizedPath.startsWith(`${GENERATED_AST_DIR}/`)
  ) {
    return false;
  }

  const manifest = readGeneratedAstManifest(cwd);
  if (!manifest) {
    return false;
  }

  return manifest.entries.some(
    (entry) =>
      entry.module === moduleName && normalizeGeneratedAstPath(entry.path, cwd) === normalizedPath
  );
}

export function isGeneratedAstManifest(value: unknown): value is GeneratedAstManifest {
  if (!isRecord(value) || value["version"] !== 1 || typeof value["generatedAt"] !== "string") {
    return false;
  }
  const entries = value["entries"];
  return Array.isArray(entries) && entries.every(isGeneratedAstManifestEntry);
}

function readGeneratedAstManifest(cwd: string): GeneratedAstManifest | undefined {
  try {
    const parsed: unknown = JSON.parse(
      readFileSync(resolve(cwd, GENERATED_AST_MANIFEST_FILE), "utf8")
    );
    return isGeneratedAstManifest(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isGeneratedAstManifestEntry(value: unknown): value is GeneratedAstManifestEntry {
  if (!isRecord(value)) {
    return false;
  }
  const sources = value["sources"];
  return (
    typeof value["module"] === "string" &&
    typeof value["path"] === "string" &&
    Array.isArray(sources) &&
    sources.every((source) => typeof source === "string")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
