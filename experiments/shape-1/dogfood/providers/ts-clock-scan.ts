// tsClockScan: an observer of clock reads in TypeScript and JavaScript identities.
//
// Channels effect(ts.call("Date.now")), effect(ts.call("Date")), effect(ts.call("performance.now")),
// effect(ts.call("process.hrtime")). Facts: one Read per (identity, call) with its site count.
// Soundness: presence (every fact is a syntactic call at its identity) and absence on entries
// marked complete: a file entry is complete only when every mention of Date, performance.now and
// process.hrtime in it is a direct call, a constructor call with arguments, Date.UTC/Date.parse, or
// a type; any other use (an alias, a subclass, an assignment) leaves the entry incomplete.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Statement } from "../../proto/src/manifest.ts";
import { type ScopeEntry, type ShapeRecord, scopeRoot } from "../../proto/src/records.ts";
import { PROVIDERS, cite, emit, recordTime, viewOf } from "./common.ts";
import { type Node, TS_EXT, attribute, identsOf, loadTs, scriptKind } from "./ts-ident.ts";

export interface ClockScanResult {
  envelope: unknown;
  id: string;
  facts: number;
  sites: { at: string; resource: string; n: number }[];
  files: number;
  incomplete: string[];
}

export async function clockScan(opts: { root: string; manifest: Statement; now: string }): Promise<ClockScanResult> {
  const ts = await loadTs(opts.root);
  const K = ts.SyntaxKind;
  const v = viewOf(opts.manifest);
  const known = (id: string): boolean => v.cites.has(id);
  const files = [...v.cites.keys()].filter((id) => id.startsWith("ts:") && !id.includes("#") && TS_EXT.test(id)).sort();
  const counts = new Map<string, number>();
  const entries: ScopeEntry[] = [];
  const incomplete: string[] = [];
  for (const fid of files) {
    const path = fid.slice(3).replace(/%23/g, "#").replace(/%25/g, "%");
    const fc = cite(v, fid, "file");
    if (!fc) continue;
    let text: string;
    try {
      text = readFileSync(join(opts.root, path), "utf8");
    } catch {
      continue;
    }
    const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest as number, true, scriptKind(ts, path));
    const idents = identsOf(ts, sf, path);
    let complete = (sf.parseDiagnostics ?? []).length === 0;
    const hit = (n: Node, resource: string): void => {
      const at = attribute(idents, n.getStart(sf), path, known);
      const k = `${at}\u0000${resource}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    };
    const ident = (n: Node | undefined, name: string): boolean => !!n && n.kind === K.Identifier && n.text === name;
    const prop = (n: Node | undefined, obj: string, name: string): boolean =>
      !!n && n.kind === K.PropertyAccessExpression && n.name?.text === name && (ident(n.expression, obj) || (n.expression?.kind === K.PropertyAccessExpression && n.expression.name?.text === obj && ident(n.expression.expression, "globalThis")));
    const isCallee = (n: Node): boolean => !!n.parent && (n.parent.kind === K.CallExpression || n.parent.kind === K.NewExpression) && n.parent.expression === n;
    const kindIs = (n: Node | undefined, k: number | undefined): n is Node => !!n && k !== undefined && n.kind === k;
    /** Is the Identifier n (Date, performance or hrtime) used only in a way the scan reads whole? */
    const accountedFor = (n: Node): boolean => {
      const p = n.parent;
      if (!p) return false;
      const gp = p.parent;
      const isMemberName = kindIs(p, K.PropertyAccessExpression) && p.name === n;
      if (n.text === "hrtime") {
        if (!isMemberName) return true;
        return isCallee(p) || (kindIs(gp, K.PropertyAccessExpression) && gp.name?.text === "bigint" && isCallee(gp));
      }
      const inType = p.kind === K.TypeReference || p.kind === K.TypeQuery || p.kind === K.QualifiedName || (p.kind === K.ExpressionWithTypeArguments && !(kindIs(gp, K.HeritageClause) && kindIs(gp.parent, K.ClassDeclaration)));
      if (inType) return true;
      // `globalThis.Date` is the Date value itself: judge the property access in its context
      const viaGlobal = n.text === "Date" && isMemberName && ident(p.expression, "globalThis");
      if (isMemberName && !viaGlobal) return true;
      if (!isMemberName && "name" in p && p.name === n) return true;
      const ref = viaGlobal ? p : n;
      const rp = ref.parent;
      if (!rp) return false;
      if (n.text === "Date") {
        if (isCallee(ref)) return true;
        if (kindIs(rp, K.PropertyAccessExpression) && rp.expression === ref) {
          const member = rp.name?.text ?? "";
          return member === "UTC" || member === "parse" || (member === "now" && isCallee(rp));
        }
        return false;
      }
      // performance
      if (kindIs(rp, K.PropertyAccessExpression) && rp.expression === ref) {
        const member = rp.name?.text ?? "";
        return member === "now" ? isCallee(rp) : member !== "timeOrigin";
      }
      return false;
    };
    const visit = (n: Node): void => {
      if (n.kind === K.CallExpression || n.kind === K.NewExpression) {
        const callee = n.expression;
        if (prop(callee, "Date", "now")) hit(n, 'ts.call("Date.now")');
        else if (prop(callee, "performance", "now")) hit(n, 'ts.call("performance.now")');
        else if (prop(callee, "process", "hrtime") || (kindIs(callee, K.PropertyAccessExpression) && callee.name?.text === "bigint" && prop(callee.expression, "process", "hrtime"))) hit(n, 'ts.call("process.hrtime")');
        else if ((ident(callee, "Date") || prop(callee, "globalThis", "Date")) && (n.kind === K.CallExpression || (n.arguments ?? []).length === 0)) hit(n, 'ts.call("Date")');
      }
      if (n.kind === K.Identifier && (n.text === "Date" || n.text === "performance" || n.text === "hrtime") && !accountedFor(n)) complete = false;
      ts.forEachChild(n, visit);
    };
    visit(sf);
    if (!complete) incomplete.push(path);
    entries.push({ ...fc, complete, deps: [] });
  }
  const sites = [...counts.entries()]
    .map(([k, n]) => {
      const [at = "", resource = ""] = k.split("\u0000");
      return { at, resource, n };
    })
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.resource < b.resource ? -1 : 1));
  const rec: ShapeRecord = {
    v: "shape.evidence.v1",
    kind: "observation",
    result: "observes",
    provider: { id: PROVIDERS.tsClockScan.q, version: PROVIDERS.tsClockScan.version },
    revision: v.revision,
    time: recordTime(opts.now),
    scope: { root: scopeRoot(entries), entries },
    facts: sites.map((s) => ({ type: "effect" as const, at: s.at, verb: "Read", resource: s.resource, n: s.n })),
    harness: [],
    assumptions: []
  };
  const { envelope, id } = emit(PROVIDERS.tsClockScan, rec);
  return { envelope, id, facts: sites.length, sites, files: entries.length, incomplete: incomplete.sort() };
}
