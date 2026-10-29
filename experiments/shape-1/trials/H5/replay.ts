// @ts-nocheck
// H5 replay: the Verus corpus history through Shape 1.0 trust-surface claims and the 1.0 prototype
// checker (proto/src/derive.ts).
//
// Inputs, per repository:
//   - <walk>/<repo>.walk.json + .blobs.jsonl (walk_fn.py): first-parent steps and per-blob vprobe
//     records; check_walk.py verifies they reproduce results/per-commit/*.json.gz row for row;
//   - results/per-commit/<repo>.json.gz: E9's ground truth (trust events per commit and file).
//
// The shape is the one a model author writes once, at the repository's first commit that holds a
// trust marker (c0), and never edits afterwards (variants F-*), or keeps current (variant M):
//   boundary TrustedSurface : ReviewedSurface { tier critical  bind paths {…}  allows hatch <kinds> }
//   rule NoHatches = HatchesStayAtBoundaries<> { tier critical }
// Variants (boundary paths):
//   F-conv  the files holding a marker at c0, plus "**/*_t.rs" when c0's tree has any *_t.rs file
//   F-dir   "<dir>/**/*.rs" for each directory holding a marked file at c0 (plus the _t.rs glob)
//   M       F-conv's globs plus every file holding a marker at the commit's base (the inventory
//           kept current; each widening would be an L7 loosening a person answers, not replayed)
// `allows` lists the std hatch kinds present inside the boundary at c0 (M: at the base as well).
//
// Manifests ("pipelines"):
//   A  identities, digests and markers from vprobe (verus_syn, the E9 instrument): one identity per
//      vprobe function (unit/own digest over contract hash, body hash, flags and marker counts;
//      contract digest = contract hash), one per file (own digest over its function keys and the
//      markers outside functions); hatch-complete iff vprobe parsed the file without macro errors.
//   B  identities, digests and markers from the prototype's own Rust/Verus scanner
//      (proto/src/fingerprint/rust.ts, the core manifest the trust provider audits).
// Only files that changed in the commit or hold a marker at base or head are listed: for this shape
// every other file is unchanged, unmarked and constrained by nothing that can fire (checked with
// --full on a sample).
//
// Records: one claim judgment of the ReviewedSurface law by an eligible person (not an author),
// signed, citing Req(c) at the base (each marked identity in the boundary: functions at unit, files
// at own). The base surface is therefore judged and fresh before every commit: each commit is
// judged in isolation, as E9 counts recall per commit.
//
// Usage: bun replay.ts --repo <name> --variant F-conv|F-dir|M --pipeline A|B --out <file.jsonl>
//        [--walk dir] [--per-commit dir] [--repos dir] [--limit n] [--only <commit,...>] [--full]
//        [--hatch-rule kinds|star] [--dump-inputs dir]
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { derive } from "../../proto/src/derive.ts";
import { elaborate } from "../../proto/src/elaborate.ts";
import { fingerprintRust } from "../../proto/src/fingerprint/rust.ts";
import { globMatches } from "../../proto/src/globs.ts";
import { reqOf } from "../../proto/src/laws.ts";
import { indexManifest, manifestStatement } from "../../proto/src/manifest.ts";
import { makeStatement, signStatement, signerFromSeed } from "../../proto/src/records.ts";
import { buildWorld } from "../../proto/src/world.ts";

const SCRATCH =
  "/tmp/claude-0/-home-user-shapelang/83ff80bc-0161-572f-9e5a-9075cccad6d0/scratchpad";
