// @ts-nocheck -- research script, run with bun; Bend's checker is loaded untyped at runtime.
// D3: deterministic indexing of a Bend project into a Shape model.
//
//   bun d3/extract.ts <project-dir> <out.shape> [records.json]
//
// Reads the project with Bend's own parser and checker (every .bend file of
// the directory is loaded as an entry; keys are merged), then writes:
//   - one component per Bend module (file), one fn per def (laws included,
//     open laws and datatypes excluded), each with source bend("file#name");
//   - effects complete {} for a def whose type does not mention IO and which
//     relies on no @unsafe or foreign def;
//   - for an IO def, typed effects derived from the Base effect defs its body
//     reaches (through every def body, Base included); effects unknown when it
//     reaches a user foreign effect (host code the checker never reads);
//   - an untargeted ReliesOnUnsafe effect for a def that relies on @unsafe
//     (a user @unsafe def skips the termination check; Base's Array.fork aliases);
//   - no effects for a law's def (a proof is erased: it never runs);
//   - grants equal to the effects its fns use, resources for each target;
//   - a calls relation A -> B for each module A whose def bodies name a
//     runtime def of module B.

import * as fs from "node:fs";
import * as path from "node:path";
import { Bend, termRefs, ctorFamily } from "../lib/bendbook.ts";

// Base foreign effect def -> typed Shape effects (verb, resource)
const EFFECTS: Array<[RegExp, Array<[string, string]>]> = [
  [/^IO\.(print|write|print_err)$/, [["Write", "Console"]]],
  [/^IO\.(get_env|args|args_bytes|thread_count)$/, [["Read", "Environment"]]],
  [/^Process\.run$/, [["Spawn", "Process"]]],
  [/^IO\.random_u32$/, [["Read", "Entropy"]]],
  [/^IO\.spawn$/, [["Spawn", "Task"]]],
  [/^IO\.(sleep|now)$/, [["Read", "Clock"]]],
  [/^Chan\.(send|try_send)$/, [["Write", "Channel"]]],
  [/^Chan\.(recv|try_recv)$/, [["Read", "Channel"]]],
  [/^Chan\.(new|close)$/, [["Update", "Channel"]]],
  [/^File\.(open|open_bytes)$/, [["Open", "FileSystem"]]],
  [/^File\.(read|read_bytes|read_at|size)$/, [["Read", "FileSystem"]]],
  [/^File\.(write|write_bytes)$/, [["Write", "FileSystem"]]],
  [/^File\.close$/, [["Close", "FileSystem"]]],
  [/^(TCP\.(listen|accept|try_accept|connect)|UDP\.bind)$/, [["Connect", "Network"]]],
  [/^(TCP|UDP)\.(try_)?send(_bytes)?(_to)?$/, [["Write", "Network"]]],
  [/^(TCP|UDP)\.(try_)?recv(_bytes)?(_from)?$/, [["Read", "Network"]]],
  [/^(Socket|Listener)\.close$/, [["Close", "Network"]]],
  [/^Window\.open$/, [["Open", "Display"]]],
  [
    /^Window\.frame$/,
    [
      ["Write", "Display"],
      ["Read", "Input"]
    ]
  ],
  [/^Window\.(set_title|grab)$/, [["Write", "Display"]]],
  [/^Window\.close$/, [["Close", "Display"]]],
  [/^Audio\.open$/, [["Open", "Audio"]]],
  [/^Audio\.write$/, [["Write", "Audio"]]],
  [/^Audio\.close$/, [["Close", "Audio"]]],
  [/^Halt$/, [["Exit", "Process"]]] // IO.OP's Halt constructor (IO.die, IO.exit, IO.pass on Fail)
];

const KEYWORDS = new Set(
  (
    "add allow applies_to approver as attest binding callbacks calls candidate change complete component confidence " +
    "conforms_to connects coordinated_call decided_on description effect effects evidence except expects expires final fingerprint fn forbid " +
    "grants guards has hypercycle implementation import kind memory modify module observed on_change or outcome over owner owns path paths " +
    "pin policy protects provides rationale reason reevaluation relation remove require require_changed require_context required requires " +
    "resource review_by reviewer role roles rule satisfied_by satisfies sensitive source status storage summary trait transform unknown " +
    "unsafe when when_changed who why"
  ).split(" ")
);

export type FnRecord = {
  key: string;
  module: string;
  file: string;
  name: string;
  shapeName: string;
  component: string;
  law: boolean;
  ioType: boolean;
  ioParam: boolean;
  unsafe: boolean;
  reliesUnsafe: string[];
  reliesForeign: string[];
  baseEffects: string[];
  effects: string[];
  claim: "complete" | "unknown";
  calls: string[];
};

function tip(T: any): { doms: any[]; ret: any } {
  const doms: any[] = [];
  let tel = Bend.term_strip(T);
  for (let d = 0; tel.$ === "All"; d++) {
    doms.push(tel.A);
    tel = Bend.term_strip(tel.B(Bend.Var(tel.k, d)));
  }
  return { doms, ret: tel };
}

