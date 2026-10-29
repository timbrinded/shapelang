// TypeScript code identities and digests (A.12.2.1-4, A.12.2.9-10, A.5.7.2). Uses the TypeScript
// compiler API when one is found on disk; otherwise a documented lexical fallback (schemes *.lex1).
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { cmpStr } from "../util.ts";
import {
  type FpIdentity,
  codeDigest,
  encodePath,
  encodeSegment,
  isInertComment
} from "./common.ts";

// ---- a minimal typed facade over the compiler API ------------------------------------------

interface TsNode {
  kind: number;
  pos: number;
  end: number;
  parent?: TsNode;
  name?: TsNode;
  text?: string;
  escapedText?: string;
  body?: TsNode;
  initializer?: TsNode;
  declarationList?: { declarations: TsNode[] };
  members?: TsNode[];
  properties?: TsNode[];
  statements?: TsNode[];
  expression?: TsNode;
  moduleSpecifier?: TsNode;
  importClause?: TsNode;
  getStart(sf?: TsSourceFile): number;
}
interface TsSourceFile extends TsNode {
  text: string;
  statements: TsNode[];
  parseDiagnostics?: unknown[];
}
interface TsScanner {
  scan(): number;
  getTokenText(): string;
  getTokenValue(): string;
  getTokenStart?(): number;
  getTokenPos?(): number;
  getTextPos(): number;
}
export interface TsApi {
  version: string;
  SyntaxKind: Record<string, number>;
  ScriptTarget: Record<string, number>;
  ScriptKind: Record<string, number>;
  NewLineKind: Record<string, number>;
  createSourceFile(
    name: string,
    text: string,
    target: number,
    setParents: boolean,
    kind?: number
  ): TsSourceFile;
  createPrinter(opts: { removeComments?: boolean; newLine?: number }): {
    printFile(sf: TsSourceFile): string;
  };
  forEachChild(node: TsNode, cb: (n: TsNode) => void): void;
  createScanner(target: number, skipTrivia: boolean, variant?: number, text?: string): TsScanner;
}

let cached: TsApi | null | undefined;

/** Locates a TypeScript compiler: node_modules resolution, the bun store, then /opt/node-tools. */
export async function loadTypeScript(repoRoot: string): Promise<TsApi | null> {
  if (cached !== undefined) return cached;
  const candidates: string[] = [];
  try {
    candidates.push(Bun.resolveSync("typescript", repoRoot));
  } catch {
    // not resolvable by name
  }
  const store = join(repoRoot, "node_modules", ".bun");
  if (existsSync(store)) {
    for (const d of readdirSync(store)
      .filter((x) => x.startsWith("typescript@"))
      .sort(cmpStr)
      .reverse()) {
      candidates.push(join(store, d, "node_modules", "typescript", "lib", "typescript.js"));
    }
  }
  candidates.push("/opt/node-tools/node_modules/typescript/lib/typescript.js");
  for (const c of candidates) {
    if (!existsSync(c)) continue;
    try {
      const mod = (await import(c)) as { default?: TsApi } & TsApi;
      const api = mod.default ?? mod;
      if (typeof api.createSourceFile === "function") {
        cached = api;
        return api;
      }
    } catch {
      // try the next candidate
    }
  }
  cached = null;
  return null;
}

export function setTypeScriptForTests(api: TsApi | null): void {
  cached = api;
}

export const TS_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];

export function isTsPath(path: string): boolean {
  return TS_EXTENSIONS.some((e) => path.endsWith(e));
}

interface Ident {
  symbol: string;
  kind: string;
  start: number;
  end: number;
  node: TsNode | null;
  context: "statement" | "member" | "property" | "declarator";
  parent: string | null;
}

export interface TsFingerprintOptions {
  /** resolves an import specifier from a file to a tracked path, or null (A.12.2.10) */
  resolve: (specifier: string, fromPath: string) => string | null;
}

/** Fingerprints one TS file: its file identity and its symbol identities. */
export function fingerprintTs(
  path: string,
  text: string,
  ts: TsApi | null,
  opts: TsFingerprintOptions
): FpIdentity[] {
  return ts ? withCompiler(path, text, ts, opts) : lexicalFallback(path, text);
}

