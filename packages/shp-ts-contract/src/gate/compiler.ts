import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { realpath, stat } from "node:fs/promises";
import { inside, object, readJson, relativePath } from "./config.ts";
import { fail, MAPPER_PACKAGE, TESTED_TYPESCRIPT_VERSION, type ContractProject } from "./types.ts";
import { captureProcess, type ProcessOutput } from "./process.ts";
import { loosensStrictness, STRICT_CHECKING_REQUIRED } from "../mapper/protocol.ts";

export type Compiler = { node: string; wrapper: string };

export async function resolveCompiler(tsconfig: string): Promise<Compiler> {
  let metadataPath: string;
  try {
    metadataPath = createRequire(tsconfig).resolve("typescript/package.json");
  } catch {
    fail(
      "compiler_not_found",
      tsconfig,
      `Install typescript@${TESTED_TYPESCRIPT_VERSION} in this project; no global compiler is used.`
    );
  }
  const metadata = await readJson(metadataPath);
  if (!object(metadata) || metadata.name !== "typescript") {
    fail(
      "invalid_compiler",
      metadataPath,
      "Resolved compiler package is not typescript.",
      tsconfig
    );
  }
  if (metadata.version !== TESTED_TYPESCRIPT_VERSION) {
    fail(
      "compiler_version_mismatch",
      metadataPath,
      `Expected ${TESTED_TYPESCRIPT_VERSION}; found ${String(metadata.version)}.`,
      tsconfig
    );
  }
  const bin = object(metadata.bin) ? metadata.bin.tsc : undefined;
  if (typeof bin !== "string" || bin.length === 0)
    fail("invalid_compiler", metadataPath, "Compiler metadata must declare bin.tsc.", tsconfig);
  const wrapper = resolve(dirname(metadataPath), bin);
  if (!inside(dirname(metadataPath), wrapper))
    fail(
      "invalid_compiler",
      metadataPath,
      "bin.tsc must remain inside the compiler package.",
      tsconfig
    );
  try {
    if (!(await stat(wrapper)).isFile()) throw new Error("not a file");
  } catch {
    fail("invalid_compiler", wrapper, "The compiler's tsc wrapper is unavailable.", tsconfig);
  }
  const node = Bun.which("node");
  if (!node)
    fail("invalid_compiler", tsconfig, "Node.js must be on PATH to run the compiler wrapper.");
  return { node, wrapper };
}

export async function validateMapper(project: ContractProject, root: string): Promise<void> {
  let actualConfig: string;
  try {
    actualConfig = await realpath(project.tsconfig);
  } catch {
    fail("unreadable_config", project.tsconfig, "Cannot read the project's tsconfig.");
  }
  if (actualConfig !== project.tsconfig || !inside(root, actualConfig)) {
    fail(
      "unsafe_path",
      project.tsconfig,
      "tsconfig must be inside repoRoot and cannot traverse symbolic links."
    );
  }
  const config = await readJson(project.tsconfig, true);
  if (!object(config)) fail("invalid_config", project.tsconfig, "Expected a tsconfig object.");
  const registrations = config.contentMappers;
  if (!Array.isArray(registrations) || registrations.length !== 1) {
    fail(
      "invalid_mapper",
      project.tsconfig,
      "Declare exactly one local contentMappers entry for @shape/shp-ts-contract; inherited-only registration is unsupported."
    );
  }
  const mapper: unknown = registrations[0];
  if (!object(mapper))
    fail("invalid_mapper", project.tsconfig, "The mapper registration must be an object.");
  const unknown = Object.keys(mapper).filter(
    (key) => !["package", "extensions", "options"].includes(key)
  );
  if (
    unknown.length ||
    mapper.package !== MAPPER_PACKAGE ||
    !Array.isArray(mapper.extensions) ||
    mapper.extensions.length !== 1 ||
    mapper.extensions[0] !== ".shape"
  ) {
    fail(
      "invalid_mapper",
      project.tsconfig,
      'Register only @shape/shp-ts-contract for exactly [".shape"], with package, extensions and options keys.'
    );
  }
  if (!object(mapper.options))
    fail("invalid_mapper", project.tsconfig, "Mapper options must explicitly declare repoRoot.");
  if (Object.keys(mapper.options).some((key) => key !== "repoRoot")) {
    fail("invalid_mapper", project.tsconfig, "The only supported mapper option is repoRoot.");
  }
  const mapperRoot = resolve(
    dirname(project.tsconfig),
    relativePath(mapper.options.repoRoot, project.tsconfig, "mapper repoRoot")
  );
  if (mapperRoot !== root) {
    fail(
      "invalid_mapper",
      project.tsconfig,
      "Mapper repoRoot, resolved from the tsconfig directory, must equal the gate's repoRoot."
    );
  }
  // A stale link to another checkout would otherwise check with a different mapper.
  const gatePackage = await realpath(resolve(import.meta.dir, "../.."));
  const linkedPackage = await nativeMapperPackage(project.tsconfig);
  if (linkedPackage === undefined) {
    fail(
      "invalid_mapper",
      project.tsconfig,
      `Cannot find node_modules/${MAPPER_PACKAGE} from this project; link ${gatePackage}, the package this gate runs from.`
    );
  }
  if (linkedPackage !== gatePackage) {
    fail(
      "invalid_mapper",
      project.tsconfig,
      `This project resolves ${MAPPER_PACKAGE} to ${linkedPackage}, but this gate runs from ${gatePackage}; link the same checkout's package.`
    );
  }
}