async function analyse(entry: string, root: string) {
  const book = Bend.book_nil();
  await Bend.book_load(book, path.resolve(entry), "", new Map());
  Bend.book_valid(book, 0);
  const stem = path.relative(root, entry).replace(/\.bend$/, "");
  const norm = (k: string) => (k.includes(":") ? k : stem + ":" + k);
  const fam = ctorFamily(book);
  const refsCache = new Map<string, { type: Set<string>; body: Set<string>; ctrs: Set<string> }>();
  const refs = (k: string) => {
    let r = refsCache.get(k);
    if (r) return r;
    const t = book.tlds[k];
    r = { type: new Set<string>(), body: new Set<string>(), ctrs: new Set<string>() };
    if (t !== undefined) {
      if (t.$ === "ADT") {
        for (const c of [t, ...t.c]) termRefs(Bend.term_lower(c.T), r.type);
      } else {
        termRefs(Bend.term_lower(t.T), r.type);
        const ctrs = r.ctrs;
        if (t.e !== undefined) termRefs(t.e, r.body, ctrs);
        else if (t.v !== null && t.v !== undefined) termRefs(Bend.term_lower(t.v), r.body, ctrs);
        for (const c of ctrs) {
          const f = fam.get(c);
          if (f) r.body.add(f);
        }
      }
      r.type.delete(k);
      r.body.delete(k);
    }
    refsCache.set(k, r);
    return r;
  };
  const isDef = (k: string) => book.tlds[k]?.$ === "Def";
  const isSort = (k: string) => {
    const t = book.tlds[k];
    return t?.$ === "Def" && tip(t.T).ret.$ === "Typ";
  };
  // all defs reachable from k over the given edge kinds
  const reach = (k: string, withTypes: boolean, stopForeign: boolean): Set<string> => {
    const seen = new Set<string>();
    const todo = [k];
    while (todo.length > 0) {
      const j = todo.pop() as string;
      if (seen.has(j)) continue;
      seen.add(j);
      const t = book.tlds[j];
      if (t === undefined) continue;
      if (stopForeign && t.$ === "Def" && t.i !== undefined && j !== k) continue;
      const r = refs(j);
      for (const x of r.body) todo.push(x);
      if (withTypes) for (const x of r.type) todo.push(x);
    }
    seen.delete(k);
    return seen;
  };
  const out = new Map<string, Omit<FnRecord, "shapeName" | "component" | "effects" | "claim">>();
  for (const k of new Set<string>(book.order)) {
    const t = book.tlds[k];
    if (t === undefined || t.b === true || t.$ !== "Def") continue;
    if (t.v === null && !t.i) continue; // open law: not a def
    const nk = norm(k);
    const [mod, name] = nk.split(":");
    const all = reach(k, true, false);
    const run = reach(k, false, true);
    const typeIO = refs(k).type.has("IO");
    const { doms } = tip(t.T);
    const ioParam = doms.some((A: any) => {
      const s = new Set<string>();
      termRefs(Bend.term_lower(A), s);
      return s.has("IO");
    });
    // a template instance (T~n) counts as a call of its template; Base's (bare keys) are not modules
    const tmpl = (j: string) => j.replace(/~\d+$/, "");
    const callTargets = [...refs(k).body]
      .filter(
        (j) => isDef(j) && book.tlds[tmpl(j)]?.b !== true && book.tlds[j].b !== true && !isSort(j)
      )
      .map((j) => norm(tmpl(j)).split(":")[0])
      .filter((m) => m !== mod);
    out.set(nk, {
      key: nk,
      module: mod,
      file: mod + ".bend",
      name,
      law: t.l === true,
      ioType: typeIO,
      ioParam,
      unsafe: t.u === true,
      reliesUnsafe: [...all]
        .filter((j) => book.tlds[j]?.u === true)
        .map(norm)
        .concat(t.u === true ? [nk] : []),
      reliesForeign: [...all, k]
        .filter((j) => {
          const d = book.tlds[j];
          return d?.$ === "Def" && d.i !== undefined && d.b !== true;
        })
        .map(norm),
      // a law's def is a proof: erased, it runs nothing, even when its statement mentions IO
      baseEffects:
        t.l === true
          ? []
          : [...run, k]
              .filter((j) => {
                const d = book.tlds[j];
                return d?.$ === "Def" && d.i !== undefined && d.b === true;
              })
              .concat(typeIO && [...run, k].some((j) => refs(j).ctrs.has("Halt")) ? ["Halt"] : [])
              .sort(),
      calls: [...new Set(callTargets)].sort()
    });
  }
  return out;
}

const pascal = (s: string) =>
  s
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join("") || "Root";

