// Checker input and output contracts (records §4–5, A.12.7, A.12.10), prototype profile.
import type { Statement } from "./manifest.ts";
import type { Cause, Discharger, JsonValue, ShapeError } from "./model.ts";
import type { SourceDoc } from "./source.ts";
import type { Tier } from "./util.ts";

export interface RevisionInput {
  revision: string;
  /** the shape, as shape.source.v1 (the prototype's stand-in for `files`); null: unreadable (L0) */
  source: SourceDoc | null;
  manifest: Statement;
  /** optional git tree id the manifest's tree must rebuild to (stand-in for the commit check) */
  treeId?: string;
  /** base only: committer time, RFC 3339 (now* = max(now, it)) */
  committerTime?: string;
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
  renames: { base: string; head: string; rule: string }[];
  debt: {
    obligation: string;
    exception: string;
    owner: string;
    expiresInDays: number;
    flagged: boolean;
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
