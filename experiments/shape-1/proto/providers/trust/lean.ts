// Lean 4 code identities, trust markers and `#print axioms` assumptions (a registry entry the core
// manifest builder lacks). Identities: lean:<path>#<Full.Name> per named theorem, lemma, def,
// abbrev, instance, axiom, opaque, structure, inductive and class, with namespaces applied
// (_root_. stripped). Markers, never in comments or strings: sorry, admit, native_decide, axiom
// (the declaration itself), implemented_by, extern, unsafe. Files defining macros, notations or
// elaborators are not hatch-complete: an expansion can hide a sorry, which only `#print axioms`
// sees. Schemes lean.{file,own,unit}.syn1 hash comment-free, whitespace-collapsed text;
// lean.closure.syn1 hashes a declaration's statement plus the definitions it names, transitively
// (a name-based bracket like verus.closure.syn1), so hosted Lean statements have a closure.
import { type FpIdentity, codeDigest, encodePath } from "../../src/fingerprint/common.ts";
import { cmpStr, sortedUniq } from "../../src/util.ts";

export interface LeanDecl {
  kind: string;
  /** full name, namespaces applied */
  name: string;
  start: number;
  end: number;
  /** end of the statement (first top-level `:=` or `where`), for closures */
  sigEnd: number;
  markers: Record<string, number>;
}

export interface LeanScan {
  path: string;
  /** comments blanked (offsets preserved) */
  code: string;
  /** comments and string/char literals blanked */
  bare: string;
  decls: LeanDecl[];
  hatchComplete: boolean;
}

/** Blanks comments (and optionally literals) with spaces, keeping offsets and newlines. */
export function blankLean(text: string, literals: boolean): string {
  const out = text.split("");
  const blank = (a: number, b: number): void => {
    for (let k = a; k < b; k += 1) if (out[k] !== "\n") out[k] = " ";
  };
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === "-" && text[i + 1] === "-") {
      const e = text.indexOf("\n", i);
      const end = e < 0 ? n : e;
      blank(i, end);
      i = end;
      continue;
    }
    if (c === "/" && text[i + 1] === "-") {
      let depth = 0;
      const s = i;
      while (i < n) {
        if (text[i] === "/" && text[i + 1] === "-") {
          depth += 1;
          i += 2;
        } else if (text[i] === "-" && text[i + 1] === "/") {
          depth -= 1;
          i += 2;
          if (depth === 0) break;
        } else i += 1;
      }
      blank(s, i);
      continue;
    }
    if (c === '"') {
      const s = i;
      i += 1;
      while (i < n && text[i] !== '"') i += text[i] === "\\" ? 2 : 1;
      i += 1;
      if (literals) blank(s + 1, i - 1);
      continue;
    }
    if (c === "'" && !/[\w'.]/.test(text[i - 1] ?? " ")) {
      const m = /^'(?:\\.|[^\\'\n])'/.exec(text.slice(i, i + 5));
      if (m) {
        if (literals) blank(i + 1, i + m[0].length - 1);
        i += m[0].length;
        continue;
      }
    }
    i += 1;
  }
  return out.join("");
}

const DECL_KINDS = new Set(["theorem", "lemma", "def", "abbrev", "instance", "axiom", "opaque", "structure", "inductive", "class"]);
const MODIFIERS = new Set(["private", "protected", "noncomputable", "partial", "unsafe", "nonrec", "scoped", "local"]);
const ITEM_MACROS = new Set(["macro", "macro_rules", "elab", "elab_rules", "syntax", "notation", "infix", "infixl", "infixr", "prefix", "postfix", "initialize", "builtin_initialize"]);
const COMMANDS = new Set([
  ...DECL_KINDS,
  ...ITEM_MACROS,
  "example",
  "namespace",
  "section",
  "end",
  "open",
  "variable",
  "universe",
  "set_option",
  "attribute",
  "mutual",
  "import",
  "export",
  "#print",
  "#eval",
  "#check",
  "#reduce",
  "#exit",
  "module",
  "public"
]);

const NAME_RE = /^(?:«[^»]+»|[A-Za-z_][\w'!?]*)(?:\.(?:«[^»]+»|[A-Za-z_][\w'!?]*))*/;

