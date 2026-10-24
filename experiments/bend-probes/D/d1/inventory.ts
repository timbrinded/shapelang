// D1 inventory: every proof-relevant escape hatch in the Bend clone
// (demos, evals, tests, base.bend), found with Bend's own parser.
//
//   bun d1/inventory.ts <bend-clone> > out.json
//
// A file is parsed (not checked) as an entry; a demo is parsed once per
// .bend file and its keys merged, so a law in LAWS.bend counts as open only
// when no entry of the demo fills it.

import * as fs from "node:fs";
import * as path from "node:path";
import { Bend } from "../lib/bendbook.ts";

const clone = process.argv[2];
const BASE = Bend.BASE_BEND;

const base = Bend.book_nil();
await Bend.book_load(base, BASE, "", new Map());
for (const k of base.order) base.tlds[k].b = true;
const baseAxioms = new Set<string>(); // Base laws left unfilled: native axioms
for (const k of Object.keys(base.tlds)) {
  const t = base.tlds[k];
  if (t.$ === "Def" && t.v === null && !t.i) baseAxioms.add(k);
}
const baseUnsafe = Object.keys(base.tlds).filter((k) => base.tlds[k].u === true);
const baseForeign = Object.keys(base.tlds).filter((k) => base.tlds[k].i !== undefined);

function seeded(): any {
  const b = Bend.book_nil();
  for (const k of Object.keys(base.tlds)) b.tlds[k] = { ...base.tlds[k] };
  Object.assign(b.ctrs, base.ctrs);
  for (const k of Object.keys(base.tmps)) b.tmps[k] = new Map(base.tmps[k]);
  b.order.push(...base.order);
  return b;
}

