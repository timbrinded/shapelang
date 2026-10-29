// Manifests (A.3.2.6, A.12.7.5): a revision's code identities with digests, parents and hatch
// markers, as an in-toto statement. Pure: indexing, validation and git tree rebuilding.
import { createHash } from "node:crypto";
import { H } from "./jcs.ts";
import { cmpStr } from "./util.ts";

export interface TreeEntry {
  path: string;
  mode: string;
  /** git blob id (40 hex SHA-1) */
  blob: string;
}

export interface ManifestEntry {
  id: string;
  projection: "file" | "own" | "unit" | "contract" | "closure";
  scheme: string;
  digest: string;
  kind: string;
  parent: string | null;
  markers?: Record<string, number>;
  merged?: number;
  /** prototype extensions (monotonic, A.12.5.1): parse completeness and executability the
   *  checker cannot recompute because it never reads code */
  hatchComplete?: boolean;
  executable?: boolean;
}

export interface ManifestPredicate {
  v: "shape.manifest.v1";
  revision: string;
  tree: TreeEntry[];
  entries: ManifestEntry[];
}

export interface Statement {
  _type: string;
  subject: { name: string; digest: Record<string, string>; annotations?: Record<string, string> }[];
  predicateType: string;
  predicate: Record<string, unknown> & { shape?: unknown };
}

export const STATEMENT_TYPE = "https://in-toto.io/Statement/v1";
export const SCAI_TYPE = "https://in-toto.io/attestation/scai/attribute-report/v0.3";
export const TEST_RESULT_TYPE = "https://in-toto.io/attestation/test-result/v0.1";

export function manifestRoot(p: Pick<ManifestPredicate, "tree" | "entries">): string {
  return H({ v: "shape.manifest.v1", tree: p.tree, entries: p.entries });
}

export function sortManifest(p: ManifestPredicate): ManifestPredicate {
  return {
    v: "shape.manifest.v1",
    revision: p.revision,
    tree: [...p.tree].sort((a, b) => cmpStr(a.path, b.path)),
    entries: [...p.entries].sort(
      (a, b) =>
        cmpStr(a.id, b.id) || cmpStr(a.projection, b.projection) || cmpStr(a.scheme, b.scheme)
    )
  };
}

export function manifestStatement(p: ManifestPredicate): Statement {
  const s = sortManifest(p);
  return {
    _type: STATEMENT_TYPE,
    subject: [
      { name: `shape:manifest/${s.revision}`, digest: { sha256: manifestRoot(s).slice(7) } }
    ],
    predicateType: SCAI_TYPE,
    predicate: { attributes: [{ attribute: "SHAPE_MANIFEST" }], shape: s }
  };
}

export function isShapeFile(path: string): boolean {
  if (path === "shape.lock") return true;
  return (
    path.startsWith("shape/") && path.endsWith(".shape") && !path.startsWith("shape/evidence/")
  );
}

export function isRecordFile(path: string): boolean {
  return /^shape\/evidence\/[0-9a-f]{2}\/[0-9a-f]{64}\.json$/.test(path);
}

export function identityPath(id: string): string {
  const colon = id.indexOf(":");
  const rest = colon >= 0 ? id.slice(colon + 1) : id;
  const hash = rest.indexOf("#");
  const p = hash >= 0 ? rest.slice(0, hash) : rest;
  return p.replace(/%23/g, "#").replace(/%25/g, "%");
}

export function identityLang(id: string): string {
  const colon = id.indexOf(":");
  return colon >= 0 ? id.slice(0, colon) : "";
}

export function identitySymbol(id: string): string | null {
  const colon = id.indexOf(":");
  const rest = colon >= 0 ? id.slice(colon + 1) : id;
  const hash = rest.indexOf("#");
  return hash >= 0 ? rest.slice(hash + 1) : null;
}

export interface IdentityInfo {
  id: string;
  lang: string;
  path: string;
  symbol: string | null;
  kind: string;
  parent: string | null;
  /** projection → digest (registry scheme) */
  digests: Map<string, string>;
  schemes: Map<string, string>;
  markers: Record<string, number>;
  hatchComplete: boolean;
  executable: boolean;
}

export interface ManifestIndex {
  revision: string;
  ids: Map<string, IdentityInfo>;
  tree: TreeEntry[];
  paths: Set<string>;
  children: Map<string, string[]>;
  root: string;
}

export interface ManifestProblem {
  code: string;
  detail: string;
}

