import { listMemoryGuardsShapeModules } from "@shape/shp-checker";
import type { CliContext } from "../../context";
import { stdout } from "../../io";
import { parseProvidedOrDefaultModules } from "../../shape-files";

export type MemoryFlags = Record<never, never>;

export default async function memory(
  this: CliContext,
  _flags: MemoryFlags,
  ...providedFiles: string[]
): Promise<void> {
  const modules = await parseProvidedOrDefaultModules(providedFiles);
  stdout(this, listMemoryGuardsShapeModules(modules));
}
