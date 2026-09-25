import { loadBaseModules, type BaseModelFlags } from "../../base-model";
import { runShapeFileCheck } from "../../check-runner";
import type { CliContext } from "../../context";
import { resolveFreshnessDate } from "../../freshness";
import { repositoryFiles } from "../../git";
import { readChangedFiles } from "../../shape-files";

export type CheckFlags = BaseModelFlags & {
  readonly allowUnknownEffects?: boolean;
  readonly changedFiles?: string;
  readonly checkCitedPaths?: boolean;
  readonly asOf?: string;
  readonly strictFreshness?: boolean;
};

export default async function check(
  this: CliContext,
  flags: CheckFlags,
  ...providedFiles: string[]
): Promise<void> {
  const changedFiles =
    flags.changedFiles !== undefined ? await readChangedFiles(flags.changedFiles) : undefined;
  await runShapeFileCheck(this, providedFiles, {
    allowUnknownEffects: flags.allowUnknownEffects,
    baseModules: await loadBaseModules(this, flags, providedFiles),
    changedFiles,
    enforceBindings: true,
    freshnessDate: resolveFreshnessDate(flags),
    repositoryFiles: flags.checkCitedPaths ? await repositoryFiles() : undefined
  });
}
