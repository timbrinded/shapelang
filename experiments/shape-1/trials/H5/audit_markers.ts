// @ts-nocheck
// H5: how far the prototype's Rust/Verus scanner (pipeline B's manifest markers) is from vprobe's
// tcb_scan (the E9 instrument, pipeline A), over every distinct .rs blob the walk saw. Per file, the
// per-kind marker totals of fingerprintRust (all identities of the file) are compared with vprobe's
// file-level tcb counts mapped to std hatch kinds (as replay.ts maps them). It also checks the trust
// provider's TypeScript port of tcb_scan (providers/trust/rust.ts vprobeTcb) against vprobe exactly.
//   bun experiments/shape-1/trials/H5/audit_markers.ts [--walk dir] [--repos dir] > audit.json
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { vprobeTcb } from "../../proto/providers/trust/rust.ts";
import { fingerprintRust } from "../../proto/src/fingerprint/rust.ts";

const SCRATCH = "/tmp/claude-0/-home-user-shapelang/83ff80bc-0161-572f-9e5a-9075cccad6d0/scratchpad";
const arg = (k: string, d: string): string => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? (process.argv[i + 1] ?? d) : d;
};
const WALK = arg("walk", `${SCRATCH}/shape1work/H5/walk`);
const REPOS = arg("repos", `${SCRATCH}/repos`);
const KIND = {
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
const out = { repos: {}, total: { blobs: 0, markedEither: 0, agree: 0, agreeMarked: 0, portExact: 0, kinds: {} } };
for (const repo of ["anvil", "atmosphere", "verified-ironkv", "verified-memory-allocator", "verified-node-replication", "verified-nrkernel", "verified-storage", "vest"]) {
  const w = JSON.parse(readFileSync(join(WALK, `${repo}.walk.json`), "utf8"));
  const pathOf = new Map<string, string>();
  for (const [p, s] of Object.entries(w.rootSnap)) if (!pathOf.has(s)) pathOf.set(s, p);
  for (const st of w.steps) for (const [p, s] of Object.entries(st.new)) if (!pathOf.has(s)) pathOf.set(s, p);
  const recs = new Map<string, any>();
  for (const line of readFileSync(join(WALK, `${repo}.blobs.jsonl`), "utf8").split("\n")) {
    if (!line) continue;
    const d = JSON.parse(line);
    if (d.rec) recs.set(d.sha, d.rec);
  }
  const r = { blobs: 0, markedEither: 0, agree: 0, agreeMarked: 0, portExact: 0, kinds: {} };
  for (const [sha, path] of pathOf) {
    const rec = recs.get(sha);
    if (!rec) continue;
    const text = execFileSync("git", ["-C", join(REPOS, repo), "cat-file", "blob", sha], { maxBuffer: 1 << 28 }).toString("utf8");
    const a: Record<string, number> = {};
    for (const [k, n] of Object.entries(rec.tcb)) if (n > 0) a[KIND[k] ?? "Hatch"] = (a[KIND[k] ?? "Hatch"] ?? 0) + n;
    const b: Record<string, number> = {};
    for (const id of fingerprintRust(path, text)) for (const [k, n] of Object.entries(id.markers)) b[k] = (b[k] ?? 0) + n;
    const port = vprobeTcb(text);
    const vp = Object.fromEntries(Object.entries(rec.tcb).filter(([, n]) => n > 0));
    if (JSON.stringify(Object.entries(port).sort()) === JSON.stringify(Object.entries(vp).sort())) r.portExact += 1;
    const kinds = new Set([...Object.keys(a), ...Object.keys(b)]);
    let same = true;
    for (const k of kinds) {
      const d = (b[k] ?? 0) - (a[k] ?? 0);
      if (d !== 0) {
        same = false;
        const t = (r.kinds[k] ??= { vprobe: 0, scanner: 0, filesDiffer: 0 });
        t.filesDiffer += 1;
      }
      const t = (r.kinds[k] ??= { vprobe: 0, scanner: 0, filesDiffer: 0 });
      t.vprobe += a[k] ?? 0;
      t.scanner += b[k] ?? 0;
    }
    r.blobs += 1;
    if (same) r.agree += 1;
    if (kinds.size > 0) {
      r.markedEither += 1;
      if (same) r.agreeMarked += 1;
    }
  }
  out.repos[repo] = r;
  for (const k of ["blobs", "markedEither", "agree", "agreeMarked", "portExact"]) out.total[k] += r[k];
  for (const [k, t] of Object.entries(r.kinds)) {
    const T = (out.total.kinds[k] ??= { vprobe: 0, scanner: 0, filesDiffer: 0 });
    T.vprobe += t.vprobe;
    T.scanner += t.scanner;
    T.filesDiffer += t.filesDiffer;
  }
  process.stderr.write(`${repo}: ${r.blobs} blobs, ${r.agree} agree; marked by either ${r.markedEither}, agree ${r.agreeMarked}; tcb port exact ${r.portExact}\n`);
}
process.stdout.write(`${JSON.stringify(out, null, 1)}\n`);
