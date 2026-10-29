// Shared plumbing for the dogfood model: files, manifests, composition of the 1.0 model from the
// 0.x shape files plus the shape1.yaml overlay, and the elaborated claim index used by providers.
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { elaborate } from "../../proto/src/elaborate.ts";
import { loadModel, rewriteAgainst } from "../../proto/src/loader.ts";
import {
  type SourceFileBytes,
  buildManifest,
  filesFromDir,
  filesFromGit
} from "../../proto/src/manifest-build.ts";
import {
  type ManifestPredicate,
  type Statement,
  gitTreeId,
  manifestStatement
} from "../../proto/src/manifest.ts";
import type { Decl, SourceDoc, SourceModule, UnitDecl } from "../../proto/src/source.ts";
import { cmpStr } from "../../proto/src/util.ts";

export const REPO = resolve(import.meta.dir, "../../../..");
export const DOGFOOD = resolve(import.meta.dir, "..");
export const DOGFOOD_REL = relative(REPO, DOGFOOD).replace(/\\/g, "/");
export const OVERLAY_PATH = join(DOGFOOD, "shape1.yaml");
export const MODEL_PATH = join(DOGFOOD, "model.source.json");

/** Every file under experiments/shape-1/dogfood, as if committed (the dogfood is never committed). */
export function dogfoodFiles(root: string = REPO): SourceFileBytes[] {
  const out: SourceFileBytes[] = [];
  const base = join(root, DOGFOOD_REL);
  const walk = (d: string): void => {
    if (!existsSync(d)) return;
    for (const n of readdirSync(d).sort(cmpStr)) {
      if (n === "node_modules") continue;
      const full = join(d, n);
      if (statSync(full).isDirectory()) walk(full);
      else
        out.push({
          path: relative(root, full).replace(/\\/g, "/"),
          mode: "100644",
          bytes: new Uint8Array(readFileSync(full))
        });
    }
  };
  walk(base);
  return out;
}

/** The working tree's tracked files plus the dogfood files (the head the dogfood checks). */
export function workingTreeFiles(): SourceFileBytes[] {
  const tracked = filesFromDir(REPO).filter((f) => !f.path.startsWith(`${DOGFOOD_REL}/`));
  return [...tracked, ...dogfoodFiles()].sort((a, b) => cmpStr(a.path, b.path));
}

/** A commit's files plus the current dogfood files (for replaying history under the dogfood model). */
export function commitFiles(rev: string): SourceFileBytes[] {
  const tracked = filesFromGit(REPO, rev).filter((f) => !f.path.startsWith(`${DOGFOOD_REL}/`));
  return [...tracked, ...dogfoodFiles()].sort((a, b) => cmpStr(a.path, b.path));
}

export async function manifestFor(
  files: SourceFileBytes[],
  revision?: string
): Promise<{ statement: Statement; revision: string; backend: string }> {
  const draft = await buildManifest({ repoRoot: REPO, revision: revision ?? "pending", files });
  const pred = draft.statement.predicate.shape as ManifestPredicate;
  const rev = revision ?? gitTreeId(pred.tree);
  return {
    statement: manifestStatement({ ...pred, revision: rev }),
    revision: rev,
    backend: draft.backend
  };
}

// ---- overlay -------------------------------------------------------------------------------

interface DropSpec {
  module?: string;
  decl?: string;
  name?: string;
  template?: string;
}

interface Overlay {
  v: "shape.source.v1";
  "x-overlay"?: { renameModules?: Record<string, string>; drop?: DropSpec[] };
  modules: SourceModule[];
}

export function readOverlay(path: string = OVERLAY_PATH): Overlay {
  const doc = Bun.YAML.parse(readFileSync(path, "utf8")) as Overlay;
  if (doc.v !== "shape.source.v1") throw new Error(`${path}: not shape.source.v1`);
  return doc;
}

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

