// observe-ts (observed, heuristic calls; presence- and absence-sound effects on complete entries):
// turns a scan into observation records. Two providers share one scan:
//   effects  observes effect(<resource code>) per channel, e.g. effect(ts.call("Date.now")) or
//            effect(pg.table("*")); channels can come from the shape's resource bindings, so facts
//            reach conduct claims (authority, forbids, summaries) through bindings;
//   calls    observes call(ts); sound none by default (Bend-C4: 43.5% precision against relations).
// Scope entries: file identities at `file`, symbols at `unit`. An effects entry is complete only
// when every route in its whole span (descendants included) to a watched API yields a fact (scan.ts,
// "Roots"): no dynamic member of a root (`dynamic:<root>[]`), eval, Function or constructor route
// (`dynamic:eval`, `dynamic:constructor`), dynamic import or require, SQL with an interpolated table;
// no supply of a root value the scan does not follow (`alias:<root>`), no read of a watched member
// (or of call/apply/bind) through a value typed as the root, by member access or destructuring
// (`alias-type:<root>`) or handoff of such a value as an argument, no untyped receiver or callee,
// and no call into or handoff of an opaque external package (`external:<pkg>`). `Date.call(null)`
// and `Date.apply(x, [])` are Date() facts. Absence rests on TypeScript's types: a root retyped
// structurally (`const c: { now(): number } = Date`) is flagged where it is supplied.
import { globMatches } from "../../src/globs.ts";
import type { CodeCite, ScopeEntry, ShapeRecord, Signer } from "../../src/records.ts";
import { scopeRoot } from "../../src/records.ts";
import { canonResourceCode, parseResourceCode } from "../../src/resource-code.ts";
import type { SourceDoc } from "../../src/source.ts";
import { cmpStr, sortedUniq } from "../../src/util.ts";
import { type Emitted, type Manifested, type ProviderInfo, REPO_ROOT, cite, elaborateAt, emit, fileIdentity, providerName, selfValidate, sortCites } from "../common.ts";
import { loadTsFull } from "../ts-api.ts";
import { type ScanResult, scanTs } from "./scan.ts";

export const OBSERVE_TS_VERSION = "0.1.0";
export const DEFAULT_OBSERVE_IMPLEMENTATION = ["experiments/shape-1/proto/providers/observe-ts/**", "experiments/shape-1/proto/providers/ts-api.ts"];

export function effectsProvider(o: { q: string; channels: string[]; identity?: string; implementation?: string[]; sound?: ("presence" | "absence")[]; depsComplete?: boolean }): ProviderInfo {
  return {
    q: o.q,
    version: OBSERVE_TS_VERSION,
    decl: {
      decl: "provider",
      name: providerName(o.q),
      produces: ["observation"],
      observes: sortedUniq(o.channels.map((c) => `effect(${canonResourceCode(c) ?? c})`)),
      sound: o.sound ?? ["presence", "absence"],
      ...(o.identity ? { identity: o.identity } : {}),
      implementation: { paths: [...(o.implementation ?? DEFAULT_OBSERVE_IMPLEMENTATION)].sort(cmpStr) }
    }
  };
}

export function callsProvider(o: { q: string; identity?: string; implementation?: string[]; sound?: ("presence" | "absence")[] }): ProviderInfo {
  return {
    q: o.q,
    version: OBSERVE_TS_VERSION,
    decl: {
      decl: "provider",
      name: providerName(o.q),
      produces: ["observation"],
      observes: ["call(ts)"],
      ...(o.sound && o.sound.length > 0 ? { sound: o.sound } : {}),
      ...(o.identity ? { identity: o.identity } : {}),
      implementation: { paths: [...(o.implementation ?? DEFAULT_OBSERVE_IMPLEMENTATION)].sort(cmpStr) }
    }
  };
}

/** The ts.call and SQL-table resource codes the shape binds: the channels its conduct claims need. */
export function channelsFromShape(source: SourceDoc, time = "2026-01-01T00:00:00Z"): string[] {
  const esf = elaborateAt(source, time);
  const out: string[] = [];
  for (const r of esf.resources) {
    for (const b of r.bind) {
      const rc = parseResourceCode(b);
      if (!rc) continue;
      const key = `${rc.tag}.${rc.kind}`;
      if (key === "ts.call" || key === "pg.table" || key === "mysql.table" || key === "sqlite.table") out.push(canonResourceCode(b) ?? b);
    }
  }
  return sortedUniq(out);
}

export interface ObserveOptions {
  man: Manifested;
  root: string;
  /** globs restricting the scanned TS files (default: every ts file identity) */
  paths?: string[];
  effects?: { info: ProviderInfo; channels: string[]; signer: Signer | null };
  calls?: { info: ProviderInfo; signer: Signer | null };
  time: string;
  tsconfig?: string;
}