function withCompiler(
  path: string,
  text: string,
  ts: TsApi,
  opts: TsFingerprintOptions
): FpIdentity[] {
  const K = ts.SyntaxKind;
  const fileId = `ts:${encodePath(path)}`;
  const kindOf = (p: string): number => {
    if (p.endsWith(".tsx")) return ts.ScriptKind.TSX as number;
    if (p.endsWith(".jsx")) return ts.ScriptKind.JSX as number;
    if (/\.[cm]?js$/.test(p)) return ts.ScriptKind.JS as number;
    return ts.ScriptKind.TS as number;
  };
  const target = ts.ScriptTarget.Latest as number;
  const sf = ts.createSourceFile(path, text, target, true, kindOf(path));
  const parsed = (sf.parseDiagnostics ?? []).length === 0;
  if (!parsed) {
    return [
      {
        id: fileId,
        kind: "file",
        parent: null,
        digests: [
          {
            projection: "file",
            scheme: "ts.file.raw.v1",
            digest: codeDigest("ts.file.raw.v1", text)
          },
          {
            projection: "own",
            scheme: "ts.file.raw.v1",
            digest: codeDigest("ts.file.raw.v1", text)
          }
        ],
        markers: countMarkers(ts, text, []),
        hatchComplete: false,
        executable: true
      }
    ];
  }

  // identities
  const idents: Ident[] = [];
  const nameText = (n: TsNode | undefined): string | null => {
    if (!n) return null;
    if (n.kind === K.Identifier || n.kind === K.StringLiteral || n.kind === K.NumericLiteral)
      return n.text ?? n.escapedText ?? null;
    if (n.kind === K.PrivateIdentifier) return n.text ?? null;
    return null;
  };
  const isFn = (n: TsNode | undefined): boolean =>
    !!n && (n.kind === K.ArrowFunction || n.kind === K.FunctionExpression);
  const join2 = (prefix: string | null, name: string): string =>
    prefix ? `${prefix}.${encodeSegment(name, ".")}` : encodeSegment(name, ".");
  const visitStatements = (stmts: TsNode[], prefix: string | null): void => {
    for (const s of stmts) visitStatement(s, prefix);
  };
  const visitBody = (body: TsNode | undefined, prefix: string): void => {
    if (!body) return;
    if (body.statements) visitStatements(body.statements, prefix);
  };
  const visitStatement = (s: TsNode, prefix: string | null): void => {
    if (s.kind === K.FunctionDeclaration) {
      const n = nameText(s.name);
      if (!n) return;
      const sym = join2(prefix, n);
      idents.push({
        symbol: sym,
        kind: "function",
        start: s.getStart(sf),
        end: s.end,
        node: s,
        context: "statement",
        parent: prefix
      });
      visitBody(s.body, sym);
    } else if (s.kind === K.ClassDeclaration) {
      const n = nameText(s.name);
      if (!n) return;
      const sym = join2(prefix, n);
      idents.push({
        symbol: sym,
        kind: "class",
        start: s.getStart(sf),
        end: s.end,
        node: s,
        context: "statement",
        parent: prefix
      });
      visitMembers(s.members ?? [], sym);
    } else if (s.kind === K.ModuleDeclaration) {
      const n = nameText(s.name);
      if (!n) return;
      const sym = join2(prefix, n);
      idents.push({
        symbol: sym,
        kind: "namespace",
        start: s.getStart(sf),
        end: s.end,
        node: s,
        context: "statement",
        parent: prefix
      });
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
        const span = single
          ? { start: s.getStart(sf), end: s.end, context: "statement" as const }
          : { start: d.getStart(sf), end: d.end, context: "declarator" as const };
        if (isFn(init)) {
          const sym = join2(prefix, n);
          idents.push({ symbol: sym, kind: "const", ...span, node: d, parent: prefix });
          visitBody(init.body, sym);
        } else if (init.kind === K.ObjectLiteralExpression) {
          const sym = join2(prefix, n);
          idents.push({ symbol: sym, kind: "object", ...span, node: d, parent: prefix });
          visitProperties(init.properties ?? [], sym);
        }
      }
    }
  };
  const visitMembers = (members: TsNode[], prefix: string): void => {
    for (const m of members) {
      let n = nameText(m.name);
      if (m.kind === K.Constructor) n = "constructor";
      const isMethod =
        m.kind === K.MethodDeclaration ||
        m.kind === K.Constructor ||
        m.kind === K.GetAccessor ||
        m.kind === K.SetAccessor;
      const isFnProp = m.kind === K.PropertyDeclaration && isFn(m.initializer);
      if (!n || !(isMethod || isFnProp)) continue;
      const sym = join2(prefix, n);
      idents.push({
        symbol: sym,
        kind: "method",
        start: m.getStart(sf),
        end: m.end,
        node: m,
        context: "member",
        parent: prefix
      });
      visitBody(isFnProp ? m.initializer?.body : m.body, sym);
    }
  };
  const visitProperties = (props: TsNode[], prefix: string): void => {
    for (const p of props) {
      const n = nameText(p.name);
      if (!n) continue;
      if (
        p.kind === K.MethodDeclaration ||
        (p.kind === K.PropertyAssignment && isFn(p.initializer))
      ) {
        const sym = join2(prefix, n);
        idents.push({
          symbol: sym,
          kind: "method",
          start: p.getStart(sf),
          end: p.end,
          node: p,
          context: "property",
          parent: prefix
        });
        visitBody(p.kind === K.MethodDeclaration ? p.body : p.initializer?.body, sym);
      }
    }
  };
  visitStatements(sf.statements, null);

  // merge same-symbol declarations in source order (merged: n)
  const bySym = new Map<string, Ident[]>();
  for (const i of idents) {
    const list = bySym.get(i.symbol) ?? [];
    list.push(i);
    bySym.set(i.symbol, list);
  }
  const directChildren = (parent: string | null, within: { start: number; end: number }): Ident[] =>
    idents.filter((i) => i.parent === parent && i.start >= within.start && i.end <= within.end);

  // top-level declarations for env(x)
  const topFns = new Map<string, string>();
  const topData = new Map<string, TsNode>();
  const imports = new Map<string, string>();
  for (const s of sf.statements) {
    if ((s.kind === K.FunctionDeclaration || s.kind === K.ClassDeclaration) && nameText(s.name)) {
      const n = nameText(s.name) as string;
      topFns.set(n, `${fileId}#${encodeSegment(n, ".")}`);
    } else if (s.kind === K.VariableStatement) {
      for (const d of s.declarationList?.declarations ?? []) {
        const n = nameText(d.name);
        if (!n || !d.initializer) continue;
        // functions by identity; data (object literals included) by canonical initialiser
        if (isFn(d.initializer)) topFns.set(n, `${fileId}#${encodeSegment(n, ".")}`);
        else topData.set(n, d.initializer);
      }
    } else if (s.kind === K.ImportDeclaration && s.moduleSpecifier) {
      const spec = s.moduleSpecifier.text ?? "";
      const resolved = opts.resolve(spec, path) ?? spec;
      collectImportNames(ts, s, (local, imported) => imports.set(local, `${resolved}#${imported}`));
    }
  }

  const canon = (src: string, wrap: Ident["context"] | "file"): string =>
    canonicalText(ts, src, wrap);
  const spliceOwn = (start: number, end: number, parent: string | null): string => {
    const kids = directChildren(parent, { start, end }).sort((a, b) => a.start - b.start);
    let out = "";
    let cur = start;
    for (const k of kids) {
      if (k.start < cur) continue;
      out += text.slice(cur, k.start) + placeholder(k);
      cur = k.end;
    }
    return out + text.slice(cur, end);
  };
  const markerSpans = (start: number, end: number, parent: string | null): [number, number][] => {
    const kids = directChildren(parent, { start, end });
    return kids.map((k) => [k.start, k.end]);
  };

  const out: FpIdentity[] = [];
  const fileCanon = canon(text, "file");
  const ownText = spliceOwn(0, text.length, null);
  out.push({
    id: fileId,
    kind: "file",
    parent: null,
    digests: [
      { projection: "file", scheme: "ts.file.v1", digest: codeDigest("ts.file.v1", fileCanon) },
      {
        projection: "own",
        scheme: "ts.own.v2",
        digest: codeDigest("ts.own.v2", canon(ownText, "file"))
      }
    ],
    markers: countMarkers(ts, text, markerSpans(0, text.length, null)),
    hatchComplete: true,
    executable: true
  });
  for (const [sym, list] of [...bySym.entries()].sort((a, b) => cmpStr(a[0], b[0]))) {
    const first = list[0] as Ident;
    const ctx = first.context;
    const unitText = list.map((i) => text.slice(i.start, i.end)).join("\n");
    const own = list.map((i) => spliceOwn(i.start, i.end, sym)).join("\n");
    const env = list
      .map((i) =>
        i.node ? envOf(ts, sf, i.node, topFns, topData, imports, `${fileId}#${sym}`) : ""
      )
      .join("\n");
    const markers: Record<string, number> = {};
    for (const i of list) {
      const m = countMarkers(
        ts,
        text.slice(i.start, i.end),
        markerSpans(i.start, i.end, sym).map(([a, b]) => [a - i.start, b - i.start])
      );
      for (const [k, n] of Object.entries(m)) markers[k] = (markers[k] ?? 0) + n;
    }
    const id = `${fileId}#${sym}`;
    out.push({
      id,
      kind: first.kind,
      parent: first.parent ? `${fileId}#${first.parent}` : fileId,
      digests: [
        {
          projection: "own",
          scheme: "ts.own.v2",
          digest: codeDigest("ts.own.v2", canon(own, ctx))
        },
        {
          projection: "unit",
          scheme: "ts.unit.v2",
          digest: codeDigest("ts.unit.v2", `${canon(unitText, ctx)}\n--env--\n${env}`)
        }
      ],
      markers,
      hatchComplete: true,
      executable: true,
      ...(list.length > 1 ? { merged: list.length } : {})
    });
  }
  return out.sort((a, b) => cmpStr(a.id, b.id));
}

