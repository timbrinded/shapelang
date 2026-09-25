// Cited-path existence: every source and evidence path the model cites must name
// a file in the repository. The checker never reads the filesystem; callers pass
// the repository's file list, just as they pass the changed files. Attestation
// sources are not checked, since attesting a deletion names a removed file.
import type { Model, Provenance, SemanticDiagnostic } from "../model.ts";
import { normalizeRepoPath } from "../globs.ts";
import { describeProvenance } from "../provenance.ts";
import { compareCodepointStrings, normalizeShapeSourcePath } from "../../shape-strings.ts";

export function checkCitedPaths(
  model: Model,
  repositoryFiles: readonly string[],
  repoRoot: string
): SemanticDiagnostic[] {
  const existing = new Set(repositoryFiles.map((file) => normalizeRepoPath(file, repoRoot)));
  const citations = new Map<string, Provenance[]>();
  const cite = (path: string, provenance: Provenance): void => {
    const normalized = normalizeRepoPath(normalizeShapeSourcePath(path), repoRoot);
    citations.set(normalized, [...(citations.get(normalized) ?? []), provenance]);
  };

  for (const [path, provenances] of model.shapeUpdatePaths) {
    for (const provenance of provenances) {
      cite(path, provenance);
    }
  }
  for (const context of [
    ...model.rationales.values(),
    ...model.memories.values(),
    ...model.reevaluations.values()
  ]) {
    for (const evidence of context.evidence) {
      cite(evidence.path, context.provenance);
    }
  }

  return [...citations]
    .filter(([path]) => !existing.has(path))
    .map(([path, provenances]) => ({
      kind: "missing_cited_path",
      path,
      filePath: provenances[0]?.filePath,
      causedBy: [...new Set(provenances.map(describeProvenance))].toSorted(compareCodepointStrings)
    }));
}
