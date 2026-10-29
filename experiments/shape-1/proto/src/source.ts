// shape.source.v1 (version 7, A.16.2(g)): the JSON transcription of the Shape 1.0 surface syntax
// (syntax §2), the source profile's shape. One declaration form per concept; field names follow the
// grammar's keywords. Version 7 adds shape.manifest, actor.was, component.exceptPaths and
// implementation.ids.
import type { Level, Tier } from "./util.ts";

export type NoteKind = "rationale" | "memory" | "decision";
export type RecKind = "observation" | "test" | "proof" | "judgment" | "equivalence";
export type ParamKind = "resource" | "component" | "unit" | "effect" | "kind" | "value" | "code";
export type OrderDir = "leq" | "geq" | "subset" | "superset" | "equal";
export type BlockKind = "unestablished" | "coverage" | "latent-loosening";

/** A template application `N<args>`; args are refs, atoms `V<R>`, strings, safe integers or `code ts("…")`. */
export interface TemplateApp {
  name: string;
  args?: (string | number)[];
}

export interface EvidenceSpec {
  /** `evidence tested` etc. */
  level?: Exclude<Level, "none">;
  /** `evidence tested or judged` */
  orJudged?: boolean;
  /** `evidence judged` (no level) */
  judged?: boolean;
  at?: "unit" | "contract" | "trust";
  by?: string[];
}

export interface ClaimMeta {
  owner?: string;
  tier?: Tier;
  evidence?: EvidenceSpec;
}

export type Clause =
  | { forbid: "effect"; final?: boolean; atom: string; within?: string[]; except?: string[] }
  | {
      forbid: "path";
      final?: boolean;
      from: string[];
      to: string[];
      over: string[];
      exceptVia?: string[];
    }
  | {
      forbid: "edge";
      final?: boolean;
      kind: string;
      from: string[];
      to: string[];
      exceptFrom?: string[];
      exceptTo?: string[];
    }
  | { forbid: "cycle"; final?: boolean; over: string[] }
  | { forbid: "hatch"; final?: boolean; kinds: string[] };

export interface SummaryEntry {
  atom: string;
  via?: string;
}

export interface UnitDecl {
  name: string;
  attach?: TemplateApp[];
  owner?: string;
  tier?: Tier;
  was?: string;
  /** SourceRef, e.g. `ts("src/a.ts#f")` */
  bind?: string;
  effects?: { mode: "complete" | "partial" | "unknown"; atoms?: SummaryEntry[] };
}

export interface TierPolicySrc {
  floor?: Exclude<Level, "none">;
  blocks?: BlockKind[];
  maxAge?: number;
  judges?: string[];
}

export type TBody =
  | Clause
  | { grants: string }
  | { law: { on?: string[]; informal?: string; evidence?: EvidenceSpec } }
  | { requiresNote: NoteKind | NoteKind[] }
  | { order: [string, OrderDir] };

export type Decl =
  | { decl: "shape"; name: string; owner: string; policy?: string; manifest?: string }
  | {
      decl: "actor";
      name: string;
      kind: "person" | "team" | "agent";
      operator?: string;
      identities?: string[];
      members?: string[];
      was?: string;
    }
  | { decl: "effect"; name: string; implies?: string[] }
  | { decl: "kind"; name: string; from: "component" | "resource"; to: "component" | "resource" }
  | { decl: "hatch"; names: string[]; lang: string }
  | {
      decl: "resource";
      name: string;
      attach?: TemplateApp[];
      owner?: string;
      tier?: Tier;
      was?: string;
      bind?: string[];
    }
  | {
      decl: "component";
      name: string;
      boundary?: boolean;
      attach?: TemplateApp[];
      owner?: string;
      tier?: Tier;
      was?: string;
      paths?: string[];
      /** globs removed from every path glob of the component (A.3.3.1 [D25]) */
      exceptPaths?: string[];
      /** absent: open authority; "none": empty grants */
      grants?: string[] | "none";
      relationsComplete?: string[];
      allows?: string[];
      assumes?: { id: string; text: string }[];
      units?: UnitDecl[];
    }
  | ({ decl: "relation"; name: string; kind: string; connects: string[] } & ClaimMeta)
  | ({
      decl: "rule";
      name: string;
      clauses?: Clause[];
      when?: { param: string; has: string }[];
      template?: TemplateApp;
    } & ClaimMeta)
  | ({
      decl: "law";
      name: string;
      on?: string[];
      statement?: string;
      informal?: string;
      template?: TemplateApp;
    } & ClaimMeta)
  | { decl: "template"; name: string; params: [string, ParamKind][]; body: TBody[] }
  | {
      decl: "exception";
      name: string;
      waives?: ("contradiction" | "unestablished")[];
      target: string;
      for?: string[];
      owner: string;
      expires: string;
    }
  | {
      decl: "note";
      name: string;
      kind: NoteKind;
      about: string[];
      owner?: string;
      text?: string;
      confidence?: "low" | "medium" | "high";
      chose?: string;
      over?: string[];
    }
  | {
      decl: "provider";
      name: string;
      produces: RecKind[];
      observes?: string[];
      decides?: string[];
      sound?: ("presence" | "absence")[];
      persist?: boolean;
      depsComplete?: boolean;
      identity?: string;
      trusts?: [string, string][];
      implementation?: { paths?: string[]; ids?: string[]; digest?: string };
    }
  | {
      decl: "policy";
      name: string;
      tiers: Partial<Record<"low" | "normal" | "critical", TierPolicySrc>>;
      budget?: number;
    };

export interface SourceModule {
  module: string;
  imports?: string[];
  decls: Decl[];
  /** provenance for diagnostics (not hashed) */
  file?: string;
  /** a pinned pack's module: exports vocabulary, templates and policies, never claims */
  pack?: boolean;
}

export interface SourceDoc {
  v: "shape.source.v1";
  modules: SourceModule[];
  /** packs pinned by the lock (name → version); std is built in */
  lock?: { name: string; version: string; digest?: string }[];
}

export function declName(d: Decl): string {
  return d.decl === "hatch" ? d.names.join(",") : d.name;
}