interface LineHead {
  start: number;
  /** offset after attributes and modifiers */
  body: number;
  word: string;
  attrs: string;
  modifiers: string[];
}

function lineHeads(bare: string): LineHead[] {
  const heads: LineHead[] = [];
  let off = 0;
  for (const line of bare.split("\n")) {
    const start = off;
    off += line.length + 1;
    if (line.length === 0 || /^\s/.test(line)) continue;
    let rest = line;
    let consumed = 0;
    let attrs = "";
    const modifiers: string[] = [];
    for (;;) {
      const a = /^@\[[^\]]*\]\s*/.exec(rest);
      if (a) {
        attrs += a[0];
        rest = rest.slice(a[0].length);
        consumed += a[0].length;
        continue;
      }
      const m = /^([a-z_]+)\s+/.exec(rest);
      if (m && MODIFIERS.has(m[1] as string)) {
        modifiers.push(m[1] as string);
        rest = rest.slice(m[0].length);
        consumed += m[0].length;
        continue;
      }
      break;
    }
    const w = /^#?[A-Za-z_]+/.exec(rest);
    heads.push({ start, body: start + consumed, word: w ? w[0] : rest.slice(0, 1), attrs, modifiers });
  }
  return heads;
}

export function scanLean(path: string, text: string): LeanScan {
  const code = blankLean(text, false);
  const bare = blankLean(text, true);
  const heads = lineHeads(bare);
  const decls: LeanDecl[] = [];
  const scopes: { kind: "namespace" | "section" | "mutual"; name: string }[] = [];
  let hatchComplete = true;
  const prefix = (): string =>
    scopes
      .filter((s) => s.kind === "namespace")
      .map((s) => s.name)
      .join(".");
  // boundaries: column-0 command lines (attribute-only lines attach to the next command)
  const bounds: LineHead[] = [];
  let pendingAttr: LineHead | null = null;
  for (const h of heads) {
    if (h.word === "" || h.word === "|" || h.word === ")" || h.word === "]" || h.word === "}") continue;
    const isAttrOnly = h.attrs !== "" && bare.slice(h.body, bare.indexOf("\n", h.body) < 0 ? bare.length : bare.indexOf("\n", h.body)).trim() === "";
    if (isAttrOnly) {
      pendingAttr = pendingAttr ?? h;
      continue;
    }
    if (!COMMANDS.has(h.word) && h.modifiers.length === 0 && h.attrs === "") continue;
    bounds.push(pendingAttr ? { ...h, start: pendingAttr.start, attrs: pendingAttr.attrs + h.attrs } : h);
    pendingAttr = null;
  }
  for (let k = 0; k < bounds.length; k += 1) {
    const h = bounds[k] as LineHead;
    const next = bounds[k + 1];
    let end = next ? next.start : text.length;
    while (end > h.start && /\s/.test(text[end - 1] as string)) end -= 1;
    const after = bare.slice(h.body + h.word.length);
    if (h.word === "namespace") {
      const m = NAME_RE.exec(after.trimStart());
      if (m) for (const part of m[0].split(".")) scopes.push({ kind: "namespace", name: part });
      continue;
    }
    if (h.word === "section") {
      const m = NAME_RE.exec(after.trimStart());
      scopes.push({ kind: "section", name: m ? m[0] : "" });
      continue;
    }
    if (h.word === "mutual") {
      scopes.push({ kind: "mutual", name: "" });
      continue;
    }
    if (h.word === "end") {
      const m = NAME_RE.exec(after.trimStart());
      if (m) {
        // `end A.B` closes as many namespace parts
        for (let p = m[0].split(".").length; p > 0 && scopes.length > 0; p -= 1) scopes.pop();
      } else if (scopes.length > 0) scopes.pop();
      continue;
    }
    if (ITEM_MACROS.has(h.word)) {
      hatchComplete = false;
      continue;
    }
    if (!DECL_KINDS.has(h.word)) continue;
    let rest = after.trimStart();
    if (h.word === "instance") rest = rest.replace(/^\(priority\s*:=\s*[^)]*\)\s*/, "");
    const m = NAME_RE.exec(rest);
    if (!m || (h.word === "instance" && /^(?:where|:)/.test(rest))) continue;
    let name = m[0].replace(/[«»]/g, "");
    if (name.startsWith("_root_.")) name = name.slice(7);
    else if (prefix()) name = `${prefix()}.${name}`;
    const span = bare.slice(h.start, end);
    const markers: Record<string, number> = {};
    const count = (re: RegExp, key: string): void => {
      const c = (span.match(re) ?? []).length;
      if (c > 0) markers[key] = (markers[key] ?? 0) + c;
    };
    count(/(?<![\w'.])sorry(?![\w'!?])/g, "sorry");
    count(/(?<![\w'.])admit(?![\w'!?])/g, "admit");
    count(/(?<![\w'.])native_decide(?![\w'!?])/g, "native_decide");
    count(/(?<![\w'.])implemented_by(?![\w'!?])/g, "implemented_by");
    count(/@\[[^\]]*(?<![\w'.])extern(?![\w'!?])/g, "extern");
    if (h.word === "axiom") markers.axiom = (markers.axiom ?? 0) + 1;
    if (h.modifiers.includes("unsafe")) markers.unsafe = (markers.unsafe ?? 0) + 1;
    // statement end: the first `:=` or `where` at bracket depth 0, else the first `|` line
    let depth = 0;
    let sigEnd = end;
    for (let i = h.body; i < end; i += 1) {
      const c = bare[i] as string;
      if (c === "(" || c === "[" || c === "{" || c === "⟨") depth += 1;
      else if (c === ")" || c === "]" || c === "}" || c === "⟩") depth -= 1;
      else if (depth <= 0 && c === ":" && bare[i + 1] === "=") {
        sigEnd = i;
        break;
      } else if (depth <= 0 && /\swhere\b/.test(bare.slice(i, i + 7)) && i > h.body) {
        sigEnd = i;
        break;
      } else if (c === "\n" && /^\s*\|/.test(bare.slice(i + 1, i + 40))) {
        sigEnd = i;
        break;
      }
    }
    decls.push({ kind: h.word, name, start: h.start, end, sigEnd, markers: Object.fromEntries(Object.entries(markers).sort((a, b) => cmpStr(a[0], b[0]))) });
  }
  return { path, code, bare, decls, hatchComplete };
}

