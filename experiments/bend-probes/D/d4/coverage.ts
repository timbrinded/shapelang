// D4: law coverage. For every demo and eval with laws, the dependency closure
// of each law statement over the project's defs (defs the statement names,
// then everything their types and bodies name, transitively; Base excluded),
// and the fraction of non-proof defs that fall in at least one closure.
//
//   bun d4/coverage.ts <bend-clone> > coverage.json
//
// Laws: `law` declarations of LAWS.bend (demos) or above "# solution" (evals);
// laws declared in PROOF.bend are lemmas and count as proof.
// Proof defs (excluded from the denominator): defs of PROOF.bend, law fills,
// and in an eval every def below "# solution".
// Code defs: non-proof defs whose type does not end in a sort (Type, Data,
// Kind): defs that run. Spec defs: non-proof defs that return a sort
// (predicates such as Sorted, LE).

import * as fs from "node:fs";
import * as path from "node:path";
import { Bend, termRefs, ctorFamily } from "../lib/bendbook.ts";

const CLONE = process.argv[2];

// the tip of a telescope, looking through the lets a law statement may hold
function tipOf(T: any): any {
  let tel = Bend.term_strip(T);
  for (let d = 0; tel.$ === "All" || tel.$ === "Let"; d++) {
    tel = tel.$ === "All" ? Bend.term_strip(tel.B(Bend.Var(tel.k, d))) : Bend.term_strip(typeof tel.f === "function" ? tel.f(tel.v) : tel.f);
  }
  return tel;
}

type Proj = { name: string; kind: "demo" | "eval"; entries: string[]; root: string };
const projects: Proj[] = [];
for (const d of fs.readdirSync(path.join(CLONE, "demos")).sort()) {
  const root = path.join(CLONE, "demos", d);
  const files = fs.readdirSync(root).filter((f) => f.endsWith(".bend")).sort()
    .sort((a, b) => (b === "PROOF.bend" ? 1 : 0) - (a === "PROOF.bend" ? 1 : 0));
  projects.push({ name: d, kind: "demo", entries: files.map((f) => path.join(root, f)), root });
}
for (const f of fs.readdirSync(path.join(CLONE, "evals")).filter((f) => f.endsWith(".bend")).sort()) {
  projects.push({ name: f.replace(/\.bend$/, ""), kind: "eval", entries: [path.join(CLONE, "evals", f)], root: path.join(CLONE, "evals") });
}

