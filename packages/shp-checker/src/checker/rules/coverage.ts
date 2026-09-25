import type {
  AttestationInfo,
  BaseModel,
  ChangedFileContext,
  Model,
  Provenance,
  SemanticDiagnostic
} from "../model.ts";
import { globMatches, normalizeRepoPath } from "../globs.ts";
import { describeProvenance } from "../provenance.ts";

/**
 * Identity used to compare an attestation against the base model. The reason is
 * part of the key so a freshly written decision for the same path counts, while
 * an attestation carried over unchanged from the base does not.
 */
export function attestationKey(
  attestation: Pick<AttestationInfo, "kind" | "path" | "reason">
): string {
  return JSON.stringify([attestation.kind, attestation.path, attestation.reason]);
}

export function checkStaleAttestations(model: Model, base: BaseModel): SemanticDiagnostic[] {
  return model.attestations
    .filter((attestation) => base.attestationKeys.has(attestationKey(attestation)))
    .map((attestation) => ({
      kind: "stale_attestation",
      attestationKind: attestation.kind,
      path: attestation.path,
      filePath: attestation.provenance.filePath,
      causedBy: [describeProvenance(attestation.provenance)]
    }));
}

export function checkCoverage(
  model: Model,
  changedFiles: string[],
  repoRoot: string,
  base?: BaseModel
): SemanticDiagnostic[] {
  if (changedFiles.length === 0) {
    return [];
  }

  const changed = changedFileContext(changedFiles, repoRoot);
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

      if (currentShapeUpdateExists(model, changedFile, changed.set, repoRoot)) {
        continue;
      }

      if (
        currentAttestationExists(
          model,
          changedFile,
          changed.set,
          noShapeChangeAttestations,
          repoRoot,
          base
        )
      ) {
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

export function changedFileContext(changedFiles: string[], repoRoot: string): ChangedFileContext {
  const files = changedFiles
    .map((file) => normalizeRepoPath(file, repoRoot))
    .filter((file) => file.length > 0);
  return {
    files,
    set: new Set(files)
  };
}

export function currentShapeUpdateExists(
  model: Model,
  changedFile: string,
  changedSet: Set<string>,
  repoRoot: string
): boolean {
  return (
    model.shapeUpdatePaths
      .get(changedFile)
      ?.some((provenance) => provenanceFileChanged(provenance, changedSet, repoRoot)) ?? false
  );
}

export function currentAttestationExists(
  model: Model,
  changedFile: string,
  changedSet: Set<string>,
  allowedKinds: ReadonlySet<string>,
  repoRoot: string,
  base?: BaseModel
): boolean {
  return model.attestations.some((attestation) =>
    isCurrentAttestation(attestation, changedFile, changedSet, allowedKinds, repoRoot, base)
  );
}

/**
 * With a base model, an attestation is current only if it is new relative to the
 * base. Without one, the declaring `.shape` file being in the changed-file input
 * is the fallback; it lets any unrelated edit to that file revive every
 * attestation declared in it.
 */
export function isCurrentAttestation(
  attestation: AttestationInfo,
  changedFile: string,
  changedSet: Set<string>,
  allowedKinds: ReadonlySet<string>,
  repoRoot: string,
  base?: BaseModel
): boolean {
  return (
    allowedKinds.has(attestation.kind) &&
    attestation.path === changedFile &&
    attestation.reason.trim().length > 0 &&
    (base === undefined
      ? provenanceFileChanged(attestation.provenance, changedSet, repoRoot)
      : !base.attestationKeys.has(attestationKey(attestation)))
  );
}

export function provenanceFileChanged(
  provenance: Provenance,
  changedSet: Set<string>,
  repoRoot: string
): boolean {
  return (
    provenance.filePath !== undefined &&
    changedSet.has(normalizeRepoPath(provenance.filePath, repoRoot))
  );
}

export function checkBindings(
  model: Model,
  changedFiles: string[],
  repoRoot: string,
  base?: BaseModel
): SemanticDiagnostic[] {
  if (changedFiles.length === 0) {
    return [];
  }

  const changed = changedFileContext(changedFiles, repoRoot);
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

      if (isAttestationOnlyChange(model, changedFile, repoRoot, base)) {
        continue;
      }

      if (currentAttestationExists(model, changedFile, changed.set, allowedKinds, repoRoot, base)) {
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

/**
 * A `.shape` file whose text, with attestations removed, matches its base
 * version changed only in attestations. That is change-set evidence, not a model
 * change, so it does not trigger bindings; pruning stale attestations therefore
 * never demands a docs change.
 */
function isAttestationOnlyChange(
  model: Model,
  changedFile: string,
  repoRoot: string,
  base: BaseModel | undefined
): boolean {
  const baseText = base?.attestationFreeTexts.get(changedFile);
  if (baseText === undefined) {
    return false;
  }
  return [...model.modules.values()].some(
    (module) =>
      module.filePath !== undefined &&
      normalizeRepoPath(module.filePath, repoRoot) === changedFile &&
      module.attestationFreeText === baseText
  );
}
