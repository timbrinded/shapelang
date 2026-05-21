import { explainShapeModules } from "@shape/shp-checker";
import type { CliContext } from "../../context";
import { stdout } from "../../io";
import { defaultShapeFiles, parseModules } from "../../shape-files";

export type ExplainFlags = Record<never, never>;

export default async function explain(
  this: CliContext,
  _flags: ExplainFlags,
  ...args: string[]
): Promise<void> {
  const [symbol, ...providedFiles] = args;
  const files = providedFiles.length > 0 ? providedFiles : await defaultShapeFiles();
  const modules = await parseModules(files);
  stdout(this, explainShapeModules(modules, symbol ?? ""));
}