const parseErrors: string[] = [];
async function parseEntry(file: string): Promise<any | string> {
  // seed Base only into a file that imports it itself (as `bend --checkup`)
  const own = /^(?:[\t\r ]*(?:(?:#|import )[^\n]*)?\n)*[\t ]*import Base\s/.test(fs.readFileSync(file, "utf8"));
  const book = own ? seeded() : Bend.book_nil();
  const seen = new Map<string, string | null>(own ? [[BASE, ""]] : []);
  try {
    await Bend.book_load(book, path.resolve(file), "", seen);
    return book;
  } catch (e: any) {
    const why = e?.$ === "Err" ? Bend.err_show(e).replace(/\n/g, " ").slice(0, 120) : String(e).slice(0, 100);
    parseErrors.push(file + ": " + why);
    return why;
  }
}

function holes(t: any): { todo: number; named: string[] } {
  const r = { todo: 0, named: [] as string[] };
  const seen = new Set([t]);
  for (const todo = [t]; todo.length > 0;) {
    const x = todo.pop();
    if (x.$ === "Hol") {
      if (x.k === "TODO") r.todo++; else r.named.push(x.k);
    }
    for (const f in x) {
      const v = x[f];
      if (f !== "s" && typeof v === "object" && v !== null && !seen.has(v)) { seen.add(v); todo.push(v); }
    }
  }
  return r;
}

function refs(t: any, out: Set<string>): void {
  const seen = new Set([t]);
  for (const todo = [t]; todo.length > 0;) {
    const x = todo.pop();
    if ((x.$ === "Ref" || x.$ === "ADT") && typeof x.k === "string") out.add(x.k);
    for (const f in x) {
      const v = x[f];
      if (f !== "s" && typeof v === "object" && v !== null && !seen.has(v)) { seen.add(v); todo.push(v); }
    }
  }
}

type Row = {
  corpus: string; unit: string; parsed: boolean; defs: number; laws: number;
  unsafeDefs: string[]; sugarQ: number; atUnsafe: number; foreign: string[];
  openLaws: string[]; holesTodo: number; holesNamed: number;
  axiomUsers: string[]; f32Users: string[]; forkUsers: string[]; userTypeLaws: string[];
};

function stripComments(src: string): string {
  return src.split("\n").map((l) => {
    let inStr = false;
    for (let i = 0; i < l.length; i++) {
      if (l[i] === '"' && l[i - 1] !== "\\") inStr = !inStr;
      if (l[i] === "#" && !inStr) return l.slice(0, i);
    }
    return l;
  }).join("\n");
}

async function unit(corpus: string, name: string, entries: string[]): Promise<Row> {
  const row: Row = { corpus, unit: name, parsed: true, defs: 0, laws: 0, unsafeDefs: [], sugarQ: 0, atUnsafe: 0,
    foreign: [], openLaws: [], holesTodo: 0, holesNamed: 0, axiomUsers: [], f32Users: [], forkUsers: [], userTypeLaws: [] };
  const merged = new Map<string, any>();
  const lawSeen = new Map<string, boolean>(); // key -> filled in some entry
  for (const e of entries) {
    const book = await parseEntry(e);
    if (typeof book === "string") { row.parsed = false; continue; }
    const stem = path.relative(path.dirname(entries[0]), e).replace(/\.bend$/, "");
    for (const k0 of new Set<string>(book.order)) {
      const t = book.tlds[k0];
      if (t === undefined || t.b === true) continue;
      const k = k0.includes(":") ? k0 : stem + ":" + k0;
      if (t.$ === "Def" && t.l === true) lawSeen.set(k, (lawSeen.get(k) ?? false) || t.v !== null);
      if (!merged.has(k) || (t.v !== null && merged.get(k).v === null)) merged.set(k, t);
    }
  }
  for (const [k, t] of merged) {
    if (t.$ !== "Def") continue;
    row.defs++;
    if (t.l === true) row.laws++;
    if (t.u === true) row.unsafeDefs.push(k);
    if (t.i !== undefined) row.foreign.push(k + " <- " + t.i.map((p: string) => path.basename(p)).join(","));
    if (t.l === true && lawSeen.get(k) === false && !t.i) {
      row.openLaws.push(k);
      // a law whose statement is a sort (Type/Data/Kind): a user handle type
      let tel = Bend.term_strip(t.T);
      for (let d = 0; tel.$ === "All"; d++) tel = Bend.term_strip(tel.B(Bend.Var(tel.k, d)));
      if (tel.$ === "Typ") row.userTypeLaws.push(k);
    }
    const rs = new Set<string>();
    refs(Bend.term_lower(t.T), rs);
    if (t.v !== null) {
      const lv = Bend.term_lower(t.v);
      const h = holes(lv);
      row.holesTodo += h.todo;
      row.holesNamed += h.named.length;
      refs(lv, rs);
    }
    const ax = [...rs].filter((r) => baseAxioms.has(r) && !["File", "Socket", "Listener", "Window", "Audio", "Chan"].includes(r));
    if (ax.length > 0) row.axiomUsers.push(k);
    if (ax.some((r) => r.startsWith("F32.") || r === "U32.to_f32")) row.f32Users.push(k);
    if (rs.has("Array.fork") || rs.has("Array.join")) row.forkUsers.push(k);
  }
  for (const e of entries) {
    const src = stripComments(fs.readFileSync(e, "utf8"));
    row.sugarQ += (src.match(/^\s*def\s+[A-Za-z_][\w.]*\?\s*\(/gm) ?? []).length;
    row.atUnsafe += (src.match(/^\s*@unsafe\b/gm) ?? []).length;
  }
  return row;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) out.push(...walk(p));
    else if (f.name.endsWith(".bend")) out.push(p);
  }
  return out.sort();
}

const rows: Row[] = [];
for (const d of fs.readdirSync(path.join(clone, "demos")).sort()) {
  const dir = path.join(clone, "demos", d);
  const files = walk(dir);
  files.sort((a, b) => (path.basename(b) === "PROOF.bend" ? 1 : 0) - (path.basename(a) === "PROOF.bend" ? 1 : 0));
  rows.push(await unit("demos", d, files));
}
for (const f of walk(path.join(clone, "evals"))) rows.push(await unit("evals", path.basename(f), [f]));
for (const f of walk(path.join(clone, "tests"))) rows.push(await unit("tests", path.relative(path.join(clone, "tests"), f), [f]));

// Base itself
const baseRow = {
  axioms: [...baseAxioms].sort(),
  unsafe: baseUnsafe,
  foreign: baseForeign.length,
  laws: Object.keys(base.tlds).filter((k) => base.tlds[k].l === true).length,
  defs: Object.keys(base.tlds).filter((k) => base.tlds[k].$ === "Def").length,
};

const sum = (c: string, f: (r: Row) => number) => rows.filter((r) => r.corpus === c).reduce((a, r) => a + f(r), 0);
const files = (c: string, f: (r: Row) => boolean) => rows.filter((r) => r.corpus === c && f(r)).length;
const summary: Record<string, unknown> = {};
for (const c of ["demos", "evals", "tests"]) {
  summary[c] = {
    units: files(c, () => true),
    unparsed: files(c, (r) => !r.parsed),
    defs: sum(c, (r) => r.defs),
    laws: sum(c, (r) => r.laws),
    atUnsafe: sum(c, (r) => r.atUnsafe), atUnsafeUnits: files(c, (r) => r.atUnsafe > 0),
    sugarQ: sum(c, (r) => r.sugarQ), sugarQUnits: files(c, (r) => r.sugarQ > 0),
    unsafeDefs: sum(c, (r) => r.unsafeDefs.length),
    foreignDefs: sum(c, (r) => r.foreign.length), foreignUnits: files(c, (r) => r.foreign.length > 0),
    openLaws: sum(c, (r) => r.openLaws.length), openLawUnits: files(c, (r) => r.openLaws.length > 0),
    userTypeLaws: sum(c, (r) => r.userTypeLaws.length),
    holesTodo: sum(c, (r) => r.holesTodo), holesTodoUnits: files(c, (r) => r.holesTodo > 0),
    holesNamed: sum(c, (r) => r.holesNamed), holesNamedUnits: files(c, (r) => r.holesNamed > 0),
    axiomUserDefs: sum(c, (r) => r.axiomUsers.length), axiomUnits: files(c, (r) => r.axiomUsers.length > 0),
    f32UserDefs: sum(c, (r) => r.f32Users.length), f32Units: files(c, (r) => r.f32Users.length > 0),
    forkUserDefs: sum(c, (r) => r.forkUsers.length), forkUnits: files(c, (r) => r.forkUsers.length > 0),
  };
}
const demoRows = rows.filter((r) => r.corpus === "demos").map((r) => ({
  demo: r.unit, defs: r.defs, laws: r.laws, unsafe: r.unsafeDefs, foreign: r.foreign, open: r.openLaws,
  holes: r.holesTodo + r.holesNamed, f32Defs: r.f32Users.length, axiomDefs: r.axiomUsers.length, fork: r.forkUsers,
}));
const evalRows = rows.filter((r) => r.corpus === "evals").map((r) => ({
  eval: r.unit, defs: r.defs, laws: r.laws, unsafe: r.unsafeDefs.length, foreign: r.foreign.length, open: r.openLaws.length,
  holes: r.holesTodo + r.holesNamed, f32Defs: r.f32Users.length,
}));
console.log(JSON.stringify({ summary, base: baseRow, demos: demoRows, evals: evalRows,
  testForeign: rows.filter((r) => r.corpus === "tests" && r.foreign.length > 0).map((r) => r.unit + ": " + r.foreign.join("; ")),
  parseErrors,
  testOpen: rows.filter((r) => r.corpus === "tests" && r.openLaws.length > 0).map((r) => r.unit + ": " + r.openLaws.join(",")),
}, null, 1));
