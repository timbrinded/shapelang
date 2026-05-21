import { graphAllShapeModules, graphShapeModules, statsShapeHypergraph } from "@shape/shp-checker";
import type { CliContext } from "../../context";
import { CliDiagnosticError, EXIT_USAGE } from "../../errors";
import { stdout } from "../../io";
import { defaultShapeFiles, parseModules } from "../../shape-files";

export type GraphFlags = {
  readonly kind?: string;
};

export type LegacyGraphFlags = GraphFlags & {
  readonly stats?: boolean;
};

export async function graphAll(
  this: CliContext,
  flags: GraphFlags,
  ...providedFiles: string[]
): Promise<void> {
  const modules = await parseModules(
    providedFiles.length > 0 ? providedFiles : await defaultShapeFiles()
  );
  stdout(this, graphAllShapeModules(modules, flags.kind));
}

export async function graphShow(
  this: CliContext,
  flags: GraphFlags,
  ...args: string[]
): Promise<void> {
  const [symbol, ...providedFiles] = args;
  const modules = await parseModules(
    providedFiles.length > 0 ? providedFiles : await defaultShapeFiles()
  );
  stdout(this, graphShapeModules(modules, symbol ?? "", flags.kind));
}

export async function graphStats(
  this: CliContext,
  flags: GraphFlags,
  ...providedFiles: string[]
): Promise<void> {
  const modules = await parseModules(
    providedFiles.length > 0 ? providedFiles : await defaultShapeFiles()
  );
  stdout(this, statsShapeHypergraph(modules, flags.kind));
}

export async function graphLegacy(
  this: CliContext,
  flags: LegacyGraphFlags,
  ...positionals: string[]
): Promise<void> {
  const graphArgs = resolveGraphArgs(positionals);
  if (flags.stats) {
    if (graphArgs.symbol) {
      throw new CliDiagnosticError("`shp graph --stats` does not accept a SYMBOL.\n", EXIT_USAGE);
    }
    return graphStats.call(this, flags, ...graphArgs.files);
  }

  if (graphArgs.symbol) {
    return graphShow.call(this, flags, graphArgs.symbol, ...graphArgs.files);
  }
  return graphAll.call(this, flags, ...graphArgs.files);
}

function resolveGraphArgs(positionals: string[]): { symbol?: string; files: string[] } {
  const [maybeSymbol, ...rest] = positionals;
  const looksLikeFile = typeof maybeSymbol === "string" && maybeSymbol.endsWith(".shape");
  const symbol = !maybeSymbol || looksLikeFile ? undefined : maybeSymbol;
  const files = symbol ? rest : positionals;
  return { symbol, files };
}
