import { staleAttestationPruner } from "@shape/shp-checker";
import { loadBaseModules, type BaseModelFlags } from "../../base-model";
import type { CliContext } from "../../context";
import { CliDiagnosticError } from "../../errors";
import { stdout } from "../../io";
import { parseModules, providedOrDefaultShapeFiles } from "../../shape-files";

export type AttestPruneFlags = BaseModelFlags;

export async function attestPrune(
  this: CliContext,
  flags: AttestPruneFlags,
  ...providedFiles: string[]
): Promise<void> {
  if (flags.baseRef === undefined && flags.baseModel === undefined) {
    throw new CliDiagnosticError(
      "error: attest prune requires --base-ref REF or --base-model DIR\n"
    );
  }
  const baseModules = await loadBaseModules(this, flags, providedFiles);
  if (baseModules === undefined) {
    throw new CliDiagnosticError("error: attest prune could not load the base model\n");
  }

  const prune = staleAttestationPruner(baseModules);
  let removed = 0;
  let files = 0;
  for (const { module, filePath } of await parseModules(
    await providedOrDefaultShapeFiles(providedFiles)
  )) {
    const result = prune(module);
    if (result.removed > 0) {
      await Bun.write(filePath, result.text);
      removed += result.removed;
      files += 1;
    }
  }
  stdout(
    this,
    removed === 0
      ? "No stale attestations.\n"
      : `Removed ${removed} stale attestation(s) from ${files} file(s).\n`
  );
}
