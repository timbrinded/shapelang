import { loadBaseModules, type BaseModelFlags } from "../../base-model";
import { runShapeFileCheck } from "../../check-runner";
import type { CliContext } from "../../context";
import { readChangedFiles } from "../../shape-files";

export type CoverageFlags = BaseModelFlags & {
  readonly changedFiles: string;
};

export default async function coverage(
  this: CliContext,
  flags: CoverageFlags,
  ...providedFiles: string[]
): Promise<void> {
  const changedFiles = await readChangedFiles(flags.changedFiles);
  await runShapeFileCheck(this, providedFiles, {
    baseModules: await loadBaseModules(this, flags, providedFiles),
    changedFiles,
    enforceBindings: false
  });
}
