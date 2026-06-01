import type {
  AttestationInfo,
  ChangedFileContext,
  Model,
  Provenance,
  SemanticDiagnostic
} from "../model.ts";
import { globMatches, normalizeRepoPath } from "../globs.ts";
import { describeProvenance } from "../provenance.ts";

export function checkCoverage(model: Model, changedFiles: string[]): SemanticDiagnostic[] {
  if (changedFiles.length === 0) {
    return [];
  }

  const changed = changedFileContext(changedFiles);
  const noShapeChangeAttestations = new Set(["no_shape_change"]);
  const diagnostics: SemanticDiagnostic[] = [];

  for (const implementation of model.implementations) {
    if (implementation.onChangeRequirement !== "shape_update") {
      continue;
    }

    for (const changedFile of changed.files) {
      if (changedFile.endsWith(".shape")) {
        continue;
      }

      const governingPath = implementation.paths.find((entry) =>
        globMatches(entry.glob, changedFile)
      );
      if (!governingPath) {
        continue;
      }

      if (currentShapeUpdateExists(model, changedFile, changed.set)) {
        continue;
      }

      if (currentAttestationExists(model, changedFile, changed.set, noShapeChangeAttestations)) {
        continue;
      }

      diagnostics.push({
        kind: "missing_shape_update",
        changedFile,
        implementation: implementation.name,
        glob: governingPath.glob,
        filePath: implementation.provenance.filePath,
        causedBy: [
          describeProvenance(implementation.provenance),
          describeProvenance(governingPath.provenance)
        ]
      });
    }
  }

  return diagnostics;
}

export function changedFileContext(changedFiles: string[]): ChangedFileContext {
  const files = changedFiles
    .map((file) => normalizeRepoPath(file))
    .filter((file) => file.length > 0);
  return {
    files,
    set: new Set(files)
  };
}

export function currentShapeUpdateExists(
  model: Model,
  changedFile: string,
  changedSet: Set<string>
): boolean {
  return (
    model.shapeUpdatePaths
      .get(changedFile)
      ?.some((provenance) => provenanceFileChanged(provenance, changedSet)) ?? false
  );
}

export function currentAttestationExists(
  model: Model,
  changedFile: string,
  changedSet: Set<string>,
  allowedKinds: ReadonlySet<string>
): boolean {
  return model.attestations.some((attestation) =>
    isCurrentAttestation(attestation, changedFile, changedSet, allowedKinds)
  );
}

export function isCurrentAttestation(
  attestation: AttestationInfo,
  changedFile: string,
  changedSet: Set<string>,
  allowedKinds: ReadonlySet<string>
): boolean {
  return (
    allowedKinds.has(attestation.kind) &&
    attestation.path === changedFile &&
    attestation.reason.trim().length > 0 &&
    provenanceFileChanged(attestation.provenance, changedSet)
  );
}

export function provenanceFileChanged(provenance: Provenance, changedSet: Set<string>): boolean {
  return (
    provenance.filePath !== undefined && changedSet.has(normalizeRepoPath(provenance.filePath))
  );
}

export function checkBindings(model: Model, changedFiles: string[]): SemanticDiagnostic[] {
  if (changedFiles.length === 0) {
    return [];
  }

  const changed = changedFileContext(changedFiles);
  const diagnostics: SemanticDiagnostic[] = [];

  for (const binding of model.bindings.values()) {
    const requiredChanged = changed.files.some((file) =>
      binding.requireChanged.some((entry) => globMatches(entry.glob, file))
    );
    if (requiredChanged) {
      continue;
    }

    const allowedKinds = new Set(binding.allowAttestations.map((item) => item.kind));
    for (const changedFile of changed.files) {
      const trigger = binding.whenChanged.find((entry) => globMatches(entry.glob, changedFile));
      if (!trigger) {
        continue;
      }

      if (currentAttestationExists(model, changedFile, changed.set, allowedKinds)) {
        continue;
      }

      diagnostics.push({
        kind: "missing_bound_docs_change",
        binding: binding.name,
        changedFile,
        requiredPaths: binding.requireChanged.map((entry) => entry.glob).sort(),
        attestationKinds: [...allowedKinds].sort(),
        filePath: binding.provenance.filePath,
        causedBy: [describeProvenance(binding.provenance), describeProvenance(trigger.provenance)]
      });
    }
  }

  return diagnostics;
}
