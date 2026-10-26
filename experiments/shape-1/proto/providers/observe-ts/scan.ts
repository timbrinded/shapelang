// observe-ts scanner: a TypeScript call graph and effect scan over the type checker (adapted from
// experiments/bend-probes/C/c3/graph.mjs and c4/calls.mjs), with facts attributed to manifest
// identities (nearest enclosing identity, A.4.4.5) and per-identity completeness per channel
// family (A.5.2.5: incomplete for unresolved callees, dynamic code, opaque external packages).
//
// Effect facts are raw: resource code ts.call("<api>") for platform APIs and pg.table("<t>") for
// literal embedded SQL; the shape's resource bindings lift them (A.4.4.2). Call facts join two
// identities: direct calls, `new C()` and functions passed as arguments (the caller supplies them,
// A.5.2.1).
//
// Roots. Every expression that reaches a classified API goes through one resolver, `chainBase`:
// a global root (Date, performance, process, ...), the global object under any of its names
// (globalThis, global, self, window, frames, parent, top; `globalThis.globalThis.Date` and
// `globalThis["Date"]` are Date), a module (static import, `import x = require(...)`, `require`,
// `await import`, or a re-export through a local barrel), or a local binding that holds one.
// Static member keys (`.now`, `["now"]`, `` [`now`] ``) and type wrappers (parentheses, `!`, `as`,
// `satisfies`, `<T>`) are transparent. A binding that can never be rebound (const, or a let/var
// no code assigns) forwards its root, so `const g = globalThis; g.Date.now()` is the fact itself.
//
// Supply (A.5.2.1). A root value that flows anywhere else (an argument, a return, a property, an
// `extends` clause, a binding that may be rebound, `x || Date`) is supplied by the entry where it
// flows: that entry is incomplete (`alias:<root>`), and so is every entry that reads a binding
// which may hold a root. A dynamic member of a root (`globalThis[k]`) is `dynamic:<root>[]`.
import { existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { ManifestIndex } from "../../src/manifest.ts";
import type { Fact } from "../../src/records.ts";
import { canonResourceCode, channelMatches, parseResourceCode } from "../../src/resource-code.ts";
import { cmpStr } from "../../src/util.ts";
import { type IdentitySpan, type TsCompilerOptions, type TsFull, type TsNode, type TsSourceFile, type TsSymbol, type TsType, enclosingIdentity, identitySpans } from "../ts-api.ts";

export interface ApiClass {
  verb: string;
  family: "clock" | "random" | "env" | "fs-read" | "fs-write" | "stdio" | "process" | "network" | "subprocess";
}

const FS_WRITE: Record<string, string> = {
  writeFileSync: "Write",
  writeFile: "Write",
  appendFileSync: "Append",
  appendFile: "Append",
  mkdirSync: "Write",
  mkdir: "Write",
  rmSync: "HardDelete",
  rm: "HardDelete",
  rmdirSync: "HardDelete",
  rmdir: "HardDelete",
  unlinkSync: "HardDelete",
  unlink: "HardDelete",
  renameSync: "Update",
  rename: "Update",
  copyFileSync: "Write",
  copyFile: "Write",
  cpSync: "Write",
  cp: "Write",
  mkdtempSync: "Write",
  mkdtemp: "Write",
  createWriteStream: "Write",
  chmodSync: "Update",
  chmod: "Update",
  symlinkSync: "Write",
  symlink: "Write",
  truncateSync: "Truncate",
  truncate: "Truncate",
  utimesSync: "Update",
  utimes: "Update"
};

const PURE_MODULES = new Set(["path", "path/posix", "path/win32", "url", "util", "events", "buffer", "string_decoder", "querystring", "zlib", "stream", "assert", "assert/strict", "bun:test", "node:test", "crypto"]);
/** Modules whose members classifyApi knows (their effects are exactly the classified APIs). */
const CLASSIFIED_MODULES = new Set(["fs", "fs/promises", "child_process", "http", "https", "net", "dgram", "tls", "dns", "http2", "os", "readline", "worker_threads", "crypto", "bun", "bun:sqlite"]);

/** Classifies an API chain (module or global root plus member names) into a canonical API name
 *  and its verb; null for pure APIs. `call` says whether the chain is called or constructed. */
export function classifyApi(root: { module?: string; global?: string }, names: string[], ctx: { call: boolean; isNew: boolean; argc: number; spread: boolean }): { api: string; cls: ApiClass } | null {
  const a = names[0];
  if (root.module !== undefined) {
    const spec = root.module.replace(/^node:/, "");
    const api = (n: number): string => [spec, ...names.slice(0, n)].join(".");
    if (spec === "fs" || spec === "fs/promises") {
      if (!a) return null;
      const w = FS_WRITE[a];
      return { api: api(1), cls: w ? { verb: w, family: "fs-write" } : { verb: "Read", family: "fs-read" } };
    }
    if (spec === "child_process") return a ? { api: api(1), cls: { verb: "Write", family: "subprocess" } } : null;
    if (["http", "https", "net", "dgram", "tls", "dns", "http2"].includes(spec)) return a ? { api: api(1), cls: { verb: "Write", family: "network" } } : null;
    if (spec === "os") return a ? { api: api(1), cls: { verb: "Read", family: "env" } } : null;
    if (spec === "readline") return a ? { api: api(1), cls: { verb: "Read", family: "stdio" } } : null;
    if (spec === "worker_threads") return a ? { api: api(1), cls: { verb: "Write", family: "process" } } : null;
    if (spec === "crypto") return a && ["randomBytes", "randomUUID", "getRandomValues", "randomInt"].includes(a) ? { api: api(1), cls: { verb: "Read", family: "random" } } : null;
    if (spec === "bun") {
      if (!a) return null;
      if (["$", "spawn", "spawnSync"].includes(a)) return { api: api(1), cls: { verb: "Write", family: "subprocess" } };
      if (a === "file" || a === "Glob") return { api: api(1), cls: { verb: "Read", family: "fs-read" } };
      if (a === "write") return { api: api(1), cls: { verb: "Write", family: "fs-write" } };
      if (a === "env" || a === "argv") return { api: api(1), cls: { verb: "Read", family: "env" } };
      return null;
    }
    if (spec === "bun:sqlite") return a ? { api: api(1), cls: { verb: "Write", family: "fs-write" } } : null;
    return null;
  }
  const g = root.global ?? "";
  const api = (n: number): string => [g, ...names.slice(0, n)].join(".");
  switch (g) {
    case "Date":
      if (a === "now") return { api: "Date.now", cls: { verb: "Read", family: "clock" } };
      if (a === undefined && ((ctx.isNew && ctx.argc === 0 && !ctx.spread) || (ctx.call && !ctx.isNew))) return { api: "Date", cls: { verb: "Read", family: "clock" } };
      return null;
    case "performance":
      return a === "now" ? { api: "performance.now", cls: { verb: "Read", family: "clock" } } : null;
    case "process":
      if (a === "hrtime" || a === "uptime") return { api: api(1), cls: { verb: "Read", family: "clock" } };
      if (a === "env" || a === "argv" || a === "cwd" || a === "platform" || a === "arch" || a === "execPath" || a === "pid" || a === "execArgv" || a === "version" || a === "versions")
        return { api: api(1), cls: { verb: "Read", family: "env" } };
      if (a === "stdout" || a === "stderr") return { api: api(1), cls: { verb: "Write", family: "stdio" } };
      if (a === "stdin") return { api: api(1), cls: { verb: "Read", family: "stdio" } };
      if (a === "exit" || a === "exitCode" || a === "kill" || a === "chdir") return { api: api(1), cls: { verb: "Write", family: "process" } };
      return null;
    case "console":
      return a ? { api: api(1), cls: { verb: "Write", family: "stdio" } } : null;
    case "Math":
      return a === "random" ? { api: "Math.random", cls: { verb: "Read", family: "random" } } : null;
    case "crypto":
      return a === "randomUUID" || a === "getRandomValues" ? { api: api(1), cls: { verb: "Read", family: "random" } } : null;
    case "fetch":
    case "XMLHttpRequest":
    case "WebSocket":
    case "EventSource":
      return { api: g, cls: { verb: "Write", family: "network" } };
    case "Bun":
      if (!a) return null;
      if (a === "file" || a === "Glob") return { api: api(1), cls: { verb: "Read", family: "fs-read" } };
      if (a === "write") return { api: api(1), cls: { verb: "Write", family: "fs-write" } };
      if (["spawn", "spawnSync", "$"].includes(a)) return { api: api(1), cls: { verb: "Write", family: "subprocess" } };
      if (["env", "argv", "main", "cwd"].includes(a)) return { api: api(1), cls: { verb: "Read", family: "env" } };
      if (a === "nanoseconds") return { api: api(1), cls: { verb: "Read", family: "clock" } };
      if (["serve", "connect", "listen", "udpSocket"].includes(a)) return { api: api(1), cls: { verb: "Write", family: "network" } };
      if (a === "stdout" || a === "stderr") return { api: api(1), cls: { verb: "Write", family: "stdio" } };
      if (a === "stdin") return { api: api(1), cls: { verb: "Read", family: "stdio" } };
      return null;
    default:
      return null;
  }
}

/** Names of the global object itself: a member of any of them is the global of that name. */
export const GLOBAL_OBJECTS: ReadonlySet<string> = new Set(["globalThis", "global", "self", "window", "frames", "parent", "top"]);
/** Global roots whose members classifyApi knows: their aliasing (use as a bare value) can hide a
 *  classified API. */
const API_ROOTS = new Set(["Date", "performance", "process", "console", "Math", "crypto", "Bun", "fetch", "XMLHttpRequest", "WebSocket", "EventSource"]);
/** Globals onChain classifies exactly (or flags as dynamic code): every other global value (`JSON`,
 *  an undeclared `myClock`, `globalThis.myDate`) is checked by its type like any other value. */
const GOVERNED_GLOBALS = new Set([...API_ROOTS, ...GLOBAL_OBJECTS, "eval", "Function", "require"]);
/** Members every function or object inherits that call it (`call`, `apply`), rebind it (`bind`) or
 *  return it (`valueOf`, `__proto__` for the prototype chain): on a root they invoke or alias it. */
const REFLECTIVE = new Set(["call", "apply", "bind", "valueOf", "__proto__"]);
const INVOKERS = new Set(["call", "apply"]);

const IDENT = String.raw`(?:"[^"]+"|[A-Za-z_][\w$]*)(?:\s*\.\s*(?:"[^"]+"|[A-Za-z_][\w$]*))?`;
const END = String.raw`(?=\s*(?:$|;|\)|,))`;
/** Literal SQL statements, each requiring its grammatical continuation so prose ("update the
 *  docs", "select one from the menu") does not match. */
const SQL_FORMS: { re: RegExp; verb: string }[] = [
  { re: new RegExp(String.raw`^\s*delete\s+from\s+(?:only\s+)?(${IDENT})(?:\s+as\s+\w+)?(?:(?:\s+\w+)?\s+(?:where|using|returning)\b|${END})`, "i"), verb: "HardDelete" },
  { re: new RegExp(String.raw`^\s*insert\s+into\s+(${IDENT})\s*(?:\(|values\b|select\b|default\b|overriding\b)`, "i"), verb: "Append" },
  { re: new RegExp(String.raw`^\s*update\s+(?:only\s+)?(${IDENT})(?:\s+(?:as\s+)?\w+)?\s+set\b`, "i"), verb: "Update" },
  { re: new RegExp(String.raw`^\s*merge\s+into\s+(${IDENT})`, "i"), verb: "Update" },
  { re: new RegExp(String.raw`^\s*alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?(${IDENT})`, "i"), verb: "Update" },
  { re: new RegExp(String.raw`^\s*truncate\s+(?:table\s+)?(?:only\s+)?(${IDENT})(?:\s+(?:restart|continue|cascade|restrict)\b|${END})`, "i"), verb: "Truncate" },
  { re: new RegExp(String.raw`^\s*drop\s+table\s+(?:if\s+exists\s+)?(${IDENT})`, "i"), verb: "DropStorage" },
  {
    re: new RegExp(
      String.raw`^\s*(?:with\b[\s\S]*?\)\s*)?select\s+[\s\S]*?\bfrom\s+(${IDENT})(?:\s+as\s+\w+)?(?:(?:\s+\w+)?\s+(?:where|join|inner|left|right|full|cross|natural|group|order|limit|offset|union|for|having)\b|${END})`,
      "i"
    ),
    verb: "Read"
  }
];

/** Embedded SQL in a literal: the statement's verb and canonical pg.table, or null. */
export function sqlEffect(text: string): { verb: string; table: string } | null {
  for (const f of SQL_FORMS) {
    const m = f.re.exec(text);
    if (!m || !m[1]) continue;
    const table = canonResourceCode(`pg.table(${JSON.stringify(m[1].replace(/\s+/g, ""))})`);
    if (table) return { verb: f.verb, table };
  }
  return null;
}

export interface IdentityScan {
  id: string;
  effectsIncomplete: string[];
  callsIncomplete: string[];
}

export interface ScanResult {
  /** manifest identity → completeness reasons (own span; parents include descendants) */
  identities: Map<string, IdentityScan>;
  effects: Fact[];
  calls: Fact[];
  stats: {
    files: number;
    unparsed: number;
    identities: number;
    relocated: number;
    effectSites: number;
    callSites: number;
    callbackRefs: number;
    externalCalls: number;
    unresolvedCalls: number;
    ms: number;
  };
}

export interface ScanOptions {
  root: string;
  files: string[];
  man: ManifestIndex;
  /** effect channels to report: resource-code patterns, e.g. ts.call("Date.now"), pg.table("*") */
  channels: string[];
  calls: boolean;
  tsconfig?: string;
}

function compilerOptions(ts: TsFull, root: string, tsconfig?: string): TsCompilerOptions {
  const cfg = tsconfig ?? join(root, "tsconfig.json");
  const base: TsCompilerOptions = {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    allowJs: true,
    allowImportingTsExtensions: true,
    noEmit: true,
    skipLibCheck: true,
    types: []
  };
  if (!existsSync(cfg)) return base;
  const read = ts.readConfigFile(cfg, (p) => ts.sys.readFile(p));
  if (!read.config) return base;
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, resolve(cfg, ".."));
  return { ...parsed.options, noEmit: true, skipLibCheck: true };
}

