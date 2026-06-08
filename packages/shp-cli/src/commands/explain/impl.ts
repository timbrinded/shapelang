import { explainShapeModules } from "@shape/shp-checker";
import type { CliContext } from "../../context";
import { stdout } from "../../io";
import { parseProvidedOrDefaultModules } from "../../shape-files";

export type ExplainFlags = Record<never, never>;

export default async function explain(
  this: CliContext,
  _flags: ExplainFlags,
  ...args: string[]
): Promise<void> {
  const [symbol, ...providedFiles] = args;
  const modules = await parseProvidedOrDefaultModules(providedFiles);
  stdout(this, explainShapeModules(modules, symbol ?? ""));
}
