// Elaborated shape (shape.elaborated.v1, A.12.9) and the shared diagnostic types.
import type { BlockKind, OrderDir, ParamKind, RecKind } from "./source.ts";
import type { Level, Tier } from "./util.ts";

export type Op =
  | "edge.exists"
  | "edge.forbid"
  | "path.forbid"
  | "cycle.forbid"
  | "authority"
  | "effect.forbid"
  | "effects.upper"
  | "effects.lower"
  | "law";

export type Family = "structure" | "authority" | "conduct" | "law";
export type Projection = "unit" | "contract" | "trust";

export interface Requirement {
  level: Level;
  judged: boolean;
  pins: string[];
  projection: Projection;
}

export type JsonValue = null | boolean | number | string | JsonValue[] | { [k: string]: JsonValue };
export type Args = { [k: string]: JsonValue };

export interface Claim {
  ids: string[];
  op: Op;
  args: Args;
  /** JCS of {"v":"shape.claim.v1", op, args} */
  nf: string;
  fp: string;
  owner: string;
  tier: Tier;
  requirement: Requirement | null;
  family: Family;
  polarity: "upper" | "lower" | "law";
  /** the declaration bearing the claim (unit, component, resource Q) or null */
  bearer: string | null;
  /** template the claim came from, if any */
  template: string | null;
  /** schema | hosted | informal, laws only */
  statementForm: "schema" | "hosted" | "informal" | null;
  /** the declaration that holds the claim, "<kind> Q" (error subjects, A.15.1) */
  decl: string;
  /** where owner and tier were written: null on the claim, else the item it inherits from
   *  ("unit Q", "component Q", "resource Q", "shape", or "default") (A.8.2.3 L7 [D18]) */
  ownerFrom: string | null;
  tierFrom: string | null;
}

export interface Actor {
  q: string;
  kind: "person" | "team" | "agent";
  operator: string | null;
  identities: string[];
  members: string[];
  /** ρ for actors (A.6.1.4 [D18]) */
  was: string | null;
}

export interface ResourceItem {
  q: string;
  owner: string;
  tier: Tier;
  /** canonical resource codes */
  bind: string[];
  was: string | null;
  attach: string[];
  /** "shape" when the owner defaults to the shape owner, else null */
  ownerFrom: string | null;
}

export interface ComponentItem {
  q: string;
  boundary: boolean;
  owner: string;
  tier: Tier;
  paths: string[];
  /** except globs, removed from every path glob (A.3.3.1 [D25]) */
  exceptPaths: string[];
  /** null: open authority (no grants clause) */
  grants: string[] | null;
  allows: string[];
  assumes: { id: string; text: string }[];
  complete: string[];
  was: string | null;
  units: string[];
  attach: string[];
  /** "shape" when the owner defaults to the shape owner, else null */
  ownerFrom: string | null;
}

export interface UnitItem {
  q: string;
  component: string;
  name: string;
  owner: string;
  tier: Tier;
  /** explicit code identity, or null to bind by name */
  bind: string | null;
  was: string | null;
  summary: { mode: "complete" | "partial"; atoms: { atom: string; via: string | null }[] } | null;
  attach: string[];
  /** owner and tier inherited from the component (L7 reports them once, at the component) */
  ownerFrom: string | null;
  tierFrom: string | null;
}

export interface TemplateItem {
  q: string;
  schemaFp: string;
  params: [string, ParamKind][];
  order: [string, OrderDir][];
  /** requires note entries: each a sorted list of accepted kinds */
  notes: string[][];
}

export type ExceptionSubject =
  | { kind: "unit"; sel: string }
  | { kind: "code"; id: string }
  | { kind: "pair"; from: string; to: string };

export interface ExceptionItem {
  q: string;
  waives: ("contradiction" | "unestablished")[];
  target: { kind: "claim"; fps: string[]; ref: string } | { kind: "component"; q: string };
  for: ExceptionSubject[] | null;
  owner: string;
  expires: number;
  expiresText: string;
}

export interface NoteItem {
  q: string;
  kind: "rationale" | "memory" | "decision";
  about: string[];
  owner: string;
  text: string;
  confidence: string | null;
}

export interface ProviderItem {
  q: string;
  produces: RecKind[];
  observes: string[];
  decides: string[];
  presence: boolean;
  absence: boolean;
  persist: boolean;
  depsComplete: boolean;
  identity: string | null;
  trusts: [string, string][];
  /** path globs, identities (A.5.2.6 [D9]) and a digest */
  implementation: { paths: string[]; ids: string[]; digest: string | null } | null;
}

export interface TierPolicy {
  floor: Exclude<Level, "none">;
  blocks: BlockKind[];
  maxAge: number;
  judges: string[];
}

export interface Policy {
  tiers: Record<"low" | "normal" | "critical", TierPolicy>;
  budget: number | null;
}

export interface Cause {
  type:
    | "fact"
    | "record"
    | "code"
    | "binding"
    | "claim"
    | "template"
    | "pack"
    | "base-claim"
    | "provider"
    | "policy"
    | "exception"
    | "note"
    | "assumption";
  id: string;
  text?: string;
}

export interface Discharger {
  act:
    | "edit-code"
    | "rerun"
    | "provide"
    | "add-was"
    | "answer"
    | "judge"
    | "declare"
    | "exception"
    | "edit-shape"
    | "lower-requirement"
    | "revert"
    | "bind";
  by: "author" | "ci" | "judges";
  agentSafe: boolean;
  eligible: string[];
  creates: { kind: string; tier: Tier; answers: number; owners: string[] } | null;
  command?: string;
  snippet?: string;
}

export interface ShapeError {
  code: string;
  subject: string;
  message?: string;
  causes: Cause[];
  dischargers: Discharger[];
}

export interface ESF {
  v: "shape.elaborated.v1";
  /** manifest: the manifest identity the shape names (A.5.2.17 [D27]), or null */
  shape: { q: string; owner: string; policy: string; manifest: string | null; declared: boolean };
  actors: Actor[];
  effects: { verb: string; implies: string[] }[];
  kinds: { name: string; from: "component" | "resource"; to: "component" | "resource" }[];
  hatches: { kind: string; lang: string }[];
  resources: ResourceItem[];
  components: ComponentItem[];
  units: UnitItem[];
  claims: Claim[];
  templates: TemplateItem[];
  exceptions: ExceptionItem[];
  notes: NoteItem[];
  providers: ProviderItem[];
  policy: Policy;
  /** head: shape errors; base: defects */
  errors: ShapeError[];
}

export const TRUST = "std::Trust";

export function atomOf(verb: string, resource: string): string {
  return `${verb}<${resource}>`;
}

export function parseAtom(atom: string): { verb: string; resource: string } | null {
  const m = /^([A-Za-z_][\w]*)<(.+)>$/.exec(atom.trim());
  if (!m || m[1] === undefined || m[2] === undefined) return null;
  return { verb: m[1], resource: m[2].trim() };
}
