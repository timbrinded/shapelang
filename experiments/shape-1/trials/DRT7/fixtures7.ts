// @ts-nocheck
// DRT7 fixtures: the 853 DRT fixtures and the 0.x skills, pass and fail fixtures as version 7
// checker inputs (A.11.2.4).
//   bun experiments/shape-1/trials/DRT7/fixtures7.ts <outDir> <workDir>
// Writes <outDir>/{h4,h3,h5,x}/*.json, <outDir>/fixtures.tsv (the gate list: "<id>\t<set>\t<path>")
// and <outDir>/fixtures-log.json; materialises model directories under <workDir> only. Sources:
//   P   (21): m0/golden/inputs, the frozen version 7 copies of the example inputs (listed in place);
//   H4 (122): trials/H4/build.ts's 33 cases (23 fixtures/loosening pairs, 2 skills/guard, 8
//            calibration) as fwd, fwdu and rev, plus orig (the untouched fixtures/loosening
//            directories, so governed_paths_narrowed.orig is governed_paths_narrowed_no_files), each
//            rebuilt by the version 7 prototype (shape1 check --synthesize --write-input); the 16
//            rename fixtures are the four rename cases' runs (set H4-rename);
//   H3 (636), H5 (74): the dumped version 6 inputs (scratch H3/dump, H5/xcheck/inputs,
//            H5/dumptest), upgraded to the version 7 input profile (upgradeV6, below);
//   X: fixtures/pass (11) and fixtures/fail (23), each 0.x model in audit mode, as a first adoption
//            over an empty base (A.16.17) and over an unreadable base (L0); fixtures/skills: the
//            review cases (base code vs candidate code), the preflight cases (base.shape vs
//            proposal.shape) and the index and unix-system-visualiser models (audit and empty base);
//            each unit without code gets one synthesised identity (as trials/H4/cases.ts completes).
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { manifestStatement } from "../../proto/src/manifest.ts";
import { makeStatement, signStatement, signerFromSeed } from "../../proto/src/records.ts";

const [outDir, workDir] = process.argv.slice(2);
if (!outDir || !workDir) {
  process.stderr.write("usage: bun fixtures7.ts <outDir> <workDir>\n");
  process.exit(2);
}
const REPO = "/home/user/shapelang";
const S1 = `${REPO}/experiments/shape-1`;
const SCRATCH =
  "/tmp/claude-0/-home-user-shapelang/83ff80bc-0161-572f-9e5a-9075cccad6d0/scratchpad/shape1work";
const CLI = `${S1}/proto/src/cli.ts`;
const NOW = "2026-10-25T12:00:00Z";
for (const d of ["h4", "h3", "h5", "x"]) mkdirSync(join(outDir, d), { recursive: true });
mkdirSync(workDir, { recursive: true });
const list = [];
const log = { h4: [], upgrade: { h3: {}, h5: {} }, x: [] };

// ---- P: the frozen version 7 example inputs ---------------------------------------------------------
for (const f of readdirSync(`${S1}/m0/golden/inputs`)
  .filter((x) => x.endsWith(".json"))
  .sort())
  list.push([`P-${f.replace(/\.json$/, "")}`, "P", `${S1}/m0/golden/inputs/${f}`]);

// ---- shape1 check --write-input ---------------------------------------------------------------------
function writeInput(model, base, out, extra = []) {
  const args = [
    CLI,
    "check",
    "--model",
    model,
    ...(base ? ["--base", base] : []),
    "--synthesize",
    "--maintainer",
    "alice",
    "--maintainer",
    "bob",
    "--now",
    NOW,
    "--json",
    "--write-input",
    out,
    ...extra
  ];
  const r = spawnSync("bun", args, { cwd: workDir, maxBuffer: 1 << 28, encoding: "utf8" });
  return {
    ok: existsSync(out),
    status: r.status,
    stderr: (r.stderr ?? "").split("\n").slice(-4).join(" | "),
    out: r.stdout
  };
}

// ---- H4 ----------------------------------------------------------------------------------------------
const RENAMES = new Set([
  "renamed_component",
  "renamed_component_and_narrowed_rule",
  "resource_renamed_trait_dropped",
  "resource_renamed_trait_kept"
]);
{
  const casesDir = join(workDir, "h4cases");
  rmSync(casesDir, { recursive: true, force: true });
  const b = spawnSync("bun", [`${S1}/trials/H4/build.ts`, casesDir], {
    cwd: workDir,
    encoding: "utf8"
  });
  if (b.status !== 0) throw new Error(`trials/H4/build.ts failed: ${b.stderr}`);
  const { CASES } = await import(`${S1}/trials/H4/cases.ts`);
  for (const c of CASES) {
    const runs = [
      ...["fwd", "fwdu", "rev"].map((run) => [
        run,
        join(casesDir, c.id, run, "head"),
        join(casesDir, c.id, run, "base")
      ]),
      ...(c.family === "loosening" ? [["orig", c.head, c.base]] : [])
    ];
    for (const [run, head, base] of runs) {
      const id = `H4-${c.id}.${run}`;
      const out = join(outDir, "h4", `${id}.json`);
      const r = writeInput(head, base, out);
      log.h4.push({ id, ok: r.ok, status: r.status, stderr: r.ok ? undefined : r.stderr });
      if (r.ok) list.push([id, RENAMES.has(c.id) ? "H4-rename" : "H4", out]);
    }
  }
}

