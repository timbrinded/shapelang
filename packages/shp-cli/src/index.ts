#!/usr/bin/env bun

import { Glob } from "bun";
import { parseArgs } from "node:util";
import { checkShapeFiles, formatDiagnostics } from "@shape/shp-checker";

const USAGE = `Usage:
  shp check [files...]

When no files are provided, shp check scans shape/system/**/*.shp.
`;

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    allowPositionals: true,
    options: {
      help: {
        type: "boolean",
        short: "h"
      }
    }
  });

  if (values.help) {
    await Bun.write(Bun.stdout, USAGE);
    return 0;
  }

  const [command, ...providedFiles] = positionals;
  if (command !== "check") {
    await Bun.write(Bun.stderr, USAGE);
    return 2;
  }

  const files = providedFiles.length > 0 ? providedFiles : await defaultShapeFiles();
  const result = await checkShapeFiles(files);
  const output = formatDiagnostics(result);
  await Bun.write(result.exitCode === 0 ? Bun.stdout : Bun.stderr, output);
  return result.exitCode;
}

async function defaultShapeFiles(): Promise<string[]> {
  const glob = new Glob("shape/system/**/*.shp");
  const files: string[] = [];
  for await (const file of glob.scan({ cwd: process.cwd(), onlyFiles: true })) {
    files.push(file);
  }
  return files.sort();
}

process.exitCode = await main();