const arg = (k: string, d: string | null = null): string | null => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : d;
};
const REPO = arg("repo");
const VARIANT = arg("variant", "F-conv");
const PIPE = arg("pipeline", "A");
const OUT = arg("out");
const WALK = arg("walk", `${SCRATCH}/shape1work/H5/walk`);
const PC = arg("per-commit", "/home/user/shapelang/experiments/verus-probes/results/per-commit");
const REPOS = arg("repos", `${SCRATCH}/repos`);
const LIMIT = Number(arg("limit", "0"));
const ONLY = arg("only") ? new Set(arg("only").split(",")) : null;
const FULL = process.argv.includes("--full");
const DUMP = arg("dump-inputs"); // write each commit's CheckInput as <dir>/<repo>-<commit>.input.json
// "kinds": `forbid hatch <the nine std hatch kinds> outside boundaries` (the intended reading of
// HatchesStayAtBoundaries). "star": the std template as the prototype elaborates `*` literally, which
// adds effect.forbid(Hatch<Trust>, [*], boundaries allowing Hatch); every declared kind implies Hatch,
// so that forbid also covers every marker inside every boundary (a spec defect, reported).
const HATCH_RULE = arg("hatch-rule", "kinds");
const STD_HATCH_KINDS = [
  "admit",
  "assume",
  "assume_specification",
  "axiom",
  "external",
  "external_body",
  "ts_ignore",
  "uninterp",
  "unsafe"
];
if (!REPO || !OUT) throw new Error("usage: --repo <name> --out <file>");

export const NOW = "2026-10-26T00:00:00Z";
const NOW_S = Math.floor(Date.parse(NOW) / 1000);
const JTIME = "2026-10-25T23:00:00Z";
const JUDGE = signerFromSeed(createHash("sha256").update("shape-h5-reviewer").digest("hex"));
const MOD = REPO.replace(/[^A-Za-z0-9]/g, "_");
const BULK = 10;