function placeholder(i: Ident): string {
  const name = i.symbol.split(".").pop() ?? i.symbol;
  switch (i.context) {
    case "statement":
      return `__shape_id__(${JSON.stringify(name)});`;
    case "member":
      return `${JSON.stringify(`__shape_id__${name}`)};`;
    case "property":
      return `${JSON.stringify(`__shape_id__${name}`)}: 0`;
    case "declarator":
      return `__shape_id__${name.replace(/[^\w$]/g, "_")} = 0`;
  }
}

function collectImportNames(
  ts: TsApi,
  imp: TsNode,
  add: (local: string, imported: string) => void
): void {
  const K = ts.SyntaxKind;
  const clause = imp.importClause;
  if (!clause) return;
  if (clause.name?.text) add(clause.name.text, "default");
  const visit = (n: TsNode): void => {
    if (n.kind === K.NamespaceImport && n.name?.text) add(n.name.text, "*");
    else if (n.kind === K.ImportSpecifier && n.name?.text) {
      const prop = (n as TsNode & { propertyName?: TsNode }).propertyName;
      add(n.name.text, prop?.text ?? n.name.text);
    } else ts.forEachChild(n, visit);
  };
  ts.forEachChild(clause, visit);
}

/** Free names of a node resolved through the file: functions by identity, data by initialiser. */
function envOf(
  ts: TsApi,
  sf: TsSourceFile,
  node: TsNode,
  topFns: Map<string, string>,
  topData: Map<string, TsNode>,
  imports: Map<string, string>,
  self: string
): string {
  const K = ts.SyntaxKind;
  const lines = new Set<string>();
  const seenData = new Set<string>();
  const visitFree = (root: TsNode): void => {
    const declared = new Set<string>();
    const used = new Set<string>();
    const walk = (n: TsNode): void => {
      if (n.kind === K.Identifier) {
        const p = n.parent;
        const name = n.text ?? "";
        const isDeclName =
          p &&
          p.name === n &&
          (p.kind === K.VariableDeclaration ||
            p.kind === K.Parameter ||
            p.kind === K.FunctionDeclaration ||
            p.kind === K.ClassDeclaration ||
            p.kind === K.MethodDeclaration ||
            p.kind === K.PropertyAssignment ||
            p.kind === K.PropertyDeclaration ||
            p.kind === K.BindingElement);
        const isPropName = p && p.kind === K.PropertyAccessExpression && p.name === n;
        if (isDeclName) declared.add(name);
        else if (!isPropName) used.add(name);
      }
      ts.forEachChild(n, walk);
    };
    walk(root);
    for (const name of [...used].sort(cmpStr)) {
      if (declared.has(name)) continue;
      const fn = topFns.get(name);
      if (fn && fn !== self) lines.add(`${name}=fn ${fn}`);
      const imp = imports.get(name);
      if (imp) lines.add(`${name}=import ${imp}`);
      const data = topData.get(name);
      if (data && !seenData.has(name)) {
        seenData.add(name);
        lines.add(
          `${name}=data ${canonicalText(ts, sf.text.slice(data.getStart(sf), data.end), "expression")}`
        );
        visitFree(data);
      }
    }
  };
  visitFree(node);
  return [...lines].sort(cmpStr).join("\n");
}