function renameRefs(x: Json, from: string, to: string): Json {
  if (typeof x === "string") return x === from ? to : x.split(`${from}::`).join(`${to}::`);
  if (Array.isArray(x)) return x.map((v) => renameRefs(v, from, to));
  if (x && typeof x === "object") {
    const o: { [k: string]: Json } = {};
    for (const [k, v] of Object.entries(x)) o[k] = renameRefs(v, from, to);
    return o;
  }
  return x;
}

function mergeObj(base: { [k: string]: Json }, over: { [k: string]: Json }): { [k: string]: Json } {
  const out: { [k: string]: Json } = { ...base };
  for (const [k, v] of Object.entries(over)) {
    if (v === null) delete out[k];
    else out[k] = v;
  }
  return out;
}

function mergeDecl(base: Decl, over: Decl): Decl {
  if (base.decl === "component" && over.decl === "component" && over.units) {
    const units = [...(base.units ?? [])];
    for (const u of over.units) {
      const i = units.findIndex((x) => x.name === u.name);
      if (i >= 0)
        units[i] = mergeObj(
          units[i] as unknown as { [k: string]: Json },
          u as unknown as { [k: string]: Json }
        ) as unknown as UnitDecl;
      else units.push(u);
    }
    const merged = mergeObj(
      base as unknown as { [k: string]: Json },
      over as unknown as { [k: string]: Json }
    ) as unknown as Decl & { units?: UnitDecl[] };
    merged.units = units;
    return merged;
  }
  return mergeObj(
    base as unknown as { [k: string]: Json },
    over as unknown as { [k: string]: Json }
  ) as unknown as Decl;
}

const declName = (d: Decl): string => (d.decl === "hatch" ? d.names.join(",") : d.name);

function dropped(m: string, d: Decl, specs: DropSpec[]): boolean {
  return specs.some(
    (s) =>
      (s.module === undefined || s.module === m) &&
      (s.decl === undefined || s.decl === d.decl) &&
      (s.name === undefined || s.name === declName(d)) &&
      (s.template === undefined || ("template" in d && d.template?.name === s.template))
  );
}

export interface Composition {
  source: SourceDoc;
  migrateNotes: string[];
  rewrites: { from: string; to: string }[];
  merged: string[];
  added: string[];
  droppedDecls: string[];
}

/** 0.x shape files → migrate → rewrite unit sources against the manifest → apply the overlay. */
export function composeModel(
  manifest: Statement,
  overlay: Overlay = readOverlay(),
  shapeDir: string = REPO
): Composition {
  const loaded = loadModel(shapeDir, { maintainers: [] });
  const rw = rewriteAgainst(loaded.source, manifest);
  let src = (rw.source ?? loaded.source) as unknown as Json;
  for (const [from, to] of Object.entries(overlay["x-overlay"]?.renameModules ?? {}))
    src = renameRefs(src, from, to);
  const doc = src as unknown as SourceDoc;
  const drops = overlay["x-overlay"]?.drop ?? [];
  const modules = new Map<string, SourceModule>();
  const droppedDecls: string[] = [];
  for (const m of doc.modules) {
    const decls = m.decls.filter((d) => {
      const drop = dropped(m.module, d, drops);
      if (drop) droppedDecls.push(`${m.module}::${d.decl} ${declName(d)}`);
      return !drop;
    });
    modules.set(m.module, { ...m, decls });
  }
  const merged: string[] = [];
  const added: string[] = [];
  for (const om of overlay.modules) {
    const m = modules.get(om.module) ?? {
      module: om.module,
      imports: [],
      decls: [],
      file: `${DOGFOOD_REL}/shape1.yaml`
    };
    m.imports = [...new Set([...(m.imports ?? []), ...(om.imports ?? [])])].sort(cmpStr);
    for (const d of om.decls) {
      const i = m.decls.findIndex((x) => x.decl === d.decl && declName(x) === declName(d));
      const key = `${om.module}::${d.decl} ${declName(d)}`;
      if (i >= 0) {
        m.decls[i] = mergeDecl(m.decls[i] as Decl, d);
        merged.push(key);
      } else {
        m.decls.push(d);
        added.push(key);
      }
    }
    modules.set(om.module, m);
  }
  // every authored module imports the governance module (templates, providers, owner team)
  for (const m of modules.values()) {
    if (m.module === "shape.governance") continue;
    m.imports = [...new Set([...(m.imports ?? []), "shape.governance", "std"])].sort(cmpStr);
  }
  const source: SourceDoc = {
    v: "shape.source.v1",
    modules: [...modules.values()]
      .filter((m) => m.decls.length > 0)
      .sort((a, b) => cmpStr(a.module, b.module))
  };
  return {
    source,
    migrateNotes: loaded.notes,
    rewrites: rw.renames,
    merged: merged.sort(cmpStr),
    added: added.sort(cmpStr),
    droppedDecls: droppedDecls.sort(cmpStr)
  };
}

