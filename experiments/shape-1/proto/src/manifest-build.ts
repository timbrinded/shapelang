// `shp manifest` for the prototype: builds a revision's manifest from a git tree or a directory,
// without executing code (A.3.2.6, A.12.2, A.12.7.5). Impure tooling; derive never calls it.
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, normalize, relative } from "node:path";
import { codeDigest, encodePath, type FpIdentity } from "./fingerprint/common.ts";
import { fingerprintRust } from "./fingerprint/rust.ts";
import {
  TS_EXTENSIONS,
  type TsApi,
  fingerprintTs,
  isTsPath,
  loadTypeScript
} from "./fingerprint/ts.ts";
import { jcs } from "./jcs.ts";
import {
  type ManifestEntry,
  type ManifestPredicate,
  type Statement,
  type TreeEntry,
  gitBlobId,
  isRecordFile,
  isShapeFile,
  manifestStatement
} from "./manifest.ts";
import { cmpStr } from "./util.ts";

export interface SourceFileBytes {
  path: string;
  mode: string;
  bytes: Uint8Array;
}

const SCRIPT_EXTS = new Set(
  "sh bash zsh fish py rb pl php ps1 bat cmd sql swift go java kt scala c h cc cpp hpp cs lua r jl ex exs erl hs ml dart groovy zig html htm astro vue svelte".split(
    " "
  )
);
const SCRIPT_NAMES = new Set(["Makefile", "GNUmakefile", "Dockerfile", "Justfile"]);
const TS_INTERPRETERS = ["node", "bun", "deno", "tsx", "ts-node"];

export function rawExecutable(path: string, mode: string, bytes: Uint8Array): boolean {
  const base = path.split("/").pop() ?? path;
  const ext = base.includes(".") ? (base.split(".").pop() ?? "") : "";
  if (SCRIPT_EXTS.has(ext) || SCRIPT_NAMES.has(base)) return true;
  if (mode === "100755") return true;
  return bytes[0] === 0x23 && bytes[1] === 0x21;
}

function hashbangInterpreter(bytes: Uint8Array): string | null {
  if (!(bytes[0] === 0x23 && bytes[1] === 0x21)) return null;
  const line = Buffer.from(bytes.subarray(0, 200)).toString("utf8").split("\n")[0] ?? "";
  const parts = line.slice(2).trim().split(/\s+/);
  const prog = (parts[0] ?? "").split("/").pop() ?? "";
  return prog === "env" ? (parts[1] ?? "") : prog;
}

function rawIdentity(path: string, mode: string, bytes: Uint8Array): FpIdentity {
  return {
    id: `raw:${encodePath(path)}`,
    kind: "file",
    parent: null,
    digests: [
      { projection: "file", scheme: "raw.file.v1", digest: codeDigest("raw.file.v1", bytes) },
      { projection: "own", scheme: "raw.own.v1", digest: codeDigest("raw.own.v1", bytes) }
    ],
    markers: {},
    hatchComplete: false,
    executable: rawExecutable(path, mode, bytes)
  };
}

function pkgjsonIdentities(path: string, bytes: Uint8Array): FpIdentity[] {
  const fileId = `pkgjson:${encodePath(path)}`;
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(Buffer.from(bytes).toString("utf8")) as Record<string, unknown>;
  } catch {
    return [{ ...rawIdentity(path, "100644", bytes), id: fileId }];
  }
  const scripts = (json.scripts ?? {}) as Record<string, string>;
  const own = {
    ...json,
    scripts: Object.fromEntries(Object.keys(scripts).map((k) => [k, `⟨scripts.${k}⟩`]))
  };
  const out: FpIdentity[] = [
    {
      id: fileId,
      kind: "file",
      parent: null,
      digests: [
        {
          projection: "file",
          scheme: "pkgjson.file.v1",
          digest: codeDigest("pkgjson.file.v1", safeJcs(json))
        },
        {
          projection: "own",
          scheme: "pkgjson.own.v1",
          digest: codeDigest("pkgjson.own.v1", safeJcs(own))
        }
      ],
      markers: {},
      hatchComplete: true,
      executable: false
    }
  ];
  for (const [name, cmd] of Object.entries(scripts)) {
    out.push({
      id: `${fileId}#scripts.${name.replace(/%/g, "%25").replace(/#/g, "%23").replace(/\./g, "%2E")}`,
      kind: "script",
      parent: fileId,
      digests: [
        {
          projection: "own",
          scheme: "pkgjson.unit.v1",
          digest: codeDigest("pkgjson.unit.v1", String(cmd))
        },
        {
          projection: "unit",
          scheme: "pkgjson.unit.v1",
          digest: codeDigest("pkgjson.unit.v1", String(cmd))
        }
      ],
      markers: {},
      hatchComplete: false,
      executable: true
    });
  }
  return out;
}

