// trust (observed): escape hatches and trust markers for Rust/Verus, Lean and Bend.
//
// In the 1.0 model hatch facts come only from the manifest (A.3.4.4; RJ14 rejects hatch facts in
// observations), so this provider's evidence is a manifest overlay: an in-toto manifest statement
// (core manifestStatement) whose Bend and Lean files become registered identities with per-identity
// markers and hatch-completeness. Soundness: presence and absence at hatch-complete identities, as
// the spec gives manifest markers. Rust/Verus markers stay the core manifest's and are audited
// against vprobe's semantics. Lean `#print axioms` output becomes proof-record assumptions: a
// `lean` proof provider (produces proof, decides statements lean, sound presence) emits records for
// laws whose statement is a Lean declaration.
import type { Ctx } from "../../src/context.ts";
import type { FpIdentity } from "../../src/fingerprint/common.ts";
import type { CheckInput } from "../../src/io-types.ts";
import { reqOf } from "../../src/laws.ts";
import {
  type ManifestEntry,
  type ManifestPredicate,
  type Statement,
  indexManifest,
  manifestStatement
} from "../../src/manifest.ts";
import type { CodeCite, ShapeRecord, Signer } from "../../src/records.ts";
import type { SourceDoc } from "../../src/source.ts";
import { cmpStr } from "../../src/util.ts";
import { buildWorld } from "../../src/world.ts";
import {
  type Emitted,
  type Manifested,
  type ProviderInfo,
  cite,
  elaborateAt,
  emit,
  fileIdentity,
  providerName,
  selfValidate,
  sortCites
} from "../common.ts";
import { bendIdentities, markOpenLaws, scanBend } from "./bend.ts";
import {
  type LeanProject,
  leanAssumptions,
  leanIdentities,
  leanProject,
  nameCone,
  parsePrintAxioms,
  scanLean
} from "./lean.ts";
import { type RustAuditRow, auditRust } from "./rust.ts";

export const TRUST_VERSION = "0.1.0";

/** What the overlay's markers are sound for (the manifest's soundness, A.3.4.4). */
export const TRUST_SOUNDNESS = {
  sound: ["presence", "absence"] as const,
  at: "hatch-complete identities"
};

function toEntries(ids: FpIdentity[]): ManifestEntry[] {
  const out: ManifestEntry[] = [];
  for (const id of ids) {
    for (const d of id.digests) {
      const e: ManifestEntry = {
        id: id.id,
        projection: d.projection,
        scheme: d.scheme,
        digest: d.digest,
        kind: id.kind,
        parent: id.parent
      };
      if (Object.keys(id.markers).length > 0) e.markers = id.markers;
      if (id.merged) e.merged = id.merged;
      if (!id.hatchComplete) e.hatchComplete = false;
      out.push(e);
    }
  }
  return out;
}

export interface OverlayResult {
  statement: Statement;
  bend: {
    files: number;
    identities: number;
    markers: Record<string, number>;
    notHatchComplete: number;
  };
  lean: {
    files: number;
    identities: number;
    markers: Record<string, number>;
    notHatchComplete: number;
  };
  project: LeanProject;
}

function tally(ids: FpIdentity[]): Record<string, number> {
  const m: Record<string, number> = {};
  for (const x of ids) for (const [k, n] of Object.entries(x.markers)) m[k] = (m[k] ?? 0) + n;
  return Object.fromEntries(Object.entries(m).sort((a, b) => cmpStr(a[0], b[0])));
}

/** Replaces raw .bend and .lean file identities with registered ones (identities, markers). */
export function overlayManifest(
  statement: Statement,
  read: (p: string) => string | null,
  opts: { bend?: boolean; lean?: boolean } = {}
): OverlayResult {
  const pred = statement.predicate.shape as ManifestPredicate;
  const doBend = opts.bend ?? true;
  const doLean = opts.lean ?? true;
  const paths = [...new Set(pred.tree.map((t) => t.path))].sort(cmpStr);
  const bendPaths = doBend ? paths.filter((p) => p.endsWith(".bend")) : [];
  const leanPaths = doLean ? paths.filter((p) => p.endsWith(".lean")) : [];
  const bendScans = bendPaths.map((p) => scanBend(p, read(p) ?? ""));
  markOpenLaws(bendScans);
  const bendIds = bendScans.flatMap(bendIdentities);
  const project = leanProject(leanPaths.map((p) => scanLean(p, read(p) ?? "")));
  const leanIds = leanIdentities(project);
  const replaced = new Set(
    [...bendPaths, ...leanPaths].map((p) => `raw:${p.replace(/%/g, "%25").replace(/#/g, "%23")}`)
  );
  const entries = [
    ...pred.entries.filter((e) => !replaced.has(e.id)),
    ...toEntries(bendIds),
    ...toEntries(leanIds)
  ];
  const next = manifestStatement({ ...pred, entries });
  const { problems } = indexManifest(next);
  if (problems.length > 0)
    throw new Error(`overlay: ${problems.map((p) => `${p.code} ${p.detail}`).join("; ")}`);
  return {
    statement: next,
    bend: {
      files: bendScans.length,
      identities: bendIds.length,
      markers: tally(bendIds),
      notHatchComplete: bendScans.filter((s) => s.unknown > 0).length
    },
    lean: {
      files: project.scans.length,
      identities: leanIds.length,
      markers: tally(leanIds),
      notHatchComplete: project.scans.filter((s) => !s.hatchComplete).length
    },
    project
  };
}

