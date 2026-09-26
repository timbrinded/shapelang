import type { Model, Provenance, SemanticDiagnostic } from "../model.ts";
import { KNOWN_PRELUDE_TRAITS } from "../../prelude.ts";
import { displaySymbol } from "../display.ts";
import { describeProvenance } from "../provenance.ts";
import { targetExists } from "../derivations.ts";
import { checkProvidesEndpointKinds, isAmbiguousVertex, isResolvedVertex } from "./relations.ts";

export function checkResolvedNames(model: Model): SemanticDiagnostic[] {
  const diagnostics: SemanticDiagnostic[] = [];
  const knownTraits = new Set([...KNOWN_PRELUDE_TRAITS, ...model.traits.keys()]);

  for (const resource of model.resources.values()) {
    for (const [trait, traitProv] of resource.traits) {
      if (!knownTraits.has(trait)) {
        diagnostics.push(unknownName("trait", trait, traitProv));
      }
    }
  }

  for (const component of model.components.values()) {
    for (const [trait, traitProv] of component.classifiers) {
      if (!knownTraits.has(trait)) {
        diagnostics.push(unknownName("trait", trait, traitProv));
      }
    }

    for (const [resource, ownProv] of component.owns) {
      if (!model.resources.has(resource)) {
        diagnostics.push(unknownName("resource", resource, ownProv));
      }
    }

    for (const fn of component.functions.values()) {
      for (const [trait, traitProv] of fn.shapeTraits) {
        if (!knownTraits.has(trait)) {
          diagnostics.push(unknownName("trait", trait, traitProv));
        }
      }

      if (fn.effects.kind !== "complete") {
        continue;
      }
      for (const entry of fn.effects.entries) {
        const target = entry.term.target;
        if (target && !model.resources.has(target)) {
          diagnostics.push(unknownName("resource", target, entry.provenance));
        }
      }
    }
  }

  for (const implementation of model.implementations) {
    if (implementation.conformsTo && !model.components.has(implementation.conformsTo)) {
      diagnostics.push(
        unknownName("component", implementation.conformsTo, implementation.provenance)
      );
    }
  }

  for (const hyperedge of model.hypergraph.edges.values()) {
    for (const member of hyperedge.members) {
      if (!isResolvedVertex(member.endpoint, model)) {
        diagnostics.push(unknownName("relation_endpoint", member.endpoint, hyperedge.provenance));
      } else if (isAmbiguousVertex(member.endpoint, model)) {
        diagnostics.push({
          kind: "invalid_relation",
          name: hyperedge.name,
          reason: `endpoint ${displaySymbol(member.endpoint)} resolves to both a component and a resource`,
          filePath: hyperedge.provenance.filePath,
          causedBy: [describeProvenance(hyperedge.provenance)]
        });
      }
    }

    if (hyperedge.kind === "provides") {
      diagnostics.push(...checkProvidesEndpointKinds(hyperedge, model));
    }
  }

  for (const candidateEffect of model.candidateEffects.values()) {
    if (!candidateEffect.functionTarget) {
      diagnostics.push(
        unknownName("component", `${candidateEffect.name} function`, candidateEffect.provenance)
      );
    } else if (!targetExists({ kind: "fn", name: candidateEffect.functionTarget }, model)) {
      diagnostics.push(
        unknownName("component", candidateEffect.functionTarget, candidateEffect.provenance)
      );
    }
    const target = candidateEffect.target;
    if (target && !model.resources.has(target)) {
      diagnostics.push(unknownName("resource", target, candidateEffect.provenance));
    }
    if (candidateEffect.anchor && !model.resources.has(candidateEffect.anchor)) {
      diagnostics.push(unknownName("resource", candidateEffect.anchor, candidateEffect.provenance));
    }
  }

  for (const trait of model.traits.values()) {
    for (const forbid of trait.finalForbids) {
      if (
        forbid.target &&
        forbid.targetBinding === "concrete" &&
        !model.resources.has(forbid.target)
      ) {
        diagnostics.push(unknownName("resource", forbid.target, forbid.provenance));
      }
    }
  }

  for (const rule of model.rules) {
    for (const when of rule.whenHas) {
      if (when.traitResolution === "ambiguous" || knownTraits.has(when.trait)) {
        continue;
      }
      diagnostics.push(unknownName("trait", when.trait, when.provenance));
    }

    for (const forbid of rule.forbidEffects) {
      if (
        forbid.target &&
        forbid.targetBinding === "concrete" &&
        !model.resources.has(forbid.target)
      ) {
        diagnostics.push(unknownName("resource", forbid.target, forbid.provenance));
      }
    }
    for (const forbid of rule.forbidProvides) {
      if (!model.resources.has(forbid.target)) {
        diagnostics.push(unknownName("resource", forbid.target, forbid.provenance));
      }
      if (forbid.except && !model.components.has(forbid.except)) {
        diagnostics.push(unknownName("component", forbid.except, forbid.provenance));
      }
    }
    for (const forbid of rule.forbidPaths) {
      const endpoints = [
        {
          name: forbid.source,
          resolution: forbid.sourceResolution
        },
        ...(forbid.target === forbid.source
          ? []
          : [
              {
                name: forbid.target,
                resolution: forbid.targetResolution
              }
            ])
      ];
      for (const endpoint of endpoints) {
        if (endpoint.resolution === "ambiguous") {
          continue;
        }
        if (endpoint.resolution === "unknown" || !isResolvedVertex(endpoint.name, model)) {
          diagnostics.push(unknownName("relation_endpoint", endpoint.name, forbid.provenance));
        } else if (isAmbiguousVertex(endpoint.name, model)) {
          diagnostics.push({
            kind: "invalid_rule",
            rule: rule.name,
            reason: `path endpoint ${displaySymbol(endpoint.name)} resolves to both a component and a resource`,
            filePath: forbid.provenance.filePath,
            causedBy: [describeProvenance(forbid.provenance)]
          });
        }
      }
    }
  }

  return diagnostics;
}

function unknownName(
  nameKind: Extract<SemanticDiagnostic, { kind: "unknown_name" }>["nameKind"],
  name: string,
  prov: Provenance
): SemanticDiagnostic {
  return {
    kind: "unknown_name",
    nameKind,
    name,
    filePath: prov.filePath,
    causedBy: [describeProvenance(prov)]
  };
}
