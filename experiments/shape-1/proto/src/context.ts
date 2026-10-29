// The derivation context shared by the derive steps (A.7.8), version 7.
import type { ProvG, UsableEntry, WFact } from "./evidence.ts";
import type { Gov } from "./governance.ts";
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
  /** change or preview mode with a base: novelty, loosening and coverage apply */
  hasBase: boolean;
  head: ESF;
  /** the readable base shape (null: audit mode, or unreadable base) */
  base: ESF | null;
  baseUnreadable: boolean;
  /** an empty base: no shape declaration and no items (A.16.17) */
  emptyBase: boolean;
  /** governance base: the base shape, the head in audit mode or over an unreadable base */
  gov: ESF;
  Mh: ManifestIndex;
  Mb: ManifestIndex | null;
  Wh: World;
  Wb: World | null;
  /** identities in Δcode (new, or a digest moved at some projection) */
  delta: Set<string>;
  /** (identity, projection) pairs of Δcode, "id\0projection" */
  deltaPairs: Set<string>;
  deleted: Set<string>;
  finest: Set<string>;
  /** new identity → the deleted identity it is relocated from (A.6.1.5 [D6]) */
  relocatedFrom: Map<string, string>;
  /** base Q → head Q (ρ) */
  rho: Map<string, string>;
  /** ρ rule 3 hints (unique remove-and-add per kind and module), never implying */
  hints: Map<string, string>;
  /** base vocabulary items ρ rules 0–2 leave unmapped */
  unmapped: Set<string>;
  renames: { base: string; head: string; rule: string }[];
  provs: Map<string, ProvG>;
  /** valid head records: records and persisted.head */
  records: ParsedRecord[];
  /** valid base-revision records */
  baseRecords: ParsedRecord[];
  /** is a base record usable with force in a run whose head is the base (A.16.6(c))? */
  usableAtBase: (r: ParsedRecord) => boolean;
  facts: WFact[];
  factById: Map<string, WFact>;
  newFact: (f: WFact) => boolean;
  headClaims: Map<string, Claim>;
  baseClaims: Map<string, Claim>;
  /** base fp → head heir fps; head fp → base fps it is an heir of */
  heirs: Map<string, string[]>;
  heirOf: Map<string, string[]>;
  /** head fp → base structural claims it is an H_A member of (A.6.2.2): tier* and R* only */
  hAOf: Map<string, string[]>;
  /** policy* */
  policy: Policy;
  gv: Gov;
  errors: ShapeError[];
  equiv: (a: string, b: string) => boolean;
  /** Calls°: identity → called identities (observed call facts within M_h plus `via` pairs) */
  calls: Map<string, { to: string; fact: WFact }[]>;
  /** Refs°: manifest refs with both ends in ids(M_h) */
  refs: Map<string, string[]>;
  /** usable observation entries anchored at each identity */
  obsEntries: Map<string, UsableEntry[]>;
  /** base claim fps whose final loosening two persons answered in this run (A.16.13) */
  finalAnswered: Set<string>;
}
