// Checker-owned adapter from pure prelude metadata into effective-model
// TraitInfo objects. Keeping this conversion out of prelude.ts preserves the
// dependency direction: language metadata has no runtime dependency on checker
// implementation types.
import type { PreludeTraitDefinition } from "../prelude.ts";
import { PRELUDE_CONTEXT_REQUIREMENTS, PRELUDE_TRAITS } from "../prelude.ts";
import type { TraitContextRequirement, TraitInfo } from "./model.ts";
import { provenance } from "./provenance.ts";

export function isPreludeTrait(trait: TraitInfo | undefined): boolean {
  return (
    trait !== undefined &&
    (trait.provenance.filePath === undefined || trait.provenance.filePath === "standard prelude")
  );
}

function preludeTraitInfo(trait: PreludeTraitDefinition): TraitInfo {
  return {
    name: trait.name,
    typeParams: trait.typeParams.map((typeParam) => ({ ...typeParam })),
    finalForbids: trait.finalForbids.map((forbid) => {
      const target = forbid.target ? `<${forbid.target}>` : "";
      return {
        effect: forbid.effect,
        target: forbid.target,
        targetBinding:
          forbid.target === undefined
            ? "omitted"
            : trait.typeParams.some((typeParam) => typeParam.name === forbid.target)
              ? "generic"
              : "concrete",
        final: true,
        provenance: provenance(
          "standard prelude",
          `trait ${trait.name} forbids final ${forbid.effect}${target}`
        )
      };
    }),
    contextRequirements: [],
    provenance: provenance("standard prelude", `trait ${trait.name}`)
  };
}

/**
 * The initial trait table: prelude `finalForbids` traits plus the prelude
 * context-obligation traits (PreserveInline, RefactorSensitive, ...), seeded
 * with their requirements straight from PRELUDE_CONTEXT_REQUIREMENTS. Seeding
 * built-in obligations through the same trait model that user traits use means
 * `requirementsForTarget` has a single source and same-name user traits shadow
 * built-ins by replacing the entry.
 */
export function preludeTraitSeed(): Map<string, TraitInfo> {
  const traits = new Map<string, TraitInfo>(
    PRELUDE_TRAITS.map((trait) => [trait.name, preludeTraitInfo(trait)])
  );
  for (const rule of PRELUDE_CONTEXT_REQUIREMENTS) {
    const existing = traits.get(rule.trait);
    const requirement: TraitContextRequirement = {
      targetKind: rule.targetKind,
      contextType: rule.contextType,
      satisfiedBy: rule.satisfiedBy,
      requiresDescription: rule.requiresDescription === true,
      provenance: provenance("standard prelude", `${rule.trait} requires ${rule.contextType}`)
    };
    if (existing) {
      existing.contextRequirements.push(requirement);
    } else {
      traits.set(rule.trait, {
        name: rule.trait,
        typeParams: [],
        finalForbids: [],
        contextRequirements: [requirement],
        provenance: provenance("standard prelude", `trait ${rule.trait}`)
      });
    }
  }
  return traits;
}
