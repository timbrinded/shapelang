import { runShapeFileCheck } from "../../check-runner";
import type { CliContext } from "../../context";
import { resolveFreshnessDate } from "../../freshness";
import { readChangedFiles } from "../../shape-files";

export type CheckFlags = {
  readonly allowUnknownEffects?: boolean;
  readonly changedFiles?: string;
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
    changedFiles,
    enforceBindings: true,
    freshnessDate: resolveFreshnessDate(flags)
  });
}
