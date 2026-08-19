#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildAtlasModel } from "../lib/atlas-model.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUTPUT = ".research/unix-system-visualiser/index.html";
const options = parseArguments(process.argv.slice(2));
const repositoryRoot = resolveRepositoryRoot(options.repository);
const outputPath = resolveOutputPath(repositoryRoot, options.output);

assertSafeOutputLocation(repositoryRoot, outputPath);
if (!options.allowUnignoredOutput) {
  requireIgnoredOutput(repositoryRoot, outputPath);
}

let atlas;
try {
  atlas = buildAtlasModel(inspectShapeModel(repositoryRoot, options.shapeCommand));
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
const serializedAtlas = JSON.stringify(atlas).replace(/</g, "\\u003c");

function parseArguments(arguments_) {
  const parsed = {
    allowUnignoredOutput: false,
    output: DEFAULT_OUTPUT,
    repository: process.cwd(),
    shapeCommand: process.env.SHAPE_CMD || "shp"
  };

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--allow-unignored-output") {
      parsed.allowUnignoredOutput = true;
      continue;
    }
    if (argument === "--help" || argument === "-h") {
      printHelp();
      process.exit(0);
    }
    if (argument === "--output" || argument === "--repo" || argument === "--shape-command") {
      const value = arguments_[index + 1];
      if (!value) {
        fail(`${argument} requires a value`);
      }
      index += 1;
      if (argument === "--output") {
        parsed.output = value;
      } else if (argument === "--repo") {
        parsed.repository = value;
      } else {
        parsed.shapeCommand = value;
      }
      continue;
    }
    fail(`unknown argument: ${argument}`);
  }

  return parsed;
}

function printHelp() {
  console.log(`Generate a self-contained Unix System Visualiser from authored Shape.

Usage:
  generate.mjs [--repo PATH] [--output PATH] [--shape-command COMMAND]
               [--allow-unignored-output]

Options:
  --repo PATH                 Repository root. Defaults to the current directory.
  --output PATH               Output file inside the repository. Defaults to
                              ${DEFAULT_OUTPUT}.
  --shape-command COMMAND     Shape command. Defaults to SHAPE_CMD or shp.
  --allow-unignored-output    Permit an output path that Git does not ignore.
  -h, --help                  Show this help.
`);
}

function resolveOutputPath(root, output) {
  const resolved = path.resolve(root, output);
  const relative = path.relative(root, resolved);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    fail("output must be inside the repository");
  }
  return resolved;
}

