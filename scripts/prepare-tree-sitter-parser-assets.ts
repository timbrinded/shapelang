#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";

import {
  BUNDLED_TREE_SITTER_LANGUAGES,
  TREE_SITTER_LANGUAGE_PACK_VERSION,
  currentTreeSitterNativeBindingTarget,
  treeSitterParserLibraryName
} from "../packages/shp-checker/src/ast-generation.ts";

type Manifest = {
  readonly version: string;
  readonly platforms: Record<string, { readonly url: string; readonly sha256: string }>;
  readonly languages: Record<string, unknown>;
};

type LanguagePackModule = {
  readonly JsDownloadManager?: {
    readonly ["new"]: (version: string) => { fetchManifest(): unknown };
  };
};

const releasePlatformKeys = new Map<string, { manifestKey: string; nodePlatform: NodeJS.Platform }>(
  [
    ["shp-linux-x64", { manifestKey: "linux-x86_64", nodePlatform: "linux" }],
    ["shp-linux-arm64", { manifestKey: "linux-aarch64", nodePlatform: "linux" }],
    ["shp-darwin-arm64", { manifestKey: "macos-arm64", nodePlatform: "darwin" }],
    ["shp-windows-x64", { manifestKey: "windows-x86_64", nodePlatform: "win32" }]
  ]
);

const args = new Map<string, string>();
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index];
  const value = process.argv[index + 1];
  if (!key?.startsWith("--") || !value) {
    throw new Error("usage: prepare-tree-sitter-parser-assets --release-name NAME --out-dir DIR");
  }
  args.set(key.slice(2), value);
}

const releaseName = args.get("release-name");
const outDir = args.get("out-dir");
if (!releaseName || !outDir) {
  throw new Error("usage: prepare-tree-sitter-parser-assets --release-name NAME --out-dir DIR");
}

const platform = releasePlatformKeys.get(releaseName);
if (!platform) {
  throw new Error(`no parser bundle platform mapping for ${releaseName}`);
}

const requireFromChecker = createRequire(
  `${process.cwd()}/packages/shp-checker/src/ast-generation.ts`
);
const languagePackPackageJson = requireFromChecker(
  "@kreuzberg/tree-sitter-language-pack/package.json"
) as { version?: string };
if (languagePackPackageJson.version !== TREE_SITTER_LANGUAGE_PACK_VERSION) {
  throw new Error(
    `tree-sitter language pack version mismatch: runtime expects ${TREE_SITTER_LANGUAGE_PACK_VERSION}, package is ${languagePackPackageJson.version}`
  );
}

const nativeBindingTarget = currentTreeSitterNativeBindingTarget();
if (!nativeBindingTarget) {
  throw new Error(
    `no tree-sitter language pack native binding for ${process.platform}-${process.arch}`
  );
}

const languagePack = requireFromChecker(nativeBindingTarget.packageSpecifier) as LanguagePackModule;
const manifest = languagePack.JsDownloadManager?.["new"](
  TREE_SITTER_LANGUAGE_PACK_VERSION
).fetchManifest() as Manifest | undefined;
if (!manifest) {
  throw new Error("tree-sitter language pack did not return a parser manifest");
}
if (manifest.version !== TREE_SITTER_LANGUAGE_PACK_VERSION) {
  throw new Error(`parser manifest version ${manifest.version} did not match package version`);
}
for (const language of BUNDLED_TREE_SITTER_LANGUAGES) {
  if (!(language in manifest.languages)) {
    throw new Error(`parser manifest does not advertise ${language}`);
  }
}

const bundle = manifest.platforms[platform.manifestKey];
if (!bundle) {
  throw new Error(`parser manifest has no platform ${platform.manifestKey}`);
}

const tempDir = await mkdtemp(join(tmpdir(), "shp-parser-assets-"));
try {
  const bundlePath = join(tempDir, basename(new URL(bundle.url).pathname));
  const archiveBytes = await fetchBytes(bundle.url);
  const actualHash = createHash("sha256").update(archiveBytes).digest("hex");
  if (actualHash !== bundle.sha256) {
    throw new Error(`checksum verification failed for ${bundle.url}`);
  }
  await writeFile(bundlePath, archiveBytes);

  const extractDir = join(tempDir, "extract");
  await mkdir(extractDir);
  await extractTarZst(bundlePath, extractDir);

  const libsDir = join(
    outDir,
    "tree-sitter-language-pack",
    TREE_SITTER_LANGUAGE_PACK_VERSION,
    "libs"
  );
  await rm(dirname(dirname(libsDir)), { recursive: true, force: true });
  await mkdir(libsDir, { recursive: true });

  for (const language of BUNDLED_TREE_SITTER_LANGUAGES) {
    const libraryName = treeSitterParserLibraryName(language, platform.nodePlatform);
    const source = findExtractedFile(extractDir, libraryName);
    if (!source) {
      throw new Error(`${bundle.url} did not contain ${libraryName}`);
    }
    await copyFile(source, join(libsDir, libraryName));
  }
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

async function extractTarZst(archivePath: string, destination: string): Promise<void> {
  const process = Bun.spawn(
    ["sh", "-c", 'zstd -dc "$1" | tar -xf - -C "$2"', "sh", archivePath, destination],
    {
      stdout: "inherit",
      stderr: "inherit"
    }
  );
  const exitCode = await process.exited;
  if (exitCode !== 0) {
    throw new Error(`failed to extract ${archivePath}`);
  }
}

function findExtractedFile(root: string, fileName: string): string | undefined {
  const entries = new Bun.Glob(`**/${fileName}`).scanSync({ cwd: root, absolute: true });
  for (const entry of entries) {
    if (existsSync(entry)) {
      return entry;
    }
  }
  return undefined;
}
