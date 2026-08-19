import { inspectShapeModules } from "@shape/shp-checker";
import { relative, resolve, sep } from "node:path";
import type { CliContext } from "../../context";
import { CliDiagnosticError, EXIT_USAGE } from "../../errors";
import { stdout } from "../../io";
import { parseProvidedOrDefaultModules } from "../../shape-files";
import { SHP_VERSION } from "../../version";

export type InspectFlags = {
  readonly json?: boolean;
};

export default async function inspect(
  this: CliContext,
  flags: InspectFlags,
  ...providedFiles: string[]
): Promise<void> {
  if (!flags.json) {
    throw new CliDiagnosticError("`shp inspect` requires --json.\n", EXIT_USAGE);
  }

  const modules = (await parseProvidedOrDefaultModules(providedFiles)).map((input) => ({
    ...input,
    filePath: input.filePath === undefined ? undefined : projectRelativePath(input.filePath)
  }));
  const inspection = inspectShapeModules(modules, { shapeVersion: SHP_VERSION });
  stdout(this, `${JSON.stringify(inspection, null, 2)}\n`);
}

function projectRelativePath(filePath: string): string {
  const path = relative(process.cwd(), resolve(filePath));
  return sep === "/" ? path : path.split(sep).join("/");
}
