// Impure model loading for the CLI: 0.x .shape files through `shp inspect --json`, trait bodies
// from the text, a 1.0 sidecar (shape1.json or shape1.yaml), and evidence files.
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import {
  type BindIndex,
  type Inspect,
  type TraitBody,
  extractTraits,
  mergeSidecar,
  migrate,
  rewriteBinds
} from "./migrate.ts";
import { type Statement, indexManifest } from "./manifest.ts";
import type { SourceDoc } from "./source.ts";
import { cmpStr } from "./util.ts";

export const REPO_ROOT = resolve(import.meta.dir, "../../../..");
export const SHP_CLI = join(REPO_ROOT, "packages/shp-cli/src/index.ts");

export function findShapeFiles(dir: string): string[] {
  const root = join(dir, "shape");
  const out: string[] = [];
  const walk = (d: string): void => {
    if (!existsSync(d)) return;
    for (const name of readdirSync(d).sort(cmpStr)) {
      const full = join(d, name);
      const rel = relative(dir, full).replace(/\\/g, "/");
      if (rel.startsWith("shape/evidence")) continue;
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith(".shape")) out.push(full);
    }
  };
  walk(root);
  return out;
}

export function runInspect(files: string[], cwd: string): Inspect {
  const r = spawnSync("bun", [SHP_CLI, "inspect", "--json", ...files], { cwd, maxBuffer: 1 << 30 });
  if (r.status !== 0)
    throw new Error(`shp inspect failed (${r.status}): ${r.stderr.toString().slice(0, 2000)}`);
  return JSON.parse(r.stdout.toString("utf8")) as Inspect;
}

export function readSidecar(dir: string, explicit?: string): SourceDoc | null {
  const cands = explicit
    ? [explicit]
    : [
        join(dir, "shape1.json"),
        join(dir, "shape1.yaml"),
        join(dir, "shape", "shape1.json"),
        join(dir, "shape", "shape1.yaml")
      ];
  for (const c of cands) {
    if (!existsSync(c)) continue;
    const text = readFileSync(c, "utf8");
    const doc = (
      c.endsWith(".yaml") || c.endsWith(".yml") ? Bun.YAML.parse(text) : JSON.parse(text)
    ) as SourceDoc;
    if (doc.v !== "shape.source.v1") throw new Error(`${c}: not shape.source.v1`);
    return doc;
  }
  return null;
}

export interface LoadedModel {
  source: SourceDoc;
  notes: string[];
  shapeFiles: string[];
}

/** Loads a model directory: migrated 0.x shapes (if any) merged with the 1.0 sidecar. */
export function loadModel(
  dir: string,
  opts: {
    sidecar?: string;
    owner?: string;
    maintainers?: string[];
    includeGenerated?: boolean;
  } = {}
): LoadedModel {
  const files = findShapeFiles(dir);
  const sidecar = readSidecar(dir, opts.sidecar);
  if (files.length === 0) {
    if (!sidecar) throw new Error(`${dir}: no shape/**/*.shape and no shape1.json sidecar`);
    return { source: sidecar, notes: [], shapeFiles: [] };
  }
  const ins = runInspect(files, dir);
  const traits: TraitBody[] = [];
  for (const d of ins.documents) {
    const path = resolve(dir, d.file);
    if (existsSync(path))
      traits.push(...extractTraits(d.file, d.module, readFileSync(path, "utf8")));
  }
  const m = migrate(ins, {
    owner: opts.owner,
    maintainers: opts.maintainers,
    traits,
    includeGenerated: opts.includeGenerated
  });
  return {
    source: mergeSidecar(m.source, sidecar),
    notes: m.notes,
    shapeFiles: files.map((f) => relative(dir, f))
  };
}

