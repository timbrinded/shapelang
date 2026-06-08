import { listShapeObligations } from "@shape/shp-checker";
import type { CliContext } from "../../context";
import { resolveFreshnessDate } from "../../freshness";
import { stdout } from "../../io";
import { parseProvidedOrDefaultModules } from "../../shape-files";

export type ObligationsFlags = {
  readonly asOf?: string;
  readonly strictFreshness?: boolean;
};

export default async function obligations(
  this: CliContext,
  flags: ObligationsFlags,
  ...providedFiles: string[]
): Promise<void> {
  const modules = await parseProvidedOrDefaultModules(providedFiles);
  stdout(this, listShapeObligations(modules, { freshnessDate: resolveFreshnessDate(flags) }));
}
