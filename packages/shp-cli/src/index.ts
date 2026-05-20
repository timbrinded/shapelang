#!/usr/bin/env bun

import { Glob } from "bun";
import { parseArgs } from "node:util";
import {
  analyzeSourceText,
  checkShapeFiles,
  compareAnalyzerHintsToShape,
  explainShapeModules,
  formatAnalyzerWarnings,
  formatDiagnostics,
  formatShapeSource,
  generateShapeUpdateDraft,
  graphAllShapeModules,
  graphShapeModules,
  listMemoryGuardsShapeModules,
  listShapeObligations,
  parseShapeModule,
  statsShapeHypergraph,
  type ShapeModule
} from "@shape/shp-checker";

const USAGE = `Usage:
  shp check [--changed-files changed.txt] [files...]
  shp coverage --changed-files changed.txt [files...]
  shp fmt [--check] [files...]
  shp explain SYMBOL [files...]
  shp graph [SYMBOL] [--kind KIND] [files...]
  shp graph --stats [--kind KIND] [files...]
  shp memory [files...]
  shp obligations [files...]
  shp author --changed-files changed.txt --component ComponentName [--module module.name]
  shp analyze [--shape-files file1.shape,file2.shape] [source-files...]

When no files are provided, commands scan shape/**/*.shape.
\`shp graph\` without a SYMBOL prints every relation in the hypergraph.
\`shp graph --stats\` prints aggregate vertex, hyperedge, and incidence counts.
`;

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    allowPositionals: true,
    options: {
      "changed-files": {
        type: "string"
      },
      check: {
        type: "boolean"
      },
      kind: {
        type: "string"
      },
      stats: {
        type: "boolean"
      },
      component: {
        type: "string"
      },
      module: {
        type: "string"
      },
      "shape-files": {
        type: "string"
      },
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
  if (command === "fmt") {
    return formatFiles(providedFiles, values.check === true);
  }

  if (command === "author") {
    const changedFilesPath = values["changed-files"];
    if (!changedFilesPath || !values.component) {
      await Bun.write(Bun.stderr, USAGE);
      return 2;
    }
    const changedFiles = await readChangedFiles(changedFilesPath);
    await Bun.write(
      Bun.stdout,
      generateShapeUpdateDraft({
        changedFiles,
        componentName: values.component,
        moduleName: values.module
      })
    );
    return 0;
  }

  if (command === "analyze") {
    return analyzeFiles(providedFiles, values["shape-files"]);
  }

  if (command === "explain") {
    const [symbol, ...files] = providedFiles;
    if (!symbol) {
      await Bun.write(Bun.stderr, USAGE);
      return 2;
    }
    const modules = await parseModules(files.length > 0 ? files : await defaultShapeFiles());
    await Bun.write(Bun.stdout, explainShapeModules(modules, symbol));
    return 0;
  }

  if (command === "graph") {
    const graphArgs = resolveGraphArgs(providedFiles);
    if (values.stats) {
      if (graphArgs.symbol) {
        await Bun.write(Bun.stderr, "`shp graph --stats` does not accept a SYMBOL.\n\n" + USAGE);
        return 2;
      }

      const modules = await parseModules(
        graphArgs.files.length > 0 ? graphArgs.files : await defaultShapeFiles()
      );
      await Bun.write(Bun.stdout, statsShapeHypergraph(modules, values.kind));
      return 0;
    }

    const modules = await parseModules(
      graphArgs.files.length > 0 ? graphArgs.files : await defaultShapeFiles()
    );
    await Bun.write(
      Bun.stdout,
      graphArgs.symbol
        ? graphShapeModules(modules, graphArgs.symbol, values.kind)
        : graphAllShapeModules(modules, values.kind)
    );
    return 0;
  }

  if (command === "memory") {
    const modules = await parseModules(
      providedFiles.length > 0 ? providedFiles : await defaultShapeFiles()
    );
    await Bun.write(Bun.stdout, listMemoryGuardsShapeModules(modules));
    return 0;
  }

  if (command === "obligations") {
    const modules = await parseModules(
      providedFiles.length > 0 ? providedFiles : await defaultShapeFiles()
    );
    await Bun.write(Bun.stdout, listShapeObligations(modules));
    return 0;
  }

  if (command !== "check" && command !== "coverage") {
    await Bun.write(Bun.stderr, USAGE);
    return 2;
  }

  const changedFilesPath = values["changed-files"];
  if (command === "coverage" && !changedFilesPath) {
    await Bun.write(Bun.stderr, USAGE);
    return 2;
  }

  const files = providedFiles.length > 0 ? providedFiles : await defaultShapeFiles();
  const changedFiles = changedFilesPath ? await readChangedFiles(changedFilesPath) : undefined;
  const result = await checkShapeFiles(files, {
    changedFiles,
    enforceBindings: command !== "coverage"
  });
  const output = formatDiagnostics(result);
  await Bun.write(result.exitCode === 0 ? Bun.stdout : Bun.stderr, output);
  return result.exitCode;
}