/** Materialises a git revision's shape files (and sidecar) into a temporary directory. */
export function materialiseShape(repo: string, rev: string, tmpRoot?: string): string {
  const base = tmpRoot ?? tmpdir();
  mkdirSync(base, { recursive: true });
  const dir = mkdtempSync(join(base, "shape1-base-"));
  const ls = spawnSync("git", ["ls-tree", "-r", "--name-only", "-z", rev], {
    cwd: repo,
    maxBuffer: 1 << 30
  });
  if (ls.status !== 0) throw new Error(`git ls-tree ${rev} failed`);
  for (const p of ls.stdout.toString("utf8").split("\0").filter(Boolean)) {
    const isShape =
      (p.startsWith("shape/") && p.endsWith(".shape") && !p.startsWith("shape/evidence/")) ||
      p === "shape.lock";
    const isSidecar =
      p === "shape1.json" ||
      p === "shape1.yaml" ||
      p === "shape/shape1.json" ||
      p === "shape/shape1.yaml";
    if (!isShape && !isSidecar) continue;
    const show = spawnSync("git", ["show", `${rev}:${p}`], { cwd: repo, maxBuffer: 1 << 30 });
    if (show.status !== 0) continue;
    const out = join(dir, p);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, show.stdout);
  }
  return dir;
}

/** Evidence from files: a statement, an envelope, a JSON array, JSONL; directories recursively. */
export function readEvidence(paths: string[]): unknown[] {
  const out: unknown[] = [];
  const readFile = (f: string): void => {
    const text = readFileSync(f, "utf8").trim();
    if (text === "") return;
    if (f.endsWith(".jsonl")) {
      for (const line of text.split("\n")) if (line.trim()) out.push(JSON.parse(line));
      return;
    }
    const v = JSON.parse(text) as unknown;
    if (Array.isArray(v)) out.push(...v);
    else out.push(v);
  };
  const walk = (p: string): void => {
    if (!existsSync(p)) throw new Error(`evidence path ${p} does not exist`);
    if (statSync(p).isDirectory()) {
      for (const n of readdirSync(p).sort(cmpStr)) {
        const full = join(p, n);
        if (statSync(full).isDirectory()) walk(full);
        else if (n.endsWith(".json") || n.endsWith(".jsonl")) readFile(full);
      }
    } else readFile(p);
  };
  for (const p of paths) walk(p);
  return out;
}

/** Persisted records under shape/evidence/<2 hex>/<64 hex>.json of a directory. */
export function readPersisted(dir: string): { path: string; record: unknown }[] {
  const root = join(dir, "shape", "evidence");
  const out: { path: string; record: unknown }[] = [];
  if (!existsSync(root)) return out;
  const walk = (d: string): void => {
    for (const n of readdirSync(d).sort(cmpStr)) {
      const full = join(d, n);
      if (statSync(full).isDirectory()) walk(full);
      else if (n.endsWith(".json"))
        out.push({
          path: relative(dir, full).replace(/\\/g, "/"),
          record: JSON.parse(readFileSync(full, "utf8"))
        });
    }
  };
  walk(root);
  return out;
}

/** Rewrites migrated unit sources against a manifest statement (A.11.1); notes the renames. */
export function rewriteAgainst(
  src: SourceDoc | null,
  manifest: Statement
): { source: SourceDoc | null; renames: { from: string; to: string }[] } {
  if (!src) return { source: null, renames: [] };
  const { index } = indexManifest(manifest);
  if (!index) return { source: src, renames: [] };
  const fileIdByPath = new Map<string, string>();
  const idsByFile = new Map<string, string[]>();
  for (const info of index.ids.values()) {
    if (!info.symbol) fileIdByPath.set(info.path, info.id);
    else {
      const f = info.id.slice(0, info.id.indexOf("#"));
      idsByFile.set(f, [...(idsByFile.get(f) ?? []), info.id]);
    }
  }
  const idx: BindIndex = { fileIdByPath, idsByFile, has: (id) => index.ids.has(id) };
  return rewriteBinds(src, idx);
}
