// Shared helpers for the D experiments: load a Bend book with Bend's own
// parser and checker (bend2/bend.ts), and describe its top-level defs.
//
// BENDC points at the bend2 source directory (default: the scratchpad build).

import * as path from "node:path";

const BENDC = process.env.BENDC
  ?? "/tmp/claude-0/-home-user-shapelang/83ff80bc-0161-572f-9e5a-9075cccad6d0/scratchpad/bendexp/bendc/bend2";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Bend: any = await import(path.join(BENDC, "bend.ts"));

export type DefInfo = {
  key: string;            // book key, "ns:name" for imported modules, bare for the entry file
  ns: string;             // module namespace ("" for the entry file)
  name: string;           // name inside its module
  kind: "Def" | "ADT";
  law: boolean;           // declared with `law`
  open: boolean;          // a law with no def (an open claim)
  unsafe: boolean;        // @unsafe or def f?
  foreign: string[] | null; // import "./x.js" / "./x.c" body
  base: boolean;
  typeRefs: Set<string>;  // defs/types named in the type (and ctor fields for an ADT)
  bodyRefs: Set<string>;  // defs/types/ctors' families named in the body
  ctorRefs: Set<string>;  // constructors named in the body
  ioType: boolean;        // the type mentions IO anywhere
  ioReturn: boolean;      // the telescope tips at IO(...)
  retHead: string | null; // head of the return type after the telescope
  retIsSort: boolean;     // returns Type / Data / Kind(..) : a type-level def
  retIsEq: boolean;       // returns an equality / Empty / a negation: a proposition
};

export async function loadBook(file: string, validate = true): Promise<any> {
  const book = Bend.book_nil();
  const seen = new Map<string, string | null>();
  await Bend.book_load(book, path.resolve(file), "", seen);
  if (validate) {
    Bend.book_valid(book, 0);
  }
  return book;
}

// term_refs as in bend2/main.ts, plus constructor names
export function termRefs(t: object, out: Set<string>, ctrs?: Set<string>): void {
  const seen = new Set([t]);
  for (const todo = [t]; todo.length > 0;) {
    const x = todo.pop() as Record<string, unknown>;
    if ((x.$ === "Ref" || x.$ === "ADT") && typeof x.k === "string") {
      out.add(x.k);
    }
    if (x.$ === "Ctr" && typeof x.k === "string" && ctrs) {
      ctrs.add(x.k);
    }
    for (const f in x) {
      const v = x[f];
      if (f !== "s" && typeof v === "object" && v !== null && !seen.has(v as object)) {
        seen.add(v as object);
        todo.push(v as Record<string, unknown>);
      }
    }
  }
}

export function ctorFamily(book: any): Map<string, string> {
  const fam = new Map<string, string>();
  for (const k of Object.keys(book.tlds)) {
    const t = book.tlds[k];
    if (t.$ === "ADT") {
      for (const c of t.c) {
        fam.set(c.k, k);
      }
    }
  }
  return fam;
}

function tip(book: any, T: any): any {
  let tel = Bend.term_strip(T);
  for (let d = 0; tel.$ === "All"; d++) {
    tel = Bend.term_strip(tel.B(Bend.Var(tel.k, d)));
  }
  return tel;
}

export function describe(book: any, includeBase = false): DefInfo[] {
  const fam = ctorFamily(book);
  const out: DefInfo[] = [];
  const keys = [...new Set(book.order as string[])];
  for (const k of keys) {
    const t = book.tlds[k];
    if (t === undefined) continue;
    if (t.b === true && !includeBase) continue;
    const typeRefs = new Set<string>();
    const bodyRefs = new Set<string>();
    const ctorRefs = new Set<string>();
    if (t.$ === "ADT") {
      for (const c of [t, ...t.c]) termRefs(Bend.term_lower(c.T), typeRefs);
    } else {
      termRefs(Bend.term_lower(t.T), typeRefs);
      if (t.e !== undefined) {
        termRefs(t.e, bodyRefs, ctorRefs);
      } else if (t.v !== null && t.v !== undefined) {
        termRefs(Bend.term_lower(t.v), bodyRefs, ctorRefs);
      }
      for (const c of ctorRefs) {
        const f = fam.get(c);
        if (f !== undefined) bodyRefs.add(f);
      }
    }
    typeRefs.delete(k);
    bodyRefs.delete(k);
    let retHead: string | null = null;
    let retIsSort = false;
    let retIsEq = false;
    let ioReturn = false;
    if (t.$ === "Def") {
      const tp = tip(book, t.T);
      const [h] = Bend.term_unapply(tp);
      if (tp.$ === "Typ") retIsSort = true;
      if (tp.$ === "Eql") retIsEq = true;
      if (h.$ === "Ref" || h.$ === "ADT") {
        retHead = h.k;
        if (h.k === "IO") ioReturn = true;
        if (h.k === "Empty") retIsEq = true;
      } else {
        retHead = tp.$;
      }
    }
    const [ns, name] = k.includes(":") ? k.split(":") : ["", k];
    out.push({
      key: k, ns, name, kind: t.$,
      law: t.$ === "Def" && t.l === true,
      open: t.$ === "Def" && t.v === null && t.b !== true && !t.i,
      unsafe: t.$ === "Def" && t.u === true,
      foreign: t.$ === "Def" && t.i !== undefined ? t.i : null,
      base: t.b === true,
      typeRefs, bodyRefs, ctorRefs,
      ioType: typeRefs.has("IO"),
      ioReturn, retHead, retIsSort, retIsEq,
    });
  }
  return out;
}

// the source file of a module namespace, relative to the project root
export function nsFile(ns: string, entry: string): string {
  return ns === "" ? path.basename(entry) : ns + ".bend";
}

// transitive closure over an adjacency function
export function closure(start: Iterable<string>, next: (k: string) => Iterable<string>): Set<string> {
  const seen = new Set<string>();
  const todo = [...start];
  while (todo.length > 0) {
    const k = todo.pop() as string;
    if (seen.has(k)) continue;
    seen.add(k);
    for (const j of next(k)) if (!seen.has(j)) todo.push(j);
  }
  return seen;
}
