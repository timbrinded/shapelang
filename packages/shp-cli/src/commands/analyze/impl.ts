import {
  analyzeSourceText,
  compareAnalyzerHintsToShape,
  formatAnalyzerWarnings
} from "@shape/shp-checker";
import type { CliContext } from "../../context";
import { EXIT_FAILURE, EXIT_SUCCESS } from "../../errors";
import { setExitCode, stderr, stdout } from "../../io";
import { parseModules, readCliTextFile } from "../../shape-files";

export type AnalyzeFlags = {
  readonly shapeFiles?: string;
};

export default async function analyze(
  this: CliContext,
  flags: AnalyzeFlags,
  ...sourceFiles: string[]
): Promise<void> {
  const hints: ReturnType<typeof analyzeSourceText> = [];
  for (const sourceFile of sourceFiles) {
    hints.push(...analyzeSourceText(sourceFile, await readCliTextFile(sourceFile)));
  }

  if (!flags.shapeFiles) {
    for (const hint of hints) {
      stdout(this, `${hint.sourcePath}:${hint.line} ${hint.effect} ${hint.evidence}\n`);
    }
    return;
  }

  const shapeFiles = flags.shapeFiles
    .split(",")
    .map((file) => file.trim())
    .filter((file) => file.length > 0);
  const modules = (await parseModules(shapeFiles)).map((input) => input.module);
  const warnings = compareAnalyzerHintsToShape(hints, modules);
  const output = formatAnalyzerWarnings(warnings);
  if (warnings.length > 0) {
    stderr(this, output);
    setExitCode(this, EXIT_FAILURE);
  } else {
    stdout(this, output);
    setExitCode(this, EXIT_SUCCESS);
  }
}