function tokenStart(sc: TsScanner): number {
  return sc.getTokenStart ? sc.getTokenStart() : (sc.getTokenPos?.() ?? 0);
}

/** Blanks inert comments, prints canonically, canonicalises string literals, joins tokens. */
export function canonicalText(
  ts: TsApi,
  src: string,
  wrap: Ident["context"] | "file" | "expression"
): string {
  const K = ts.SyntaxKind;
  const target = ts.ScriptTarget.Latest as number;
  // 1. blank inert comments (hashbang never inert)
  const sc = ts.createScanner(target, false, 0, src);
  let blanked = "";
  let cur = 0;
  for (;;) {
    const tk = sc.scan();
    if (tk === K.EndOfFileToken) break;
    if (tk === K.SingleLineCommentTrivia || tk === K.MultiLineCommentTrivia) {
      const start = tokenStart(sc);
      const t = sc.getTokenText();
      if (isInertComment(t)) {
        blanked += `${src.slice(cur, start)} `;
        cur = sc.getTextPos();
      }
    }
  }
  blanked += src.slice(cur);
  // 2. parse (wrapped for members, properties, declarators and expressions) and print
  const pre = {
    file: "",
    statement: "",
    member: "class __W {\n",
    property: "const __W = {\n",
    declarator: "let ",
    expression: "("
  }[wrap];
  const post = {
    file: "",
    statement: "",
    member: "\n}",
    property: "\n};",
    declarator: ";",
    expression: ");"
  }[wrap];
  const sf = ts.createSourceFile(
    "canon.ts",
    pre + blanked + post,
    target,
    true,
    ts.ScriptKind.TSX as number
  );
  const printed = ts
    .createPrinter({ removeComments: false, newLine: ts.NewLineKind.LineFeed as number })
    .printFile(sf);
  // 3. token join with canonical string literals; trailing commas dropped
  const toks: string[] = [];
  const s2 = ts.createScanner(target, false, 1, printed);
  for (;;) {
    const tk = s2.scan();
    if (tk === K.EndOfFileToken) break;
    if (tk === K.WhitespaceTrivia || tk === K.NewLineTrivia) continue;
    if (tk === K.StringLiteral) toks.push(JSON.stringify(s2.getTokenValue()));
    else toks.push(s2.getTokenText());
  }
  const out: string[] = [];
  for (let i = 0; i < toks.length; i += 1) {
    const t = toks[i] as string;
    const nx = toks[i + 1];
    if (t === "," && (nx === ")" || nx === "]" || nx === "}")) continue;
    out.push(t);
  }
  return out.join(" ");
}

