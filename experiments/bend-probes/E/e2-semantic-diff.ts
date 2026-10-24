// @ts-nocheck
// E2 follow-up: a deterministic, location-insensitive semantic diff of two
// Shape models (`shp inspect --json`), classified with the impact table of
// plugins/shapelang/skills/shape-contract-guard/references/signals.md.
// Usage: bun e2-semantic-diff.ts <baseShapeDir> <candidateShapeDir>
// Each dir is passed as the working directory for `shp inspect --json`, so the
// model is shape/**/*.shape under it. Prints a guard-style JSON result.
import { spawnSync } from "node:child_process";

const SHP = ["bun", "/home/user/shapelang/packages/shp-cli/src/index.ts"];
const DESTRUCTIVE = new Set(["HardDelete", "Truncate", "DropStorage", "Delete", "Overwrite"]);

type Rec = Record<string, unknown> & { id: string };
type Model = Record<string, Rec[]>;

export function inspect(dir: string): Model {
  const r = spawnSync(SHP[0], [...SHP.slice(1), "inspect", "--json"], {
    cwd: dir,
    encoding: "utf8"
  });
  if (r.status !== 0) throw new Error(`inspect failed in ${dir}: ${r.stderr}`);
  return JSON.parse(r.stdout);
}

// Remove file locations and origin: a relocated declaration is the same claim.
function norm(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(norm);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (k === "file" || k === "origin") continue;
      out[k] = norm(x);
    }
    return out;
  }
  return v;
}

const COLLECTIONS = [
  "resources",
  "components",
  "functions",
  "relations",
  "implementations",
  "bindings",
  "rules",
  "memories"
];

export type Finding = {
  impact: "high" | "medium" | "low";
  support: "none" | "generic" | "specific";
  disposition: "suspicious" | "supported" | "tightening" | "informational";
  signal: string;
  symbol: string;
  before: string;
  after: string;
  replacement: string;
};

const set = (a: unknown) => new Set(((a as unknown[]) ?? []).map((x) => JSON.stringify(x)));
const minus = (a: Set<string>, b: Set<string>) => [...a].filter((x) => !b.has(x));

export function diff(base: Model, cand: Model) {
  const changes: { kind: string; coll: string; id: string; before?: Rec; after?: Rec }[] = [];
  for (const c of COLLECTIONS) {
    const B = new Map((base[c] ?? []).map((r) => [r.id, norm(r) as Rec]));
    const C = new Map((cand[c] ?? []).map((r) => [r.id, norm(r) as Rec]));
    for (const [id, b] of B) {
      const a = C.get(id);
      if (!a) changes.push({ kind: "removed", coll: c, id, before: b });
      else if (JSON.stringify(a) !== JSON.stringify(b))
        changes.push({ kind: "changed", coll: c, id, before: b, after: a });
    }
    for (const [id, a] of C) if (!B.has(id)) changes.push({ kind: "added", coll: c, id, after: a });
  }
  return changes;
}

// `shp memory` lists rationale and memory entries by target ("<kind> <Name>"),
// which `inspect --json` omits for rationales. Returns "target|kind name|summary-less entry" keys.
export function contextEntries(dir: string): Set<string> {
  const r = spawnSync(SHP[0], [...SHP.slice(1), "memory"], { cwd: dir, encoding: "utf8" });
  const out = new Set<string>();
  let target = "";
  for (const line of r.stdout.split("\n")) {
    if (/^\S/.test(line) && line !== "Memory Guards")
      target = line.trim().split(" ").slice(1).join(" ");
    const m = line.match(/^  (rationale|memory) (\S+)/);
    if (m) out.add(`${target}|${m[1]} ${m[2]}`);
  }
  return out;
}