function squash(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

const IDENT_RE = /(?<![\w'.])[A-Za-z_][\w'!?]*(?:\.[A-Za-z_][\w'!?]*)*/g;

export interface LeanProject {
  scans: LeanScan[];
  byName: Map<string, { scan: LeanScan; decl: LeanDecl }>;
  /** full name → identity id */
  identity: Map<string, string>;
  /** last name segment → full names */
  byLast: Map<string, string[]>;
  /** memoised references per declaration */
  refs: Map<string, string[]>;
}

function encodeLeanSymbol(name: string): string {
  return name
    .split(".")
    .map((s) => s.replace(/%/g, "%25").replace(/#/g, "%23"))
    .join(".");
}

export function leanProject(scans: LeanScan[]): LeanProject {
  const byName = new Map<string, { scan: LeanScan; decl: LeanDecl }>();
  const identity = new Map<string, string>();
  const byLast = new Map<string, string[]>();
  for (const s of scans) {
    for (const d of s.decls) {
      if (!byName.has(d.name)) {
        byName.set(d.name, { scan: s, decl: d });
        const last = d.name.split(".").pop() ?? d.name;
        byLast.set(last, [...(byLast.get(last) ?? []), d.name]);
      }
      identity.set(d.name, `lean:${encodePath(s.path)}#${encodeLeanSymbol(d.name)}`);
    }
  }
  return { scans, byName, identity, byLast, refs: new Map() };
}

/** Declarations a text names: exact full names, else suffix matches either way (deterministic). */
export function referencedNames(p: LeanProject, text: string, self: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(IDENT_RE)) {
    const t = m[0];
    if (t === self) continue;
    if (p.byName.has(t)) {
      out.add(t);
      continue;
    }
    // n.endsWith("." + t): a qualified declaration named by a short reference
    for (const n of p.byLast.get(t.split(".").pop() ?? t) ?? []) if (n !== self && n.endsWith(`.${t}`)) out.add(n);
    // t.endsWith("." + n): a reference more qualified than the declaration (opened namespaces)
    const segs = t.split(".");
    for (let k = 1; k < segs.length; k += 1) {
      const suf = segs.slice(k).join(".");
      if (suf !== self && p.byName.has(suf)) out.add(suf);
    }
  }
  return [...out].sort(cmpStr);
}

function declRefs(p: LeanProject, n: string): string[] {
  const hit = p.refs.get(n);
  if (hit) return hit;
  const e = p.byName.get(n);
  const r = e ? referencedNames(p, e.scan.bare.slice(e.decl.start, e.decl.end), n) : [];
  p.refs.set(n, r);
  return r;
}

const DEF_KINDS = new Set(["def", "abbrev", "instance", "axiom", "opaque", "structure", "inductive", "class"]);

/** Transitive closure of names from a start text, following only `follow` kinds. */
export function nameCone(p: LeanProject, start: string, startText: string, follow: (kind: string) => boolean): string[] {
  const seen = new Set<string>();
  const stack = referencedNames(p, startText, start);
  while (stack.length > 0) {
    const n = stack.pop() as string;
    if (seen.has(n) || n === start) continue;
    const e = p.byName.get(n);
    if (!e) continue;
    seen.add(n);
    if (!follow(e.decl.kind)) continue;
    for (const r of declRefs(p, n)) if (!seen.has(r)) stack.push(r);
  }
  return [...seen].sort(cmpStr);
}

/** FpIdentities for every scanned Lean file of a project (closures span files). */
export function leanIdentities(p: LeanProject): FpIdentity[] {
  const out: FpIdentity[] = [];
  for (const s of p.scans) {
    const fileId = `lean:${encodePath(s.path)}`;
    const declCanon = (d: LeanDecl): string => squash(s.code.slice(d.start, d.end));
    let own = "";
    let cur = 0;
    for (const d of [...s.decls].sort((a, b) => a.start - b.start)) {
      own += `${s.code.slice(cur, d.start)} ⟨${d.name}⟩ `;
      cur = d.end;
    }
    own += s.code.slice(cur);
    out.push({
      id: fileId,
      kind: "file",
      parent: null,
      digests: [
        { projection: "file", scheme: "lean.file.syn1", digest: codeDigest("lean.file.syn1", squash(s.code)) },
        { projection: "own", scheme: "lean.own.syn1", digest: codeDigest("lean.own.syn1", squash(own)) }
      ],
      markers: {},
      hatchComplete: s.hatchComplete,
      executable: true
    });
    const bySym = new Map<string, LeanDecl[]>();
    for (const d of s.decls) bySym.set(d.name, [...(bySym.get(d.name) ?? []), d]);
    for (const [name, list] of [...bySym.entries()].sort((a, b) => cmpStr(a[0], b[0]))) {
      const d = list[0] as LeanDecl;
      const unit = list.map(declCanon).join("\n");
      const segs = name.split(".");
      let parent = fileId;
      for (let k = segs.length - 1; k > 0; k -= 1) {
        const pre = segs.slice(0, k).join(".");
        if (bySym.has(pre)) {
          parent = `${fileId}#${encodeLeanSymbol(pre)}`;
          break;
        }
      }
      const sig = squash(s.code.slice(d.start, d.sigEnd));
      const cone = nameCone(p, name, s.bare.slice(d.start, d.sigEnd), (k) => DEF_KINDS.has(k));
      const closure = [
        sig,
        "--closure--",
        ...cone.map((n) => {
          const e = p.byName.get(n);
          return e ? `${n}=${squash(e.scan.code.slice(e.decl.start, e.decl.end))}` : n;
        })
      ].join("\n");
      const markers: Record<string, number> = {};
      for (const x of list) for (const [k, n] of Object.entries(x.markers)) markers[k] = (markers[k] ?? 0) + n;
      out.push({
        id: `${fileId}#${encodeLeanSymbol(name)}`,
        kind: d.kind,
        parent,
        digests: [
          { projection: "own", scheme: "lean.own.syn1", digest: codeDigest("lean.own.syn1", unit) },
          { projection: "unit", scheme: "lean.unit.syn1", digest: codeDigest("lean.unit.syn1", unit) },
          { projection: "closure", scheme: "lean.closure.syn1", digest: codeDigest("lean.closure.syn1", closure) }
        ],
        markers: Object.fromEntries(Object.entries(markers).sort((a, b) => cmpStr(a[0], b[0]))),
        hatchComplete: s.hatchComplete,
        executable: true,
        ...(list.length > 1 ? { merged: list.length } : {})
      });
    }
  }
  return out.sort((a, b) => cmpStr(a.id, b.id));
}

// ---- #print axioms ------------------------------------------------------------------------------------

/** Parses `#print axioms` output: theorem → axioms (sorted). */
export function parsePrintAxioms(out: string): Map<string, string[]> {
  const res = new Map<string, string[]>();
  const flat = out.replace(/\[\s*([^\]]*?)\s*\]/gs, (_m, inner: string) => `[${inner.replace(/\s+/g, " ")}]`);
  for (const line of flat.split("\n")) {
    const dep = /^'([^']+)' depends on axioms: \[([^\]]*)\]/.exec(line.trim());
    if (dep) {
      res.set(
        dep[1] as string,
        sortedUniq(
          (dep[2] as string)
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean)
        )
      );
      continue;
    }
    const none = /^'([^']+)' does not depend on any axioms/.exec(line.trim());
    if (none) res.set(none[1] as string, []);
  }
  return res;
}

