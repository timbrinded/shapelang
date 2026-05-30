import { listShapeObligations } from "@shape/shp-checker";
import type { CliContext } from "../../context";
import { stdout } from "../../io";
import { defaultShapeFiles, isoToday, parseModules } from "../../shape-files";

export type ObligationsFlags = {
  readonly strictFreshness?: boolean;
};

export default async function obligations(
  this: CliContext,
  flags: ObligationsFlags,
  ...providedFiles: string[]
): Promise<void> {
  const files = providedFiles.length > 0 ? providedFiles : await defaultShapeFiles();
  const modules = await parseModules(files);
  const freshnessDate = flags.strictFreshness ? isoToday() : undefined;
  stdout(this, listShapeObligations(modules, { freshnessDate }));
}