function countMarkers(ts: TsApi, src: string, exclude: [number, number][]): Record<string, number> {
  const K = ts.SyntaxKind;
  const sc = ts.createScanner(ts.ScriptTarget.Latest as number, false, 0, src);
  let n = 0;
  for (;;) {
    const tk = sc.scan();
    if (tk === K.EndOfFileToken) break;
    if (tk === K.SingleLineCommentTrivia || tk === K.MultiLineCommentTrivia) {
      const start = tokenStart(sc);
      if (exclude.some(([a, b]) => start >= a && start < b)) continue;
      if (/@ts-ignore\b/.test(sc.getTokenText())) n += 1;
    }
  }
  return n > 0 ? { ts_ignore: n } : {};
}

// ---- lexical fallback --------------------------------------------------------------------------

interface LexTok {
  t: string;
  start: number;
  end: number;
  comment: boolean;
}

function lex(src: string): LexTok[] {
  const toks: LexTok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i] as string;
    if (/\s/.test(c)) {
      i += 1;
      continue;
    }
    const start = i;
    if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i += 1;
      toks.push({ t: src.slice(start, i), start, end: i, comment: true });
    } else if (c === "/" && src[i + 1] === "*") {
      const e = src.indexOf("*/", i + 2);
      i = e < 0 ? src.length : e + 2;
      toks.push({ t: src.slice(start, i), start, end: i, comment: true });
    } else if (c === '"' || c === "'" || c === "`") {
      i += 1;
      while (i < src.length && src[i] !== c) i += src[i] === "\\" ? 2 : 1;
      i += 1;
      const raw = src.slice(start, i);
      let t = raw;
      if (c !== "`") {
        try {
          t = JSON.stringify(
            JSON.parse(`"${raw.slice(1, -1).replace(/\\'/g, "'").replace(/"/g, '\\"')}"`)
          );
        } catch {
          t = raw;
        }
      }
      toks.push({ t, start, end: i, comment: false });
    } else if (/[\w$]/.test(c)) {
      while (i < src.length && /[\w$]/.test(src[i] as string)) i += 1;
      toks.push({ t: src.slice(start, i), start, end: i, comment: false });
    } else {
      i += 1;
      toks.push({ t: c, start, end: i, comment: false });
    }
  }
  return toks;
}