/** Applies the overlay to a ready CheckInput's head and base manifests (for `shape1 check --input`). */
export function overlayInput(
  input: CheckInput,
  readHead: (p: string) => string | null,
  readBase?: (p: string) => string | null
): CheckInput {
  const head = {
    ...input.head,
    manifest: overlayManifest(input.head.manifest, readHead).statement
  };
  const base =
    input.base && readBase
      ? { ...input.base, manifest: overlayManifest(input.base.manifest, readBase).statement }
      : input.base;
  return { ...input, head, base };
}

// ---- report -----------------------------------------------------------------------------------------

export interface TrustReport {
  v: "shape.trust.report.v1";
  revision: string;
  soundness: typeof TRUST_SOUNDNESS;
  rust: {
    files: number;
    agree: number;
    vprobe: Record<string, number>;
    manifest: Record<string, number>;
    disagreements: RustAuditRow[];
  };
  bend: OverlayResult["bend"];
  lean: OverlayResult["lean"] & {
    theorems: {
      name: string;
      identity: string | null;
      axioms: string[];
      assumptions: { id: string; kind: string }[];
      inherited: string[];
    }[];
    unresolved: string[];
    byAxiom: Record<string, number>;
  };
  markedIdentities: { id: string; markers: Record<string, number> }[];
}

function sumKinds(rows: RustAuditRow[], key: "vprobe" | "manifest"): Record<string, number> {
  const m: Record<string, number> = {};
  for (const r of rows) for (const [k, n] of Object.entries(r[key])) m[k] = (m[k] ?? 0) + n;
  return Object.fromEntries(Object.entries(m).sort((a, b) => cmpStr(a[0], b[0])));
}

export function trustReport(
  man: Manifested,
  opts: { printAxioms?: string; leanVersion?: string } = {}
): { report: TrustReport; overlay: OverlayResult } {
  const overlay = overlayManifest(man.statement, man.read);
  const rows = auditRust(man.index, man.read);
  const ax = opts.printAxioms ? parsePrintAxioms(opts.printAxioms) : new Map<string, string[]>();
  const theorems: TrustReport["lean"]["theorems"] = [];
  const unresolved: string[] = [];
  const byAxiom: Record<string, number> = {};
  for (const [name, axioms] of [...ax.entries()].sort((a, b) => cmpStr(a[0], b[0]))) {
    for (const a of axioms) byAxiom[a] = (byAxiom[a] ?? 0) + 1;
    const identity = overlay.project.identity.get(name) ?? null;
    if (!identity) unresolved.push(name);
    const { assumptions, inherited } = leanAssumptions(
      overlay.project,
      name,
      axioms,
      opts.leanVersion ?? "4.34.0"
    );
    theorems.push({ name, identity, axioms, assumptions, inherited });
  }
  const idx = indexManifest(overlay.statement).index;
  const marked = idx
    ? [...idx.ids.values()]
        .filter((x) => Object.values(x.markers).some((n) => n > 0))
        .map((x) => ({ id: x.id, markers: x.markers }))
        .sort((a, b) => cmpStr(a.id, b.id))
    : [];
  return {
    overlay,
    report: {
      v: "shape.trust.report.v1",
      revision: man.revision,
      soundness: TRUST_SOUNDNESS,
      rust: {
        files: rows.length,
        agree: rows.filter((r) => Object.keys(r.delta).length === 0).length,
        vprobe: sumKinds(rows, "vprobe"),
        manifest: sumKinds(rows, "manifest"),
        disagreements: rows.filter((r) => Object.keys(r.delta).length > 0)
      },
      bend: overlay.bend,
      lean: {
        ...overlay.lean,
        theorems,
        unresolved,
        byAxiom: Object.fromEntries(Object.entries(byAxiom).sort((a, b) => cmpStr(a[0], b[0])))
      },
      markedIdentities: marked
    }
  };
}

// ---- Lean proof records ---------------------------------------------------------------------------------