/**
 * Locates the mapper package as the native compiler does: the nearest existing
 * node_modules/@shape/shp-ts-contract directory above the tsconfig. Module
 * resolution is not used, because Bun applies tsconfig `paths` and package
 * `exports`, which the compiler ignores when it loads the mapper.
 */
async function nativeMapperPackage(tsconfig: string): Promise<string | undefined> {
  for (let directory = dirname(tsconfig); ; directory = dirname(directory)) {
    const candidate = join(directory, "node_modules", MAPPER_PACKAGE);
    try {
      if ((await stat(candidate)).isDirectory()) return await realpath(candidate);
    } catch {
      // A missing entry or a dangling link does not end the compiler's search.
    }
    if (dirname(directory) === directory) return undefined;
  }
}

export async function runCompiler(
  compiler: Compiler,
  project: ContractProject,
  showConfig: boolean
): Promise<ProcessOutput> {
  const args = [
    compiler.wrapper,
    "-p",
    project.tsconfig,
    "--runExternalCode",
    "--pretty",
    "false",
    ...(showConfig ? ["--showConfig"] : ["--noEmit"])
  ];
  return captureProcess(compiler.node, args, dirname(project.tsconfig));
}

export function compilerRoots(output: string, project: ContractProject): Set<string> {
  let config: unknown;
  try {
    config = JSON.parse(output);
  } catch {
    fail("invalid_compiler", project.tsconfig, "Compiler --showConfig did not return JSON.");
  }
  if (
    !object(config) ||
    !Array.isArray(config.files) ||
    !config.files.every((file: unknown) => typeof file === "string")
  ) {
    fail(
      "invalid_compiler",
      project.tsconfig,
      "Compiler --showConfig must report its resolved root files."
    );
  }
  if (
    config.references !== undefined &&
    !(Array.isArray(config.references) && config.references.length === 0)
  ) {
    fail(
      "invalid_compiler",
      project.tsconfig,
      "Version 1 does not support project references: referenced types come from built .d.ts outputs, so the result would depend on whether those builds are current."
    );
  }
  // The mapper refuses the same options; checking here stops before any mapper runs.
  const options = config.compilerOptions;
  if (!object(options) || loosensStrictness(options)) {
    fail("invalid_compiler", project.tsconfig, STRICT_CHECKING_REQUIRED);
  }
  if (
    options.moduleSuffixes !== undefined &&
    (!Array.isArray(options.moduleSuffixes) ||
      options.moduleSuffixes.length !== 1 ||
      options.moduleSuffixes[0] !== "")
  ) {
    fail(
      "invalid_compiler",
      project.tsconfig,
      'moduleSuffixes must be omitted or exactly [""]; other suffixes can redirect a contract import to a different source file from the governed sibling.'
    );
  }
  return new Set(config.files.map((file: string) => resolve(dirname(project.tsconfig), file)));
}
