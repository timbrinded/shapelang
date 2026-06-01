import { listShapeObligations } from "@shape/shp-checker";
import type { CliContext } from "../../context";
import { resolveFreshnessDate } from "../../freshness";
import { stdout } from "../../io";
import { defaultShapeFiles, parseModules } from "../../shape-files";

export type ObligationsFlags = {
  readonly asOf?: string;
  readonly strictFreshness?: boolean;
};

export default async function obligations(
  this: CliContext,
  flags: ObligationsFlags,
  ...providedFiles: string[]
): Promise<void> {
  const files = providedFiles.length > 0 ? providedFiles : await defaultShapeFiles();
  const modules = await parseModules(files);
  stdout(this, listShapeObligations(modules, { freshnessDate: resolveFreshnessDate(flags) }));
}
