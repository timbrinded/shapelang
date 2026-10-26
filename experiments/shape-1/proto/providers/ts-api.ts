// A typed facade over the parts of the TypeScript compiler API the providers use (parser, program,
// type checker), loaded the same way the core fingerprinter loads it, plus the code-identity walk
// that mirrors src/fingerprint/ts.ts exactly (functions, classes, methods, namespaces, const-bound
// functions and object literals, nested functions), so facts land on manifest identities.
import { encodePath, encodeSegment } from "../src/fingerprint/common.ts";
import { loadTypeScript } from "../src/fingerprint/ts.ts";
import { cmpStr } from "../src/util.ts";

export interface TsNode {
  kind: number;
  pos: number;
  end: number;
  flags: number;
  parent: TsNode;
  name?: TsNode;
  text?: string;
  escapedText?: string;
  body?: TsNode;
  initializer?: TsNode;
  expression?: TsNode;
  arguments?: TsNode[];
  declarationList?: { declarations: TsNode[] };
  members?: TsNode[];
  properties?: TsNode[];
  statements?: TsNode[];
  parameters?: TsNode[];
  operatorToken?: TsNode;
  left?: TsNode;
  right?: TsNode;
  operand?: TsNode;
  operator?: number;
  argumentExpression?: TsNode;
  moduleSpecifier?: TsNode;
  importClause?: TsNode;
  namedBindings?: TsNode;
  elements?: TsNode[];
  propertyName?: TsNode;
  tryBlock?: TsNode;
  catchClause?: TsNode;
  finallyBlock?: TsNode;
  block?: TsNode;
  tag?: TsNode;
  template?: TsNode;
  head?: TsNode;
  templateSpans?: TsNode[];
  literal?: TsNode;
  keywordToken?: number;
  modifiers?: TsNode[];
  token?: number;
  whenTrue?: TsNode;
  whenFalse?: TsNode;
  dotDotDotToken?: TsNode;
  moduleReference?: TsNode;
  getStart(sf?: TsSourceFile): number;
  getText(sf?: TsSourceFile): string;
  getSourceFile(): TsSourceFile;
}

export interface TsSourceFile extends TsNode {
  fileName: string;
  text: string;
  statements: TsNode[];
  parseDiagnostics?: unknown[];
  getLineAndCharacterOfPosition(pos: number): { line: number; character: number };
}

export interface TsSymbol {
  flags: number;
  name: string;
  escapedName?: string;
  declarations?: TsNode[];
}

export interface TsType {
  flags: number;
  symbol?: TsSymbol;
  /** constituents of a union or intersection */
  types?: TsType[];
}

export interface TsChecker {
  getSymbolAtLocation(n: TsNode): TsSymbol | undefined;
  getAliasedSymbol(s: TsSymbol): TsSymbol;
  getTypeAtLocation(n: TsNode): TsType;
  getShorthandAssignmentValueSymbol(n: TsNode): TsSymbol | undefined;
  /** 0 = call signatures, 1 = construct signatures (ts.SignatureKind) */
  getSignaturesOfType(t: TsType, kind: number): readonly unknown[];
  getTypeOfSymbolAtLocation(s: TsSymbol, n: TsNode): TsType;
  getPropertyOfType(t: TsType, name: string): TsSymbol | undefined;
  getBaseConstraintOfType(t: TsType): TsType | undefined;
  isTypeAssignableTo(source: TsType, target: TsType): boolean;
  /** the type an object or array destructuring assignment target receives */
  getTypeOfAssignmentPattern(pattern: TsNode): TsType;
  resolveName(name: string, location: TsNode | undefined, meaning: number, excludeGlobals: boolean): TsSymbol | undefined;
}

export interface TsProgram {
  getSourceFile(name: string): TsSourceFile | undefined;
  getSourceFiles(): readonly TsSourceFile[];
  getTypeChecker(): TsChecker;
}

export interface TsCompilerOptions {
  [k: string]: unknown;
}

export interface TsSys {
  readFile(path: string): string | undefined;
  fileExists(path: string): boolean;
}

export interface TsFull {
  version: string;
  SyntaxKind: Record<string, number>;
  SymbolFlags: Record<string, number>;
  TypeFlags: Record<string, number>;
  NodeFlags: Record<string, number>;
  ScriptTarget: Record<string, number>;
  ScriptKind: Record<string, number>;
  ModuleKind: Record<string, number>;
  ModuleResolutionKind: Record<string, number>;
  sys: TsSys;
  createSourceFile(name: string, text: string, target: number, setParents: boolean, kind?: number): TsSourceFile;
  createProgram(roots: string[], options: TsCompilerOptions): TsProgram;
  readConfigFile(path: string, read: (p: string) => string | undefined): { config?: unknown; error?: unknown };
  parseJsonConfigFileContent(json: unknown, sys: TsSys, basePath: string): { options: TsCompilerOptions; fileNames: string[] };
  forEachChild(node: TsNode, cb: (n: TsNode) => void): void;
}

export async function loadTsFull(repoRoot: string): Promise<TsFull | null> {
  const api = await loadTypeScript(repoRoot);
  if (!api) return null;
  const full = api as unknown as TsFull;
  return typeof full.createProgram === "function" ? full : null;
}

export function scriptKindOf(ts: TsFull, path: string): number {
  if (path.endsWith(".tsx")) return ts.ScriptKind.TSX as number;
  if (path.endsWith(".jsx")) return ts.ScriptKind.JSX as number;
  if (/\.[cm]?js$/.test(path)) return ts.ScriptKind.JS as number;
  return ts.ScriptKind.TS as number;
}

// ---- identity spans ------------------------------------------------------------------------------