async function formatFiles(providedFiles: string[], checkOnly: boolean): Promise<number> {
  const files = providedFiles.length > 0 ? providedFiles : await defaultShapeFiles();
  let ok = true;

  for (const file of files) {
    const source = await Bun.file(file).text();
    const result = formatShapeSource(source, file);
    if (!result.ok) {
      ok = false;
      for (const diagnostic of result.diagnostics) {
        await Bun.write(Bun.stderr, `${diagnostic.filePath}: ${diagnostic.message}\n`);
      }
      continue;
    }

    if (checkOnly) {
      if (source !== result.formatted) {
        ok = false;
        await Bun.write(Bun.stderr, `${file}: not formatted\n`);
      }
    } else if (source !== result.formatted) {
      await Bun.write(file, result.formatted);
    }
  }

  if (ok) {
    await Bun.write(
      Bun.stdout,
      checkOnly ? "Shape format check passed.\n" : "Shape format complete.\n"
    );
  }

  return ok ? 0 : 1;
}

function resolveGraphArgs(positionals: string[]): { symbol?: string; files: string[] } {
  const [maybeSymbol, ...rest] = positionals;
  const looksLikeFile = typeof maybeSymbol === "string" && maybeSymbol.endsWith(".shape");
  const symbol = !maybeSymbol || looksLikeFile ? undefined : maybeSymbol;
  const files = symbol ? rest : positionals;
  return { symbol, files };
}

async function defaultShapeFiles(): Promise<string[]> {
  const patterns = ["shape/**/*.shape"];
  const files = new Set<string>();
  for (const pattern of patterns) {
    const glob = new Glob(pattern);
    for await (const file of glob.scan({ cwd: process.cwd(), onlyFiles: true })) {
      files.add(file);
    }
  }
  return [...files].sort();
}

async function readChangedFiles(path: string): Promise<string[]> {
  const text = await Bun.file(path).text();
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

async function parseModules(paths: string[]): Promise<{ module: ShapeModule; filePath: string }[]> {
  const modules: { module: ShapeModule; filePath: string }[] = [];
  for (const filePath of paths) {
    const parsed = parseShapeModule(await Bun.file(filePath).text(), filePath);
    if (!parsed.ok) {
      throw new Error(parsed.diagnostics.map((diagnostic) => diagnostic.message).join("\n"));
    }
    modules.push({ module: parsed.module, filePath });
  }
  return modules;
}

async function analyzeFiles(
  sourceFiles: string[],
  shapeFilesOption: string | undefined
): Promise<number> {
  const hints: ReturnType<typeof analyzeSourceText> = [];
  for (const sourceFile of sourceFiles) {
    hints.push(...analyzeSourceText(sourceFile, await Bun.file(sourceFile).text()));
  }

  if (!shapeFilesOption) {
    for (const hint of hints) {
      await Bun.write(
        Bun.stdout,
        `${hint.sourcePath}:${hint.line} ${hint.effect} ${hint.evidence}\n`
      );
    }
    return 0;
  }

  const shapeFiles = shapeFilesOption
    .split(",")
    .map((file) => file.trim())
    .filter((file) => file.length > 0);
  const modules = (await parseModules(shapeFiles)).map((input) => input.module);
  const warnings = compareAnalyzerHintsToShape(hints, modules);
  await Bun.write(warnings.length > 0 ? Bun.stderr : Bun.stdout, formatAnalyzerWarnings(warnings));
  return warnings.length === 0 ? 0 : 1;
}

process.exitCode = await main();
