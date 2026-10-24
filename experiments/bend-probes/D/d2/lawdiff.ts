// D2: a deterministic law-set diff between two versions of a Bend project.
//
//   bun d2/lawdiff.ts <old-dir> <new-dir>   -> JSON on stdout
//
// Three views, all deterministic:
//   book: the laws reachable from <dir>/PROOF.bend (what the gate checks),
//         keyed by name, compared by an alpha-normal form of the statement
//         (binder names and source spans dropped, de Bruijn levels kept,
//         global names kept as book keys, so import aliases do not matter);
//   dir:  the laws declared in any .bend file of the directory, by name only
//         (what a file-level scan of the project sees);
//   closure: per law, a fingerprint of the statement plus the type and body
//         of every non-Base def reachable from it (excluding PROOF.bend's own
//         defs), so a change to a def the law mentions shows up even when the
//         statement text is unchanged.

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { Bend, loadBook, termRefs } from "../lib/bendbook.ts";

export function normal(t: unknown): string {
  const seen = new Map<object, number>();
  const go = (x: unknown): unknown => {
    if (x === null || typeof x !== "object") return x;
    if (Array.isArray(x)) return x.map(go);
    const o = x as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(o).sort()) {
      if (k === "s") continue;                                  // span
      if (k === "k" && o.$ !== "Ref" && o.$ !== "ADT" && o.$ !== "Ctr" && o.$ !== "Lit" && o.$ !== "Hol" && o.$ !== "Mat" && o.$ !== "PCtr") continue; // binder name
      out[k] = go(o[k]);
    }
    return out;
  };
  void seen;
  return JSON.stringify(go(t));
}

const hash = (s: string) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 16);

type LawView = { stmt: string; closure: string; closureDefs: string[] };

export async function bookLaws(dir: string): Promise<Record<string, LawView> | string> {
  let book: any;
  try {
    book = await loadBook(path.join(dir, "PROOF.bend"), false);
  } catch (e: any) {
    return "parse error: " + (e?.$ === "Err" ? Bend.err_show(e).split("\n").slice(0, 3).join(" ") : String(e));
  }
  const out: Record<string, LawView> = {};
  const isProofDef = (k: string) => !k.includes(":"); // PROOF.bend is the entry: its own keys are bare
  const refsOf = (k: string): Set<string> => {
    const t = book.tlds[k];
    const rs = new Set<string>();
    if (t === undefined || t.b === true) return rs;
    if (t.$ === "ADT") {
      for (const c of [t, ...t.c]) termRefs(Bend.term_lower(c.T), rs);
    } else {
      termRefs(Bend.term_lower(t.T), rs);
      if (t.v !== null && t.l !== true) termRefs(Bend.term_lower(t.v), rs); // a law's body is its proof: skip it
    }
    return rs;
  };
  for (const k of new Set<string>(book.order)) {
    const t = book.tlds[k];
    if (t?.$ !== "Def" || t.l !== true || t.b === true) continue;
    const stmt = normal(Bend.term_lower(t.T));
    const reach = new Set<string>();
    const todo = [...refsOf(k)];
    while (todo.length > 0) {
      const j = todo.pop() as string;
      const tj = book.tlds[j];
      if (reach.has(j) || tj === undefined || tj.b === true || isProofDef(j)) continue;
      reach.add(j);
      todo.push(...refsOf(j));
    }
    const defs = [...reach].sort();
    const parts = defs.map((j) => {
      const tj = book.tlds[j];
      return j + "=" + (tj.$ === "ADT" ? normal([tj.T, ...tj.c.map((c: any) => [c.k, Bend.term_lower(c.T)])])
        : normal([Bend.term_lower(tj.T), tj.v === null || tj.l === true ? null : Bend.term_lower(tj.v)]));
    });
    out[Bend.name_key(k)] = { stmt: hash(stmt), closure: hash(stmt + "|" + parts.join("|")), closureDefs: defs.map(Bend.name_key) };
  }
  return out;
}

export function dirLaws(dir: string): string[] {
  const names: string[] = [];
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".bend")).sort()) {
    const src = fs.readFileSync(path.join(dir, f), "utf8");
    for (const m of src.matchAll(/^law\s+([A-Za-z_][\w.]*)\s*:/gm)) names.push(m[1]);
  }
  return names.sort();
}

export async function lawDiff(oldDir: string, newDir: string) {
  const a = await bookLaws(oldDir);
  const b = await bookLaws(newDir);
  const res: Record<string, unknown> = {};
  if (typeof a === "string" || typeof b === "string") {
    res.book = { error: typeof a === "string" ? "old: " + a : "new: " + b };
  } else {
    const removed = Object.keys(a).filter((k) => !(k in b));
    const added = Object.keys(b).filter((k) => !(k in a));
    const renamed: string[] = [];
    for (const r of [...removed]) {
      const hit = added.find((n) => b[n].stmt === a[r].stmt);
      if (hit !== undefined) {
        renamed.push(r + " -> " + hit);
        removed.splice(removed.indexOf(r), 1);
        added.splice(added.indexOf(hit), 1);
      }
    }
    const changed = Object.keys(a).filter((k) => k in b && a[k].stmt !== b[k].stmt);
    const closureOnly = Object.keys(a).filter((k) => k in b && a[k].stmt === b[k].stmt && a[k].closure !== b[k].closure);
    res.book = { removed, added, renamed, changed, closureOnly,
      flagged: removed.length + added.length + renamed.length + changed.length > 0,
      closureFlagged: removed.length + added.length + renamed.length + changed.length + closureOnly.length > 0 };
  }
  const da = dirLaws(oldDir);
  const db = dirLaws(newDir);
  res.dir = { removed: da.filter((n) => !db.includes(n)), added: db.filter((n) => !da.includes(n)),
    flagged: da.join() !== db.join() };
  return res;
}

if (import.meta.main) {
  console.log(JSON.stringify(await lawDiff(process.argv[2], process.argv[3]), null, 1));
}