// ---- version 6 dumps upgraded to the version 7 profile ----------------------------------------------
const SCRIPT_EXTS = new Set(
  "sh bash zsh fish py rb pl php ps1 bat cmd sql swift go java kt scala c h cc cpp hpp cs lua r jl ex exs erl hs ml dart groovy zig html htm astro vue svelte".split(
    " "
  )
);
const SIGNERS = [
  signerFromSeed(createHash("sha256").update("shape-h3-law-suite-provider").digest("hex")),
  signerFromSeed(createHash("sha256").update("shape-h5-reviewer").digest("hex"))
];
const signerOf = (keyid) => SIGNERS.find((s) => s.identity === `ed25519("${keyid}")`) ?? null;
const decode = (env) => JSON.parse(Buffer.from(env.payload, "base64").toString("utf8"));
const isEnv = (x) => x && typeof x.payload === "string" && typeof x.payloadType === "string";
function executableOf(id, mode) {
  const lang = id.split(":")[0];
  const file = id.split("#")[0];
  if (lang === "ts" || lang === "rust" || lang === "verus") return true;
  if (lang === "pkgjson" || lang === "gha") return id.includes("#"); // command identities (A.16.22)
  if (lang === "raw") {
    const base = file.slice(4).split("/").pop() ?? "";
    const ext = base.includes(".") ? base.split(".").pop() : "";
    return (
      SCRIPT_EXTS.has(ext) ||
      ["Makefile", "GNUmakefile", "Dockerfile", "Justfile"].includes(base) ||
      mode === "100755"
    );
  }
  return false;
}

/** The version 7 form of a version 6 checker input (A.16.2, A.16.22, A.16.35, D15, D16, D27). */
export function upgradeV6(input, stats) {
  const x = structuredClone(input);
  const bump = (k) => {
    stats[k] = (stats[k] ?? 0) + 1;
  };
  // (1) manifest entries carry refs, executable and hatchComplete (A.12.7.5, A.16.22 [D27])
  for (const side of ["head", "base"]) {
    const rev = x[side];
    if (!rev?.manifest) continue;
    if (isEnv(rev.manifest)) {
      bump("manifest-enveloped-kept");
      continue;
    }
    const p = rev.manifest.predicate.shape;
    const modeOf = new Map((p.tree ?? []).map((t) => [t.path, t.mode]));
    let changed = false;
    const entries = p.entries.map((e) => {
      const file = e.id.split("#")[0];
      const path = file.slice(file.indexOf(":") + 1);
      const ne = {
        ...e,
        refs: e.refs ?? [],
        executable: e.executable ?? executableOf(e.id, modeOf.get(path)),
        hatchComplete: e.hatchComplete !== false
      };
      if (e.refs === undefined || e.executable === undefined || e.hatchComplete === undefined)
        changed = true;
      return ne;
    });
    if (changed) bump("manifest-flags");
    rev.manifest = manifestStatement({ ...p, entries });
  }
  // (2) audit mode has no base (D16); options.health true (the kernel fragment, A.16.30)
  if (x.mode === "audit" && x.base !== null) {
    x.base = null;
    bump("audit-base-dropped");
  }
  if (!x.options || x.options.health !== true || x.options.teeth !== false) bump("options");
  x.options = { health: true, teeth: false };
  // (3) records: n on presence-sound effect facts (RJ14 [D15]); test counterexamples {seed, inputs,
  // assertion} (A.12.5.2, A.16.35 [D21]); re-signed by the same identity
  const presence = new Set();
  for (const side of ["head", "base"])
    for (const m of x[side]?.source?.modules ?? [])
      for (const d of m.decls ?? [])
        if (d.decl === "provider" && (d.sound ?? []).includes("presence"))
          presence.add(`${m.module}::${d.name}`);
  const fix = (r) => {
    const env = isEnv(r) ? r : null;
    const st = env ? decode(env) : r;
    const s = structuredClone(st.predicate.shape);
    let changed = false;
    if (s.kind === "observation" && presence.has(s.provider?.id ?? ""))
      for (const f of s.facts ?? [])
        if (f.type === "effect" && f.n === undefined) {
          f.n = 1;
          changed = true;
        }
    if (
      (s.kind === "test" || s.kind === "proof") &&
      s.result === "contradicts" &&
      s.counterexample &&
      typeof s.counterexample === "object"
    ) {
      const c = s.counterexample;
      if (!("seed" in c && "inputs" in c && "assertion" in c)) {
        s.counterexample = {
          seed: s.bound?.seed ?? 0,
          inputs: c.inputs ?? c.input ?? null,
          assertion: c.assertion ?? c.law ?? null
        };
        changed = true;
        bump("counterexample-v7");
      }
    }
    if (!changed) return r;
    const stmt = makeStatement(s);
    if (!env) {
      bump("record-rebuilt-unsigned");
      return stmt;
    }
    const signers = env.signatures.map((g) => signerOf(g.keyid));
    if (signers.some((g) => !g)) {
      bump("record-unknown-signer-kept");
      return r;
    }
    bump("record-resigned");
    return signStatement(stmt, signers);
  };
  x.records = (x.records ?? []).map(fix);
  x.baseRecords = (x.baseRecords ?? []).map(fix);
  return x;
}

