// The std pack 1.0.0 (syntax §4 and A.13.2) as a shape.source.v1 module.
import { H } from "./jcs.ts";
import type { SourceModule } from "./source.ts";

export const SURFACE_TEXT = "The trusted surface of this component is acceptable.";
export const REFACTOR_TEXT =
  "Changes to this unit preserve the constraint recorded in its memory note.";
export const DOCUMENTED_TEXT = "The documentation describes this component as implemented.";

export const STD: SourceModule = {
  module: "std",
  file: "std/std.shape",
  decls: [
    { decl: "effect", name: "Read" },
    { decl: "effect", name: "Write" },
    { decl: "effect", name: "Export", implies: ["Read"] },
    { decl: "effect", name: "Append", implies: ["Write"] },
    { decl: "effect", name: "Import", implies: ["Write"] },
    { decl: "effect", name: "Update", implies: ["Write"] },
    { decl: "effect", name: "Redact", implies: ["Update"] },
    { decl: "effect", name: "LogicalDelete", implies: ["Update"] },
    { decl: "effect", name: "HardDelete", implies: ["Update"] },
    { decl: "effect", name: "Truncate", implies: ["HardDelete"] },
    { decl: "effect", name: "DropStorage", implies: ["Truncate"] },
    { decl: "resource", name: "Trust" },
    { decl: "effect", name: "Hatch" },
    { decl: "kind", name: "calls", from: "component", to: "component" },
    { decl: "kind", name: "callbacks", from: "component", to: "component" },
    { decl: "kind", name: "provides", from: "component", to: "resource" },
    { decl: "kind", name: "data_flow", from: "component", to: "component" },
    { decl: "kind", name: "coordinated_call", from: "component", to: "component" },
    {
      decl: "hatch",
      names: [
        "external_body",
        "external",
        "assume",
        "admit",
        "assume_specification",
        "uninterp",
        "axiom"
      ],
      lang: "verus"
    },
    { decl: "hatch", names: ["unsafe"], lang: "bend" },
    { decl: "hatch", names: ["ts_ignore"], lang: "ts" },
    {
      decl: "template",
      name: "AppendOnly",
      params: [["R", "resource"]],
      body: [{ forbid: "effect", atom: "HardDelete<R>" }]
    },
    {
      decl: "template",
      name: "HatchesStayAtBoundaries",
      params: [],
      body: [{ forbid: "hatch", kinds: ["*"] }]
    },
    {
      decl: "template",
      name: "ReviewedSurface",
      params: [["B", "component"]],
      body: [{ law: { informal: SURFACE_TEXT, evidence: { judged: true, at: "trust" } } }]
    },
    {
      decl: "template",
      name: "RefactorSensitive",
      params: [["U", "unit"]],
      body: [{ requiresNote: "memory" }, { law: { informal: REFACTOR_TEXT } }]
    },
    {
      decl: "template",
      name: "Deterministic",
      params: [["F", "unit"]],
      body: [{ law: { evidence: { level: "tested" } } }]
    },
    {
      decl: "template",
      name: "HistoryPreserved",
      params: [["R", "resource"]],
      body: [{ law: { evidence: { level: "tested" } } }]
    },
    {
      decl: "template",
      name: "Bounded",
      params: [
        ["F", "unit"],
        ["Lo", "value"],
        ["Hi", "value"]
      ],
      body: [
        { law: { evidence: { level: "tested" } } },
        { order: ["Lo", "geq"] },
        { order: ["Hi", "leq"] }
      ]
    },
    {
      decl: "template",
      name: "Verified",
      params: [["K", "component"]],
      body: [{ law: { evidence: { level: "proven" } } }]
    },
    { decl: "template", name: "PII", params: [["R", "resource"]], body: [] },
    {
      decl: "template",
      name: "Owns",
      params: [
        ["R", "resource"],
        ["K", "component"]
      ],
      body: [
        { forbid: "effect", atom: "Write<R>", except: ["component K"] },
        { forbid: "edge", kind: "provides", from: ["*"], to: ["R"], exceptFrom: ["K"] }
      ]
    },
    {
      decl: "template",
      name: "Layering",
      params: [
        ["Upper", "component"],
        ["Lower", "component"]
      ],
      body: [
        {
          forbid: "path",
          from: ["Lower"],
          to: ["Upper"],
          over: ["calls", "callbacks", "coordinated_call"]
        }
      ]
    },
    {
      decl: "template",
      name: "DocumentedBy",
      params: [
        ["K", "component"],
        ["Doc", "code"]
      ],
      body: [{ law: { informal: DOCUMENTED_TEXT } }]
    },
    {
      decl: "policy",
      name: "DefaultPolicy",
      tiers: {
        low: { floor: "declared", blocks: [], maxAge: 365, judges: ["owner", "agents"] },
        normal: {
          floor: "declared",
          blocks: ["latent-loosening"],
          maxAge: 365,
          judges: ["owner", "agents"]
        },
        critical: {
          floor: "tested",
          blocks: ["unestablished", "coverage", "latent-loosening"],
          maxAge: 90,
          judges: ["owner"]
        }
      }
    }
  ]
};

/** shape.pack.v1 digest of the built-in std (the prototype hashes the JCS of the module). */
export function stdPackDigest(): string {
  return H({ v: "shape.pack.v1", files: [["std/std.shape", H(STD).slice(7)]] });
}
