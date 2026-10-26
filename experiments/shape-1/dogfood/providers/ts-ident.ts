// TypeScript access for the dogfood observers: the compiler (as the prototype's manifest finds
// it), and identity spans named exactly as the manifest's ts.* identities (A.12.2), so a call
// site or an effect site is attributed to the innermost identity that contains it.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { encodePath, encodeSegment } from "../../proto/src/fingerprint/common.ts";

export interface Node {
  kind: number;
  pos: number;
  end: number;
  parent?: Node;
  name?: Node;
  text?: string;
  escapedText?: string;
  body?: Node;
  statements?: Node[];
  members?: Node[];
  declarationList?: { declarations: Node[] };
  initializer?: Node;
  properties?: Node[];
  expression?: Node;
  arguments?: Node[];
  moduleSpecifier?: Node;
  getStart(sf?: SourceFile): number;
  getSourceFile(): SourceFile;
}

export interface SourceFile extends Node {
  fileName: string;
  text: string;
  statements: Node[];
  parseDiagnostics?: unknown[];
}

export interface Symbol {
  flags: number;
  declarations?: Node[];
  valueDeclaration?: Node;
}

export interface TypeChecker {
  getSymbolAtLocation(n: Node): Symbol | undefined;
  getAliasedSymbol(s: Symbol): Symbol;
}

export interface Program {
  getSourceFile(name: string): SourceFile | undefined;
  getTypeChecker(): TypeChecker;
}

export interface Ts {
  version: string;
  SyntaxKind: Record<string, number>;
  ScriptTarget: Record<string, number>;
  ScriptKind: Record<string, number>;
  ModuleKind: Record<string, number>;
  ModuleResolutionKind: Record<string, number>;
  SymbolFlags: Record<string, number>;
  createSourceFile(name: string, text: string, target: number, setParents: boolean, kind?: number): SourceFile;
  forEachChild(node: Node, cb: (n: Node) => void): void;
  createProgram(rootNames: string[], options: Record<string, unknown>): Program;
}

let cached: Ts | null = null;

export async function loadTs(repoRoot: string): Promise<Ts> {
  if (cached) return cached;
  const candidates: string[] = [];
  try {
    candidates.push(Bun.resolveSync("typescript", repoRoot));
  } catch {
    // not resolvable by name
  }
  const store = join(repoRoot, "node_modules", ".bun");
  if (existsSync(store)) for (const d of readdirSync(store).filter((x) => x.startsWith("typescript@")).sort().reverse()) candidates.push(join(store, d, "node_modules", "typescript", "lib", "typescript.js"));
  for (const c of candidates) {
    if (!existsSync(c)) continue;
    const mod = (await import(c)) as { default?: Ts } & Ts;
    const api = mod.default ?? mod;
    if (typeof api.createProgram === "function") {
      cached = api;
      return api;
    }
  }
  throw new Error("no TypeScript compiler found");
}

export const TS_EXT = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;

export function scriptKind(ts: Ts, path: string): number {
  if (path.endsWith(".tsx")) return ts.ScriptKind.TSX as number;
  if (path.endsWith(".jsx")) return ts.ScriptKind.JSX as number;
  if (/\.[cm]?js$/.test(path)) return ts.ScriptKind.JS as number;
  return ts.ScriptKind.TS as number;
}

export interface Ident {
  id: string;
  start: number;
  end: number;
  node: Node;
}

/** Identity spans of one file, named as the manifest names them (functions, classes, methods,
 *  namespaces, const function/arrow/object literals, nested functions; same-name merges keep
 *  every span). */