for (const [set, dirs] of [
  ["H3", [`${SCRATCH}/H3/dump`]],
  ["H5", [`${SCRATCH}/H5/xcheck/inputs`, `${SCRATCH}/H5/dumptest`]]
]) {
  const stats = log.upgrade[set.toLowerCase()];
  for (const dir of dirs)
    for (const f of readdirSync(dir)
      .filter((y) => y.endsWith(".json"))
      .sort()) {
      const v6 = JSON.parse(readFileSync(join(dir, f), "utf8"));
      const v7 = upgradeV6(v6, stats);
      const id = `${set}-${f.replace(/\.input\.json$|\.json$/, "")}${dir.endsWith("dumptest") ? "-dumptest" : ""}`;
      const out = join(outDir, set.toLowerCase(), `${id}.json`);
      writeFileSync(out, JSON.stringify(v7));
      list.push([id, set, out]);
      stats.inputs = (stats.inputs ?? 0) + 1;
    }
}

// ---- X: fixtures/pass, fixtures/fail, fixtures/skills ----------------------------------------------
function shapeFilesIn(dir) {
  const out = [];
  const rec = (d) => {
    for (const e of readdirSync(d).sort()) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) rec(p);
      else if (e.endsWith(".shape")) out.push(p);
    }
  };
  rec(dir);
  return out;
}
/** A model directory: the shape files at their paths, plus code directories copied to theirs. */
function materialise(dst, shapeFiles, copies = []) {
  rmSync(dst, { recursive: true, force: true });
  mkdirSync(join(dst, "shape"), { recursive: true });
  for (const [rel, src] of shapeFiles) {
    mkdirSync(dirname(join(dst, rel)), { recursive: true });
    cpSync(src, join(dst, rel));
  }
  for (const [src, rel] of copies) {
    if (!existsSync(src)) continue;
    mkdirSync(join(dst, rel), { recursive: true });
    cpSync(src, join(dst, rel), {
      recursive: true,
      filter: (q) => !q.endsWith(".shape") && !basename(q).startsWith(".")
    });
  }
  return dst;
}
/** One synthesised identity per unit the elaboration leaves unbound (E-unbound by name). */
function complete(model, input) {
  const comps = new Map();
  for (const m of input.head.source?.modules ?? [])
    for (const d of m.decls ?? [])
      if (d.decl === "component") comps.set(`${m.module}::${d.name}`, d);
  const out = spawnSync("bun", [CLI, "check", "--input", "-", "--json"], {
    input: JSON.stringify(input),
    cwd: workDir,
    maxBuffer: 1 << 28,
    encoding: "utf8"
  });
  let added = 0;
  try {
    for (const e of JSON.parse(out.stdout).errors ?? []) {
      if (e.code !== "E-unbound" || !e.subject.startsWith("unit ")) continue;
      const q = e.subject.slice(5);
      const name = q.split(".").pop();
      const comp = comps.get(q.slice(0, q.lastIndexOf(".")));
      const glob = comp?.paths?.[0];
      if (!glob) continue;
      const path =
        /\.(ts|tsx|js)$/.test(glob) && !/[*?]/.test(glob)
          ? glob
          : `${glob
              .replace(/\*\*\/?/g, "")
              .replace(/\*.*$/, "")
              .replace(/\/$/, "")}/${name}.ts`;
      const p = join(model, path);
      mkdirSync(dirname(p), { recursive: true });
      const prev = existsSync(p) ? readFileSync(p, "utf8") : "";
      writeFileSync(
        p,
        `${prev}export function ${name}() {\n  return ${JSON.stringify(name)};\n}\n`
      );
      added += 1;
    }
  } catch {
    // no output: leave the model as it is
  }
  return added;
}
const empty = join(workDir, "x-empty-base");
mkdirSync(empty, { recursive: true });
function xCase(id, set, headModel, baseModel, variants) {
  for (const v of variants) {
    const out = join(outDir, "x", `${id}.${v}.json`);
    const tmp = join(workDir, "x-tmp.json");
    rmSync(tmp, { force: true });
    const r =
      v === "audit"
        ? writeInput(headModel, null, tmp, ["--mode", "audit"])
        : writeInput(headModel, v === "change" ? baseModel : empty, tmp);
    if (!r.ok) {
      log.x.push({ id: `${id}.${v}`, ok: false, stderr: r.stderr });
      continue;
    }
    const input = JSON.parse(readFileSync(tmp, "utf8"));
    if (v === "empty-base") input.base.source = { v: "shape.source.v1", modules: [] };
    if (v === "unreadable-base") input.base.source = null;
    writeFileSync(out, JSON.stringify(input));
    log.x.push({ id: `${id}.${v}`, ok: true });
    list.push([`X-${id}.${v}`, set, out]);
  }
}
function prepared(id, shapeFiles, copies) {
  const m = materialise(join(workDir, "x", id), shapeFiles, copies);
  for (let k = 0; k < 3; k += 1) {
    const tmp = join(workDir, "x-probe.json");
    rmSync(tmp, { force: true });
    if (!writeInput(m, null, tmp, ["--mode", "audit"]).ok) break;
    if (complete(m, JSON.parse(readFileSync(tmp, "utf8"))) === 0) break;
  }
  return m;
}
/** Code directories of a skills case, at the path its shapes' sources name. */
function codeCopies(d, shapeFiles, subs, as = null) {
  const repoRel = shapeFiles.some(([, p]) => readFileSync(p, "utf8").includes('ts("fixtures/'));
  const rel = d.slice(REPO.length + 1);
  return subs.map((sub) => [join(d, sub), repoRel ? join(rel, as ?? sub) : (as ?? sub)]);
}
for (const fam of ["pass", "fail"])
  for (const name of readdirSync(`${REPO}/fixtures/${fam}`).sort()) {
    const dir = `${REPO}/fixtures/${fam}/${name}`;
    const files = shapeFilesIn(dir).map((p) => [`shape/${p.slice(dir.length + 1)}`, p]);
    const m = prepared(`${fam}-${name}`, files, []);
    xCase(`${fam}-${name}`, `X-${fam}`, m, null, ["audit", "empty-base", "unreadable-base"]);
  }
{
  const SK = `${REPO}/fixtures/skills`;
  for (const name of readdirSync(`${SK}/review`).sort()) {
    const d = `${SK}/review/${name}`;
    const files = shapeFilesIn(`${d}/shape`).map((p) => [`shape/${p.slice(d.length + 7)}`, p]);
    const base = prepared(
      `skills-review-${name}-base`,
      files,
      codeCopies(d, files, ["base"], "candidate")
    );
    const head = prepared(`skills-review-${name}-head`, files, codeCopies(d, files, ["candidate"]));
    xCase(`skills-review-${name}`, "X-skills", head, base, ["change"]);
  }
  for (const name of readdirSync(`${SK}/preflight`).sort()) {
    const d = `${SK}/preflight/${name}`;
    const base = prepared(
      `skills-preflight-${name}-base`,
      [["shape/base.shape", `${d}/shape/base.shape`]],
      []
    );
    const head = prepared(
      `skills-preflight-${name}-head`,
      [
        ["shape/base.shape", `${d}/shape/base.shape`],
        ["shape/proposal.shape", `${d}/proposal.shape`]
      ],
      []
    );
    xCase(`skills-preflight-${name}`, "X-skills", head, base, ["change"]);
  }
  for (const group of ["index", "unix-system-visualiser"])
    for (const name of readdirSync(`${SK}/${group}`).sort()) {
      const d = `${SK}/${group}/${name}`;
      if (!statSync(d).isDirectory() || !existsSync(`${d}/shape`)) continue;
      const files = shapeFilesIn(`${d}/shape`).map((p) => [`shape/${p.slice(d.length + 7)}`, p]);
      const subs = readdirSync(d).filter(
        (e) => e !== "shape" && statSync(join(d, e)).isDirectory()
      );
      const m = prepared(`skills-${group}-${name}`, files, codeCopies(d, files, subs));
      xCase(`skills-${group}-${name}`, "X-skills", m, null, ["audit", "empty-base"]);
    }
}

writeFileSync(join(outDir, "fixtures.tsv"), `${list.map((r) => r.join("\t")).join("\n")}\n`);
const bySet = {};
for (const [, set] of list) bySet[set] = (bySet[set] ?? 0) + 1;
log.bySet = bySet;
writeFileSync(join(outDir, "fixtures-log.json"), `${JSON.stringify(log, null, 1)}\n`);
process.stdout.write(`${JSON.stringify(bySet)}\n`);