export function leanProofProvider(o: {
  q: string;
  leanVersion?: string;
  identity?: string;
  implementation?: string[];
  depsComplete?: boolean;
}): ProviderInfo {
  const v = o.leanVersion ?? "4.34.0";
  return {
    q: o.q,
    version: `${TRUST_VERSION} lean@${v}`,
    decl: {
      decl: "provider",
      name: providerName(o.q),
      produces: ["proof"],
      decides: ["statements lean"],
      sound: ["presence"],
      trusts: [["lean", v]],
      ...(o.depsComplete ? { depsComplete: true } : {}),
      ...(o.identity ? { identity: o.identity } : {}),
      implementation: {
        paths: [
          ...(o.implementation ?? ["lakefile.toml", "lean-toolchain", "lake-manifest.json"])
        ].sort(cmpStr)
      }
    }
  };
}

/** One proof record per law whose statement is a Lean declaration listed in `#print axioms`
 *  output (built = the project compiled, so the theorem checked). Code: Req(c, test) — the law's
 *  targets plus (ref, closure); deps: the proof's name cone at unit; assumptions from the axioms. */
export function leanProofRecords(o: {
  info: ProviderInfo;
  source: SourceDoc;
  /** the overlaid manifest */
  man: Manifested;
  project: LeanProject;
  printAxioms: string;
  built: boolean;
  signer: Signer | null;
  time: string;
  leanVersion?: string;
  harness?: string[];
}): {
  records: Emitted[];
  skipped: { claim: string; why: string }[];
  rejected: { record: string; code: string; detail: string }[];
} {
  const esf = elaborateAt(o.source, o.time);
  const world = buildWorld(esf, o.man.index, { side: "h" });
  const ctx = { Wh: world, Mh: o.man.index } as unknown as Ctx;
  const ax = parsePrintAxioms(o.printAxioms);
  const records: Emitted[] = [];
  const skipped: { claim: string; why: string }[] = [];
  const rejected: { record: string; code: string; detail: string }[] = [];
  const byIdentity = new Map([...o.project.identity.entries()].map(([n, id]) => [id, n]));
  for (const c of esf.claims) {
    if (c.op !== "law") continue;
    const st = c.args.statement as { ref?: string };
    if (!st?.ref || !st.ref.startsWith("lean:")) continue;
    const id = c.ids[0] ?? c.fp;
    const name = byIdentity.get(st.ref);
    if (!name) {
      skipped.push({ claim: id, why: `${st.ref} is not a scanned Lean declaration` });
      continue;
    }
    const axioms = ax.get(name);
    if (!axioms) {
      skipped.push({ claim: id, why: `${name} is missing from the #print axioms output` });
      continue;
    }
    const code: CodeCite[] = [];
    let bad: string | null = null;
    for (const p of reqOf(ctx, c, "test", "unit")) {
      const ci = cite(o.man.index, p.id, p.projection);
      if (ci) code.push(ci);
      else bad = `${p.id}@${p.projection}`;
    }
    if (bad) {
      skipped.push({ claim: id, why: `Req ${bad} is not in the manifest` });
      continue;
    }
    const e = o.project.byName.get(name);
    const coneNames = e
      ? nameCone(o.project, name, e.scan.bare.slice(e.decl.start, e.decl.end), () => true)
      : [];
    const reqKeys = new Set(code.map((x) => `${x.id}@${x.projection}`));
    const deps = coneNames
      .map((n) => o.project.identity.get(n))
      .filter((x): x is string => !!x)
      .map((x) => cite(o.man.index, x, "unit"))
      .filter((x): x is CodeCite => !!x && !reqKeys.has(`${x.id}@${x.projection}`));
    const harness = (o.harness ?? ["lakefile.toml", "lean-toolchain", "lake-manifest.json"])
      .map((p) => fileIdentity(o.man.index, p))
      .filter((x): x is string => !!x)
      .map((x) => cite(o.man.index, x, "file"))
      .filter((x): x is CodeCite => !!x);
    const { assumptions } = leanAssumptions(o.project, name, axioms, o.leanVersion ?? "4.34.0");
    const rec: ShapeRecord = {
      v: "shape.evidence.v1",
      kind: "proof",
      result: o.built ? "supports" : "inconclusive",
      provider: { id: o.info.q, version: o.info.version },
      revision: o.man.revision,
      time: o.time,
      claim: { id, fp: c.fp, nf: c.nf },
      code: sortCites(code),
      deps: sortCites(deps),
      harness: sortCites(harness),
      assumptions,
      bound: { axioms: axioms.length }
    };
    const em = emit(rec, o.signer);
    const rej = selfValidate(em, o.info, o.man.index, o.time);
    if (rej) rejected.push(rej);
    else records.push(em);
  }
  return { records, skipped, rejected };
}