/** Validates and indexes a manifest statement; problems make the input invalid (A.12.7.5). */
export function indexManifest(stmt: unknown): {
  index: ManifestIndex | null;
  problems: ManifestProblem[];
} {
  const problems: ManifestProblem[] = [];
  const s = stmt as Statement;
  const p = (s?.predicate?.shape ?? null) as ManifestPredicate | null;
  if (!s || s._type !== STATEMENT_TYPE || !p || p.v !== "shape.manifest.v1") {
    return {
      index: null,
      problems: [{ code: "manifest-form", detail: "not a shape.manifest.v1 statement" }]
    };
  }
  const tree = [...(p.tree ?? [])].sort((a, b) => cmpStr(a.path, b.path));
  const paths = new Set<string>();
  const folded = new Map<string, string>();
  for (const t of tree) {
    if (t.path.normalize("NFC") !== t.path) problems.push({ code: "nfc", detail: t.path });
    const f = t.path.toLowerCase();
    const prev = folded.get(f);
    if (prev && prev !== t.path)
      problems.push({ code: "case-fold-collision", detail: `${prev} / ${t.path}` });
    folded.set(f, t.path);
    if (paths.has(t.path)) problems.push({ code: "duplicate-path", detail: t.path });
    paths.add(t.path);
  }
  const ids = new Map<string, IdentityInfo>();
  for (const e of p.entries ?? []) {
    let info = ids.get(e.id);
    if (!info) {
      info = {
        id: e.id,
        lang: identityLang(e.id),
        path: identityPath(e.id),
        symbol: identitySymbol(e.id),
        kind: e.kind,
        parent: e.parent ?? null,
        digests: new Map(),
        schemes: new Map(),
        markers: {},
        hatchComplete: e.hatchComplete ?? true,
        executable: e.executable ?? false
      };
      ids.set(e.id, info);
    }
    const prev = info.digests.get(e.projection);
    if (prev !== undefined && info.schemes.get(e.projection) === e.scheme && prev !== e.digest) {
      problems.push({ code: "conflicting-digest", detail: `${e.id}@${e.projection}` });
    }
    if (prev === undefined) {
      info.digests.set(e.projection, e.digest);
      info.schemes.set(e.projection, e.scheme);
    }
    if (e.markers)
      for (const [k, n] of Object.entries(e.markers))
        info.markers[k] = Math.max(info.markers[k] ?? 0, n);
    if (e.hatchComplete === false) info.hatchComplete = false;
    if (e.executable) info.executable = true;
    if (!/^sha256:[0-9a-f]{64}$/.test(e.digest))
      problems.push({ code: "bad-digest", detail: `${e.id}@${e.projection}` });
  }
  // one file identity per non-shape, non-record tracked path: no code can be omitted
  const fileIds = new Map<string, string>();
  for (const info of ids.values()) {
    if (info.symbol === null) {
      if (fileIds.has(info.path)) problems.push({ code: "two-file-identities", detail: info.path });
      fileIds.set(info.path, info.id);
      if (tree.length > 0 && !paths.has(info.path))
        problems.push({ code: "entry-outside-tree", detail: info.id });
    }
    if (isShapeFile(info.path) || isRecordFile(info.path))
      problems.push({ code: "shape-file-identity", detail: info.id });
  }
  for (const t of tree) {
    if (isShapeFile(t.path) || isRecordFile(t.path)) continue;
    if (!fileIds.has(t.path)) problems.push({ code: "omitted-path", detail: t.path });
  }
  const children = new Map<string, string[]>();
  for (const info of ids.values()) {
    if (info.parent) {
      if (!ids.has(info.parent)) problems.push({ code: "unknown-parent", detail: info.id });
      const list = children.get(info.parent) ?? [];
      list.push(info.id);
      children.set(info.parent, list);
    }
  }
  for (const list of children.values()) list.sort(cmpStr);
  const sorted = sortManifest({ ...p, tree });
  return {
    index: { revision: p.revision, ids, tree, paths, children, root: manifestRoot(sorted) },
    problems
  };
}

export function ancestorsOrSelf(index: ManifestIndex, id: string): string[] {
  const out: string[] = [];
  let cur: string | null = id;
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    out.push(cur);
    cur = index.ids.get(cur)?.parent ?? null;
  }
  return out;
}

export function descendantsOrSelf(index: ManifestIndex, id: string): string[] {
  const out: string[] = [];
  const stack = [id];
  while (stack.length > 0) {
    const x = stack.pop() as string;
    out.push(x);
    for (const c of index.children.get(x) ?? []) stack.push(c);
  }
  return out.sort(cmpStr);
}

// ---- git objects --------------------------------------------------------------------

export function gitBlobId(bytes: Uint8Array): string {
  const h = createHash("sha1");
  h.update(`blob ${bytes.length}\0`);
  h.update(bytes);
  return h.digest("hex");
}

/** Rebuilds git tree objects from {path, mode, blob} and returns the root tree id (A.12.7.5). */
export function gitTreeId(tree: TreeEntry[]): string {
  interface Dir {
    files: Map<string, { mode: string; id: string }>;
    dirs: Map<string, Dir>;
  }
  const root: Dir = { files: new Map(), dirs: new Map() };
  for (const t of tree) {
    const segs = t.path.split("/");
    let d = root;
    for (const s of segs.slice(0, -1)) {
      let nd = d.dirs.get(s);
      if (!nd) {
        nd = { files: new Map(), dirs: new Map() };
        d.dirs.set(s, nd);
      }
      d = nd;
    }
    d.files.set(segs[segs.length - 1] as string, { mode: t.mode, id: t.blob });
  }
  const hashDir = (d: Dir): string => {
    const items: { name: string; sortKey: string; mode: string; id: string }[] = [];
    for (const [name, f] of d.files)
      items.push({ name, sortKey: name, mode: f.mode.replace(/^0+/, ""), id: f.id });
    for (const [name, sub] of d.dirs)
      items.push({ name, sortKey: `${name}/`, mode: "40000", id: hashDir(sub) });
    items.sort((a, b) => Buffer.compare(Buffer.from(a.sortKey), Buffer.from(b.sortKey)));
    const parts: Buffer[] = [];
    for (const it of items) {
      parts.push(Buffer.from(`${it.mode} ${it.name}\0`));
      parts.push(Buffer.from(it.id, "hex"));
    }
    const body = Buffer.concat(parts);
    const h = createHash("sha1");
    h.update(`tree ${body.length}\0`);
    h.update(body);
    return h.digest("hex");
  };
  return hashDir(root);
}
