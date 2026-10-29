// Parser for the Shape 1.0 surface syntax (syntax §2) into shape.source.v1 modules (A.16.2(g)).
// Used by the full input profile (A.16.1): each shape file parses to one module, or fails with
// E-parse (subject: the file's path, A.16.25).
import type {
  Clause,
  ClaimMeta,
  Decl,
  EvidenceSpec,
  NoteKind,
  OrderDir,
  ParamKind,
  RecKind,
  SourceModule,
  SummaryEntry,
  TBody,
  TemplateApp,
  TierPolicySrc,
  UnitDecl
} from "./source.ts";
import type { Tier } from "./util.ts";

type TokKind = "id" | "str" | "int" | "punct";
interface Tok {
  k: TokKind;
  v: string;
  line: number;
}

export class ParseError extends Error {
  constructor(
    message: string,
    readonly line: number
  ) {
    super(message);
  }
}

const PUNCT = ["->", "::", "{", "}", "<", ">", "(", ")", ",", ":", "=", "*", "."];

function lex(text: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  let line = 1;
  const n = text.length;
  while (i < n) {
    const c = text[i] as string;
    if (c === "\n") {
      line += 1;
      i += 1;
      continue;
    }
    if (c === " " || c === "\t" || c === "\r") {
      i += 1;
      continue;
    }
    if (c === "/" && text[i + 1] === "/") {
      while (i < n && text[i] !== "\n") i += 1;
      continue;
    }
    if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      if (end < 0) throw new ParseError("unterminated comment", line);
      for (let j = i; j < end; j += 1) if (text[j] === "\n") line += 1;
      i = end + 2;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      let raw = "";
      while (j < n && text[j] !== '"') {
        if (text[j] === "\\") {
          raw += text.slice(j, j + 2);
          j += 2;
        } else {
          if (text[j] === "\n") throw new ParseError("newline in string", line);
          raw += text[j];
          j += 1;
        }
      }
      if (j >= n) throw new ParseError("unterminated string", line);
      let v: string;
      try {
        v = JSON.parse(`"${raw}"`) as string;
      } catch {
        throw new ParseError("bad string escape", line);
      }
      out.push({ k: "str", v, line });
      i = j + 1;
      continue;
    }
    if (/[0-9]/.test(c) || (c === "-" && /[0-9]/.test(text[i + 1] ?? "") && text[i + 1] !== ">")) {
      let j = i + 1;
      while (j < n && /[0-9]/.test(text[j] as string)) j += 1;
      out.push({ k: "int", v: text.slice(i, j), line });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_]/.test(text[j] as string)) j += 1;
      out.push({ k: "id", v: text.slice(i, j), line });
      i = j;
      continue;
    }
    const p = PUNCT.find((x) => text.startsWith(x, i));
    if (!p) throw new ParseError(`unexpected character ${JSON.stringify(c)}`, line);
    out.push({ k: "punct", v: p, line });
    i += p.length;
  }
  return out;
}

const TIERS: Tier[] = ["low", "normal", "critical", "final"];
const PARAM_KINDS: ParamKind[] = [
  "resource",
  "component",
  "unit",
  "effect",
  "kind",
  "value",
  "code"
];
const NOTE_KINDS: NoteKind[] = ["rationale", "memory", "decision"];
const REC_KINDS: RecKind[] = ["observation", "test", "proof", "judgment", "equivalence"];
const ORDER_DIRS: OrderDir[] = ["leq", "geq", "subset", "superset", "equal"];
const DECL_KEYWORDS = new Set([
  "shape",
  "actor",
  "effect",
  "kind",
  "hatch",
  "resource",
  "component",
  "boundary",
  "relation",
  "rule",
  "law",
  "template",
  "exception",
  "note",
  "provider",
  "policy"
]);