function safeJcs(v: unknown): string {
  try {
    return jcs(v);
  } catch {
    return JSON.stringify(v);
  }
}

function ghaIdentities(path: string, bytes: Uint8Array): FpIdentity[] {
  const fileId = `gha:${encodePath(path)}`;
  let doc: Record<string, unknown>;
  try {
    doc = Bun.YAML.parse(Buffer.from(bytes).toString("utf8")) as Record<string, unknown>;
  } catch {
    return [{ ...rawIdentity(path, "100644", bytes), id: fileId }];
  }
  const out: FpIdentity[] = [];
  const steps: { id: string; run: string }[] = [];
  const own = JSON.parse(JSON.stringify(doc ?? {})) as Record<string, unknown>;
  const jobs = (own.jobs ?? {}) as Record<string, { steps?: { run?: string }[] }>;
  for (const [job, def] of Object.entries(jobs)) {
    (def?.steps ?? []).forEach((st, i) => {
      if (typeof st?.run === "string") {
        steps.push({ id: `${fileId}#jobs.${job}.steps.${i}`, run: st.run });
        st.run = `⟨jobs.${job}.steps.${i}⟩`;
      }
    });
  }
  out.push({
    id: fileId,
    kind: "file",
    parent: null,
    digests: [
      {
        projection: "file",
        scheme: "gha.file.v1",
        digest: codeDigest("gha.file.v1", safeJcs(doc))
      },
      { projection: "own", scheme: "gha.own.v1", digest: codeDigest("gha.own.v1", safeJcs(own)) }
    ],
    markers: {},
    hatchComplete: true,
    executable: false
  });
  for (const s of steps) {
    out.push({
      id: s.id,
      kind: "step",
      parent: fileId,
      digests: [
        { projection: "own", scheme: "gha.unit.v1", digest: codeDigest("gha.unit.v1", s.run) },
        { projection: "unit", scheme: "gha.unit.v1", digest: codeDigest("gha.unit.v1", s.run) }
      ],
      markers: {},
      hatchComplete: false,
      executable: true
    });
  }
  return out;
}

export function makeResolver(paths: Set<string>): (spec: string, from: string) => string | null {
  return (spec, from) => {
    if (!spec.startsWith(".")) return null;
    const base = normalize(join(dirname(from), spec)).replace(/\\/g, "/");
    const cands = [
      base,
      ...TS_EXTENSIONS.map((e) => base + e),
      ...TS_EXTENSIONS.map((e) => `${base}/index${e}`)
    ];
    for (const c of cands) if (paths.has(c)) return c;
    return null;
  };
}

/** Fingerprints a set of files into manifest entries and a tree. */
export function manifestFromFiles(
  revision: string,
  files: SourceFileBytes[],
  ts: TsApi | null
): ManifestPredicate {
  const tree: TreeEntry[] = files.map((f) => ({
    path: f.path,
    mode: f.mode,
    blob: gitBlobId(f.bytes)
  }));
  const paths = new Set(files.map((f) => f.path));
  const resolve = makeResolver(paths);
  const entries: ManifestEntry[] = [];
  for (const f of [...files].sort((a, b) => cmpStr(a.path, b.path))) {
    if (isShapeFile(f.path) || isRecordFile(f.path)) continue;
    if (f.mode === "120000" || f.mode === "160000") {
      pushAll(entries, [rawIdentity(f.path, f.mode, f.bytes)]);
      continue;
    }
    const base = f.path.split("/").pop() ?? "";
    let ids: FpIdentity[];
    if (base === "package.json") ids = pkgjsonIdentities(f.path, f.bytes);
    else if (/^\.github\/workflows\/[^/]+\.ya?ml$/.test(f.path))
      ids = ghaIdentities(f.path, f.bytes);
    else if (isTsPath(f.path)) {
      const interp = hashbangInterpreter(f.bytes);
      if (interp && !TS_INTERPRETERS.includes(interp)) ids = [rawIdentity(f.path, f.mode, f.bytes)];
      else ids = fingerprintTs(f.path, Buffer.from(f.bytes).toString("utf8"), ts, { resolve });
    } else if (f.path.endsWith(".rs"))
      ids = fingerprintRust(f.path, Buffer.from(f.bytes).toString("utf8"));
    else ids = [rawIdentity(f.path, f.mode, f.bytes)];
    pushAll(entries, ids);
  }
  return { v: "shape.manifest.v1", revision, tree, entries };
}