export function readModel(path: string = MODEL_PATH): SourceDoc {
  return JSON.parse(readFileSync(path, "utf8")) as SourceDoc;
}

/** Elaborated claims by id and by fingerprint (providers cite claims by id + fp + nf). */
export interface ClaimInfo {
  ids: string[];
  op: string;
  args: Record<string, unknown>;
  nf: string;
  fp: string;
  tier: string;
}

export function claimIndex(
  source: SourceDoc,
  now: number
): { claims: ClaimInfo[]; errors: { code: string; subject: string; message: string }[] } {
  const esf = elaborate(source, { now }) as unknown as {
    claims: ClaimInfo[];
    errors: { code: string; subject: string; message: string }[];
  };
  return { claims: esf.claims, errors: esf.errors };
}

/** unit Q → bound code identity, from the composed source (`ts("p#s")` → `ts:p#s`). */
export function unitBindings(source: SourceDoc): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of source.modules)
    for (const d of m.decls) {
      if (d.decl !== "component") continue;
      for (const u of d.units ?? []) {
        const mm = u.bind ? /^\s*([A-Za-z_][\w-]*)\("((?:[^"\\]|\\.)*)"\)\s*$/.exec(u.bind) : null;
        if (mm)
          out.set(
            `${m.module}::${d.name}.${u.name}`,
            `${mm[1]}:${JSON.parse(`"${mm[2] ?? ""}"`) as string}`
          );
      }
    }
  return out;
}

/**
 * Materialises a revision's tracked files (git archive, read-only on the repository) plus the
 * current dogfood files into dir, with the repository's node_modules linked so the law tests run.
 */
export function materialize(rev: string, dir: string): string {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const archive = spawnSync("sh", [
    "-c",
    `git -C ${JSON.stringify(REPO)} archive ${rev} | tar -x -C ${JSON.stringify(dir)}`
  ]);
  if (archive.status !== 0)
    throw new Error(`git archive ${rev} failed: ${archive.stderr.toString()}`);
  cpSync(DOGFOOD, join(dir, DOGFOOD_REL), { recursive: true });
  // the root store is linked; workspace node_modules are copied link-for-link so relative
  // workspace links (@shape/shp-checker -> ../../../shp-checker) resolve inside the tree
  if (!existsSync(join(dir, "node_modules")))
    symlinkSync(join(REPO, "node_modules"), join(dir, "node_modules"), "dir");
  for (const nm of [
    "packages/shp-checker/node_modules",
    "packages/shp-cli/node_modules",
    "docs-site/node_modules"
  ]) {
    const src = join(REPO, nm);
    const dst = join(dir, nm);
    if (existsSync(src) && existsSync(dirname(dst)) && !existsSync(dst))
      cpSync(src, dst, { recursive: true, verbatimSymlinks: true });
  }
  return dir;
}

/** The files of a materialised tree, as its manifest sees them. */
export function treeFiles(dir: string): SourceFileBytes[] {
  return filesFromDir(dir).sort((a, b) => cmpStr(a.path, b.path));
}