class P {
  i = 0;
  constructor(readonly toks: Tok[]) {}
  peek(o = 0): Tok | undefined {
    return this.toks[this.i + o];
  }
  line(): number {
    return this.peek()?.line ?? this.toks[this.toks.length - 1]?.line ?? 1;
  }
  fail(msg: string): never {
    const t = this.peek();
    throw new ParseError(
      `${msg}${t ? ` at ${JSON.stringify(t.v)}` : " at end of file"}`,
      this.line()
    );
  }
  isId(v?: string, o = 0): boolean {
    const t = this.peek(o);
    return !!t && t.k === "id" && (v === undefined || t.v === v);
  }
  isP(v: string, o = 0): boolean {
    const t = this.peek(o);
    return !!t && t.k === "punct" && t.v === v;
  }
  atEnd(): boolean {
    return this.i >= this.toks.length;
  }
  next(): Tok {
    const t = this.peek();
    if (!t) this.fail("unexpected end of file");
    this.i += 1;
    return t;
  }
  id(v?: string): string {
    if (!this.isId(v)) this.fail(v ? `expected ${v}` : "expected an identifier");
    return this.next().v;
  }
  p(v: string): void {
    if (!this.isP(v)) this.fail(`expected ${v}`);
    this.i += 1;
  }
  str(): string {
    const t = this.peek();
    if (!t || t.k !== "str") this.fail("expected a string");
    this.i += 1;
    return t.v;
  }
  int(): number {
    const t = this.peek();
    if (!t || t.k !== "int") this.fail("expected an integer");
    this.i += 1;
    const n = Number(t.v);
    if (!Number.isSafeInteger(n)) this.fail("integer out of range");
    return n;
  }
  accept(v: string): boolean {
    if (this.isId(v) || this.isP(v)) {
      this.i += 1;
      return true;
    }
    return false;
  }
  /** QName: Id (:: Id)* */
  qname(): string {
    let s = this.id();
    while (this.isP("::")) {
      this.i += 1;
      s += `::${this.id()}`;
    }
    return s;
  }
  /** Ref: QName (. Id)* (a unit is K.u) */
  ref(): string {
    let s = this.qname();
    while (this.isP(".") && this.peek(1)?.k === "id") {
      this.i += 1;
      s += `.${this.id()}`;
    }
    return s;
  }
  /** Id ( String ): identities and source refs */
  call(): string {
    const f = this.id();
    this.p("(");
    const s = this.str();
    this.p(")");
    return `${f}(${JSON.stringify(s)})`;
  }
  /** Id . Id ( String ): resource codes */
  codeRef(): string {
    const tag = this.id();
    this.p(".");
    const kind = this.id();
    this.p("(");
    const s = this.str();
    this.p(")");
    return `${tag}.${kind}(${JSON.stringify(s)})`;
  }
  isCodeRef(): boolean {
    return this.isId() && this.isP(".", 1) && this.peek(2)?.k === "id" && this.isP("(", 3);
  }
  /** Atom: Id < Ref > */
  atom(): string {
    const v = this.id();
    this.p("<");
    const r = this.ref();
    this.p(">");
    return `${v}<${r}>`;
  }
  isAtom(): boolean {
    return this.isId() && this.isP("<", 1);
  }
  commaList<T>(item: () => T): T[] {
    const out = [item()];
    while (this.isP(",")) {
      this.i += 1;
      out.push(item());
    }
    return out;
  }
  tier(): Tier {
    const t = this.id();
    if (!(TIERS as string[]).includes(t)) this.fail("expected a tier");
    return t as Tier;
  }
}

function owner(p: P): string {
  if (p.isId() && p.isP("(", 1)) return p.call();
  return p.ref();
}

function unitSel(p: P): string {
  if (p.accept("*")) return "*";
  if (p.isId("ungoverned")) {
    p.next();
    return "ungoverned";
  }
  if (p.isId("component") || p.isId("unit")) {
    const k = p.next().v;
    return `${k} ${p.ref()}`;
  }
  return p.ref();
}

function nodeSel(p: P): string {
  if (p.accept("*")) return "*";
  if (p.isId("component") || p.isId("resource")) {
    const k = p.next().v;
    return `${k} ${p.ref()}`;
  }
  return p.ref();
}