function pushAll(entries: ManifestEntry[], ids: FpIdentity[]): void {
  for (const id of ids) {
    for (const d of id.digests) {
      const e: ManifestEntry = {
        id: id.id,
        projection: d.projection,
        scheme: d.scheme,
        digest: d.digest,
        kind: id.kind,
        parent: id.parent
      };
      if (Object.keys(id.markers).length > 0) e.markers = id.markers;
      if (id.merged) e.merged = id.merged;
      if (!id.hatchComplete) e.hatchComplete = false;
      if (id.executable && id.id.startsWith("raw:")) e.executable = true;
      if (id.executable && (id.kind === "script" || id.kind === "step")) e.executable = true;
      entries.push(e);
    }
  }
}

// ---- file sources ------------------------------------------------------------------------------

function git(root: string, args: string[], input?: string): Buffer {
  const r = spawnSync("git", args, { cwd: root, input, maxBuffer: 1 << 30 });
  if (r.status !== 0)
    throw new Error(`git ${args.join(" ")} failed: ${r.stderr?.toString() ?? ""}`);
  return r.stdout;
}

/** Files of a git revision (`git ls-tree -r` + `git cat-file --batch`). */
export function filesFromGit(root: string, rev: string): SourceFileBytes[] {
  const listing = git(root, ["ls-tree", "-r", "-z", rev])
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
  const items = listing.map((line) => {
    const [meta, path] = line.split("\t") as [string, string];
    const [mode, type, blob] = meta.split(" ") as [string, string, string];
    return { mode, type, blob, path };
  });
  const blobs = items.filter((i) => i.type === "blob");
  const out = git(root, ["cat-file", "--batch"], `${blobs.map((b) => b.blob).join("\n")}\n`);
  const files: SourceFileBytes[] = [];
  let off = 0;
  for (const b of blobs) {
    const nl = out.indexOf(0x0a, off);
    const header = out.subarray(off, nl).toString("utf8");
    const size = Number(header.split(" ")[2]);
    const bytes = out.subarray(nl + 1, nl + 1 + size);
    off = nl + 1 + size + 1;
    files.push({ path: b.path, mode: b.mode, bytes: new Uint8Array(bytes) });
  }
  for (const i of items)
    if (i.type === "commit") files.push({ path: i.path, mode: "160000", bytes: new Uint8Array() });
  return files.sort((a, b) => cmpStr(a.path, b.path));
}

/** Files of a directory: tracked files when it is a git work tree, else every file (skipping .git, node_modules). */
export function filesFromDir(root: string): SourceFileBytes[] {
  const out: SourceFileBytes[] = [];
  const r = spawnSync("git", ["ls-files", "-s", "-z"], { cwd: root, maxBuffer: 1 << 30 });
  const top = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: root });
  const isRepoRoot =
    r.status === 0 &&
    top.status === 0 &&
    normalize(top.stdout.toString().trim()) === normalize(root);
  if (isRepoRoot) {
    for (const line of r.stdout.toString("utf8").split("\0").filter(Boolean)) {
      const [meta, path] = line.split("\t") as [string, string];
      const mode = meta.split(" ")[0] ?? "100644";
      if (mode === "160000") {
        out.push({ path, mode, bytes: new Uint8Array() });
        continue;
      }
      try {
        out.push({ path, mode, bytes: new Uint8Array(readFileSync(join(root, path))) });
      } catch {
        // deleted in the work tree
      }
    }
    return out.sort((a, b) => cmpStr(a.path, b.path));
  }
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort(cmpStr)) {
      if (name === ".git" || name === "node_modules") continue;
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else {
        const rel = relative(root, full).replace(/\\/g, "/");
        out.push({
          path: rel,
          mode: st.mode & 0o111 ? "100755" : "100644",
          bytes: new Uint8Array(readFileSync(full))
        });
      }
    }
  };
  walk(root);
  return out.sort((a, b) => cmpStr(a.path, b.path));
}

export async function buildManifest(opts: {
  repoRoot: string;
  revision: string;
  files: SourceFileBytes[];
  noTypeScript?: boolean;
}): Promise<{ statement: Statement; backend: string }> {
  const ts = opts.noTypeScript ? null : await loadTypeScript(opts.repoRoot);
  const pred = manifestFromFiles(opts.revision, opts.files, ts);
  return {
    statement: manifestStatement(pred),
    backend: ts ? `typescript ${ts.version}` : "lexical fallback"
  };
}