export async function extract(root: string) {
  const entries = fs
    .readdirSync(root)
    .filter((f) => f.endsWith(".bend"))
    .sort()
    .sort((a, b) => (b === "PROOF.bend" ? 1 : 0) - (a === "PROOF.bend" ? 1 : 0))
    .map((f) => path.join(root, f));
  const recs = new Map<string, Omit<FnRecord, "shapeName" | "component" | "effects" | "claim">>();
  const errors: string[] = [];
  for (const e of entries) {
    try {
      for (const [k, v] of await analyse(e, root)) if (!recs.has(k)) recs.set(k, v);
    } catch (err: any) {
      errors.push(
        path.basename(e) +
          ": " +
          (err?.$ === "Err"
            ? Bend.err_show(err).split("\n").slice(0, 3).join(" ")
            : String(err)
          ).slice(0, 200)
      );
    }
  }
  const modules = [...new Set([...recs.values()].map((r) => r.module))].sort();
  const compOf = new Map<string, string>();
  const usedC = new Set<string>();
  for (const m of modules) {
    let c = pascal(m);
    while (usedC.has(c) || KEYWORDS.has(c)) c += "_";
    usedC.add(c);
    compOf.set(m, c);
  }
  const out: FnRecord[] = [];
  const usedN = new Map<string, Set<string>>();
  for (const r of [...recs.values()].sort((a, b) => a.key.localeCompare(b.key))) {
    const comp = compOf.get(r.module) as string;
    const names = usedN.get(comp) ?? new Set<string>();
    usedN.set(comp, names);
    let n = r.name.replace(/[^A-Za-z0-9_]/g, "_");
    if (!/^[_A-Za-z]/.test(n)) n = "_" + n;
    while (KEYWORDS.has(n) || names.has(n)) n += "_";
    names.add(n);
    const effects = new Set<string>();
    for (const b of r.baseEffects) {
      const hit = EFFECTS.find(([re]) => re.test(b));
      for (const [v, res] of hit ? hit[1] : [["Unmapped", "Host"] as [string, string]])
        effects.add(v + "<" + res + ">");
    }
    if (r.reliesUnsafe.length > 0) effects.add("ReliesOnUnsafe");
    out.push({
      ...r,
      shapeName: n,
      component: comp,
      effects: [...effects].sort(),
      claim: r.reliesForeign.length > 0 ? "unknown" : "complete"
    });
  }
  // Shape text
  const demo = path.basename(path.resolve(root)).replace(/[^A-Za-z0-9_]/g, "_");
  const lines: string[] = [`module bend.${demo}`, ""];
  const resources = new Set<string>();
  for (const f of out)
    for (const e of f.effects) {
      const m = /<(\w+)>/.exec(e);
      if (m) resources.add(m[1]);
    }
  for (const r of [...resources].sort()) lines.push(`resource ${r} : External`, "");
  for (const m of modules) {
    const comp = compOf.get(m) as string;
    const fns = out.filter((f) => f.module === m);
    const grants = [
      ...new Set(
        fns.flatMap((f) => (f.claim === "complete" ? f.effects.filter((e) => e.includes("<")) : []))
      )
    ].sort();
    lines.push(`component ${comp} {`);
    for (const g of grants) lines.push(`  grants ${g}`);
    for (const f of fns) {
      lines.push(
        `  fn ${f.shapeName}`,
        `    source bend(${JSON.stringify(f.file + "#" + f.name)})`
      );
      if (f.claim === "unknown") {
        lines.push("    effects unknown");
        continue;
      }
      if (f.effects.length === 0) {
        lines.push("    effects complete {", "    }");
        continue;
      }
      lines.push("    effects complete {");
      for (const e of f.effects) lines.push(`      ${e}`);
      lines.push("    }");
    }
    lines.push("}", "");
  }
  const edges = new Set<string>();
  for (const f of out) for (const t of f.calls) edges.add(f.module + "\u0000" + t);
  for (const e of [...edges].sort()) {
    const [a, b] = e.split("\u0000");
    if (!compOf.has(b)) continue;
    const ca = compOf.get(a) as string,
      cb = compOf.get(b) as string;
    lines.push(`relation ${ca}Calls${cb} {`, "  kind calls", `  connects ${ca} -> ${cb}`, "}", "");
  }
  return {
    shape: lines.join("\n"),
    records: out,
    errors,
    modules: modules.map((m) => [m, compOf.get(m)])
  };
}

if (import.meta.main) {
  const r = await extract(process.argv[2]);
  fs.writeFileSync(process.argv[3], r.shape);
  if (process.argv[4])
    fs.writeFileSync(
      process.argv[4],
      JSON.stringify({ errors: r.errors, modules: r.modules, records: r.records }, null, 1)
    );
  const n = r.records.length;
  const io = r.records.filter((f) => f.ioType).length;
  const unk = r.records.filter((f) => f.claim === "unknown").length;
  const div = r.records.filter((f) => f.effects.includes("ReliesOnUnsafe")).length;
  process.stderr.write(
    `${path.basename(process.argv[2])}: ${n} fns, ${io} IO-typed, ${unk} unknown, ${div} ReliesOnUnsafe, errors ${r.errors.length}\n`
  );
}
