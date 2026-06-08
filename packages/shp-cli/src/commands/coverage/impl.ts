import { runShapeFileCheck } from "../../check-runner";
import type { CliContext } from "../../context";
import { readChangedFiles } from "../../shape-files";

export type CoverageFlags = {
  readonly changedFiles: string;
};

export default async function coverage(
  this: CliContext,
  flags: CoverageFlags,
  ...providedFiles: string[]
): Promise<void> {
  const changedFiles = await readChangedFiles(flags.changedFiles);
  await runShapeFileCheck(this, providedFiles, {
    changedFiles,
    enforceBindings: false
  });
}
