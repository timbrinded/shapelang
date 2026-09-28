import { loadBaseModules, type BaseModelFlags } from "../../base-model";
import { runShapeFileCheck } from "../../check-runner";
import type { CliContext } from "../../context";
import { CliDiagnosticError } from "../../errors";
import { stderr } from "../../io";
import { resolveFreshnessDate } from "../../freshness";
import { repositoryFiles } from "../../git";
import { readChangedFiles } from "../../shape-files";

export type CheckFlags = BaseModelFlags & {
  readonly allowUnknownEffects?: boolean;
  readonly changedFiles?: string;
  readonly checkLoosening?: boolean;
  readonly checkCitedPaths?: boolean;
  readonly asOf?: string;
  readonly strictFreshness?: boolean;
};

export default async function check(
  this: CliContext,
  flags: CheckFlags,
  ...providedFiles: string[]
): Promise<void> {
  if (flags.checkLoosening && flags.baseRef === undefined && flags.baseModel === undefined) {
    throw new CliDiagnosticError("error: --check-loosening needs --base-ref or --base-model\n");
  }
  const changedFiles =
    flags.changedFiles !== undefined ? await readChangedFiles(flags.changedFiles) : undefined;
  const baseModules = await loadBaseModules(this, flags, providedFiles);
  if (flags.checkLoosening && baseModules === undefined) {
    stderr(
      this,
      "warning: rule loosening was not checked because the base model could not be read\n"
    );
  }
  await runShapeFileCheck(this, providedFiles, {
    allowUnknownEffects: flags.allowUnknownEffects,
    baseModules,
    checkLoosening: flags.checkLoosening === true && baseModules !== undefined,
    changedFiles,
    enforceBindings: true,
    freshnessDate: resolveFreshnessDate(flags),
    repositoryFiles: flags.checkCitedPaths ? await repositoryFiles() : undefined
  });
}
