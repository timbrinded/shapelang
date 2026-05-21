import { listShapeObligations } from "@shape/shp-checker";
import type { CliContext } from "../../context";
import { stdout } from "../../io";
import { defaultShapeFiles, parseModules } from "../../shape-files";

export type ObligationsFlags = Record<never, never>;

export default async function obligations(
  this: CliContext,
  _flags: ObligationsFlags,
  ...providedFiles: string[]
): Promise<void> {
  const files = providedFiles.length > 0 ? providedFiles : await defaultShapeFiles();
  const modules = await parseModules(files);
  stdout(this, listShapeObligations(modules));
}