function resolveRepositoryRoot(repository) {
  const resolved = path.resolve(repository);
  try {
    const realRoot = fs.realpathSync(resolved);
    if (!fs.statSync(realRoot).isDirectory()) {
      fail(`repository root is not a directory: ${resolved}`);
    }
    return realRoot;
  } catch (error) {
    fail(
      `cannot resolve repository root ${resolved}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

function assertSafeOutputLocation(root, output) {
  const parent = path.dirname(output);
  const relativeParent = path.relative(root, parent);
  let current = root;
  for (const segment of relativeParent.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const metadata = lstatIfPresent(current);
    if (!metadata) {
      break;
    }
    if (metadata.isSymbolicLink()) {
      fail(`output path must not contain symbolic links: ${path.relative(root, current)}`);
    }
    if (!metadata.isDirectory()) {
      fail(`output parent is not a directory: ${path.relative(root, current)}`);
    }
  }
  if (fs.existsSync(parent)) {
    const realParent = fs.realpathSync(parent);
    const relativeRealParent = path.relative(root, realParent);
    if (
      relativeRealParent === ".." ||
      relativeRealParent.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativeRealParent)
    ) {
      fail("output parent resolves outside the repository");
    }
  }
  const outputMetadata = lstatIfPresent(output);
  if (outputMetadata?.isSymbolicLink()) {
    fail(`output path must not be a symbolic link: ${path.relative(root, output)}`);
  }
  if (outputMetadata && !outputMetadata.isFile()) {
    fail(`output path is not a regular file: ${path.relative(root, output)}`);
  }
}

function lstatIfPresent(filePath) {
  try {
    return fs.lstatSync(filePath);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

function ensureSafeOutputDirectory(root, output) {
  const parent = path.dirname(output);
  const relativeParent = path.relative(root, parent);
  let current = root;
  for (const segment of relativeParent.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const metadata = lstatIfPresent(current);
    if (!metadata) {
      fs.mkdirSync(current);
    }
    const createdMetadata = fs.lstatSync(current);
    if (createdMetadata.isSymbolicLink()) {
      fail(`output path must not contain symbolic links: ${path.relative(root, current)}`);
    }
    if (!createdMetadata.isDirectory()) {
      fail(`output parent is not a directory: ${path.relative(root, current)}`);
    }
  }
  assertSafeOutputLocation(root, output);
}

function writeOutputSafely(root, output, contents) {
  ensureSafeOutputDirectory(root, output);
  const parent = path.dirname(output);
  const temporaryDirectory = fs.mkdtempSync(path.join(parent, ".unix-system-visualiser-"));
  const temporaryPath = path.join(temporaryDirectory, "index.html");
  try {
    fs.writeFileSync(temporaryPath, contents, { encoding: "utf8", flag: "wx" });
    fs.renameSync(temporaryPath, output);
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

function requireIgnoredOutput(root, output) {
  const relative = path.relative(root, output);
  const result = spawnSync("git", ["check-ignore", "--quiet", "--", relative], {
    cwd: root,
    encoding: "utf8"
  });
  if (result.status !== 0) {
    fail(
      `default output is not ignored by Git: ${relative}\n` +
        "Choose an ignored --output path or pass --allow-unignored-output."
    );
  }
}

function inspectShapeModel(root, command) {
  const [executable, ...prefixArguments] = command.trim().split(/\s+/);
  if (!executable) {
    fail("shape command must not be empty");
  }
  const checkResult = spawnSync(executable, [...prefixArguments, "check"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024
  });
  if (checkResult.error) {
    fail(`failed to run ${command}: ${checkResult.error.message}`);
  }
  if (checkResult.status !== 0) {
    fail(checkResult.stderr.trim() || checkResult.stdout.trim() || `${command} check failed`);
  }
  const result = spawnSync(executable, [...prefixArguments, "inspect", "--json"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024
  });
  if (result.error) {
    fail(`failed to run ${command}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    fail(result.stderr.trim() || `${command} inspect --json failed`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    fail(
      `${command} inspect --json returned invalid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

function fail(message) {
  console.error(message.startsWith("error:") ? message : `error: ${message}`);
  process.exit(1);
}

const templatePath = path.resolve(scriptDirectory, "../assets/index.template.html");
const stylePath = path.resolve(scriptDirectory, "../assets/styles.css");
const rendererPaths = [
  "../assets/renderer/bootstrap.mjs",
  "../assets/renderer/canvas.mjs",
  "../assets/renderer/details.mjs",
  "../assets/renderer/interactions.mjs"
].map((relativePath) => path.resolve(scriptDirectory, relativePath));
const template = fs.readFileSync(templatePath, "utf8");
const styles = fs.readFileSync(stylePath, "utf8");
const renderer = rendererPaths
  .map((rendererPath) => fs.readFileSync(rendererPath, "utf8"))
  .join("\n");
const page = replaceOnce(
  replaceOnce(replaceOnce(template, "__STYLE_CSS__", styles), "__RENDERER_JS__", renderer),
  "__ATLAS_MODEL_JSON__",
  serializedAtlas
);

function replaceOnce(contents, marker, replacement) {
  const first = contents.indexOf(marker);
  if (first === -1 || contents.indexOf(marker, first + marker.length) !== -1) {
    fail(`template must contain exactly one ${marker} marker`);
  }
  return contents.slice(0, first) + replacement + contents.slice(first + marker.length);
}

writeOutputSafely(repositoryRoot, outputPath, page);
console.log("Wrote " + path.relative(repositoryRoot, outputPath));
console.log(JSON.stringify(atlas.stats));