export interface ObserveReport {
  v: "shape.observe-ts.report.v1";
  revision: string;
  channels: string[];
  stats: ScanResult["stats"];
  entries: number;
  effectsComplete: number;
  callsComplete: number;
  effectFacts: number;
  callFacts: number;
  reasons: { effects: Record<string, number>; calls: Record<string, number> };
  records: string[];
  rejected: { record: string; code: string; detail: string }[];
}

function reasonKey(r: string): string {
  if (r.startsWith("child:")) return "child";
  if (r.startsWith("external:")) return "external";
  if (r.startsWith("alias:")) return "alias";
  if (r.startsWith("alias-type:")) return "alias-type";
  return r;
}

export async function runObserveTs(o: ObserveOptions): Promise<{ records: Emitted[]; report: ObserveReport; scan: ScanResult }> {
  const ts = await loadTsFull(REPO_ROOT);
  if (!ts) throw new Error("observe-ts: no TypeScript compiler found");
  const files = sortedUniq(
    [...o.man.index.ids.values()]
      .filter((x) => x.lang === "ts" && x.symbol === null)
      .map((x) => x.path)
      .filter((p) => !o.paths || o.paths.length === 0 || o.paths.some((g) => globMatches(g, p)))
  );
  const channels = sortedUniq((o.effects?.channels ?? []).map((c) => canonResourceCode(c) ?? c));
  const scan = scanTs(ts, { root: o.root, files, man: o.man.index, channels, calls: !!o.calls, tsconfig: o.tsconfig });
  const harness: CodeCite[] = [];
  const cfg = fileIdentity(o.man.index, "tsconfig.json");
  if (cfg) {
    const c = cite(o.man.index, cfg, "file");
    if (c) harness.push(c);
  }
  const entriesFor = (family: "effects" | "calls"): ScopeEntry[] => {
    const out: ScopeEntry[] = [];
    for (const s of [...scan.identities.values()].sort((a, b) => cmpStr(a.id, b.id))) {
      const info = o.man.index.ids.get(s.id);
      if (!info) continue;
      const proj = info.symbol === null ? "file" : info.digests.has("unit") ? "unit" : "own";
      const c = cite(o.man.index, s.id, proj);
      if (!c) continue;
      const reasons = family === "effects" ? s.effectsIncomplete : s.callsIncomplete;
      out.push({ ...c, complete: reasons.length === 0, deps: [] });
    }
    return out;
  };
  const records: Emitted[] = [];
  const rejected: ObserveReport["rejected"] = [];
  const make = (info: ProviderInfo, signer: Signer | null, family: "effects" | "calls"): void => {
    const entries = entriesFor(family);
    const facts = family === "effects" ? scan.effects : scan.calls;
    const rec: ShapeRecord = {
      v: "shape.evidence.v1",
      kind: "observation",
      result: "observes",
      provider: { id: info.q, version: info.version },
      revision: o.man.revision,
      time: o.time,
      scope: { root: scopeRoot(entries), entries },
      facts,
      harness: sortCites(harness),
      assumptions: []
    };
    const em = emit(rec, signer);
    const rej = selfValidate(em, info, o.man.index, o.time);
    if (rej) rejected.push(rej);
    else records.push(em);
  };
  if (o.effects) make(o.effects.info, o.effects.signer, "effects");
  if (o.calls) make(o.calls.info, o.calls.signer, "calls");
  const count = (family: "effects" | "calls"): Record<string, number> => {
    const m: Record<string, number> = {};
    for (const s of scan.identities.values()) {
      const rs = new Set((family === "effects" ? s.effectsIncomplete : s.callsIncomplete).map(reasonKey));
      for (const r of rs) m[r] = (m[r] ?? 0) + 1;
    }
    return Object.fromEntries(Object.entries(m).sort((a, b) => cmpStr(a[0], b[0])));
  };
  const ids = [...scan.identities.values()];
  const report: ObserveReport = {
    v: "shape.observe-ts.report.v1",
    revision: o.man.revision,
    channels,
    stats: scan.stats,
    entries: ids.length,
    effectsComplete: ids.filter((s) => s.effectsIncomplete.length === 0).length,
    callsComplete: ids.filter((s) => s.callsIncomplete.length === 0).length,
    effectFacts: scan.effects.length,
    callFacts: scan.calls.length,
    reasons: { effects: count("effects"), calls: count("calls") },
    records: records.map((r) => r.id),
    rejected
  };
  return { records, report, scan };
}