function lexCanon(toks: LexTok[]): string {
  return toks
    .filter((t) => !t.comment || !isInertComment(t.t))
    .map((t) => t.t)
    .join(" ");
}

/** Fallback without a compiler: top-level functions, classes and const-bound arrows by brace matching. */
function lexicalFallback(path: string, text: string): FpIdentity[] {
  const fileId = `ts:${encodePath(path)}`;
  const toks = lex(text);
  const idents: { name: string; kind: string; from: number; to: number }[] = [];
  let depth = 0;
  for (let i = 0; i < toks.length; i += 1) {
    const t = toks[i] as LexTok;
    if (t.comment) continue;
    if (t.t === "{") depth += 1;
    else if (t.t === "}") depth -= 1;
    if (depth !== 0) continue;
    const nx = toks[i + 1]?.t ?? "";
    let kind: string | null = null;
    if ((t.t === "function" || t.t === "class") && /^[A-Za-z_$][\w$]*$/.test(nx))
      kind = t.t === "class" ? "class" : "function";
    if (t.t === "const" && toks[i + 2]?.t === "=" && /^[A-Za-z_$][\w$]*$/.test(nx)) {
      const after = toks.slice(i + 3, i + 12).map((x) => x.t);
      if (after.includes("=>") || after[0] === "function" || after[0] === "async") kind = "const";
    }
    if (!kind) continue;
    // extend to the matching close brace of the first top-level block after the header
    let j = i;
    let d = 0;
    let opened = false;
    while (j < toks.length) {
      const x = (toks[j] as LexTok).t;
      if (x === "{") {
        d += 1;
        opened = true;
      } else if (x === "}") {
        d -= 1;
        if (opened && d === 0) break;
      } else if (x === ";" && d === 0 && kind === "const" && opened) break;
      j += 1;
    }
    let s = i;
    while (s > 0 && ["export", "default", "async", "declare"].includes((toks[s - 1] as LexTok).t))
      s -= 1;
    idents.push({ name: nx, kind, from: s, to: Math.min(j, toks.length - 1) });
    i = j;
  }
  const own = toks.filter((_, k) => !idents.some((d) => k >= d.from && k <= d.to));
  const ownCanon = `${lexCanon(own)} ${idents.map((d) => `⟨${d.name}⟩`).join(" ")}`;
  const ts1 = (from: number, to: number): string => lexCanon(toks.slice(from, to + 1));
  const markerCount = (list: LexTok[]): Record<string, number> => {
    const n = list.filter((t) => t.comment && /@ts-ignore\b/.test(t.t)).length;
    return n > 0 ? { ts_ignore: n } : {};
  };
  const out: FpIdentity[] = [
    {
      id: fileId,
      kind: "file",
      parent: null,
      digests: [
        {
          projection: "file",
          scheme: "ts.file.lex1",
          digest: codeDigest("ts.file.lex1", lexCanon(toks))
        },
        { projection: "own", scheme: "ts.own.lex1", digest: codeDigest("ts.own.lex1", ownCanon) }
      ],
      markers: markerCount(own),
      hatchComplete: true,
      executable: true
    }
  ];
  for (const d of idents) {
    const c = ts1(d.from, d.to);
    out.push({
      id: `${fileId}#${encodeSegment(d.name, ".")}`,
      kind: d.kind,
      parent: fileId,
      digests: [
        { projection: "own", scheme: "ts.own.lex1", digest: codeDigest("ts.own.lex1", c) },
        { projection: "unit", scheme: "ts.unit.lex1", digest: codeDigest("ts.unit.lex1", c) }
      ],
      markers: markerCount(toks.slice(d.from, d.to + 1)),
      hatchComplete: true,
      executable: true
    });
  }
  return out.sort((a, b) => cmpStr(a.id, b.id));
}