const TARGET_KINDS = ["unit", "component", "resource", "rule", "law", "relation", "exception"];
function target(p: P): string {
  if (p.isId("code")) {
    p.next();
    return `code ${p.call()}`;
  }
  const k = p.peek();
  if (k?.k === "id" && TARGET_KINDS.includes(k.v) && p.peek(1)?.k === "id") {
    p.next();
    return `${k.v} ${p.ref()}`;
  }
  p.fail("expected a target");
}

function templateApp(p: P): TemplateApp {
  const name = p.qname();
  if (!p.isP("<")) return { name };
  p.p("<");
  const args: (string | number)[] = [];
  if (!p.isP(">")) {
    const arg = (): string | number => {
      const t = p.peek();
      if (t?.k === "str") return p.str();
      if (t?.k === "int") return p.int();
      if (p.isId("code") && p.peek(1)?.k === "id" && p.isP("(", 2)) {
        p.next();
        return `code ${p.call()}`;
      }
      if (p.isAtom()) return p.atom();
      return p.ref();
    };
    args.push(...p.commaList(arg));
  }
  p.p(">");
  return { name, args };
}

function attach(p: P): TemplateApp[] | undefined {
  if (!p.isP(":")) return undefined;
  p.p(":");
  return p.commaList(() => templateApp(p));
}

function evidence(p: P): EvidenceSpec {
  const ev: EvidenceSpec = {};
  if (p.isId("judged")) {
    p.next();
    ev.judged = true;
  } else {
    const l = p.id();
    if (l !== "declared" && l !== "tested" && l !== "proven") p.fail("expected a level");
    ev.level = l;
    if (p.isId("or")) {
      p.next();
      p.id("judged");
      ev.orJudged = true;
    }
  }
  if (p.isId("at")) {
    p.next();
    const a = p.id();
    if (a !== "unit" && a !== "contract" && a !== "trust")
      p.fail("expected unit, contract or trust");
    ev.at = a;
  }
  if (p.isId("by")) {
    p.next();
    ev.by = p.commaList(() => p.ref());
  }
  return ev;
}

/** ClaimMeta member; returns false when the next token starts none. */
function claimMeta(p: P, m: ClaimMeta): boolean {
  if (p.isId("owner")) {
    p.next();
    m.owner = owner(p);
    return true;
  }
  if (p.isId("tier")) {
    p.next();
    m.tier = p.tier();
    return true;
  }
  if (p.isId("evidence")) {
    p.next();
    m.evidence = evidence(p);
    return true;
  }
  return false;
}

function clause(p: P): Clause {
  p.id("forbid");
  const final = p.isId("final") ? (p.next(), true) : false;
  const fin = final ? { final: true } : {};
  if (p.isId("path") && !p.isP("<", 1)) {
    p.next();
    const from = p.commaList(() => nodeSel(p));
    p.p("->");
    const to = p.commaList(() => nodeSel(p));
    p.id("over");
    const over = p.commaList(() => p.id());
    let exceptVia: string[] | undefined;
    if (p.isId("except") && p.isId("via", 1)) {
      p.next();
      p.next();
      exceptVia = p.commaList(() => nodeSel(p));
    }
    return { forbid: "path", ...fin, from, to, over, ...(exceptVia ? { exceptVia } : {}) };
  }
  if (p.isId("edge") && !p.isP("<", 1)) {
    p.next();
    const kind = p.id();
    p.id("from");
    const from = p.commaList(() => nodeSel(p));
    p.id("to");
    const to = p.commaList(() => nodeSel(p));
    let exceptFrom: string[] | undefined;
    let exceptTo: string[] | undefined;
    while (p.isId("except") && (p.isId("from", 1) || p.isId("to", 1))) {
      p.next();
      const w = p.next().v;
      const sels = p.commaList(() => nodeSel(p));
      if (w === "from") exceptFrom = sels;
      else exceptTo = sels;
    }
    return {
      forbid: "edge",
      ...fin,
      kind,
      from,
      to,
      ...(exceptFrom ? { exceptFrom } : {}),
      ...(exceptTo ? { exceptTo } : {})
    };
  }
  if (p.isId("cycle") && !p.isP("<", 1)) {
    p.next();
    p.id("over");
    return { forbid: "cycle", ...fin, over: p.commaList(() => p.id()) };
  }
  if (p.isId("hatch") && !p.isP("<", 1)) {
    p.next();
    const kinds = p.accept("*") ? ["*"] : p.commaList(() => p.id());
    p.id("outside");
    p.id("boundaries");
    return { forbid: "hatch", ...fin, kinds };
  }
  const atom = p.atom();
  let within: string[] | undefined;
  let except: string[] | undefined;
  if (p.isId("within")) {
    p.next();
    within = p.commaList(() => unitSel(p));
  }
  if (p.isId("except")) {
    p.next();
    except = p.commaList(() => unitSel(p));
  }
  return {
    forbid: "effect",
    ...fin,
    atom,
    ...(within ? { within } : {}),
    ...(except ? { except } : {})
  };
}

