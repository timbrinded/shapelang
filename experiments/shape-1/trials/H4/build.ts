// @ts-nocheck
// Materialises every H4 case as three base/head pairs of model directories:
//   fwd : base shape + base code      vs head shape + head code     (the change as authored)
//   fwdu: base shape + union code     vs head shape + union code    (forward over one code world)
//   rev : head shape + union code     vs base shape + union code    (reverse: does the head tighten?)
// Usage: bun build.ts <outdir>
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { CASES } from "./cases.ts";

const out = process.argv[2];
if (!out) throw new Error("usage: bun build.ts <outdir>");

function walk(dir) {
  const files = [];
  const rec = (d) => {
    for (const e of readdirSync(d).sort()) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) rec(p);
      else files.push(p);
    }
  };
  rec(dir);
  return files;
}

/** shape files (keyed by their path under the model dir) and real code files of one side */
function readSide(dir, flat) {
  const shape = {};
  const code = {};
  for (const p of walk(dir)) {
    const rel = relative(dir, p);
    if (rel.endsWith(".shape")) shape[flat ? `shape/${rel}` : rel] = readFileSync(p, "utf8");
    else if (rel !== "changed-files.txt" && rel !== "repository.txt") code[rel] = readFileSync(p, "utf8");
  }
  return { shape, code };
}

/** `shape1 check --synthesize`'s files: one per ts("path#sym") unit source and per literal .ts path */
function synthSymbols(shape) {
  const by = new Map();
  for (const text of Object.values(shape)) {
    for (const m of text.matchAll(/source\s+ts\("([^"#]+)(?:#([^"]+))?"\)/g)) {
      const s = by.get(m[1]) ?? new Set();
      if (m[2]) s.add(m[2]);
      by.set(m[1], s);
    }
    for (const blk of text.matchAll(/implementation\s+\w+\s*\{[^]*?paths\s*\{([^}]*)\}/g))
      for (const q of blk[1].matchAll(/"([^"]+)"/g))
        if (!/[*?]/.test(q[1]) && /\.(ts|tsx|js|mjs|cjs)$/.test(q[1]) && !by.has(q[1])) by.set(q[1], new Set());
  }
  return by;
}
const synthText = (syms) =>
  [...syms].sort().map((s) => `export function ${s.split(".").pop() ?? s}() {\n  return ${JSON.stringify(s)};\n}\n`).join("\n") || "export {};\n";

function codeOf(side, extra, syms) {
  const code = { ...side.code };
  for (const [p, t] of Object.entries(extra ?? {})) if (!(p in code)) code[p] = t;
  for (const [p, s] of syms) if (!(p in code)) code[p] = synthText(s);
  return code;
}

function writeModel(dir, shape, code) {
  for (const [p, t] of Object.entries({ ...code, ...shape })) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), t);
  }
}

function normalise(c) {
  return { ...c, baseDir: c.base, headDir: c.head, extraBase: c.extra?.base ?? {}, extraHead: c.extra?.head ?? {} };
}

rmSync(out, { recursive: true, force: true });
const rows = [];
for (const c0 of CASES) {
  const c = normalise(c0);
  const B = readSide(c.baseDir, c.flat);
  const Hh = readSide(c.headDir, c.flat);
  const sb = synthSymbols(B.shape);
  const sh = synthSymbols(Hh.shape);
  const codeB = codeOf(B, c.extraBase, sb);
  const codeH = codeOf(Hh, c.extraHead, sh);
  // union code: synthesised files merge their symbol sets; other files take the head's text
  const su = new Map(sb);
  for (const [p, s] of sh) su.set(p, new Set([...(su.get(p) ?? []), ...s]));
  const codeU = { ...codeB, ...codeH };
  for (const [p, s] of su) if (!(p in Hh.code) && !(p in B.code) && !(p in c.extraHead) && !(p in c.extraBase)) codeU[p] = synthText(s);
  const root = join(out, c.id);
  writeModel(join(root, "fwd/base"), B.shape, codeB);
  writeModel(join(root, "fwd/head"), Hh.shape, codeH);
  writeModel(join(root, "fwdu/base"), B.shape, codeU);
  writeModel(join(root, "fwdu/head"), Hh.shape, codeU);
  writeModel(join(root, "rev/base"), Hh.shape, codeU);
  writeModel(join(root, "rev/head"), B.shape, codeU);
  // changed files for 0.x: the registry's list, else every path whose text differs
  const all = new Set([...Object.keys({ ...B.shape, ...codeB }), ...Object.keys({ ...Hh.shape, ...codeH })]);
  const changed =
    c.changed ??
    [...all].filter((p) => ({ ...B.shape, ...codeB })[p] !== ({ ...Hh.shape, ...codeH })[p]).sort();
  writeFileSync(join(root, "changed-files.txt"), `${changed.join("\n")}\n`);
  rows.push({ id: c.id, family: c.family, baseCode: Object.keys(codeB).sort(), headCode: Object.keys(codeH).sort(), unionCode: Object.keys(codeU).sort(), changed });
}
writeFileSync(join(out, "index.json"), `${JSON.stringify(rows, null, 1)}\n`);
console.log(`${rows.length} cases written to ${out}`);
