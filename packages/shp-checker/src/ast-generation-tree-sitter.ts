import { existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import type { AstGenerationDiagnostic, TreeSitterParseProvider } from "./ast-generation-types.ts";
import {
  currentTreeSitterNativeBindingTarget as currentNativeBindingTarget,
  type TreeSitterNativeBindingEmbeddedSpecifier,
  type TreeSitterNativeBindingPackageSpecifier,
  type TreeSitterNativeBindingTarget
} from "./tree-sitter-native-targets.ts";

type NativeBindingLoadResult =
  | { ok: true; moduleValue: unknown }
  | { ok: false; diagnostics: AstGenerationDiagnostic[] };

const treeSitterNativeRequire = createRequire(import.meta.url);

export const TREE_SITTER_LANGUAGE_PACK_VERSION = "1.8.1";
export const BUNDLED_TREE_SITTER_LANGUAGES = [
  "javascript",
  "typescript",
  "tsx",
  "rust",
  "go",
  "python"
] as const;

export async function loadTreeSitterProvider(): Promise<
  | { ok: true; provider: TreeSitterParseProvider }
  | { ok: false; diagnostics: AstGenerationDiagnostic[] }
> {
  const nativeBinding = loadTreeSitterNativeBinding();
  if (!nativeBinding.ok) {
    return nativeBinding;
  }

  const moduleValue = nativeBinding.moduleValue;
  if (!isRecord(moduleValue)) {
    return {
      ok: false,
      diagnostics: [
        {
          kind: "error",
          code: "invalid_tree_sitter_language_pack",
          message: "@kreuzberg/tree-sitter-language-pack did not export an object"
        }
      ]
    };
  }

  const bundledParserDiagnostics = configureBundledTreeSitterParsers(moduleValue);
  if (bundledParserDiagnostics.length > 0) {
    return {
      ok: false,
      diagnostics: bundledParserDiagnostics
    };
  }

  const getParser = methodFunction(moduleValue, ["getParser"]);
  if (!getParser) {
    return {
      ok: false,
      diagnostics: [
        {
          kind: "error",
          code: "invalid_tree_sitter_language_pack",
          message: "@kreuzberg/tree-sitter-language-pack native binding does not expose getParser"
        }
      ]
    };
  }

  return {
    ok: true,
    provider: async (language, source) => {
      const parser = await getParser(undefined, language);
      const tree = await callMethod(parser, ["parse"], [source]);
      if (!tree) {
        throw new Error(`parser for ${language} returned no tree`);
      }
      return tree;
    }
  };
}

export function configureBundledTreeSitterParsers(
  moduleValue: Record<string, unknown>,
  executablePath: string = process.execPath
): AstGenerationDiagnostic[] {
  const assetRoot = bundledTreeSitterParserAssetRoot(executablePath);
  if (!existsSync(assetRoot)) {
    return [];
  }

  const libsDir = bundledTreeSitterParserLibsDir(executablePath);
  const missing = BUNDLED_TREE_SITTER_LANGUAGES.map((language) =>
    join(libsDir, treeSitterParserLibraryName(language))
  ).filter((path) => !existsSync(path));
  if (missing.length > 0) {
    return [
      {
        kind: "error",
        code: "missing_bundled_tree_sitter_parsers",
        message: `bundled tree-sitter parser assets are incomplete; missing ${missing.join(", ")}`
      }
    ];
  }

  const configure = methodFunction(moduleValue, ["configure"]);
  if (!configure) {
    return [
      {
        kind: "error",
        code: "invalid_tree_sitter_language_pack",
        message: "@kreuzberg/tree-sitter-language-pack native binding does not expose configure"
      }
    ];
  }

  try {
    configure(undefined, { cacheDir: libsDir });
  } catch (error) {
    return [
      {
        kind: "error",
        code: "invalid_tree_sitter_parser_cache",
        message: `failed to configure bundled tree-sitter parser cache: ${errorMessage(error)}`
      }
    ];
  }

  return [];
}

export function bundledTreeSitterParserAssetRoot(
  executablePath: string = process.execPath
): string {
  // Allow an explicit override so a pre-bundled parser cache can be used when
  // running off-binary (e.g. via `bun`) or in a sandbox without network access.
  const override = process.env.SHP_TREE_SITTER_ASSET_ROOT;
  if (override && override.length > 0) {
    return override;
  }
  return join(dirname(executablePath), "tree-sitter-language-pack");
}

export function bundledTreeSitterParserLibsDir(
  executablePath: string = process.execPath,
  version: string = TREE_SITTER_LANGUAGE_PACK_VERSION
): string {
  return join(bundledTreeSitterParserAssetRoot(executablePath), version, "libs");
}

export function treeSitterParserLibraryName(
  language: (typeof BUNDLED_TREE_SITTER_LANGUAGES)[number],
  platform: NodeJS.Platform = process.platform
): string {
  const extension = platform === "win32" ? ".dll" : platform === "darwin" ? ".dylib" : ".so";
  const prefix = platform === "win32" ? "" : "lib";
  return `${prefix}tree_sitter_${language}${extension}`;
}

function loadTreeSitterNativeBinding(): NativeBindingLoadResult {
  const target = currentTreeSitterNativeBindingTarget();
  if (!target) {
    return {
      ok: false,
      diagnostics: [
        {
          kind: "error",
          code: "unsupported_tree_sitter_platform",
          message: `no bundled @kreuzberg/tree-sitter-language-pack native binding target for ${process.platform}-${process.arch}`
        }
      ]
    };
  }

  try {
    return {
      ok: true,
      moduleValue: requireTreeSitterNativeBinding(target)
    };
  } catch (error) {
    return {
      ok: false,
      diagnostics: [
        {
          kind: "error",
          code: "missing_tree_sitter_language_pack",
          message: `failed to load ${target.packageSpecifier}: ${errorMessage(error)}`
        }
      ]
    };
  }
}

function currentTreeSitterNativeBindingTarget(): TreeSitterNativeBindingTarget | undefined {
  if (process.platform === "linux" && isCurrentLinuxMusl()) {
    return undefined;
  }
  return currentNativeBindingTarget();
}

function requireTreeSitterNativeBinding(target: TreeSitterNativeBindingTarget): unknown {
  try {
    return requireTreeSitterNativePackageBinding(target.packageSpecifier);
  } catch (packageError) {
    try {
      return requireTreeSitterEmbeddedBinding(target.embeddedSpecifier);
    } catch (embeddedError) {
      throw new Error(
        `package ${errorMessage(packageError)}; embedded ${errorMessage(embeddedError)}`
      );
    }
  }
}

function requireTreeSitterNativePackageBinding(
  specifier: TreeSitterNativeBindingPackageSpecifier
): unknown {
  switch (specifier) {
    case "@kreuzberg/tree-sitter-language-pack/ts-pack-core-node.linux-x64-gnu.node":
      return treeSitterNativeRequire(
        "@kreuzberg/tree-sitter-language-pack/ts-pack-core-node.linux-x64-gnu.node"
      );
    case "@kreuzberg/tree-sitter-language-pack/ts-pack-core-node.linux-arm64-gnu.node":
      return treeSitterNativeRequire(
        "@kreuzberg/tree-sitter-language-pack/ts-pack-core-node.linux-arm64-gnu.node"
      );
    case "@kreuzberg/tree-sitter-language-pack/ts-pack-core-node.darwin-arm64.node":
      return treeSitterNativeRequire(
        "@kreuzberg/tree-sitter-language-pack/ts-pack-core-node.darwin-arm64.node"
      );
    case "@kreuzberg/tree-sitter-language-pack/ts-pack-core-node.win32-x64-msvc.node":
      return treeSitterNativeRequire(
        "@kreuzberg/tree-sitter-language-pack/ts-pack-core-node.win32-x64-msvc.node"
      );
    default:
      return assertNeverTreeSitterBinding(specifier);
  }
}

function requireTreeSitterEmbeddedBinding(
  specifier: TreeSitterNativeBindingEmbeddedSpecifier
): unknown {
  switch (specifier) {
    case "./ts-pack-core-node.linux-x64-gnu.node":
      return treeSitterNativeRequire("./ts-pack-core-node.linux-x64-gnu.node");
    case "./ts-pack-core-node.linux-arm64-gnu.node":
      return treeSitterNativeRequire("./ts-pack-core-node.linux-arm64-gnu.node");
    case "./ts-pack-core-node.darwin-arm64.node":
      return treeSitterNativeRequire("./ts-pack-core-node.darwin-arm64.node");
    case "./ts-pack-core-node.win32-x64-msvc.node":
      return treeSitterNativeRequire("./ts-pack-core-node.win32-x64-msvc.node");
    default:
      return assertNeverTreeSitterBinding(specifier);
  }
}

function assertNeverTreeSitterBinding(value: never): never {
  throw new Error(`unsupported Tree-sitter native binding target: ${String(value)}`);
}

function isCurrentLinuxMusl(): boolean {
  const report: unknown = process.report?.getReport?.();
  const header = isRecord(report) ? report["header"] : undefined;
  return detectLinuxMuslRuntime(header, process.arch, (loaderPath) => {
    try {
      statSync(loaderPath);
      return true;
    } catch {
      return false;
    }
  });
}

export function detectLinuxMuslRuntime(
  reportHeader: unknown,
  arch: NodeJS.Architecture,
  fileExists: (path: string) => boolean
): boolean {
  const header = reportHeader;
  if (isRecord(header)) {
    if (
      typeof header["glibcVersionRuntime"] === "string" ||
      typeof header["glibcVersion"] === "string"
    ) {
      return false;
    }

    const componentVersions = header["componentVersions"];
    if (isRecord(componentVersions) && typeof componentVersions["glibc"] === "string") {
      return false;
    }
  }

  for (const loaderPath of linuxMuslLoaderPaths(arch)) {
    if (fileExists(loaderPath)) {
      return true;
    }
  }

  return false;
}

function linuxMuslLoaderPaths(arch: NodeJS.Architecture): string[] {
  switch (arch) {
    case "x64":
      return [
        "/lib/ld-musl-x86_64.so.1",
        "/lib64/ld-musl-x86_64.so.1",
        "/usr/lib/ld-musl-x86_64.so.1"
      ];
    case "arm64":
      return [
        "/lib/ld-musl-aarch64.so.1",
        "/lib64/ld-musl-aarch64.so.1",
        "/usr/lib/ld-musl-aarch64.so.1"
      ];
    default:
      return [];
  }
}

function methodFunction(
  receiver: Record<string, unknown>,
  names: string[]
): ((thisValue: unknown, ...args: unknown[]) => Promise<unknown> | unknown) | undefined {
  for (const name of names) {
    const method = receiver[name];
    if (typeof method === "function") {
      return (thisValue, ...args) => Reflect.apply(method, thisValue ?? receiver, args) as unknown;
    }
  }
  return undefined;
}

function callMethod(receiver: unknown, names: string[], args: unknown[]): unknown {
  if (!isRecord(receiver)) {
    return undefined;
  }
  for (const name of names) {
    const method = receiver[name];
    if (typeof method === "function") {
      return Reflect.apply(method, receiver, args) as unknown;
    }
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