function block(p: P, member: () => void): void {
  p.p("{");
  while (!p.isP("}")) {
    if (p.atEnd()) p.fail("unclosed block");
    member();
  }
  p.p("}");
}

function stringBlock(p: P): string[] {
  const out: string[] = [];
  p.p("{");
  while (!p.isP("}")) {
    out.push(p.str());
    p.accept(",");
  }
  p.p("}");
  return out;
}

function unit(p: P): UnitDecl {
  p.id("unit");
  const u: UnitDecl = { name: p.id() };
  const at = attach(p);
  if (at) u.attach = at;
  if (!p.isP("{")) return u;
  block(p, () => {
    const t = p.peek();
    if (p.isId("owner")) {
      p.next();
      u.owner = owner(p);
    } else if (p.isId("tier")) {
      p.next();
      u.tier = p.tier();
    } else if (p.isId("was")) {
      p.next();
      u.was = p.qname();
    } else if (p.isId("bind")) {
      p.next();
      u.bind = p.call();
    } else if (p.isId("effects")) {
      p.next();
      const mode = p.id();
      if (mode === "unknown") {
        u.effects = { mode: "unknown" };
        return;
      }
      if (mode !== "complete" && mode !== "partial")
        p.fail("expected complete, partial or unknown");
      const atoms: SummaryEntry[] = [];
      block(p, () => {
        const a = p.atom();
        if (p.isId("via")) {
          p.next();
          atoms.push({ atom: a, via: p.ref() });
        } else atoms.push({ atom: a });
        p.accept(",");
      });
      u.effects = { mode, atoms };
    } else p.fail(`unexpected ${t?.v ?? "end"} in unit`);
  });
  return u;
}

function component(p: P, boundary: boolean): Decl {
  p.next();
  const name = p.id();
  const d: Extract<Decl, { decl: "component" }> = { decl: "component", name };
  if (boundary) d.boundary = true;
  const at = attach(p);
  if (at) d.attach = at;
  block(p, () => {
    if (p.isId("owner")) {
      p.next();
      d.owner = owner(p);
    } else if (p.isId("tier")) {
      p.next();
      d.tier = p.tier();
    } else if (p.isId("was")) {
      p.next();
      d.was = p.qname();
    } else if (p.isId("bind")) {
      p.next();
      p.id("paths");
      d.paths = [...(d.paths ?? []), ...stringBlock(p)];
      if (p.isId("except")) {
        p.next();
        d.exceptPaths = [...(d.exceptPaths ?? []), ...stringBlock(p)];
      }
    } else if (p.isId("grants")) {
      p.next();
      if (p.isId("none")) {
        p.next();
        d.grants = "none";
      } else
        d.grants = [...(Array.isArray(d.grants) ? d.grants : []), ...p.commaList(() => p.atom())];
    } else if (p.isId("relations")) {
      p.next();
      p.id("complete");
      p.id("over");
      d.relationsComplete = [...(d.relationsComplete ?? []), ...p.commaList(() => p.id())];
    } else if (p.isId("unit")) {
      d.units = [...(d.units ?? []), unit(p)];
    } else if (boundary && p.isId("allows")) {
      p.next();
      p.id("hatch");
      d.allows = [...(d.allows ?? []), ...p.commaList(() => p.id())];
    } else if (boundary && p.isId("assumes")) {
      p.next();
      const id = p.id();
      d.assumes = [...(d.assumes ?? []), { id, text: p.str() }];
    } else p.fail("unexpected token in component");
  });
  return d;
}