const sha = (s: string): string => createHash("sha256").update(s).digest("hex");
const dg = (s: string): string => `sha256:${sha(s)}`;
const encPath = (p: string): string => p.normalize("NFC").replace(/%/g, "%25").replace(/#/g, "%23");
const encSym = (s: string): string =>
  s.replace(/%/g, "%25").replace(/#/g, "%23").replace(/ /g, "%20");
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

// vprobe marker kinds -> std hatch kinds (std::Trust verbs; syntax §4)
const KIND: Record<string, string> = {
  external_body: "external_body",
  external: "external",
  external_fn_specification: "assume_specification",
  external_type_specification: "external",
  assume_specification: "assume_specification",
  uninterp: "uninterp",
  assume: "assume",
  admit: "admit",
  axiom_fn: "axiom"
};

// ---- inputs -----------------------------------------------------------------------------------------

const walk = JSON.parse(readFileSync(join(WALK, `${REPO}.walk.json`), "utf8"));
const blobs = new Map<string, any>();
for (const line of readFileSync(join(WALK, `${REPO}.blobs.jsonl`), "utf8").split("\n")) {
  if (!line) continue;
  const d = JSON.parse(line);
  blobs.set(d.sha, d.rec);
}
const gt = JSON.parse(gunzipSync(readFileSync(join(PC, `${REPO}.json.gz`))).toString("utf8"));
const gtRow = new Map(gt.rows.map((r) => [r.commit, r]));

const markerTotal = (rec): number =>
  Object.values(rec?.tcb ?? {}).reduce((a: number, b: number) => a + b, 0) as number;
const stdKinds = (tcb: Record<string, number>): Record<string, number> => {
  const m: Record<string, number> = {};
  for (const [k, n] of Object.entries(tcb ?? {}))
    if (n > 0) m[KIND[k] ?? "Hatch"] = (m[KIND[k] ?? "Hatch"] ?? 0) + n;
  return m;
};

// ---- manifests ----------------------------------------------------------------------------------------

interface Ent {
  id: string;
  projection: string;
  scheme: string;
  digest: string;
  kind: string;
  parent: string | null;
  markers?: Record<string, number>;
  hatchComplete?: boolean;
  executable?: boolean;
}

const idCacheA = new Map<string, Ent[]>();
function entriesA(path: string, blob: string): Ent[] {
  const key = `${path}\u0000${blob}`;
  const hit = idCacheA.get(key);
  if (hit) return hit;
  const rec = blobs.get(blob);
  const lang = rec.verus ? "verus" : "rust";
  const fileId = `${lang}:${encPath(path)}`;
  const out: Ent[] = [];
  const fnSum: Record<string, number> = {};
  const hc = rec.ok;
  const sch = (p: string): string => `${lang}.${p}.vprobe1`;
  for (const f of rec.fns) {
    const m: Record<string, number> = {};
    for (const fl of f.flags)
      if (KIND[fl] && fl !== "assume" && fl !== "admit") m[KIND[fl]] = (m[KIND[fl]] ?? 0) + 1;
    if (f.assume > 0) m.assume = (m.assume ?? 0) + f.assume;
    if (f.admit > 0) m.admit = (m.admit ?? 0) + f.admit;
    if (f.mode === "axiom") m.axiom = (m.axiom ?? 0) + 1;
    for (const [k, n] of Object.entries(m)) fnSum[k] = (fnSum[k] ?? 0) + n;
    const id = `${fileId}#${encSym(f.key)}`;
    const unit = dg(
      JSON.stringify(["vprobe.unit", f.contract_h, f.body_h, f.flags, f.assume, f.admit, f.mode])
    );
    const base = {
      id,
      kind: "function",
      parent: fileId,
      hatchComplete: hc,
      executable: true,
      ...(Object.keys(m).length ? { markers: m } : {})
    };
    out.push({ ...base, projection: "own", scheme: sch("own"), digest: unit });
    out.push({ ...base, projection: "unit", scheme: sch("unit"), digest: unit });
    out.push({
      ...base,
      projection: "contract",
      scheme: sch("contract"),
      digest: dg(JSON.stringify(["vprobe.contract", f.contract_h]))
    });
  }
  // markers outside functions (attributes on impls, types, assume_specification items, …)
  const residual: Record<string, number> = {};
  for (const [k, n] of Object.entries(stdKinds(rec.tcb))) {
    const r = n - (fnSum[k] ?? 0);
    if (r > 0) residual[k] = r;
  }
  const fileBase = {
    id: fileId,
    kind: "file",
    parent: null,
    hatchComplete: hc,
    executable: true,
    ...(Object.keys(residual).length ? { markers: residual } : {})
  };
  out.push({ ...fileBase, projection: "file", scheme: sch("file"), digest: dg(`blob ${blob}`) });
  out.push({
    ...fileBase,
    projection: "own",
    scheme: sch("own"),
    digest: dg(JSON.stringify(["vprobe.fileown", rec.fns.map((f) => f.key).sort(cmp), residual]))
  });
  idCacheA.set(key, out);
  return out;
}

const idCacheB = new Map<string, Ent[]>();
function entriesB(path: string, blob: string): Ent[] {
  const key = `${path}\u0000${blob}`;
  const hit = idCacheB.get(key);
  if (hit) return hit;
  const text = execFileSync("git", ["-C", join(REPOS, REPO), "cat-file", "blob", blob], {
    maxBuffer: 1 << 28
  }).toString("utf8");
  const out: Ent[] = [];
  for (const id of fingerprintRust(path, text)) {
    for (const d of id.digests) {
      const e: Ent = {
        id: id.id,
        projection: d.projection,
        scheme: d.scheme,
        digest: d.digest,
        kind: id.kind,
        parent: id.parent
      };
      if (Object.keys(id.markers).length > 0) e.markers = id.markers;
      if (!id.hatchComplete) e.hatchComplete = false;
      if (id.executable) e.executable = true;
      out.push(e);
    }
  }
  idCacheB.set(key, out);
  return out;
}
const entriesOf = PIPE === "B" ? entriesB : entriesA;
const fileMarked = (path: string, blob: string): boolean =>
  entriesOf(path, blob).some((e) => e.markers && Object.values(e.markers).some((n) => n > 0));

function manifestFor(rev: string, snap: Map<string, string>, files: string[]) {
  const entries: Ent[] = [];
  const tree = [];
  for (const p of files) {
    const b = snap.get(p);
    if (!b) continue;
    entries.push(...entriesOf(p, b));
    tree.push({ path: p, mode: "100644", blob: b });
  }
  return manifestStatement({ v: "shape.manifest.v1", revision: rev, tree, entries });
}

// ---- the shape ------------------------------------------------------------------------------------------

function sourceFor(paths: string[], allows: string[]) {
  return {
    v: "shape.source.v1",
    modules: [
      {
        module: MOD,
        imports: ["std"],
        file: `shape/${MOD}.shape`,
        decls: [
          { decl: "shape", name: "Repo", owner: "Maintainers" },
          { decl: "actor", name: "Maintainers", kind: "team", members: ["reviewer"] },
          {
            decl: "actor",
            name: "reviewer",
            kind: "person",
            identities: ['github("reviewer")', JUDGE.identity]
          },
          { decl: "actor", name: "dev", kind: "person", identities: ['github("dev")'] },
          {
            decl: "component",
            name: "TrustedSurface",
            boundary: true,
            attach: [{ name: "ReviewedSurface" }],
            owner: "Maintainers",
            tier: "critical",
            paths: [...new Set(paths)].sort(cmp),
            allows: [...new Set(allows)].sort(cmp)
          },
          HATCH_RULE === "star"
            ? {
                decl: "rule",
                name: "NoHatches",
                template: { name: "HatchesStayAtBoundaries", args: [] },
                owner: "Maintainers",
                tier: "critical"
              }
            : {
                decl: "rule",
                name: "NoHatches",
                clauses: [{ forbid: "hatch", kinds: STD_HATCH_KINDS }],
                owner: "Maintainers",
                tier: "critical"
              }
        ]
      }
    ]
  };
}

function markedFiles(snap: Map<string, string>): string[] {
  return [...snap.keys()].filter((p) => markerTotal(blobs.get(snap.get(p))) > 0).sort(cmp);
}

function globsAt(snap: Map<string, string>, variant: string): string[] {
  const marked = markedFiles(snap);
  const conv = [...snap.keys()].some((p) => p.endsWith("_t.rs"));
  const out: string[] = conv ? ["**/*_t.rs"] : [];
  if (variant === "F-dir") {
    for (const p of marked) {
      const i = p.lastIndexOf("/");
      out.push(i < 0 ? p : `${p.slice(0, i)}/**/*.rs`);
    }
  } else {
    for (const p of marked) if (!(conv && p.endsWith("_t.rs"))) out.push(p);
  }
  return [...new Set(out)].sort(cmp);
}

function allowsAt(snap: Map<string, string>, globs: string[]): string[] {
  const kinds = new Set<string>();
  for (const [p, b] of snap) {
    if (!globs.some((g) => globMatches(g, p))) continue;
    for (const k of Object.keys(stdKinds(blobs.get(b)?.tcb))) kinds.add(k);
  }
  return [...kinds].filter((k) => k !== "Hatch").sort(cmp);
}

// ---- one commit ---------------------------------------------------------------------------------------------

const LAW_ID = `${MOD}::TrustedSurface/ReviewedSurface/law`;

function judgmentFor(source, baseMan, baseRev) {
  const esf = elaborate(source, { now: NOW_S });
  const idx = indexManifest(baseMan).index;
  const W = buildWorld(esf, idx, { side: "h" });
  const c = esf.claims.find((x) => x.op === "law" && x.ids.includes(LAW_ID));
  if (!c) throw new Error(`no law ${LAW_ID}: ${esf.claims.map((x) => x.ids[0]).join(", ")}`);
  const req = reqOf({ Wh: W, Mh: idx }, c, "judgment", "trust");
  const code = req
    .map((p) => {
      const info = idx.ids.get(p.id);
      const d = info?.digests.get(p.projection);
      return d
        ? { id: p.id, projection: p.projection, scheme: info.schemes.get(p.projection), digest: d }
        : null;
    })
    .filter(Boolean);
  const rec = {
    v: "shape.evidence.v1",
    kind: "judgment",
    result: "supports",
    provider: null,
    revision: baseRev,
    time: JTIME,
    claim: { id: LAW_ID, fp: c.fp, nf: c.nf },
    code,
    judge: `${MOD}::reviewer`
  };
  return {
    envelope: signStatement(makeStatement(rec), [JUDGE]),
    cited: code.map((x) => x.id),
    errors: esf.errors.length
  };
}

function inputFor(o) {
  return {
    contract: "shape.check.input/v1",
    mode: "change",
    now: NOW,
    head: { revision: o.headRev, source: o.headSrc, manifest: o.headMan },
    base: { revision: o.baseRev, source: o.baseSrc, manifest: o.baseMan },
    change: { ids: [`github:${REPO}#${o.headRev.slice(0, 12)}`] },
    authors: [{ identity: 'github("dev")', verified: true, bot: false }],
    reviews: [],
    records: [o.judgment],
    baseRecords: [o.judgment],
    persisted: { base: [], head: [] },
    options: { health: true, teeth: false }
  };
}

const pathOf = (id: string): string => {
  const rest = id.slice(id.indexOf(":") + 1);
  const h = rest.indexOf("#");
  return (h >= 0 ? rest.slice(0, h) : rest).replace(/%23/g, "#").replace(/%25/g, "%");
};

function changedIds(bm, hm): Set<string> {
  const b = indexManifest(bm).index;
  const h = indexManifest(hm).index;
  const out = new Set<string>();
  for (const [id, info] of h.ids) {
    const bi = b.ids.get(id);
    if (!bi) {
      out.add(id);
      continue;
    }
    for (const [p, d] of info.digests) if (bi.digests.get(p) !== d) out.add(id);
  }
  for (const id of b.ids.keys()) if (!h.ids.has(id)) out.add(id);
  return out;
}

function compact(o, changed: Set<string>, cited: string[], bIdx, hIdx) {
  let ids: string[] = [];
  if (o.kind === "contradiction" && o.subject && typeof o.subject === "object" && o.subject.code)
    ids = [o.subject.code];
  else if (o.kind === "unestablished")
    ids = [...new Set([...(o.affected ?? []), ...cited])].filter((x) => changed.has(x));
  else ids = (o.affected ?? []).filter((x) => !x.startsWith("cell:"));
  return {
    key: o.key,
    kind: o.kind,
    reason: o.reason,
    questions: o.questions,
    introduced: o.introduced,
    severity: o.severity,
    tier: o.tier,
    force: o.force,
    budget: o.budget,
    group: o.group,
    claim: o.claim ? o.claim.ids[0] : null,
    subject: o.subject,
    rule: o.rule ?? null,
    files: [...new Set(ids.map(pathOf))].sort(cmp),
    ids: ids.slice(0, 50),
    // a contradiction whose identity's own digests moved in this commit (counterfactual rule, report)
    codeChanged:
      o.kind === "contradiction" && o.subject && typeof o.subject === "object" && o.subject.code
        ? changed.has(o.subject.code)
        : null,
    // what moved under each identity (markers at base and head; absent = null)
    moved: ids.slice(0, 50).map((x) => ({
      id: x,
      file: !x.slice(x.indexOf(":") + 1).includes("#"),
      mb: bIdx.ids.get(x)?.markers ?? null,
      mh: hIdx.ids.get(x)?.markers ?? null
    }))
  };
}

// ---- main loop ------------------------------------------------------------------------------------------------

const snap = new Map<string, string>(Object.entries(walk.rootSnap));
const apply = (s: Map<string, string>, st): Map<string, string> => {
  const n = new Map(s);
  for (const [o, nn] of st.pairs) {
    if (o && n.has(o)) n.delete(o);
    if (nn && st.new[nn]) n.set(nn, st.new[nn]);
  }
  return n;
};

let cur = snap;
let c0: string | null = markedFiles(cur).length > 0 ? walk.root : null;
let c0snap = c0 ? cur : null;
writeFileSync(OUT, "");
if (c0) {
  const g = globsAt(c0snap, VARIANT === "F-dir" ? "F-dir" : "F-conv");
  appendFileSync(
    OUT,
    `${JSON.stringify({ type: "adoption", repo: REPO, variant: VARIANT, pipeline: PIPE, hatchRule: HATCH_RULE, c0, globs: g, allows: allowsAt(c0snap, g) })}\n`
  );
}
let done = 0;
const t0 = performance.now();
for (const st of walk.steps) {
  const before = cur;
  const after = apply(cur, st);
  cur = after;
  if (!c0) {
    if (markedFiles(after).length > 0) {
      c0 = st.commit;
      c0snap = after;
      const g = globsAt(c0snap, VARIANT === "F-dir" ? "F-dir" : "F-conv");
      appendFileSync(
        OUT,
        `${JSON.stringify({ type: "adoption", repo: REPO, variant: VARIANT, pipeline: PIPE, hatchRule: HATCH_RULE, c0, globs: g, allows: allowsAt(c0snap, g) })}\n`
      );
    }
    continue;
  }
  const row = gtRow.get(st.commit);
  if (!row || !(row.verus_files > 0 && row.added_files < BULK && row.parse_fail === 0)) continue;
  if (ONLY && !ONLY.has(st.commit) && !ONLY.has(st.commit.slice(0, 10))) continue;
  if (LIMIT && done >= LIMIT) break;
  // shape
  const g0 = globsAt(c0snap, VARIANT === "F-dir" ? "F-dir" : "F-conv");
  let globs = g0;
  let allows = allowsAt(c0snap, g0);
  if (VARIANT === "M") {
    globs = [...new Set([...g0, ...markedFiles(before)])].sort(cmp);
    allows = [...new Set([...allows, ...allowsAt(before, globs)])].sort(cmp);
  }
  const src = sourceFor(globs, allows);
  // files listed
  const changedPaths = new Set<string>();
  for (const [o, n] of st.pairs) {
    if (o) changedPaths.add(o);
    if (n) changedPaths.add(n);
  }
  const files = FULL
    ? [...new Set([...before.keys(), ...after.keys()])].sort(cmp)
    : [
        ...new Set([
          ...changedPaths,
          ...[...before].filter(([p, b]) => fileMarked(p, b)).map(([p]) => p),
          ...[...after].filter(([p, b]) => fileMarked(p, b)).map(([p]) => p)
        ])
      ].sort(cmp);
  const baseMan = manifestFor(st.parent, before, files);
  const headMan = manifestFor(st.commit, after, files);
  const j = judgmentFor(src, baseMan, st.parent);
  if (DUMP)
    writeFileSync(
      join(DUMP, `${REPO}-${st.commit.slice(0, 12)}.input.json`),
      JSON.stringify(
        inputFor({
          headRev: st.commit,
          baseRev: st.parent,
          headSrc: src,
          baseSrc: src,
          headMan,
          baseMan,
          judgment: j.envelope
        })
      )
    );
  const ta = performance.now();
  let out;
  let err = null;
  try {
    out = derive(
      inputFor({
        headRev: st.commit,
        baseRev: st.parent,
        headSrc: src,
        baseSrc: src,
        headMan,
        baseMan,
        judgment: j.envelope
      })
    );
  } catch (e) {
    err = String(e?.stack ?? e).slice(0, 400);
  }
  const tb = performance.now();
  const changed = changedIds(baseMan, headMan);
  const bIdx = indexManifest(baseMan).index;
  const hIdx = indexManifest(headMan).index;
  let o0 = null;
  if (out && out.obligations.some((o) => !o.introduced && o.kind !== "contradiction")) {
    // was the same obligation open with no change at all? (derive base -> base)
    const z = derive(
      inputFor({
        headRev: st.parent,
        baseRev: st.parent,
        headSrc: src,
        baseSrc: src,
        headMan: baseMan,
        baseMan,
        judgment: j.envelope
      })
    );
    o0 = z.obligations.map((o) => o.key);
  }
  const evs = (row.trust_events ?? []).filter(
    (e) => Object.keys(e.add).length || Object.keys(e.remove).length || e.tbody || e.tcontract
  );
  const rec = {
    type: "commit",
    repo: REPO,
    variant: VARIANT,
    pipeline: PIPE,
    hatchRule: HATCH_RULE,
    commit: st.commit,
    parent: st.parent,
    files: files.length,
    globs: globs.length,
    allows,
    cited: j.cited.length,
    elabErrors: j.errors,
    gt: evs,
    verdict: out?.verdict ?? null,
    errors: (out?.errors ?? []).map((e) => `${e.code} ${e.subject}`),
    rejected: (out?.rejected ?? []).map((r) => r.code),
    obligations: (out?.obligations ?? []).map((o) => compact(o, changed, j.cited, bIdx, hIdx)),
    answered: (out?.answered ?? []).length,
    o0,
    changedIds: changed.size,
    ms: Math.round(tb - ta),
    err
  };
  appendFileSync(OUT, `${JSON.stringify(rec)}\n`);
  done += 1;
  if (done % 50 === 0)
    process.stderr.write(
      `${REPO} ${VARIANT}/${PIPE}: ${done} commits, ${((performance.now() - t0) / 1000).toFixed(0)} s\n`
    );
}
process.stderr.write(
  `${REPO} ${VARIANT}/${PIPE}: done ${done} commits in ${((performance.now() - t0) / 1000).toFixed(1)} s\n`
);