export function identsOf(ts: Ts, sf: SourceFile, path: string): Ident[] {
  const K = ts.SyntaxKind;
  const fileId = `ts:${encodePath(path)}`;
  const out: Ident[] = [];
  const nameText = (n: Node | undefined): string | null => {
    if (!n) return null;
    if (n.kind === K.Identifier || n.kind === K.StringLiteral || n.kind === K.NumericLiteral || n.kind === K.PrivateIdentifier) return n.text ?? n.escapedText ?? null;
    return null;
  };
  const isFn = (n: Node | undefined): boolean => !!n && (n.kind === K.ArrowFunction || n.kind === K.FunctionExpression);
  const join2 = (prefix: string | null, name: string): string => (prefix ? `${prefix}.${encodeSegment(name, ".")}` : encodeSegment(name, "."));
  const push = (sym: string, start: number, end: number, node: Node): void => {
    out.push({ id: `${fileId}#${sym}`, start, end, node });
  };
  const visitBody = (body: Node | undefined, prefix: string): void => {
    if (body?.statements) for (const s of body.statements) visitStatement(s, prefix);
  };
  const visitStatement = (s: Node, prefix: string | null): void => {
    if (s.kind === K.FunctionDeclaration) {
      const n = nameText(s.name);
      if (!n) return;
      const sym = join2(prefix, n);
      push(sym, s.getStart(sf), s.end, s);
      visitBody(s.body, sym);
    } else if (s.kind === K.ClassDeclaration) {
      const n = nameText(s.name);
      if (!n) return;
      const sym = join2(prefix, n);
      push(sym, s.getStart(sf), s.end, s);
      for (const m of s.members ?? []) {
        let mn = nameText(m.name);
        if (m.kind === K.Constructor) mn = "constructor";
        const isMethod = m.kind === K.MethodDeclaration || m.kind === K.Constructor || m.kind === K.GetAccessor || m.kind === K.SetAccessor;
        const isFnProp = m.kind === K.PropertyDeclaration && isFn(m.initializer);
        if (!mn || !(isMethod || isFnProp)) continue;
        const msym = join2(sym, mn);
        push(msym, m.getStart(sf), m.end, m);
        visitBody(isFnProp ? m.initializer?.body : m.body, msym);
      }
    } else if (s.kind === K.ModuleDeclaration) {
      const n = nameText(s.name);
      if (!n) return;
      const sym = join2(prefix, n);
      push(sym, s.getStart(sf), s.end, s);
      let b = s.body;
      while (b && b.kind === K.ModuleDeclaration) b = b.body;
      if (b?.statements) for (const x of b.statements) visitStatement(x, sym);
    } else if (s.kind === K.VariableStatement) {
      const decls = s.declarationList?.declarations ?? [];
      for (const d of decls) {
        const n = nameText(d.name);
        if (!n || !d.initializer) continue;
        const span = decls.length === 1 ? { start: s.getStart(sf), end: s.end } : { start: d.getStart(sf), end: d.end };
        if (isFn(d.initializer)) {
          const sym = join2(prefix, n);
          push(sym, span.start, span.end, d);
          visitBody(d.initializer.body, sym);
        } else if (d.initializer.kind === K.ObjectLiteralExpression) {
          const sym = join2(prefix, n);
          push(sym, span.start, span.end, d);
          for (const p of d.initializer.properties ?? []) {
            const pn = nameText(p.name);
            if (!pn) continue;
            if (p.kind === K.MethodDeclaration || (p.kind === K.PropertyAssignment && isFn(p.initializer))) {
              const psym = join2(sym, pn);
              push(psym, p.getStart(sf), p.end, p);
              visitBody(p.kind === K.MethodDeclaration ? p.body : p.initializer?.body, psym);
            }
          }
        }
      }
    }
  };
  for (const s of sf.statements) visitStatement(s, null);
  return out;
}

/** The innermost identity whose span contains pos, else the file identity. */
export function attribute(idents: Ident[], pos: number, path: string, known: (id: string) => boolean): string {
  let best: Ident | null = null;
  for (const i of idents) if (i.start <= pos && pos < i.end && known(i.id) && (!best || i.end - i.start < best.end - best.start)) best = i;
  return best ? best.id : `ts:${encodePath(path)}`;
}
