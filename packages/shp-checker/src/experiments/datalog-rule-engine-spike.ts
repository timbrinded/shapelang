import { compareCodepointStrings } from "../shape-strings.ts";
import { compareShapeDiagnostics } from "../checker/diagnostics.ts";
import type { Fact, Provenance, SemanticDiagnostic } from "../checker/model.ts";
import { describeProvenance } from "../checker/provenance.ts";

type Atom = {
  relation: string;
  variables: readonly string[];
};

type Rule = {
  select: readonly string[];
  when: readonly Atom[];
  unless: readonly Atom[];
};

type Tuple = {
  relation: string;
  values: readonly string[];
  provenance: readonly Provenance[];
};

type Row = {
  bindings: ReadonlyMap<string, string>;
  provenance: readonly Provenance[];
};

type PrototypeMissingGrantDiagnostic = Extract<SemanticDiagnostic, { kind: "missing_grant" }>;

const MISSING_GRANT_RULE: Rule = {
  select: ["component", "function", "effect", "target"],
  when: [
    {
      relation: "effect",
      variables: ["component", "function", "effect", "target"]
    },
    {
      relation: "component",
      variables: ["component"]
    }
  ],
  unless: [
    {
      relation: "grants",
      variables: ["component", "effect", "target"]
    }
  ]
};

/**
 * Executable comparison spike for issue #39.
 *
 * This deliberately evaluates only the fact-complete missing-grant slice. It
 * is not exported from the checker package and is not called by the production
 * semantic registry.
 */
export function evaluateMissingGrantPrototype(
  facts: readonly Fact[]
): PrototypeMissingGrantDiagnostic[] {
  return evaluateRule(facts.flatMap(toTuple), MISSING_GRANT_RULE)
    .map((row) => ({
      kind: "missing_grant" as const,
      component: boundValue(row, "component"),
      functionName: boundValue(row, "function"),
      effect: boundValue(row, "effect"),
      target: boundValue(row, "target"),
      filePath: row.provenance[0]?.filePath,
      causedBy: row.provenance.map(describeProvenance)
    }))
    .toSorted(compareShapeDiagnostics);
}

function toTuple(fact: Fact): Tuple[] {
  switch (fact.kind) {
    case "component":
      return [{ relation: "component", values: [fact.name], provenance: [fact.provenance] }];
    case "effect":
      if (!fact.target) {
        return [];
      }
      return [
        {
          relation: "effect",
          values: [fact.component, fact.functionName, fact.effect, fact.target],
          provenance: [fact.provenance]
        }
      ];
    case "grants":
      return [
        {
          relation: "grants",
          values: [fact.component, fact.effect, fact.target],
          provenance: [fact.provenance]
        }
      ];
    default:
      return [];
  }
}

function evaluateRule(input: readonly Tuple[], rule: Rule): Row[] {
  const database = input.toSorted((left, right) =>
    compareCodepointStrings(tupleKey(left), tupleKey(right))
  );
  let rows: Row[] = [{ bindings: new Map(), provenance: [] }];

  for (const atom of rule.when) {
    const candidates = database.filter((candidate) => candidate.relation === atom.relation);
    const joined: Row[] = [];
    for (const row of rows) {
      for (const candidate of candidates) {
        const bindings = unify(atom, candidate, row.bindings);
        if (bindings) {
          joined.push({
            bindings,
            provenance: [...row.provenance, ...candidate.provenance]
          });
        }
      }
    }
    rows = joined;
  }

  for (const atom of rule.unless) {
    rows = rows.filter(
      (row) =>
        !database.some(
          (candidate) =>
            candidate.relation === atom.relation &&
            unify(atom, candidate, row.bindings) !== undefined
        )
    );
  }

  return rows.toSorted((left, right) =>
    compareCodepointStrings(
      rule.select.map((variable) => boundValue(left, variable)).join("\u0000"),
      rule.select.map((variable) => boundValue(right, variable)).join("\u0000")
    )
  );
}

function unify(
  atom: Atom,
  tuple: Tuple,
  existing: ReadonlyMap<string, string>
): ReadonlyMap<string, string> | undefined {
  if (atom.variables.length !== tuple.values.length) {
    return undefined;
  }

  const bindings = new Map(existing);
  for (const [index, variable] of atom.variables.entries()) {
    const value = tuple.values[index];
    const bound = bindings.get(variable);
    if (value === undefined || (bound !== undefined && bound !== value)) {
      return undefined;
    }
    bindings.set(variable, value);
  }
  return bindings;
}

function boundValue(row: Row, variable: string): string {
  const value = row.bindings.get(variable);
  if (value === undefined) {
    throw new Error(`unbound rule variable ${variable}`);
  }
  return value;
}

function tupleKey(tuple: Tuple): string {
  return `${tuple.relation}\u0000${tuple.values.join("\u0000")}\u0000${tuple.provenance
    .map((item) => `${item.filePath ?? ""}\u0000${item.label}`)
    .join("\u0000")}`;
}