/** A root an expression reaches: a module specifier or a global name. */
type Root = { module: string; global?: undefined } | { global: string; module?: undefined };
/** What an expression or binding holds: exactly `root.chain` (forwardable), or possibly
 *  `root.chain` (a supply: flows the scan does not follow). */
type Base = { kind: "root" | "may"; root: Root; chain: string[] };
const NO_CALL = { call: false, isNew: false, argc: 0, spread: false };
/** a chain inside a classified API (`process.platform`, `Date.now`): its value is that API's result
 *  or function, reported where the chain is read, and cannot hide another API */
function classifiedChain(r: Root, chain: string[]): boolean {
  for (let n = chain.length; n >= 0; n -= 1) if (classifyApi(r, chain.slice(0, n), NO_CALL)) return true;
  return false;
}

export function scanTs(ts: TsFull, o: ScanOptions): ScanResult {
  const t0 = Date.now();
  const K = ts.SyntaxKind;
  const SF = ts.SymbolFlags;
  const root = resolve(o.root);
  const abs = o.files.map((f) => join(root, f));
  const program = ts.createProgram(abs, compilerOptions(ts, root, o.tsconfig));
  const checker = program.getTypeChecker();
  const isLocal = (fileName: string): boolean => fileName.startsWith(`${root}/`) && !fileName.endsWith(".d.ts") && !fileName.includes("/node_modules/");
  const isLocalDecl = (d: TsNode): boolean => isLocal(d.getSourceFile().fileName);
  const rel = (fileName: string): string => relative(root, fileName).replace(/\\/g, "/");
  const wantEffects = o.channels.length > 0;
  const reportable = (resource: string): boolean => o.channels.some((p) => channelMatches(p, resource));
  // watched ts.call heads ("Date" for ts.call("Date.now"), "fs/promises" for ts.call("fs/promises.rm"),
  // "*") and their first members ("" for the head itself, as in ts.call("Date"))
  const heads = new Set<string>();
  const watchedMembers = new Map<string, Set<string>>();
  for (const p of o.channels) {
    const r = parseResourceCode(p);
    if (!r || r.tag !== "ts" || r.kind !== "call") continue;
    const v = r.value.replace(/^globalThis\./, "");
    const [h = v, m = ""] = v === "*" ? ["*"] : v.split(".");
    heads.add(h);
    watchedMembers.set(h, (watchedMembers.get(h) ?? new Set<string>()).add(m));
  }
  /** does any configured channel reach APIs under this global root? The global object reaches all. */
  const rootWatched = (g: string): boolean => (GLOBAL_OBJECTS.has(g) ? heads.size > 0 : heads.has("*") || heads.has(g));
  const isApiRoot = (g: string): boolean => API_ROOTS.has(g) || GLOBAL_OBJECTS.has(g);
  /** does a watched channel reach member `key` of global root g? */
  const memberWatched = (g: string, key: string): boolean => {
    if (!rootWatched(g)) return false;
    if (heads.has("*")) return true;
    // a global object's member is a root: checked where its own member is read, unless it is called
    if (GLOBAL_OBJECTS.has(g)) return callWatched(key);
    return watchedMembers.get(g)?.has(key) ?? false;
  };
  /** is calling or constructing global root g itself watched (ts.call("Date"), ts.call("fetch"))? */
  const callWatched = (g: string): boolean => heads.has("*") || (watchedMembers.get(g)?.has("") ?? false);
  /** can a supply of this root hide a fact on the configured channels? */
  const watchedRoot = (r: Root): boolean => {
    if (r.global !== undefined) return isApiRoot(r.global) && rootWatched(r.global);
    const spec = r.module.replace(/^node:/, "");
    if (!wantEffects) return false;
    if (CLASSIFIED_MODULES.has(spec)) return heads.has("*") || heads.has(spec);
    return !PURE_MODULES.has(spec);
  };
  /** the reason a supply of r leaves its entry incomplete: an alias of a known root, or opaque code */
  const supplyReason = (r: Root): string => {
    if (r.global !== undefined) return `alias:${r.global}`;
    const spec = r.module.replace(/^node:/, "");
    return CLASSIFIED_MODULES.has(spec) ? `alias:${spec}` : `external:${spec}`;
  };

  const identities = new Map<string, IdentityScan>();
  const effects = new Map<string, { fact: Fact; n: number }>();
  const calls = new Map<string, { fact: Fact; n: number }>();
  const stats: ScanResult["stats"] = { files: 0, unparsed: 0, identities: 0, relocated: 0, effectSites: 0, callSites: 0, callbackRefs: 0, externalCalls: 0, unresolvedCalls: 0, ms: 0 };
  // declaration node → identity id, across files (callee resolution)
  const spansByFile = new Map<string, IdentitySpan[]>();
  const nodeIdentity = new Map<TsNode, string>();
  const spansOf = (sf: TsSourceFile): IdentitySpan[] => {
    const p = rel(sf.fileName);
    let s = spansByFile.get(p);
    if (!s) {
      s = identitySpans(ts, sf, p);
      spansByFile.set(p, s);
      for (const x of s) if (x.node) nodeIdentity.set(x.node, x.id);
    }
    return s;
  };
  /** the manifest identity a span maps to: itself, else its nearest present ancestor */
  const present = (id: string): string | null => {
    let cur: string | null = id;
    while (cur && !o.man.ids.has(cur)) {
      const hash = cur.indexOf("#");
      if (hash < 0) return null;
      const sym = cur.slice(hash + 1);
      const i = sym.lastIndexOf(".");
      cur = i > 0 ? `${cur.slice(0, hash)}#${sym.slice(0, i)}` : cur.slice(0, hash);
    }
    return cur;
  };
  const resolveSym = (s: TsSymbol | undefined): TsSymbol | undefined => {
    if (s && s.flags & (SF.Alias as number)) {
      try {
        return checker.getAliasedSymbol(s);
      } catch {
        return s;
      }
    }
    return s;
  };
  const importOf = (s: TsSymbol | undefined): { spec: string; imported: string | null; namespace: boolean } | null => {
    for (const d of s?.declarations ?? []) {
      let imp: TsNode | null = null;
      let imported: string | null = null;
      let namespace = false;
      if (d.kind === K.ImportSpecifier) {
        imp = d.parent.parent.parent;
        imported = (d.propertyName ?? d.name)?.text ?? null;
      } else if (d.kind === K.NamespaceImport) {
        imp = d.parent.parent;
        namespace = true;
      } else if (d.kind === K.ImportClause) {
        imp = d.parent;
        imported = "default";
      } else if (d.kind === K.ImportEqualsDeclaration) {
        const ref = d.moduleReference;
        const lit = ref && ref.kind === K.ExternalModuleReference ? ref.expression : undefined;
        if (lit && lit.kind === K.StringLiteral) return { spec: lit.text ?? "", imported: null, namespace: true };
      }
      const ms = imp?.moduleSpecifier;
      if (imp && imp.kind === K.ImportDeclaration && ms && ms.kind === K.StringLiteral) return { spec: ms.text ?? "", imported, namespace };
    }
    return null;
  };
  const calleeIdentity = (decl: TsNode): string | null => {
    let d: TsNode | undefined = decl;
    // `const f = () => …`: the identity node is the VariableDeclaration
    if (d && (d.kind === K.ArrowFunction || d.kind === K.FunctionExpression) && d.parent?.kind === K.VariableDeclaration) d = d.parent;
    if (!d) return null;
    const sf = d.getSourceFile();
    if (!isLocal(sf.fileName)) return null;
    spansOf(sf);
    const id = nodeIdentity.get(d);
    return id ? present(id) : null;
  };
  const isDeclName = (id: TsNode): boolean => {
    const p = id.parent;
    if (!p) return false;
    if (p.kind === K.PropertyAccessExpression) return false;
    if (p.kind === K.BindingElement && p.propertyName === id) return true;
    if (p.kind === K.QualifiedName) return true;
    return p.name === id;
  };
  const isTypePosition = (n: TsNode): boolean => {
    for (let p: TsNode | undefined = n.parent; p; p = p.parent) {
      const k = p.kind;
      // `class C extends <expression>` and instantiation expressions (`f<T>`) are values;
      // `implements` and interface `extends` clauses are types
      if (k === K.ExpressionWithTypeArguments) {
        const h = p.parent;
        if (h?.kind !== K.HeritageClause) return false;
        return !(h.token === K.ExtendsKeyword && (h.parent?.kind === K.ClassDeclaration || h.parent?.kind === K.ClassExpression));
      }
      if (k === K.TypeReference || k === K.TypeQuery || k === K.TypeAliasDeclaration || k === K.InterfaceDeclaration || k === K.ImportDeclaration || k === K.ExportDeclaration) return true;
      if (k === K.Block || k === K.SourceFile) return false;
    }
    return false;
  };

  // ---- roots -----------------------------------------------------------------------------------
  // the declared types of the watched global roots (globalThis stands for every global object)
  const rootTypes = new Map<string, TsType>();
  const anchor = abs.map((f) => program.getSourceFile(f)).find((x) => x !== undefined);
  if (anchor && heads.size > 0) {
    for (const g of [...API_ROOTS, "globalThis"].sort(cmpStr)) {
      if (!rootWatched(g)) continue;
      const s = checker.resolveName(g, undefined, SF.Value as number, false);
      if (!s || (s.declarations ?? []).some(isLocalDecl)) continue;
      rootTypes.set(g, checker.getTypeOfSymbolAtLocation(s, anchor));
    }
  }
  const isWrapper = (n: TsNode): boolean =>
    n.kind === K.ParenthesizedExpression || n.kind === K.NonNullExpression || n.kind === K.AsExpression || n.kind === K.SatisfiesExpression || n.kind === K.TypeAssertionExpression;
  const unwrap = (n: TsNode): TsNode => {
    let x = n;
    while (isWrapper(x) && x.expression) x = x.expression;
    return x;
  };
  /** a static member key: `["now"]`, `` [`now`] ``, `[0]` */
  const literalKey = (n: TsNode | undefined): string | null =>
    n && (n.kind === K.StringLiteral || n.kind === K.NoSubstitutionTemplateLiteral || n.kind === K.NumericLiteral) ? (n.text ?? null) : null;
  /** a module specifier argument: the external specifier, "local" for repo code, null if dynamic */
  const moduleArg = (n: TsNode | undefined): string | null => {
    if (!n || (n.kind !== K.StringLiteral && n.kind !== K.NoSubstitutionTemplateLiteral)) return null;
    const spec = n.text ?? "";
    if (spec.startsWith(".") || spec.startsWith("/")) return "local";
    const m = checker.getSymbolAtLocation(n);
    return m && (m.declarations ?? []).some(isLocalDecl) ? "local" : spec;
  };
  /** `await import("m")` and `require("m")` are the module m itself */
  const headSpec = (x: TsNode): string | null => {
    let spec: string | null = null;
    if (x.kind === K.AwaitExpression && x.expression) {
      const inner = unwrap(x.expression);
      if (inner.kind === K.CallExpression && inner.expression?.kind === K.ImportKeyword) spec = moduleArg(inner.arguments?.[0]);
    } else if (x.kind === K.CallExpression && x.expression && x.expression.kind === K.Identifier && x.expression.text === "require") {
      const s = checker.getSymbolAtLocation(x.expression);
      if (!(s && (s.declarations ?? []).some(isLocalDecl))) spec = moduleArg(x.arguments?.[0]);
    }
    return spec === "local" ? null : spec;
  };
  const may = (b: Base): Base => (b.kind === "may" ? b : { kind: "may", root: b.root, chain: b.chain });
  /** `globalThis.Date` is Date, `globalThis.globalThis` is globalThis, `X.prototype.constructor` is X */
  const normalise = (r0: Root, c0: string[]): { root: Root; chain: string[] } => {
    let r = r0;
    let c = c0;
    for (let i = c.indexOf("prototype"); i >= 0 && i + 1 < c.length; i = c.indexOf("prototype", i + 1)) {
      if (c[i + 1] === "constructor") {
        c = [...c.slice(0, i), ...c.slice(i + 2)];
        i = -1;
      }
    }
    while (r.global !== undefined && GLOBAL_OBJECTS.has(r.global) && c.length > 0) {
      r = { global: c[0] as string };
      c = c.slice(1);
    }
    return { root: r, chain: c };
  };
  /** the module or global a non-local declaration reached through a local re-export belongs to */
  const externalBase = (target: TsSymbol): Base | null => {
    const d = target.declarations?.[0];
    if (!d) return null;
    const isModule = d.kind === K.ModuleDeclaration || d.kind === K.SourceFile;
    const member = isModule || target.name === "default" ? [] : [target.name];
    for (let p: TsNode | undefined = d; p && p.kind !== K.SourceFile; p = p.parent) {
      const nm = p.kind === K.ModuleDeclaration ? p.name : undefined;
      if (!nm) continue;
      if (nm.kind === K.StringLiteral) return { kind: "root", root: { module: nm.text ?? "" }, chain: p === d ? [] : member };
      if (nm.kind === K.Identifier && nm.text === "global") return { kind: "root", root: { global: target.name }, chain: [] };
    }
    const sf = d.getSourceFile();
    const moduleFile = sf.statements.some(
      (s) => s.kind === K.ImportDeclaration || s.kind === K.ExportDeclaration || s.kind === K.ExportAssignment || (s.modifiers ?? []).some((m) => m.kind === K.ExportKeyword)
    );
    if (!moduleFile) return { kind: "root", root: { global: target.name }, chain: [] };
    const f = sf.fileName.replace(/\\/g, "/");
    const i = f.lastIndexOf("/node_modules/");
    if (i < 0) return { kind: "root", root: { module: rel(f) }, chain: member };
    const parts = f.slice(i + "/node_modules/".length).split("/");
    const pkg = parts[0]?.startsWith("@") ? `${parts[0]}/${parts[1] ?? ""}` : (parts[0] ?? "");
    return { kind: "root", root: { module: pkg }, chain: member };
  };
  // bindings some code assigns after their declaration (pre-pass below): declaration → values
  const assigned = new Map<TsNode, (TsNode | null)[]>();
  const aliasCache = new Map<TsNode, Base | null>();
  /** a binding never rebound: const, or a let/var no code assigns */
  const fixed = (varDecl: TsNode, leaf: TsNode): boolean => {
    const list = varDecl.parent;
    if (list?.kind !== K.VariableDeclarationList) return false;
    if ((list.flags & (ts.NodeFlags.Const as number)) !== 0) return true;
    return !assigned.has(leaf) && !assigned.has(varDecl);
  };
  /** what the value destructured by a binding pattern holds, and its variable declaration */
  const patternValue = (pattern: TsNode): { base: Base | null; decl: TsNode | null } => {
    const owner = pattern.parent;
    if (owner?.kind === K.VariableDeclaration) return { base: owner.initializer ? valueBase(owner.initializer) : null, decl: owner };
    if (owner?.kind === K.BindingElement) {
      const up = patternValue(owner.parent);
      return { base: up.base ? memberOf(up.base, owner) : null, decl: up.decl };
    }
    if (owner?.kind === K.Parameter && owner.initializer) {
      const b = valueBase(owner.initializer);
      return { base: b ? may(b) : null, decl: null };
    }
    return { base: null, decl: null };
  };
  const memberOf = (b: Base, el: TsNode): Base => {
    if (b.kind === "may" || el.dotDotDotToken || el.parent.kind !== K.ObjectBindingPattern) return may(b);
    const pn = el.propertyName ?? el.name;
    const key = pn && pn.kind === K.Identifier ? (pn.text ?? null) : literalKey(pn);
    return key === null ? may(b) : { kind: "root", root: b.root, chain: [...b.chain, key] };
  };
  /** what a local binding holds when it holds a root (null: it holds no root) */
  const aliasOf = (d: TsNode): Base | null => {
    if (aliasCache.has(d)) return aliasCache.get(d) ?? null;
    aliasCache.set(d, null); // cycle guard
    let out: Base | null = null;
    if (d.kind === K.VariableDeclaration && d.name?.kind === K.Identifier && d.initializer) {
      const v = valueBase(d.initializer);
      if (v) out = v.kind === "root" && fixed(d, d) ? v : may(v);
    } else if (d.kind === K.BindingElement && d.name?.kind === K.Identifier) {
      const { base, decl } = patternValue(d.parent);
      if (base) {
        const m = memberOf(base, d);
        out = m.kind === "root" && decl && fixed(decl, d) ? m : may(m);
      }
    } else if (d.kind === K.Parameter && d.initializer) {
      const v = valueBase(d.initializer);
      if (v) out = may(v);
    }
    for (const v of assigned.get(d) ?? []) {
      const b = v ? valueBase(v) : null;
      if (b) out = may(out ?? b);
    }
    aliasCache.set(d, out);
    return out;
  };
  /** the root an identifier denotes: an import, a global, a re-export, or a local binding */
  const identBase = (id: TsNode, sym: TsSymbol | undefined): Base | null => {
    const imp = importOf(sym);
    const target = resolveSym(sym);
    const decls = target?.declarations ?? [];
    const localTarget = decls.some(isLocalDecl);
    if (imp && !localTarget && !imp.spec.startsWith(".")) return { kind: "root", root: { module: imp.spec }, chain: imp.namespace || imp.imported === "default" ? [] : [imp.imported ?? ""] };
    if (!localTarget && target && decls.length > 0 && (imp || (sym?.declarations ?? []).some(isLocalDecl))) return externalBase(target);
    if (!imp && !localTarget && (sym === undefined || (sym.declarations ?? []).every((d) => !isLocalDecl(d)))) return { kind: "root", root: { global: id.text ?? "" }, chain: [] };
    if (!localTarget) return null;
    const holders = decls.map(aliasOf).filter((b): b is Base => b !== null);
    if (holders.length === 0) return null;
    // a var declared twice may hold either value
    return decls.length === 1 ? (holders[0] as Base) : may(holders[0] as Base);
  };
  /** the root a member chain reaches: `globalThis["Date"]`, `(await import("fs")).promises`, … */
  const chainBase = (e: TsNode): Base | null => {
    const names: string[] = [];
    let x = e;
    for (;;) {
      if (isWrapper(x) && x.expression) x = x.expression;
      else if (x.kind === K.PropertyAccessExpression && x.expression) {
        names.unshift(x.name?.text ?? "");
        x = x.expression;
      } else if (x.kind === K.ElementAccessExpression && x.expression) {
        const key = literalKey(x.argumentExpression);
        if (key === null) {
          const b = chainBase(x.expression);
          return b ? may(b) : null;
        }
        names.unshift(key);
        x = x.expression;
      } else break;
    }
    let base: Base | null = null;
    if (x.kind === K.Identifier) base = identBase(x, checker.getSymbolAtLocation(x));
    else {
      const spec = headSpec(x);
      if (spec !== null) base = { kind: "root", root: { module: spec }, chain: [] };
    }
    if (!base || base.kind === "may") return base;
    return { kind: "root", ...normalise(base.root, [...base.chain, ...names]) };
  };
  /** a root onChain classifies (or flags as dynamic code): a module, an API root, the global object,
   *  eval, Function, require */
  const governed = (b: Base | null): boolean => b !== null && (b.root.module !== undefined || GOVERNED_GLOBALS.has(b.root.global));
  /** an expression another handler owns: an exact chain to a governed root (onChain) or a binding
   *  that may hold one (onIdentifier). Everything else, `JSON`, an undeclared global or
   *  `(globalThis as any).myClock`, is checked by its type like any other value. */
  const handledChain = (e: TsNode): boolean => governed(chainBase(e));
  const isOp = (op: number | undefined, ...names: string[]): boolean => op !== undefined && names.some((n) => K[n] === op);
  /** the call, construction or tagged template that invokes `top`, if any */
  const calleeOf = (top: TsNode): TsNode | null => {
    const p = top.parent;
    if (!p) return null;
    if ((p.kind === K.CallExpression || p.kind === K.NewExpression) && p.expression === top) return p;
    return p.kind === K.TaggedTemplateExpression && p.tag === top ? p : null;
  };
  /** what `F.call(this, …args)` or `F.apply(this, list)` passes F */
  const invokedCtx = (kind: string, args: TsNode[]): typeof NO_CALL => {
    const isSpread = (x: TsNode | undefined): boolean => x !== undefined && x.kind === K.SpreadElement;
    if (isSpread(args[0])) return { call: true, isNew: false, argc: 0, spread: true };
    if (kind === "call") return { call: true, isNew: false, argc: Math.max(0, args.length - 1), spread: args.slice(1).some(isSpread) };
    if (args[1] === undefined) return { call: true, isNew: false, argc: 0, spread: false };
    const list = unwrap(args[1]);
    if (list.kind === K.ArrayLiteralExpression && !(list.elements ?? []).some(isSpread)) return { call: true, isNew: false, argc: (list.elements ?? []).length, spread: false };
    return { call: true, isNew: false, argc: 0, spread: true };
  };
  /** what an initializer or assigned value holds */
  const valueBase = (e: TsNode): Base | null => {
    const x = unwrap(e);
    if (x.kind === K.ConditionalExpression) {
      const v = (x.whenTrue ? valueBase(x.whenTrue) : null) ?? (x.whenFalse ? valueBase(x.whenFalse) : null);
      return v ? may(v) : null;
    }
    if (x.kind === K.BinaryExpression) {
      const op = x.operatorToken?.kind;
      if (!isOp(op, "BarBarToken", "QuestionQuestionToken", "AmpersandAmpersandToken", "CommaToken", "EqualsToken", "BarBarEqualsToken", "QuestionQuestionEqualsToken", "AmpersandAmpersandEqualsToken")) return null;
      const r = x.right ? valueBase(x.right) : null;
      const l = !isOp(op, "CommaToken", "EqualsToken") && x.left ? valueBase(x.left) : null;
      const v = r ?? l;
      return v ? may(v) : null;
    }
    // `Date.bind(null)` and `Date.valueOf()` are Date again, under another name
    if (x.kind === K.CallExpression && x.expression) {
      const cb = chainBase(x.expression);
      const last = cb?.chain[cb.chain.length - 1];
      if (cb && last !== undefined && (last === "bind" || last === "valueOf")) return may({ kind: cb.kind, root: cb.root, chain: cb.chain.slice(0, -1) });
    }
    const c = chainBase(x);
    if (c) return c;
    if (x.kind === K.AwaitExpression && x.expression) {
      const v = valueBase(x.expression);
      return v ? may(v) : null;
    }
    return null;
  };

  // pre-pass: bindings assigned after their declaration (`x = …`, `({ x } = …)`, `x++`, `for (x of …)`)
  const noteTarget = (target: TsNode, value: TsNode | null): void => {
    const t = unwrap(target);
    const add = (s: TsSymbol | undefined, v: TsNode | null): void => {
      for (const d of s?.declarations ?? []) {
        if (!isLocalDecl(d)) continue;
        const l = assigned.get(d) ?? [];
        l.push(v);
        assigned.set(d, l);
      }
    };
    if (t.kind === K.Identifier) add(checker.getSymbolAtLocation(t), value);
    else if (t.kind === K.ObjectLiteralExpression) {
      for (const p of t.properties ?? []) {
        if (p.kind === K.ShorthandPropertyAssignment) add(checker.getShorthandAssignmentValueSymbol(p), value);
        else if (p.kind === K.PropertyAssignment && p.initializer) noteTarget(p.initializer, value);
        else if (p.kind === K.SpreadAssignment && p.expression) noteTarget(p.expression, value);
      }
    } else if (t.kind === K.ArrayLiteralExpression) {
      for (const el of t.elements ?? []) noteTarget(el.kind === K.SpreadElement && el.expression ? el.expression : el, value);
    } else if (t.kind === K.BinaryExpression && isOp(t.operatorToken?.kind, "EqualsToken") && t.left) noteTarget(t.left, value); // default in a pattern
  };
  const ASSIGN_OPS = new Set(
    ["EqualsToken", "PlusEqualsToken", "MinusEqualsToken", "AsteriskEqualsToken", "AsteriskAsteriskEqualsToken", "SlashEqualsToken", "PercentEqualsToken", "LessThanLessThanEqualsToken", "GreaterThanGreaterThanEqualsToken", "GreaterThanGreaterThanGreaterThanEqualsToken", "AmpersandEqualsToken", "BarEqualsToken", "CaretEqualsToken", "BarBarEqualsToken", "AmpersandAmpersandEqualsToken", "QuestionQuestionEqualsToken"].map((n) => K[n])
  );
  const prepass = (n: TsNode): void => {
    const k = n.kind;
    if (k === K.BinaryExpression && n.left && ASSIGN_OPS.has(n.operatorToken?.kind)) noteTarget(n.left, n.right ?? null);
    else if ((k === K.PrefixUnaryExpression || k === K.PostfixUnaryExpression) && n.operand && (n.operator === K.PlusPlusToken || n.operator === K.MinusMinusToken)) noteTarget(n.operand, null);
    else if ((k === K.ForOfStatement || k === K.ForInStatement) && n.initializer && n.initializer.kind !== K.VariableDeclarationList) noteTarget(n.initializer, null);
    ts.forEachChild(n, prepass);
  };
  for (const sf of program.getSourceFiles()) if (isLocal(sf.fileName)) prepass(sf);

  /** does a root value at `top` flow somewhere the scan does not follow? */
  const isEscape = (top: TsNode): boolean => {
    const p = top.parent;
    if (!p) return false;
    const k = p.kind;
    if (k === K.ExpressionStatement || k === K.TypeOfExpression || k === K.VoidExpression || k === K.DeleteExpression) return false;
    if (k === K.BinaryExpression) {
      const op = p.operatorToken?.kind;
      if (isOp(op, "InstanceOfKeyword", "EqualsEqualsEqualsToken", "ExclamationEqualsEqualsToken", "EqualsEqualsToken", "ExclamationEqualsToken")) return false;
      if (isOp(op, "InKeyword") && p.right === top) return false;
      if (isOp(op, "EqualsToken") && p.left === top) return false; // assigned to, not read
      return true;
    }
    if (k === K.VariableDeclaration && p.initializer === top) {
      // a binding that forwards the root follows it to every read
      const leaves: TsNode[] = [];
      const collect = (n: TsNode | undefined): void => {
        if (!n) return;
        if (n.kind === K.Identifier) leaves.push(n.parent);
        else for (const el of n.elements ?? []) if (el.kind === K.BindingElement) collect(el.name);
      };
      collect(p.name);
      return leaves.some((d) => aliasOf(d)?.kind !== "root");
    }
    return true;
  };

  for (const file of o.files) {
    const sf = program.getSourceFile(join(root, file));
    if (!sf) continue;
    stats.files += 1;
    const spans = spansOf(sf);
    const parsed = (sf.parseDiagnostics ?? []).length === 0;
    const scanOf = (span: IdentitySpan): IdentityScan | null => {
      const id = present(span.id);
      if (!id) return null;
      if (id !== span.id) stats.relocated += 1;
      let s = identities.get(id);
      if (!s) {
        s = { id, effectsIncomplete: [], callsIncomplete: [] };
        identities.set(id, s);
      }
      return s;
    };
    for (const sp of spans) scanOf(sp);
    const fileScan = identities.get(present(spans[0]?.id ?? "") ?? "");
    if (!parsed) {
      stats.unparsed += 1;
      fileScan?.effectsIncomplete.push("unparsed");
      fileScan?.callsIncomplete.push("unparsed");
      continue;
    }
    const at = (n: TsNode): { span: IdentitySpan; scan: IdentityScan } | null => {
      const span = enclosingIdentity(spans, n.getStart(sf));
      const scan = scanOf(span);
      return scan ? { span, scan } : null;
    };
    const addEffect = (n: TsNode, verb: string, resource: string): void => {
      if (!wantEffects || !reportable(resource)) return;
      const w = at(n);
      if (!w) return;
      stats.effectSites += 1;
      const fact: Fact = { type: "effect", at: w.scan.id, verb, resource };
      const k = `${w.scan.id}\u0000${verb}\u0000${resource}`;
      const e = effects.get(k);
      if (e) e.n += 1;
      else effects.set(k, { fact, n: 1 });
    };
    const incomplete = (n: TsNode, family: "effects" | "calls", why: string): void => {
      const w = at(n);
      if (!w) return;
      const list = family === "effects" ? w.scan.effectsIncomplete : w.scan.callsIncomplete;
      if (!list.includes(why)) list.push(why);
    };
    const addCall = (n: TsNode, to: string, ref: boolean): void => {
      if (!o.calls) return;
      const w = at(n);
      if (!w || w.scan.id === to) return;
      if (ref) stats.callbackRefs += 1;
      else stats.callSites += 1;
      const k = `${w.scan.id}\u0000${to}`;
      const e = calls.get(k);
      if (e) e.n += 1;
      else calls.set(k, { fact: { type: "call", at: w.scan.id, to }, n: 1 });
    };
    /** may this value be called? (untyped values may) */
    const isCallable = (n: TsNode): boolean => {
      const t = checker.getTypeAtLocation(n);
      if (t.flags & (ts.TypeFlags.Any as number)) return true;
      return checker.getSignaturesOfType(t, 0).length > 0 || checker.getSignaturesOfType(t, 1).length > 0;
    };

    /** one occurrence of a root: `head` and the static member chain above it (A.5.2 classification) */
    const onChain = (head: TsNode, root0: Root, prefix: string[]): void => {
      // climb property and static element accesses and type wrappers
      let top = head;
      const names = [...prefix];
      let element = false;
      for (;;) {
        const p = top.parent;
        if (!p) break;
        if (p.kind === K.PropertyAccessExpression && p.expression === top) names.push(p.name?.text ?? "");
        else if (p.kind === K.ElementAccessExpression && p.expression === top) {
          const key = literalKey(p.argumentExpression);
          if (key === null) {
            element = true;
            break;
          }
          names.push(key);
        } else if (!isWrapper(p)) break;
        top = p;
      }
      // the last name is a member access at this site (not part of a forwarded binding's chain)
      const lastClimbed = names.length > prefix.length;
      const { root: r, chain } = normalise(root0, names);
      const callNode = calleeOf(top);
      const args = callNode?.arguments ?? [];
      const tagged = callNode !== null && callNode.kind === K.TaggedTemplateExpression;
      const cctx = {
        call: callNode !== null && callNode.kind !== K.NewExpression,
        isNew: callNode !== null && callNode.kind === K.NewExpression,
        argc: tagged ? 1 + (callNode.template?.templateSpans?.length ?? 0) : args.length,
        spread: args.some((x) => x.kind === K.SpreadElement)
      };
      const g = r.global;
      if (g === "eval" || g === "Function") {
        incomplete(head, "effects", "dynamic:eval");
        incomplete(head, "calls", "dynamic:eval");
        return;
      }
      // a constructor reached from a root (`Date.now.constructor` is Function): dynamic code
      if (chain.includes("constructor")) {
        incomplete(head, "effects", "dynamic:constructor");
        incomplete(head, "calls", "dynamic:constructor");
        return;
      }
      if (g === "require" && chain.length === 0 && callNode && cctx.call) {
        const spec = moduleArg(args[0]);
        if (spec === null) incomplete(head, "effects", "dynamic:require");
        else if (spec !== "local") onChain(callNode, { module: spec }, []);
        return;
      }
      // the longest classified prefix of the chain
      let hit: { api: string; cls: ApiClass } | null = null;
      for (let n = chain.length; n >= 0 && !hit; n -= 1) {
        const called = n === chain.length;
        hit = classifyApi(r, chain.slice(0, n), called ? cctx : NO_CALL);
      }
      if (hit) {
        addEffect(head, hit.cls.verb, `ts.call(${JSON.stringify(hit.api)})`);
        return;
      }
      if (element) {
        // a dynamic member of a root can be any of its APIs
        if (g === undefined ? wantEffects : isApiRoot(g) && rootWatched(g)) incomplete(head, "effects", `dynamic:${g ?? r.module}[]`);
        return;
      }
      if (g !== undefined) {
        if (g === "Date" && chain.length === 0 && cctx.isNew && cctx.spread) incomplete(head, "effects", "dynamic:new Date(...)");
        // Function.prototype on the root itself: `Date.call(null)` and `Date.apply(x, [])` call Date
        // (a member invocation keeps the receiver); `Date.bind(…)`, `Date.valueOf()`, `Date.call` as
        // a value or `Date.call.call(…)` hand Date on under another name (a supply)
        if (chain.length > 0 && REFLECTIVE.has(chain[0] as string) && watchedRoot(r)) {
          if (chain.length === 1 && INVOKERS.has(chain[0] as string) && lastClimbed && callNode?.kind === K.CallExpression) {
            const inv = classifyApi(r, [], invokedCtx(chain[0] as string, args));
            if (inv) addEffect(head, inv.cls.verb, `ts.call(${JSON.stringify(inv.api)})`);
          } else incomplete(head, "effects", supplyReason(r));
          return;
        }
        // a bare API root handed on (aliasing, injection) can hide any of its members
        if (chain.length === 0 && !callNode && watchedRoot(r) && isEscape(top)) incomplete(head, "effects", supplyReason(r));
        return;
      }
      // a module: opaque external callees make the entry incomplete when called or handed on
      const spec = r.module.replace(/^node:/, "");
      if (!wantEffects) return;
      if (callNode) {
        if (!PURE_MODULES.has(spec)) {
          incomplete(head, "effects", `external:${spec}`);
          stats.externalCalls += 1;
        }
        return;
      }
      if (!isEscape(top)) return;
      if (chain.length === 0) {
        if (watchedRoot(r)) incomplete(head, "effects", supplyReason(r));
      } else if (!CLASSIFIED_MODULES.has(spec) && !PURE_MODULES.has(spec) && isCallable(top)) incomplete(head, "effects", `external:${spec}`);
    };

    const onIdentifier = (id: TsNode): void => {
      const p0 = id.parent;
      if (p0?.kind === K.PropertyAccessExpression && p0.name === id) return;
      // `{ Date }` reads Date
      const shorthand = p0?.kind === K.ShorthandPropertyAssignment && p0.name === id;
      if (!shorthand && (isDeclName(id) || isTypePosition(id))) return;
      const sym = shorthand ? checker.getShorthandAssignmentValueSymbol(p0) : checker.getSymbolAtLocation(id);
      const base = identBase(id, sym);
      if (base?.kind === "root") {
        onChain(id, base.root, base.chain);
        return;
      }
      // reading a binding that may hold a root is reading the root (unless it holds a classified
      // API's value, reported where it was read; an external member matters only if callable)
      if (base?.kind === "may" && watchedRoot(base.root) && !classifiedChain(base.root, base.chain)) {
        const opaqueValue = base.root.module !== undefined && !CLASSIFIED_MODULES.has(base.root.module.replace(/^node:/, "")) && base.chain.length > 0;
        if (!opaqueValue || isCallable(id)) incomplete(id, "effects", supplyReason(base.root));
      }
      // repo-local values: calls and callbacks
      if (!o.calls || shorthand) return;
      let top = id;
      let member = false;
      for (;;) {
        const p = top.parent;
        if (p && (p.kind === K.PropertyAccessExpression || p.kind === K.ElementAccessExpression) && p.expression === top) member = true;
        else if (!p || (p.kind !== K.NonNullExpression && p.kind !== K.ParenthesizedExpression)) break;
        if (member) break;
        top = p;
      }
      if (member) return; // member chains resolve through their property names
      const parent = top.parent;
      const callNode = calleeOf(top);
      const isCall = callNode !== null && callNode.kind !== K.NewExpression;
      for (const d of resolveSym(sym)?.declarations ?? []) {
        if (d.kind === K.Parameter || d.kind === K.BindingElement || (d.kind === K.VariableDeclaration && !isModuleScopeVar(d))) {
          if (isCall) {
            incomplete(id, "calls", "unresolved:callback-or-local");
            stats.unresolvedCalls += 1;
          }
          continue;
        }
        const to = calleeIdentity(d);
        if (!to) continue;
        if (callNode) addCall(id, to, false);
        else if (parent && (parent.kind === K.CallExpression || parent.kind === K.NewExpression) && (parent.arguments ?? []).includes(top)) addCall(id, to, true);
      }
    };
    const isModuleScopeVar = (d: TsNode): boolean => d.kind === K.VariableDeclaration && d.parent?.kind === K.VariableDeclarationList && d.parent.parent?.kind === K.VariableStatement && d.parent.parent.parent?.kind === K.SourceFile;

    const onPropertyAccess = (pa: TsNode): void => {
      if (!pa.name || (!o.calls && !wantEffects)) return;
      const callee = calleeOf(pa) !== null;
      const asArg = pa.parent && (pa.parent.kind === K.CallExpression || pa.parent.kind === K.NewExpression) && (pa.parent.arguments ?? []).includes(pa);
      const sym = resolveSym(checker.getSymbolAtLocation(pa.name));
      const decls = sym?.declarations ?? [];
      let local = false;
      for (const d of decls) {
        const to = calleeIdentity(d);
        if (!to) continue;
        local = true;
        if (callee) addCall(pa, to, false);
        else if (asArg) addCall(pa, to, true);
      }
      if (local || !callee) return;
      if (decls.length === 0) {
        // a call on an untyped receiver can reach anything; a callee that is an exact chain to a
        // governed root is classified by onChain (`global.Date.now()` without Node's types), but a
        // member of the global object that is no known root (`(globalThis as any).myDate()`,
        // `globalThis.myClock.now()`) is as untyped as any other value
        const recv = pa.expression as TsNode;
        const b = chainBase(pa);
        if (b?.kind === "root" && governed(b)) return;
        const ty = checker.getTypeAtLocation(recv);
        if (ty.flags & (ts.TypeFlags.Any as number)) {
          if (o.calls) {
            incomplete(pa, "calls", "unresolved:untyped-receiver");
            stats.unresolvedCalls += 1;
          }
          if (wantEffects) incomplete(pa, "effects", "unresolved:untyped-receiver");
        }
      } else if (o.calls && decls.some((d) => isLocal(d.getSourceFile().fileName) && (d.kind === K.MethodSignature || d.kind === K.PropertySignature || d.kind === K.PropertyDeclaration || d.kind === K.PropertyAssignment))) {
        incomplete(pa, "calls", "unresolved:interface-or-field");
        stats.unresolvedCalls += 1;
      }
    };

    /** `x.constructor` / `x["constructor"]` off a root chain: a Date instance's constructor is Date,
     *  a function's is Function (dynamic code), an untyped value's can be either */
    const onConstructorAccess = (m: TsNode): void => {
      if (!wantEffects && !o.calls) return;
      const recv = m.expression as TsNode;
      if (handledChain(recv)) return; // root chains and bindings that may hold one: onChain, onIdentifier
      const t = checker.getTypeAtLocation(recv);
      if (t.flags & (ts.TypeFlags.Any as number)) {
        if (wantEffects) incomplete(m, "effects", "unresolved:untyped-receiver");
        return;
      }
      const parts = t.types ?? [t];
      if (parts.some((x) => x.symbol?.name === "Date" && (x.symbol.declarations ?? []).length > 0 && (x.symbol.declarations ?? []).every((d) => !isLocalDecl(d)))) {
        onChain(m, { global: "Date" }, []);
        return;
      }
      if (parts.some((x) => checker.getSignaturesOfType(x, 0).length > 0 || checker.getSignaturesOfType(x, 1).length > 0)) {
        incomplete(m, "effects", "dynamic:constructor");
        incomplete(m, "calls", "dynamic:constructor");
      }
    };

    const typeOf = (n: TsNode): TsType => {
      const t = checker.getTypeAtLocation(n);
      return t.flags & (ts.TypeFlags.TypeParameter as number) ? (checker.getBaseConstraintOfType(t) ?? t) : t;
    };
    const isAny = (t: TsType): boolean => (t.flags & (ts.TypeFlags.Any as number)) !== 0;
    /** is t (or a member of the union t) the root type r or a subtype of it? Nominal on purpose: a
     *  structural type the root merely fits (`{ now(): number }`) is a shadow, a mock or an injected
     *  clock; the root's supply is flagged where it escapes (A.5.2.1). */
    const holdsRoot = (t: TsType, r: TsType): boolean =>
      (t.flags & (ts.TypeFlags.Union as number) ? (t.types ?? []) : [t]).some((c) => (c.flags & (ts.TypeFlags.Never as number)) === 0 && checker.isTypeAssignableTo(c, r));
    /** A static read of a watched member (`x.now`, `x["hrtime"]`, `x.Date` when Date is watched as a
     *  call) on a receiver that is no root chain but is typed as the root (`d: DateConstructor`,
     *  `getG(): typeof globalThis`, a field `clock = Date`) or reads the root's own member (`class F
     *  extends Date {}; F.now()`): the root arrived through a parameter, a return or shared state
     *  the scan does not follow, so the reading entry is incomplete. A dynamic member's value is
     *  typed by the receiver's index signature: it reaches an API only through a later static read
     *  (checked here) or a call. */
    const onTypedMember = (m: TsNode): void => {
      if (rootTypes.size === 0) return;
      const recv = m.expression as TsNode;
      const up = m.parent;
      if (up?.kind === K.BinaryExpression && up.left === m && isOp(up.operatorToken?.kind, "EqualsToken")) return; // written, not read
      if (chainBase(recv) !== null) return; // root chains: onChain; bindings that may hold one: onIdentifier
      const key = m.kind === K.PropertyAccessExpression ? (m.name?.text ?? null) : literalKey(m.argumentExpression);
      // an element of an untyped value, called, can be any API (as a called member: onPropertyAccess)
      if (m.kind === K.ElementAccessExpression && up && (up.kind === K.CallExpression || up.kind === K.NewExpression) && up.expression === m && isAny(typeOf(recv))) {
        incomplete(m, "effects", "unresolved:untyped-receiver");
        return;
      }
      if (key === null) return;
      const cands = [...rootTypes.keys()].filter((g) => memberWatched(g, key));
      if (cands.length === 0) return;
      const t = typeOf(recv);
      if (isAny(t)) {
        incomplete(m, "effects", "unresolved:untyped-receiver");
        return;
      }
      const accessed = checker.getSymbolAtLocation((m.kind === K.PropertyAccessExpression ? m.name : m.argumentExpression) as TsNode);
      for (const g of cands) {
        const r = rootTypes.get(g) as TsType;
        const own = (checker.getPropertyOfType(r, key)?.declarations ?? []).some((d) => (accessed?.declarations ?? []).includes(d));
        if (own || holdsRoot(t, r)) {
          incomplete(m, "effects", `alias-type:${g}`);
          return;
        }
      }
    };
    /** a call or construction of a value typed as a watched callable root (`D: DateConstructor`,
     *  `new D()`), or untyped, other than a root chain */
    const onTypedCallee = (n: TsNode): void => {
      const callee = n.expression;
      if (!callee || callee.kind === K.ImportKeyword || callee.kind === K.SuperKeyword || rootTypes.size === 0) return;
      const args = n.arguments ?? [];
      const spread = args.some((x) => x.kind === K.SpreadElement);
      // Date reads the clock as Date() and new Date() (or new Date(...xs))
      const cands = [...rootTypes.keys()].filter((g) => callWatched(g) && !(g === "Date" && n.kind === K.NewExpression && args.length > 0 && !spread));
      if (cands.length === 0 || chainBase(callee) !== null) return;
      const u = unwrap(callee);
      if (u.kind === K.PropertyAccessExpression || u.kind === K.ElementAccessExpression) return; // member callees: onTypedMember, onPropertyAccess
      const t = typeOf(callee);
      if (isAny(t)) {
        incomplete(n, "effects", "unresolved:untyped-callee");
        return;
      }
      const g = cands.find((x) => holdsRoot(t, rootTypes.get(x) as TsType));
      if (g !== undefined) incomplete(n, "effects", `alias-type:${g}`);
    };

    const onImportCall = (n: TsNode): void => {
      const spec = moduleArg(n.arguments?.[0]);
      if (spec === null) {
        incomplete(n, "effects", "dynamic:import");
        incomplete(n, "calls", "dynamic:import");
        return;
      }
      if (spec === "local") return;
      let up = n.parent;
      while (up && isWrapper(up)) up = up.parent;
      // `await import("m")` is the module itself; a bare promise hands it to callbacks (a supply)
      if (up?.kind === K.AwaitExpression) onChain(up, { module: spec }, []);
      else if (watchedRoot({ module: spec })) incomplete(n, "effects", supplyReason({ module: spec }));
    };

    const onLiteral = (n: TsNode): void => {
      if (!wantEffects) return;
      let text: string | null = null;
      let dynamicTable = false;
      if (n.kind === K.StringLiteral || n.kind === K.NoSubstitutionTemplateLiteral) text = n.text ?? null;
      else if (n.kind === K.TemplateExpression) {
        const head = n.head?.text ?? "";
        text = head;
        // the table name itself interpolated: dynamic SQL
        if (/^\s*(?:delete|insert|update|merge|alter|truncate|drop|select|with)\b/i.test(head) && /\b(?:from|into|update|table|exists|only)\s*$/i.test(head)) dynamicTable = true;
      }
      if (text === null) return;
      if (dynamicTable) {
        if (o.channels.some((p) => p.startsWith("pg.table("))) incomplete(n, "effects", "dynamic:sql");
        return;
      }
      const s = sqlEffect(text);
      if (s) addEffect(n, s.verb, s.table);
    };

    const walk = (n: TsNode): void => {
      const k = n.kind;
      if (k === K.InterfaceDeclaration || k === K.TypeAliasDeclaration || k === K.ImportDeclaration || k === K.ImportEqualsDeclaration) return;
      if (k === K.Identifier) onIdentifier(n);
      else if (k === K.PropertyAccessExpression) {
        onPropertyAccess(n);
        if (n.name?.text === "constructor") onConstructorAccess(n);
        else onTypedMember(n);
      } else if (k === K.ElementAccessExpression) {
        if (literalKey(n.argumentExpression) === "constructor") onConstructorAccess(n);
        else onTypedMember(n);
      } else if ((k === K.CallExpression || k === K.NewExpression) && n.expression?.kind !== K.ImportKeyword) onTypedCallee(n);
      else if (k === K.StringLiteral || k === K.NoSubstitutionTemplateLiteral || k === K.TemplateExpression) onLiteral(n);
      else if (k === K.CallExpression && n.expression?.kind === K.ImportKeyword) onImportCall(n);
      ts.forEachChild(n, walk);
    };
    walk(sf);
  }

  // completeness is inherited upward: a parent's entry is complete only if its descendants are
  for (const s of [...identities.values()].sort((a, b) => b.id.length - a.id.length)) {
    const info = o.man.ids.get(s.id);
    const parent = info?.parent ?? null;
    const p = parent ? identities.get(parent) : undefined;
    if (!p) continue;
    if (s.effectsIncomplete.length > 0 && !p.effectsIncomplete.includes(`child:${s.id}`)) p.effectsIncomplete.push(`child:${s.id}`);
    if (s.callsIncomplete.length > 0 && !p.callsIncomplete.includes(`child:${s.id}`)) p.callsIncomplete.push(`child:${s.id}`);
  }
  stats.identities = identities.size;
  stats.ms = Date.now() - t0;
  const withN = (m: Map<string, { fact: Fact; n: number }>): Fact[] =>
    [...m.values()]
      .map(({ fact, n }) => (n > 1 ? { ...fact, n } : fact))
      .sort((a, b) => cmpStr(JSON.stringify(a), JSON.stringify(b)));
  for (const s of identities.values()) {
    s.effectsIncomplete.sort(cmpStr);
    s.callsIncomplete.sort(cmpStr);
  }
  return { identities, effects: withN(effects), calls: withN(calls), stats };
}