function decl(p: P): Decl {
  const kw = p.id();
  switch (kw) {
    case "shape": {
      const name = p.id();
      let own: string | undefined;
      let policy: string | undefined;
      let manifest: string | undefined;
      block(p, () => {
        if (p.isId("owner")) {
          p.next();
          own = owner(p);
        } else if (p.isId("policy")) {
          p.next();
          policy = p.qname();
        } else if (p.isId("manifest")) {
          p.next();
          manifest = p.call();
        } else p.fail("unexpected token in shape");
      });
      if (own === undefined) p.fail("a shape needs an owner");
      return {
        decl: "shape",
        name,
        owner: own,
        ...(policy ? { policy } : {}),
        ...(manifest ? { manifest } : {})
      };
    }
    case "actor": {
      const name = p.id();
      const d: Extract<Decl, { decl: "actor" }> = { decl: "actor", name, kind: "person" };
      let kind: string | null = null;
      block(p, () => {
        if (p.isId("kind")) {
          p.next();
          kind = p.id();
          if (kind !== "person" && kind !== "team" && kind !== "agent")
            p.fail("expected person, team or agent");
          d.kind = kind;
        } else if (p.isId("operator")) {
          p.next();
          d.operator = p.ref();
        } else if (p.isId("identity")) {
          p.next();
          d.identities = [...(d.identities ?? []), ...p.commaList(() => p.call())];
        } else if (p.isId("member")) {
          p.next();
          d.members = [...(d.members ?? []), ...p.commaList(() => p.ref())];
        } else if (p.isId("was")) {
          p.next();
          d.was = p.qname();
        } else p.fail("unexpected token in actor");
      });
      if (kind === null) p.fail("an actor needs a kind");
      return d;
    }
    case "effect": {
      const name = p.id();
      if (p.isId("implies")) {
        p.next();
        return { decl: "effect", name, implies: p.commaList(() => p.id()) };
      }
      return { decl: "effect", name };
    }
    case "kind": {
      const name = p.id();
      p.id("from");
      const from = p.id();
      p.id("to");
      const to = p.id();
      if (
        (from !== "component" && from !== "resource") ||
        (to !== "component" && to !== "resource")
      )
        p.fail("kinds connect components and resources");
      return { decl: "kind", name, from, to };
    }
    case "hatch": {
      const names = p.commaList(() => p.id());
      p.id("in");
      return { decl: "hatch", names, lang: p.id() };
    }
    case "resource": {
      const name = p.id();
      const d: Extract<Decl, { decl: "resource" }> = { decl: "resource", name };
      const at = attach(p);
      if (at) d.attach = at;
      if (p.isP("{"))
        block(p, () => {
          if (p.isId("owner")) {
            p.next();
            d.owner = owner(p);
          } else if (p.isId("tier")) {
            p.next();
            d.tier = p.tier();
          } else if (p.isId("was")) {
            p.next();
            d.was = p.qname();
          } else if (p.isId("bind")) {
            p.next();
            d.bind = [...(d.bind ?? []), ...p.commaList(() => p.codeRef())];
          } else p.fail("unexpected token in resource");
        });
      return d;
    }
    case "component":
    case "boundary":
      p.i -= 1;
      return component(p, kw === "boundary");
    case "relation": {
      const name = p.id();
      let kind = "";
      const connects: string[] = [];
      const meta: ClaimMeta = {};
      block(p, () => {
        if (p.isId("kind")) {
          p.next();
          kind = p.id();
        } else if (p.isId("connects")) {
          p.next();
          connects.push(p.ref());
          while (p.isP("->")) {
            p.next();
            connects.push(p.ref());
          }
        } else if (!claimMeta(p, meta)) p.fail("unexpected token in relation");
      });
      if (!kind || connects.length < 2) p.fail("a relation needs a kind and two endpoints");
      return { decl: "relation", name, kind, connects, ...meta };
    }
    case "rule": {
      const name = p.id();
      const meta: ClaimMeta = {};
      if (p.isP("=")) {
        p.next();
        const template = templateApp(p);
        if (p.isP("{"))
          block(p, () => {
            if (!claimMeta(p, meta)) p.fail("unexpected token in rule");
          });
        return { decl: "rule", name, template, ...meta };
      }
      const clauses: Clause[] = [];
      const when: { param: string; has: string }[] = [];
      block(p, () => {
        if (p.isId("forbid")) clauses.push(clause(p));
        else if (p.isId("when")) {
          p.next();
          const param = p.id();
          p.id("has");
          when.push({ param, has: p.qname() });
        } else if (!claimMeta(p, meta)) p.fail("unexpected token in rule");
      });
      return { decl: "rule", name, clauses, ...(when.length > 0 ? { when } : {}), ...meta };
    }
    case "law": {
      const name = p.id();
      const meta: ClaimMeta = {};
      let on: string[] | undefined;
      if (p.isP("=")) {
        p.next();
        const template = templateApp(p);
        if (p.isP("{"))
          block(p, () => {
            if (p.isId("on")) {
              p.next();
              on = p.commaList(() => target(p));
            } else if (!claimMeta(p, meta)) p.fail("unexpected token in law");
          });
        return { decl: "law", name, template, ...(on ? { on } : {}), ...meta };
      }
      let statement: string | undefined;
      let informal: string | undefined;
      block(p, () => {
        if (p.isId("on")) {
          p.next();
          on = p.commaList(() => target(p));
        } else if (p.isId("statement")) {
          p.next();
          statement = p.call();
        } else if (p.isId("informal")) {
          p.next();
          informal = p.str();
        } else if (!claimMeta(p, meta)) p.fail("unexpected token in law");
      });
      if (!on) p.fail("a law needs on");
      return {
        decl: "law",
        name,
        on,
        ...(statement !== undefined ? { statement } : {}),
        ...(informal !== undefined ? { informal } : {}),
        ...meta
      };
    }
    case "template": {
      const name = p.id();
      p.p("<");
      const params: [string, ParamKind][] = [];
      if (!p.isP(">"))
        params.push(
          ...p.commaList((): [string, ParamKind] => {
            const n = p.id();
            p.p(":");
            const k = p.id();
            if (!(PARAM_KINDS as string[]).includes(k)) p.fail("expected a parameter kind");
            return [n, k as ParamKind];
          })
        );
      p.p(">");
      const body: TBody[] = [];
      block(p, () => {
        if (p.isId("forbid")) body.push(clause(p));
        else if (p.isId("grants")) {
          p.next();
          body.push({ grants: p.atom() });
        } else if (p.isId("law")) {
          p.next();
          const law: { on?: string[]; informal?: string; evidence?: EvidenceSpec } = {};
          block(p, () => {
            if (p.isId("on")) {
              p.next();
              law.on = p.commaList(() => target(p));
            } else if (p.isId("informal")) {
              p.next();
              law.informal = p.str();
            } else if (p.isId("evidence")) {
              p.next();
              law.evidence = evidence(p);
            } else p.fail("unexpected token in template law");
          });
          body.push({ law });
        } else if (p.isId("requires")) {
          p.next();
          p.id("note");
          const kinds = p.commaList(() => {
            const k = p.id();
            if (!(NOTE_KINDS as string[]).includes(k)) p.fail("expected a note kind");
            return k as NoteKind;
          });
          body.push({ requiresNote: kinds.length === 1 ? (kinds[0] as NoteKind) : kinds });
        } else if (p.isId("order")) {
          p.next();
          const param = p.id();
          p.id("by");
          const dir = p.id();
          if (!(ORDER_DIRS as string[]).includes(dir)) p.fail("expected an order");
          body.push({ order: [param, dir as OrderDir] });
        } else p.fail("unexpected token in template");
      });
      return { decl: "template", name, params, body };
    }
    case "exception": {
      const name = p.id();
      const d: Partial<Extract<Decl, { decl: "exception" }>> = { decl: "exception", name };
      block(p, () => {
        if (p.isId("waives")) {
          p.next();
          const kinds: ("contradiction" | "unestablished")[] = [];
          const save = p.i;
          if (p.isId("contradiction") || p.isId("unestablished")) {
            const ks = p.commaList(() => p.id());
            if (p.isId("of")) {
              p.next();
              for (const k of ks) {
                if (k !== "contradiction" && k !== "unestablished") p.fail("bad obligation kind");
                kinds.push(k);
              }
            } else p.i = save;
          }
          if (kinds.length > 0) d.waives = kinds;
          const t = p.id();
          if (t === "claim") d.target = `claim ${JSON.stringify(p.str())}`;
          else if (["rule", "law", "relation", "authority", "component"].includes(t))
            d.target = `${t} ${p.ref()}`;
          else p.fail("expected a claim or component target");
          if (p.isId("for")) {
            p.next();
            d.for = p.commaList(() => {
              if (p.isId("code")) {
                p.next();
                return `code ${p.call()}`;
              }
              if (p.isId("pair")) {
                p.next();
                const a = p.ref();
                p.p("->");
                return `pair ${a} -> ${p.ref()}`;
              }
              return unitSel(p);
            });
          }
        } else if (p.isId("owner")) {
          p.next();
          d.owner = owner(p);
        } else if (p.isId("expires")) {
          p.next();
          d.expires = p.str();
        } else p.fail("unexpected token in exception");
      });
      if (!d.target || !d.owner || !d.expires)
        p.fail("an exception needs waives, owner and expires");
      return d as Decl;
    }
    case "note": {
      const name = p.id();
      p.p(":");
      const kind = p.id();
      if (!(NOTE_KINDS as string[]).includes(kind)) p.fail("expected a note kind");
      const d: Extract<Decl, { decl: "note" }> = {
        decl: "note",
        name,
        kind: kind as NoteKind,
        about: []
      };
      block(p, () => {
        if (p.isId("about")) {
          p.next();
          d.about.push(...p.commaList(() => target(p)));
        } else if (p.isId("owner")) {
          p.next();
          d.owner = owner(p);
        } else if (p.isId("text")) {
          p.next();
          d.text = p.str();
        } else if (p.isId("confidence")) {
          p.next();
          const c = p.id();
          if (c !== "low" && c !== "medium" && c !== "high") p.fail("bad confidence");
          d.confidence = c;
        } else if (p.isId("chose")) {
          p.next();
          d.chose = p.str();
          p.id("over");
          d.over = p.commaList(() => p.str());
        } else p.fail("unexpected token in note");
      });
      return d;
    }
    case "provider": {
      const name = p.id();
      const d: Extract<Decl, { decl: "provider" }> = { decl: "provider", name, produces: [] };
      block(p, () => {
        if (p.isId("produces")) {
          p.next();
          d.produces.push(
            ...p.commaList(() => {
              const k = p.id();
              if (!(REC_KINDS as string[]).includes(k)) p.fail("expected a record kind");
              return k as RecKind;
            })
          );
        } else if (p.isId("observes")) {
          p.next();
          d.observes = [
            ...(d.observes ?? []),
            ...p.commaList(() => {
              const k = p.id();
              p.p("(");
              let s: string;
              if (k === "effect") s = `effect(${p.codeRef()})`;
              else if (k === "call") s = `call(${p.id()})`;
              else if (k === "edge") {
                const kind = p.id();
                s = p.isP(",") ? (p.next(), `edge(${kind}, ${p.codeRef()})`) : `edge(${kind})`;
              } else p.fail("expected effect, call or edge");
              p.p(")");
              return s;
            })
          ];
        } else if (p.isId("decides")) {
          p.next();
          d.decides = [
            ...(d.decides ?? []),
            ...p.commaList(() => {
              const k = p.id();
              if (k === "template") return `template ${p.qname()}`;
              if (k === "statements") return `statements ${p.id()}`;
              if (k === "equivalence") return "equivalence";
              p.fail("expected template, statements or equivalence");
            })
          ];
        } else if (p.isId("sound")) {
          p.next();
          if (p.isId("none")) {
            p.next();
            d.sound = [];
          } else
            d.sound = p.commaList(() => {
              const s = p.id();
              if (s !== "presence" && s !== "absence") p.fail("expected presence or absence");
              return s;
            });
        } else if (p.isId("persist")) {
          p.next();
          d.persist = true;
        } else if (p.isId("deps")) {
          p.next();
          p.id("complete");
          d.depsComplete = true;
        } else if (p.isId("identity")) {
          p.next();
          d.identity = p.call();
        } else if (p.isId("trusts")) {
          p.next();
          p.id("tool");
          p.p("(");
          const a = p.str();
          p.p(",");
          const b = p.str();
          p.p(")");
          d.trusts = [...(d.trusts ?? []), [a, b]];
        } else if (p.isId("implementation")) {
          p.next();
          const impl: { paths?: string[]; ids?: string[]; digest?: string } = {};
          block(p, () => {
            if (p.isId("bind") && p.isId("paths", 1)) {
              p.next();
              p.next();
              impl.paths = [...(impl.paths ?? []), ...stringBlock(p)];
            } else if (p.isId("bind")) {
              p.next();
              impl.ids = [...(impl.ids ?? []), p.call()];
            } else if (p.isId("digest")) {
              p.next();
              impl.digest = p.str();
            } else p.fail("unexpected token in implementation");
          });
          d.implementation = impl;
        } else p.fail("unexpected token in provider");
      });
      return d;
    }
    case "policy": {
      const name = p.id();
      const tiers: Partial<Record<"low" | "normal" | "critical", TierPolicySrc>> = {};
      let budget: number | undefined;
      block(p, () => {
        if (p.isId("tier")) {
          p.next();
          const t = p.id();
          if (t !== "low" && t !== "normal" && t !== "critical")
            p.fail("expected low, normal or critical");
          const tp: TierPolicySrc = {};
          block(p, () => {
            if (p.isId("floor")) {
              p.next();
              const l = p.id();
              if (l !== "declared" && l !== "tested" && l !== "proven") p.fail("expected a level");
              tp.floor = l;
            } else if (p.isId("blocks")) {
              p.next();
              tp.blocks = p.commaList(() => {
                const b = p.id();
                if (b === "latent") {
                  p.id("loosening");
                  return "latent-loosening";
                }
                if (b !== "unestablished" && b !== "coverage") p.fail("bad blocks entry");
                return b;
              });
            } else if (p.isId("max_age")) {
              p.next();
              tp.maxAge = p.int();
              p.id("days");
            } else if (p.isId("judges")) {
              p.next();
              tp.judges = p.commaList(() => p.ref());
            } else p.fail("unexpected token in tier");
          });
          tiers[t] = tp;
        } else if (p.isId("judgment")) {
          p.next();
          p.id("budget");
          budget = p.int();
          p.id("per");
          p.id("change");
        } else p.fail("unexpected token in policy");
      });
      return { decl: "policy", name, tiers, ...(budget !== undefined ? { budget } : {}) };
    }
    default:
      p.i -= 1;
      p.fail("expected a declaration");
  }
}

/** Parses one shape file. Throws ParseError when it does not parse (E-parse). */
export function parseShapeFile(path: string, text: string): SourceModule {
  const p = new P(lex(text));
  let module = path
    .replace(/^shape\//, "")
    .replace(/\.shape$/, "")
    .replace(/\//g, "::");
  if (p.isId("module")) {
    p.next();
    module = p.qname();
  }
  const imports: string[] = [];
  while (p.isId("import")) {
    p.next();
    imports.push(p.qname());
  }
  const decls: Decl[] = [];
  while (!p.atEnd()) {
    if (!p.isId() || !DECL_KEYWORDS.has(p.peek()?.v ?? "")) p.fail("expected a declaration");
    decls.push(decl(p));
  }
  return { module, imports, decls, file: path };
}