export function classify(
  base: Model,
  cand: Model,
  ctx?: { base: Set<string>; cand: Set<string> }
): { status: string; changes: number; findings: Finding[] } {
  const changes = diff(base, cand);
  const findings: Finding[] = [];
  // Support: a memory/rationale added in the candidate whose target is the symbol
  // (by local name). This is a mechanical proxy: "specific" in signals.md also
  // requires that the entry addresses the semantic risk, which needs reading.
  const added = ctx ? [...ctx.cand].filter((k) => !ctx.base.has(k)) : [];
  const memTargets = new Set([
    ...changes
      .filter((c) => c.coll === "memories" && c.after)
      .map((c) => (c.after!.target as { id: string }).id.split("::").pop()!),
    ...added.map((k) => k.split("|")[0])
  ]);
  const local = (sym: string) => sym.split("::").pop()!;
  const supportFor = (sym: string): Finding["support"] =>
    memTargets.has(local(sym)) ? "specific" : memTargets.size > 0 ? "generic" : "none";
  const push = (
    impact: Finding["impact"],
    signal: string,
    sym: string,
    before: string,
    after: string
  ) => {
    const support = supportFor(sym);
    findings.push({
      impact,
      support,
      signal,
      symbol: sym,
      before,
      after,
      replacement: "",
      disposition: support === "specific" ? "supported" : "suspicious"
    });
  };
  for (const ch of changes) {
    const { coll, id, before: b, after: a } = ch;
    if (coll === "resources" && b) {
      const lost = minus(set(b.traits), set(a?.traits));
      if (lost.length)
        push(
          "high",
          "constraint-removal",
          id,
          `traits [${(b.traits as string[]).join(",")}]`,
          a ? `traits [${(a.traits as string[]).join(",")}]` : "removed"
        );
    }
    if (coll === "rules" && b) {
      const fields = [
        "forbidEffects",
        "forbidProvides",
        "forbidHypercycles",
        "forbidPaths",
        "whenHas"
      ];
      const lost = fields.flatMap((f) => minus(set(b[f]), set(a?.[f])).map((x) => `${f}:${x}`));
      if (!a || lost.length)
        push(
          "high",
          a ? "rule-weakened" : "rule-removal",
          id,
          lost.join("; ") || "rule",
          a ? "weakened" : "removed"
        );
    }
    if (coll === "implementations" && b) {
      const lostPaths = minus(set(b.paths), set(a?.paths));
      const lostReq = b.onChangeRequirement && !a?.onChangeRequirement;
      if (!a || lostPaths.length || lostReq)
        push(
          "high",
          "review-enforcement-weakened",
          id,
          JSON.stringify(b.paths),
          a ? JSON.stringify(a.paths) : "removed"
        );
    }
    if (coll === "bindings" && b) {
      if (
        !a ||
        minus(set(b.whenChanged), set(a.whenChanged)).length ||
        minus(set(b.requireChanged), set(a.requireChanged)).length
      )
        push("high", "binding-weakened", id, "binding", a ? "narrowed" : "removed");
    }
    if (coll === "functions") {
      if (
        a &&
        a.effectsComplete &&
        (a.effects as unknown[]).length === 0 &&
        (!b || !b.effectsComplete)
      )
        push(
          "high",
          "false-completeness",
          id,
          b ? "effects unknown" : "(new)",
          "effects complete {}"
        );
      const newEff = minus(set(a?.effects), set(b?.effects)).map((x) => JSON.parse(x));
      for (const e of newEff)
        if (DESTRUCTIVE.has(e.name))
          push("high", "destructive-effect", id, "", `${e.name}<${e.target}>`);
    }
    if (coll === "components") {
      const newGr = minus(set(a?.grants), set(b?.grants)).map((x) => JSON.parse(x));
      for (const g of newGr)
        push(
          DESTRUCTIVE.has(g.name) ? "high" : "medium",
          "capability-widening",
          id,
          "",
          `grants ${g.name}<${g.target}>`
        );
      const lostOwn = minus(set(b?.owns), set(a?.owns));
      if (b && lostOwn.length) push("high", "ownership-removed", id, `owns ${lostOwn}`, "");
    }
    if (coll === "relations" && b && !a)
      push("medium", "structural-relation-removed", id, `${b.kind} ${b.from} -> ${b.to}`, "");
    if (coll === "memories" && b) {
      const lostGuards = minus(set(b.guards), set(a?.guards));
      if (!a)
        push(
          "medium",
          "traceability-loss",
          id,
          `memory on ${(b.target as { id: string }).id}`,
          "removed"
        );
      else if (lostGuards.length) push("high", "guard-removed", id, lostGuards.join(","), "");
    }
  }
  // signals.md: co-occurring constraint removal + destructive effect on the same neighbourhood is one root finding.
  const removal = findings.find((f) => f.signal === "constraint-removal");
  const destr = findings.filter(
    (f) =>
      f.signal === "destructive-effect" ||
      (f.signal === "capability-widening" && f.impact === "high")
  );
  if (removal && destr.some((d) => d.after.includes(removal.symbol))) {
    const merged = {
      ...removal,
      signal: "constraint-removal-plus-destructive-effect",
      after: `${removal.after}; ${destr.map((d) => d.after).join("; ")}`
    };
    findings.splice(
      0,
      findings.length,
      merged,
      ...findings.filter((f) => f !== removal && !destr.includes(f))
    );
  }
  return { status: findings.length ? "advisory" : "pass", changes: changes.length, findings };
}

if (import.meta.main) {
  const [baseDir, candDir] = process.argv.slice(2);
  const base = inspect(baseDir);
  const cand = inspect(candDir);
  const ctx = { base: contextEntries(baseDir), cand: contextEntries(candDir) };
  console.log(
    JSON.stringify(
      {
        rawChanges: diff(base, cand).map((c) => `${c.kind} ${c.coll} ${c.id}`),
        ...classify(base, cand, ctx)
      },
      null,
      2
    )
  );
}