export const STANDARD_AXIOMS = new Set(["propext", "Quot.sound", "Classical.choice"]);
const SORRY_AXIOMS = new Set(["sorryAx"]);
const COMPILER_AXIOMS = new Set(["Lean.ofReduceBool", "Lean.trustCompiler", "Lean.ofReduceNat"]);

export interface LeanAssumption {
  id: string;
  kind: "hatch" | "named" | "tool";
}

/** A theorem's assumptions from its axioms: the standard axioms are the toolchain's (tool
 *  lean@<v>); sorryAx and the compiler axioms are hatches at the cone identities whose text holds
 *  the marker (else at the theorem itself); user axioms are hatches at their declaration. */
export function leanAssumptions(p: LeanProject, theorem: string, axioms: string[], leanVersion: string): { assumptions: LeanAssumption[]; inherited: string[] } {
  const out = new Map<string, LeanAssumption>();
  const inherited: string[] = [];
  const thmId = p.identity.get(theorem) ?? `lean:?#${theorem}`;
  const e = p.byName.get(theorem);
  const cone = e ? nameCone(p, theorem, e.scan.bare.slice(e.decl.start, e.decl.end), () => true) : [];
  const withMarker = (keys: string[]): string[] =>
    [theorem, ...cone].filter((n) => {
      const d = p.byName.get(n)?.decl;
      return !!d && keys.some((k) => (d.markers[k] ?? 0) > 0);
    });
  for (const a of axioms) {
    if (STANDARD_AXIOMS.has(a)) out.set(`lean@${leanVersion}`, { id: `lean@${leanVersion}`, kind: "tool" });
    else if (SORRY_AXIOMS.has(a) || COMPILER_AXIOMS.has(a)) {
      const kind = SORRY_AXIOMS.has(a) ? "sorry" : "native_decide";
      const keys = kind === "sorry" ? ["sorry", "admit"] : ["native_decide"];
      const at = withMarker(keys);
      if (at.length === 0) out.set(`${thmId}/${kind}`, { id: `${thmId}/${kind}`, kind: "hatch" });
      for (const n of at) {
        const id = p.identity.get(n) as string;
        const k = (p.byName.get(n)?.decl.markers.admit ?? 0) > 0 && kind === "sorry" && !(p.byName.get(n)?.decl.markers.sorry ?? 0) ? "admit" : kind;
        out.set(`${id}/${k}`, { id: `${id}/${k}`, kind: "hatch" });
        if (n !== theorem) inherited.push(n);
      }
    } else {
      const id = p.identity.get(a);
      if (id) out.set(`${id}/axiom`, { id: `${id}/axiom`, kind: "hatch" });
      else out.set(a, { id: a, kind: "named" });
    }
  }
  return { assumptions: [...out.values()].sort((x, y) => cmpStr(x.id, y.id)), inherited: sortedUniq(inherited) };
}