const results = [];
for (const p of projects) {
  // merge the books of every entry, keys normalized to "module:name"
  const defs = new Map<string, { t: any; refs: Set<string>; lawBody: Set<string>; eqAdt: boolean; stmt?: Set<string>; module: string; name: string; ioType: boolean; sort: boolean; retHead: string }>();
  for (const e of p.entries) {
    const book = Bend.book_nil();
    await Bend.book_load(book, path.resolve(e), "", new Map());
    const stem = path.relative(p.root, e).replace(/\.bend$/, "");
    const norm = (k: string) => (k.includes(":") ? k : stem + ":" + k);
    const fam = ctorFamily(book);
    for (const k of new Set<string>(book.order)) {
      const t = book.tlds[k];
      if (t === undefined || t.b === true) continue;
      const nk = norm(k);
      if (defs.has(nk) && !(t.$ === "Def" && t.v !== null && defs.get(nk)!.t.v === null)) continue;
      const rs = new Set<string>();
      const lawBody = new Set<string>();
      const ctrs = new Set<string>();
      if (t.$ === "ADT") for (const c of [t, ...t.c]) termRefs(Bend.term_lower(c.T), rs);
      else {
        termRefs(Bend.term_lower(t.T), rs);
        if (t.v !== null && t.l !== true) termRefs(Bend.term_lower(t.v), rs, ctrs);
        if (t.v !== null && t.l === true) termRefs(Bend.term_lower(t.v), lawBody, ctrs);
      }
      for (const c of ctrs) { const f = fam.get(c); if (f) rs.add(f); }
      const keep = (src: Set<string>) => {
        const out = new Set<string>();
        for (const r of src) {
          const base = book.tlds[r.replace(/~\d+$/, "")]?.b === true || book.tlds[r]?.b === true;
          if (!base) out.add(norm(r.replace(/~\d+$/, "")));
        }
        out.delete(nk);
        return out;
      };
      const nrs = keep(rs);
      const nlb = keep(lawBody);
      // a law statement mentioning a user datatype whose constructors carry equalities
      // (a proof-carrying result, e.g. Verdict) is a claim whose fill is also code
      let eqAdt = false;
      if (t.$ === "Def" && t.l === true) {
        const tp0 = tipOf(t.T);
        const [h0] = Bend.term_unapply(tp0);
        const adt = h0?.k !== undefined ? book.tlds[h0.k] : undefined;
        if (adt?.$ === "ADT" && adt.b !== true) {
          eqAdt = adt.c.some((c: any) => /==/.test(Bend.term_show(Bend.term_lower(c.T))));
        }
      }
      const tp = t.$ === "Def" ? tipOf(t.T) : null;
      const [h] = tp ? Bend.term_unapply(tp) : [null];
      const stmt = new Set<string>();
      if (t.$ === "Def" && t.l === true) {
        const s0 = new Set<string>();
        termRefs(Bend.term_lower(t.T), s0);
        for (const r of s0) if (book.tlds[r.replace(/~\d+$/, "")]?.b !== true && book.tlds[r]?.b !== true) stmt.add(norm(r.replace(/~\d+$/, "")));
      }
      const [mod, name] = nk.split(":");
      const typeRefs = new Set<string>();
      if (t.$ === "Def") termRefs(Bend.term_lower(t.T), typeRefs);
      defs.set(nk, { t, refs: nrs, lawBody: nlb, eqAdt, stmt: t.$ === "Def" && t.l === true ? stmt : undefined, module: mod, name,
        ioType: typeRefs.has("IO"), sort: tp?.$ === "Typ",
        retHead: tp?.$ === "Eql" ? "Eql" : tp?.$ === "Typ" ? "Typ" : h ? (h.k !== undefined ? (book.tlds[h.k]?.b === true ? h.k : norm(h.k)) : h.$) : "" });
    }
  }
  // which defs are proof, which laws are user laws
  let solutionLine = Infinity;
  const lineOf = new Map<string, number>();
  if (p.kind === "eval") {
    const lines = fs.readFileSync(p.entries[0], "utf8").split("\n");
    solutionLine = lines.findIndex((l) => /^#\s*solution\b/.test(l));
    lines.forEach((l, i) => { const m = /^(?:@unsafe\s+)?(?:def|law)\s+([A-Za-z_][\w.]*)/.exec(l); if (m && !lineOf.has(m[1])) lineOf.set(m[1], i); });
  }
  // a law whose statement is a proposition is a claim; one whose statement is
  // a data type (some evals declare the function to write as a law, e.g.
  // `law emit: for t: Tree ... List<Token>`) is code, filled below "# solution"
  const isClaimType = (k: string) => {
    const d = defs.get(k)!;
    const h = d.retHead;
    return h === "Eql" || h === "Empty" || h === "Sigma" || h === "Exists" || h === "Pair" || h === "Unit" || h === "Typ" || h === "Not"
      || (defs.get(h)?.sort ?? false) || d.eqAdt;
  };
  // a law whose statement is a data type (some evals declare the function to
  // write as a law, e.g. `law emit: for t: Tree ... List<Token>`) is code; a
  // claim on a proof-carrying datatype (eqAdt) is a claim whose fill is code too
  const isCodeLaw = (k: string) => { const d = defs.get(k)!; return d.t.$ === "Def" && d.t.l === true && !isClaimType(k); };
  const isLaw = (k: string) => {
    const d = defs.get(k)!;
    if (d.t.$ !== "Def" || d.t.l !== true || isCodeLaw(k)) return false;
    if (p.kind === "demo") return d.module === "LAWS";
    return (lineOf.get(d.name) ?? Infinity) < solutionLine;
  };
  const isProof = (k: string) => {
    const d = defs.get(k)!;
    if (d.t.$ !== "Def") return false;
    if (d.t.l === true) return !isCodeLaw(k) && !d.eqAdt; // a claim's def is its proof; a code law's def is code
    if (p.kind === "demo") return d.module === "PROOF" || d.module === "LAWS";
    return (lineOf.get(d.name) ?? -1) > solutionLine;
  };
  const laws = [...defs.keys()].filter(isLaw);
  const program = [...defs.keys()].filter((k) => defs.get(k)!.t.$ === "Def" && !isProof(k));
  const code = program.filter((k) => !defs.get(k)!.sort);
  const covered = new Set<string>();
  const perLaw: Record<string, number> = {};
  for (const l of laws) {
    const seen = new Set<string>();
    const todo = [...(defs.get(l)!.stmt ?? []), ...(defs.get(l)!.eqAdt ? [l] : [])];
    while (todo.length > 0) {
      const k = todo.pop() as string;
      if (seen.has(k) || !defs.has(k) || isProof(k)) continue;
      if (defs.get(k)!.t.l === true && !isCodeLaw(k) && !defs.get(k)!.eqAdt) continue;
      seen.add(k);
      for (const r of defs.get(k)!.refs) todo.push(r);
      if (isCodeLaw(k) || defs.get(k)!.eqAdt) for (const r of defs.get(k)!.lawBody) todo.push(r);
    }
    const inProg = [...seen].filter((k) => program.includes(k));
    perLaw[defs.get(l)!.name] = inProg.length;
    inProg.forEach((k) => covered.add(k));
  }
  const cat = (k: string) => {
    const d = defs.get(k)!;
    if (d.name === "main") return "main";
    if (d.ioType) return "IO";
    if (/^(Image|Pix|Qua)$/.test(d.retHead) || /(^|\.)(draw|view|show|render|paint|pix|cell|row|grid|frame|shade|color|sky|raster|tri|quad|mesh)/i.test(d.name)) return "render/graphics";
    if (/(^|\.)(read|parse|lex|tok|scan|chr|str_|word|digit|name)/i.test(d.name) || d.retHead === "String") return "parse/text";
    return "other logic";
  };
  const uncoveredCode = code.filter((k) => !covered.has(k));
  const cats: Record<string, number> = {};
  for (const k of uncoveredCode) cats[cat(k)] = (cats[cat(k)] ?? 0) + 1;
  results.push({
    project: p.name, kind: p.kind, laws: laws.length, codeLaws: [...defs.keys()].filter(isCodeLaw).length,
    programDefs: program.length, codeDefs: code.length, specDefs: program.length - code.length,
    coveredProgram: program.filter((k) => covered.has(k)).length,
    coveredCode: code.filter((k) => covered.has(k)).length,
    closurePerLaw: perLaw,
    uncoveredCodeByCategory: cats,
    uncoveredCodeSample: uncoveredCode.slice(0, 12).map((k) => defs.get(k)!.module + "." + defs.get(k)!.name),
  });
  process.stderr.write(`${p.name}: laws ${laws.length} code ${code.filter((k) => covered.has(k)).length}/${code.length} program ${program.filter((k) => covered.has(k)).length}/${program.length}\n`);
}
console.log(JSON.stringify(results, null, 1));
