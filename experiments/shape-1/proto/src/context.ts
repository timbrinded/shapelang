// The derivation context shared by the derive steps (A.7.8).
import type { ProvG, UsableEntry, WFact } from "./evidence.ts";
import type { CheckInput } from "./io-types.ts";
import type { ManifestIndex } from "./manifest.ts";
import type { Claim, ESF, Policy, ShapeError } from "./model.ts";
import type { ParsedRecord } from "./records.ts";
import type { World } from "./world.ts";

export interface Ctx {
  input: CheckInput;
  mode: CheckInput["mode"];
  /** now* in seconds */
  now: number;
  /** change mode with a base: novelty, loosening and coverage apply */
  hasBase: boolean;
  head: ESF;
  /** the base shape (null: audit mode, or unreadable base) */
  base: ESF | null;
  baseUnreadable: boolean;
  /** governance base: the base shape, the head in audit mode, an empty shape when unreadable */
  gov: ESF;
  Mh: ManifestIndex;
  Mb: ManifestIndex | null;
  Wh: World;
  Wb: World | null;
  delta: Set<string>;
  deleted: Set<string>;
  finest: Set<string>;
  /** base Q → head Q (ρ) */
  rho: Map<string, string>;
  /** ρ rule 3 hints (unique remove-and-add per kind and module), never implying (A.6.1.4, A.8.1.6) */
  hints: Map<string, string>;
  /** base vocabulary items ρ rules 0–2 leave unmapped */
  unmapped: Set<string>;
  renames: { base: string; head: string; rule: string }[];
  provs: Map<string, ProvG>;
  records: ParsedRecord[];
  baseRecords: ParsedRecord[];
  facts: WFact[];
  factById: Map<string, WFact>;
  newFact: (f: WFact) => boolean;
  headClaims: Map<string, Claim>;
  baseClaims: Map<string, Claim>;
  /** base fp → head heir fps; head fp → base fps it is an heir of */
  heirs: Map<string, string[]>;
  heirOf: Map<string, string[]>;
  policy: Policy;
  errors: ShapeError[];
  equiv: (a: string, b: string) => boolean;
  /** Calls°: identity → called identities (observed call facts within M_h plus `via` pairs) */
  calls: Map<string, { to: string; fact: WFact }[]>;
  health: Record<string, unknown>;
  /** usable observation entries anchored at each identity */
  obsEntries: Map<string, UsableEntry[]>;
}
