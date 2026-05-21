import { listMemoryGuardsShapeModules } from "@shape/shp-checker";
import type { CliContext } from "../../context";
import { stdout } from "../../io";
import { defaultShapeFiles, parseModules } from "../../shape-files";

export type MemoryFlags = Record<never, never>;

export default async function memory(
  this: CliContext,
  _flags: MemoryFlags,
  ...providedFiles: string[]
): Promise<void> {
  const files = providedFiles.length > 0 ? providedFiles : await defaultShapeFiles();
  const modules = await parseModules(files);
  stdout(this, listMemoryGuardsShapeModules(modules));
}
