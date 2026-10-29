// @ts-nocheck
// Kernel detail runs for H4, on the kernel cases run.ts wrote:
//   kdump    KDump.lean on each case: parts with deltas, realisable pairs and L3 verdicts
//   prebind  the same case with each unit of a path-less component given the explicit binding
//            A.3.3.2 defines (the unique M_h identity whose last symbol segment is the unit's
//            name), because the kernel's unitBind searches only the component's globs; then
//            shapek and KDump again. This isolates that one defect from the kernel's other gaps.
// Usage: bun run-kernel.ts <outDir> <leanBinDir>
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { REPO } from "./cases.ts";

const [outDir, leanBin] = process.argv.slice(2);
const KERNEL = join(REPO, "experiments/shape-1/kernel");
const SHAPEK = join(KERNEL, ".lake/build/bin/shapek");
const KDUMP = join(REPO, "experiments/shape-1/trials/H4/KDump.lean");
const LEAN_PATH = `${KERNEL}/.lake/build/lib/lean:${leanBin}/../lib/lean`;

function kdump(file) {
  const r = spawnSync(join(leanBin, "lean"), ["--run", KDUMP, file], {
    env: { ...process.env, LEAN_PATH },
    maxBuffer: 1 << 26
  });
  try {
    return JSON.parse(r.stdout.toString());
  } catch {
    return { error: r.stdout.toString().slice(0, 500) + r.stderr.toString().slice(0, 500) };
  }
}

const ids = (man) => (man?.predicate?.shape?.entries ?? man?.entries ?? []).map((e) => e.id);
const lastSeg = (id) => {
  const h = id.indexOf("#");
  if (h < 0) return "";
  const sym = id.slice(h + 1);
  return sym.split(".").pop();
};
function prebind(esf, man) {
  if (!esf?.units) return esf;
  const all = [...new Set(ids(man))]; // one entry per projection: dedupe
  const units = esf.units.map((u) => {
    if (u.bind) return u;
    const comp = esf.components.find((c) => c.q === u.component);
    if (comp && (comp.paths ?? []).length > 0) return u;
    const m = all.filter((x) => lastSeg(x) === u.name);
    return m.length === 1 ? { ...u, bind: m[0] } : u;
  });
  return { ...esf, units };
}

for (const f of readdirSync(outDir)
  .filter((x) => x.endsWith(".kcase.json"))
  .sort()) {
  const stem = f.slice(0, -".kcase.json".length);
  const file = join(outDir, f);
  writeFileSync(join(outDir, `${stem}.kdump.json`), JSON.stringify(kdump(file), null, 1));
  const kc = JSON.parse(readFileSync(file, "utf8"));
  const pb = {
    ...kc,
    head: { ...kc.head, esf: prebind(kc.head.esf, kc.head.manifest) },
    base: kc.base ? { ...kc.base, esf: prebind(kc.base.esf, kc.head.manifest) } : null
  };
  const pbFile = join(outDir, `${stem}.kcase-prebind.json`);
  writeFileSync(pbFile, JSON.stringify(pb));
  const r = spawnSync(SHAPEK, [pbFile], { maxBuffer: 1 << 26 });
  writeFileSync(join(outDir, `${stem}.kernel-prebind.json`), r.stdout.toString());
  writeFileSync(join(outDir, `${stem}.kdump-prebind.json`), JSON.stringify(kdump(pbFile), null, 1));
  process.stderr.write(`${stem}\n`);
}
