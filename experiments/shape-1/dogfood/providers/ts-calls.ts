// tsCalls: an observer of calls between TypeScript identities, resolved by the TypeScript type
// checker. Channel call(ts). Soundness: presence only (each fact is a syntactic call or `new`
// whose callee resolves to the named identity's declaration); never absence (callbacks, dynamic
// dispatch and calls through values are not seen), so every scope entry is incomplete.
import { relative, resolve } from "node:path";
import type { Statement } from "../../proto/src/manifest.ts";
import { type ScopeEntry, type ShapeRecord, scopeRoot } from "../../proto/src/records.ts";
import { PROVIDERS, cite, emit, recordTime, viewOf } from "./common.ts";
import {
  type Ident,
  type Node,
  type SourceFile,
  TS_EXT,
  attribute,
  identsOf,
  loadTs
} from "./ts-ident.ts";

/** Code whose calls matter to the model: everything but the research experiments. */
export const CALL_SCOPE = [
  /^packages\//,
  /^scripts\//,
  /^docs-site\/scripts\//,
  /^\.github\/scripts\//,
  /^plugins\//,
  /^experiments\/semantic-kernel\//,
  /^experiments\/shape-1\/dogfood\//
];

export interface CallsResult {
  envelope: unknown;
  id: string;
  facts: number;
  files: number;
  external: number;
  unresolved: number;
}

export async function callScan(opts: {
  root: string;
  manifest: Statement;
  now: string;
}): Promise<CallsResult> {
  const ts = await loadTs(opts.root);
  const K = ts.SyntaxKind;
  const v = viewOf(opts.manifest);
  const known = (id: string): boolean => v.cites.has(id);
  const paths = [...v.cites.keys()]
    .filter((id) => id.startsWith("ts:") && !id.includes("#") && TS_EXT.test(id))
    .map((id) => id.slice(3))
    .filter((p) => CALL_SCOPE.some((re) => re.test(p)) && !p.endsWith(".d.ts"))
    .sort();
  const abs = (p: string): string => resolve(opts.root, p);
  const program = ts.createProgram(paths.map(abs), {
    allowJs: true,
    checkJs: false,
    noEmit: true,
    skipLibCheck: true,
    allowImportingTsExtensions: true,
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    types: []
  });
  const checker = program.getTypeChecker();
  const inScope = new Set(paths);
  const identCache = new Map<string, { idents: Ident[]; byNode: Map<Node, string> }>();
  const identsFor = (sf: SourceFile): { idents: Ident[]; byNode: Map<Node, string> } | null => {
    const rel = relative(opts.root, sf.fileName).replace(/\\/g, "/");
    if (!inScope.has(rel)) return null;
    let c = identCache.get(rel);
    if (!c) {
      const idents = identsOf(ts, sf, rel);
      c = { idents, byNode: new Map(idents.filter((i) => known(i.id)).map((i) => [i.node, i.id])) };
      identCache.set(rel, c);
    }
    return c;
  };
  const counts = new Map<string, number>();
  let external = 0;
  let unresolved = 0;
  const entries: ScopeEntry[] = [];
  for (const p of paths) {
    const sf = program.getSourceFile(abs(p));
    const fc = cite(v, `ts:${p}`, "file");
    if (!sf || !fc) continue;
    entries.push({ ...fc, complete: false, deps: [] });
    const mine = identsFor(sf);
    if (!mine) continue;
    const visit = (n: Node): void => {
      if (n.kind === K.CallExpression || n.kind === K.NewExpression) {
        const callee = n.expression;
        const at = callee
          ? callee.kind === K.PropertyAccessExpression && callee.name
            ? callee.name
            : callee
          : undefined;
        let sym = at ? checker.getSymbolAtLocation(at) : undefined;
        if (sym && sym.flags & (ts.SymbolFlags.Alias as number))
          sym = checker.getAliasedSymbol(sym);
        const decl = sym?.valueDeclaration ?? sym?.declarations?.[0];
        if (!decl) unresolved += 1;
        else {
          const target = identsFor(decl.getSourceFile());
          if (!target) external += 1;
          else {
            const tpath = relative(opts.root, decl.getSourceFile().fileName).replace(/\\/g, "/");
            const to =
              target.byNode.get(decl) ?? attribute(target.idents, decl.getStart(), tpath, known);
            const from = attribute(mine.idents, n.getStart(sf), p, known);
            if (to !== from && !to.endsWith(`:${tpath}`)) {
              const k = `${from}\u0000${to}`;
              counts.set(k, (counts.get(k) ?? 0) + 1);
            }
          }
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  const facts = [...counts.entries()]
    .map(([k, n]) => {
      const [at = "", to = ""] = k.split("\u0000");
      return { type: "call" as const, at, to, n };
    })
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.to < b.to ? -1 : 1));
  const rec: ShapeRecord = {
    v: "shape.evidence.v1",
    kind: "observation",
    result: "observes",
    provider: { id: PROVIDERS.tsCalls.q, version: PROVIDERS.tsCalls.version },
    revision: v.revision,
    time: recordTime(opts.now),
    scope: { root: scopeRoot(entries), entries },
    facts,
    harness: [],
    assumptions: []
  };
  const { envelope, id } = emit(PROVIDERS.tsCalls, rec);
  return { envelope, id, facts: facts.length, files: entries.length, external, unresolved };
}