export interface IdentitySpan {
  /** full identity, ts:<path>#<symbol> or the file identity */
  id: string;
  symbol: string | null;
  kind: string;
  start: number;
  end: number;
  node: TsNode | null;
  parent: string | null;
}

/** Identity spans of one parsed file, with the core fingerprinter's rules (A.12.2.2). Same-symbol
 *  declarations share an identity (merged). */
export function identitySpans(ts: TsFull, sf: TsSourceFile, path: string): IdentitySpan[] {
  const K = ts.SyntaxKind;
  const fileId = `ts:${encodePath(path)}`;
  const out: IdentitySpan[] = [{ id: fileId, symbol: null, kind: "file", start: 0, end: sf.text.length, node: sf, parent: null }];
  const nameText = (n: TsNode | undefined): string | null => {
    if (!n) return null;
    if (n.kind === K.Identifier || n.kind === K.StringLiteral || n.kind === K.NumericLiteral) return n.text ?? n.escapedText ?? null;
    if (n.kind === K.PrivateIdentifier) return n.text ?? null;
    return null;
  };
  const isFn = (n: TsNode | undefined): boolean => !!n && (n.kind === K.ArrowFunction || n.kind === K.FunctionExpression);
  const join2 = (prefix: string | null, name: string): string => (prefix ? `${prefix}.${encodeSegment(name, ".")}` : encodeSegment(name, "."));
  const push = (sym: string, kind: string, node: TsNode, start: number, end: number, prefix: string | null): void => {
    out.push({ id: `${fileId}#${sym}`, symbol: sym, kind, start, end, node, parent: prefix ? `${fileId}#${prefix}` : fileId });
  };
  const visitStatements = (stmts: TsNode[], prefix: string | null): void => {
    for (const s of stmts) visitStatement(s, prefix);
  };
  const visitBody = (body: TsNode | undefined, prefix: string): void => {
    if (body?.statements) visitStatements(body.statements, prefix);
  };
  const visitStatement = (s: TsNode, prefix: string | null): void => {
    if (s.kind === K.FunctionDeclaration) {
      const n = nameText(s.name);
      if (!n) return;
      const sym = join2(prefix, n);
      push(sym, "function", s, s.getStart(sf), s.end, prefix);
      visitBody(s.body, sym);
    } else if (s.kind === K.ClassDeclaration) {
      const n = nameText(s.name);
      if (!n) return;
      const sym = join2(prefix, n);
      push(sym, "class", s, s.getStart(sf), s.end, prefix);
      visitMembers(s.members ?? [], sym);
    } else if (s.kind === K.ModuleDeclaration) {
      const n = nameText(s.name);
      if (!n) return;
      const sym = join2(prefix, n);
      push(sym, "namespace", s, s.getStart(sf), s.end, prefix);
      let b = s.body;
      while (b && b.kind === K.ModuleDeclaration) b = b.body;
      if (b?.statements) visitStatements(b.statements, sym);
    } else if (s.kind === K.VariableStatement) {
      const decls = s.declarationList?.declarations ?? [];
      for (const d of decls) {
        const n = nameText(d.name);
        if (!n || !d.initializer) continue;
        const init = d.initializer;
        const single = decls.length === 1;
        const start = single ? s.getStart(sf) : d.getStart(sf);
        const end = single ? s.end : d.end;
        if (isFn(init)) {
          const sym = join2(prefix, n);
          push(sym, "const", d, start, end, prefix);
          visitBody(init.body, sym);
        } else if (init.kind === K.ObjectLiteralExpression) {
          const sym = join2(prefix, n);
          push(sym, "object", d, start, end, prefix);
          visitProperties(init.properties ?? [], sym);
        }
      }
    }
  };
  const visitMembers = (members: TsNode[], prefix: string): void => {
    for (const m of members) {
      let n = nameText(m.name);
      if (m.kind === K.Constructor) n = "constructor";
      const isMethod = m.kind === K.MethodDeclaration || m.kind === K.Constructor || m.kind === K.GetAccessor || m.kind === K.SetAccessor;
      const isFnProp = m.kind === K.PropertyDeclaration && isFn(m.initializer);
      if (!n || !(isMethod || isFnProp)) continue;
      const sym = join2(prefix, n);
      push(sym, "method", m, m.getStart(sf), m.end, prefix);
      visitBody(isFnProp ? m.initializer?.body : m.body, sym);
    }
  };
  const visitProperties = (props: TsNode[], prefix: string): void => {
    for (const p of props) {
      const n = nameText(p.name);
      if (!n) continue;
      if (p.kind === K.MethodDeclaration || (p.kind === K.PropertyAssignment && isFn(p.initializer))) {
        const sym = join2(prefix, n);
        push(sym, "method", p, p.getStart(sf), p.end, prefix);
        visitBody(p.kind === K.MethodDeclaration ? p.body : p.initializer?.body, sym);
      }
    }
  };
  visitStatements(sf.statements, null);
  return out.sort((a, b) => a.start - b.start || b.end - a.end || cmpStr(a.id, b.id));
}

/** The innermost identity whose span contains [pos, pos]. Spans nest, so the latest-starting
 *  containing span wins. */
export function enclosingIdentity(spans: IdentitySpan[], pos: number): IdentitySpan {
  let best = spans[0] as IdentitySpan;
  for (const s of spans) {
    if (s.start <= pos && pos < s.end && s.start >= best.start && (s.end - s.start) <= (best.end - best.start)) best = s;
  }
  return best;
}

export function lineCol(sf: TsSourceFile, pos: number): string {
  const lc = sf.getLineAndCharacterOfPosition(pos);
  return `${lc.line + 1}:${lc.character + 1}`;
}
