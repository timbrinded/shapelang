// Checker input and output contracts (records §4–5, A.12.7, A.12.10, A.16.1-2): the full profile
// (files, commit, packs, trustRoots) and the source profile (source, treeId, committerTime).
import type { Statement } from "./manifest.ts";
import type { Cause, Discharger, JsonValue, ShapeError } from "./model.ts";
import type { SourceDoc } from "./source.ts";
import type { Tier } from "./util.ts";

export interface RevisionInput {
  revision: string;
  /** source profile: the shape as shape.source.v1; null: unreadable (L0) */
  source?: SourceDoc | null;
  /** a manifest statement or its DSSE envelope */
  manifest: Statement | { payloadType: string; payload: string; signatures: unknown[] };
  /** source profile: optional git tree id the manifest's tree must rebuild to */
  treeId?: string;
  /** source profile, base: committer time, RFC 3339 (now* = max(now, it)) */
  committerTime?: string;
  /** full profile: the commit object after its header */
  commit?: string;
  /** full profile: exactly the revision's shape files */
  files?: { path: string; text: string }[];
}

export interface Author {
  identity: string;
  verified: boolean;
  bot: boolean;
}

export interface Review {
  identity: string;
  line: string;
  /** change id the review was written on (defaults to every change id) */
  change?: string;
  time?: string;
}

export interface CheckInput {
  contract: "shape.check.input/v1";
  mode: "change" | "audit" | "preview";
  now: string;
  head: RevisionInput;
  base: RevisionInput | null;
  change: { ids: string[] };
  authors: Author[];
  reviews: Review[];
  records: unknown[];
  baseRecords: unknown[];
  persisted: {
    base: { path: string; record: unknown }[];
    head: { path: string; record: unknown }[];
  };
  options: { health: boolean; teeth: boolean };
  /** full profile: one entry per pinned (name, version) */
  packs?: { name: string; version: string; files: { path: string; text: string }[] }[];
  /** full profile: Sigstore roots (ed25519 identities need none) */
  trustRoots?: { fulcio: string[]; rekor: string[] };
}

export type Severity = "blocking" | "owed";
export type ObKind = "contradiction" | "unestablished" | "loosening" | "coverage";

export interface ObligationOut {
  key: string;
  kind: ObKind;
  reason: string | null;
  questions: string[] | null;
  introduced: boolean;
  severity: Severity;
  tier: Tier;
  budget: "mechanical" | "judgment";
  force: "sound" | "heuristic" | null;
  owner: string;
  assignee: string | null;
  group: string;
  claim: { fp: string; ids: string[]; tier: Tier } | null;
  subject: JsonValue;
  witness: string[];
  facts: Record<string, JsonValue>;
  counterexample: JsonValue;
  exploited: boolean | null;
  final: boolean;
  binding: string;
  exception: string | null;
  dischargers: Discharger[];
  message?: string;
  causes: Cause[];
  /** prototype extensions, outside the core comparison: */
  affected?: string[];
  rule?: number;
  matched?: boolean;
}

export interface CheckOutput {
  contract: "shape.check.output/v1";
  mode: CheckInput["mode"];
  inputDigest: string;
  verdict: "invalid" | "blocked" | "owed" | "pass";
  errors: ShapeError[];
  rejected: { record: string; code: string; detail: string }[];
  obligations: ObligationOut[];
  answered: {
    obligation: string;
    records: string[];
    self: boolean;
    exploited: boolean | null;
    as: "discharge" | "exception-answer";
  }[];
  loosening: {
    question: string;
    subject: string;
    answer: "loosened" | "undecided";
    exploited: boolean;
    final: boolean;
    affected: string[];
    counterexample: JsonValue;
    obligation: string;
  }[];
  /** the order class (A.8.1.3); null in audit mode */
  order: "looser" | "tighter" | "equivalent" | "incomparable" | "undecided" | null;
  renames: { base: string; head: string; rule: string }[];
  debt: {
    obligation: string;
    exceptions: string[];
    exception: string;
    owner: string;
    expiresInDays: number;
  }[];
  preexisting: { obligation: string; owner: string }[];
  budget: { limit: number | null; used: number; overflow: string[] };
  health: Record<string, JsonValue>;
  /** phase-1 review lines, per group (display) */
  summary?: {
    group: string;
    tier: Tier;
    eligible: string[];
    approve: string | null;
    judge: string[];
    members: string[];
  }[];
}

export const EXIT: Record<CheckOutput["verdict"], number> = {
  pass: 0,
  owed: 0,
  blocked: 1,
  invalid: 2
};
