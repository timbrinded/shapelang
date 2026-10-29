// Checker input (version 7): the full profile of records §4 (A.16.1) and the source profile for
// conformance sets (A.16.2), step 1 of A.7.8 (input integrity), and the canonical input that
// inputDigest hashes (A.16.3).
import { createHash } from "node:crypto";
import type { CheckInput, RevisionInput } from "./io-types.ts";
import { H, jcs, sha256Hex } from "./jcs.ts";
import {
  type ManifestIndex,
  type ManifestPredicate,
  type Statement,
  gitBlobId,
  gitTreeId,
  indexManifest,
  isShapeFile,
  openManifest,
  sortManifest
} from "./manifest.ts";
import { ParseError, parseShapeFile } from "./parse.ts";
import type { Decl, SourceDoc, SourceModule } from "./source.ts";
import { cmpStr, toSeconds } from "./util.ts";

export interface Revision {
  revision: string;
  /** the shape as source modules; null: unreadable (L0) */
  source: SourceDoc | null;
  /** why the shape is unreadable (L0 delta), or null */
  unreadable: "unreadable" | "migrate-failed" | null;
  /** head shape errors found while reading the shape files (E-parse, A.16.25) */
  shapeErrors: { code: string; subject: string; message: string }[];
  /** base defects found while reading the shape files (bad pins) */
  defects: { code: string; subject: string; message: string }[];
  manifest: ManifestIndex;
  manifestSigners: string[];
  manifestEnveloped: boolean;
  manifestBadSignature: boolean;
  committerTime: number | null;
  /** whether std is in scope (always in the source profile; pinned in the full profile) */
  std: boolean;
}

export interface Verified {
  ok: true;
  head: Revision;
  base: Revision | null;
  profile: "full" | "source";
}

export interface Invalid {
  ok: false;
  problems: string[];
}

const utf8 = (s: string): Uint8Array => new Uint8Array(Buffer.from(s, "utf8"));

/** shape.pack.v1 digest of a pack's files (A.3.1.3, A.16.1(c)). */
export function packDigest(files: { path: string; text: string }[]): string {
  const rows = [...files]
    .sort((a, b) => cmpStr(a.path, b.path))
    .map((f) => [f.path, sha256Hex(utf8(f.text))]);
  return H({ v: "shape.pack.v1", files: rows });
}

interface LockPin {
  name: string;
  version: string;
  digest?: string;
}

function parseLock(text: string): LockPin[] | null {
  try {
    const v = JSON.parse(text) as { v?: unknown; packs?: unknown };
    if (v.v !== "shape.lock.v1" || !Array.isArray(v.packs)) return null;
    const out: LockPin[] = [];
    for (const p of v.packs as Record<string, unknown>[]) {
      if (typeof p.name !== "string" || typeof p.version !== "string") return null;
      out.push({
        name: p.name,
        version: p.version,
        ...(typeof p.digest === "string" ? { digest: p.digest } : {})
      });
    }
    return out;
  } catch {
    return null;
  }
}

function commitInfo(
  commit: string
): { sha1: string; tree: string | null; committerTime: number | null } {
  const bytes = Buffer.from(commit, "utf8");
  const h = createHash("sha1");
  h.update(`commit ${bytes.length}\0`);
  h.update(bytes);
  const tree = /^tree ([0-9a-f]{40})$/m.exec(commit)?.[1] ?? null;
  const ct = /^committer .* (\d+) [+-]\d{4}$/m.exec(commit)?.[1];
  return { sha1: h.digest("hex"), tree, committerTime: ct === undefined ? null : Number(ct) };
}

function readRevision(
  side: "head" | "base",
  r: RevisionInput,
  input: CheckInput,
  full: boolean,
  problems: string[]
): Revision | null {
  const m = openManifest(r.manifest);
  const ix = indexManifest(r.manifest);
  for (const p of ix.problems) problems.push(`${side} manifest: ${p.code} ${p.detail}`);
  if (!ix.index) return null;
  const man = ix.index;
  if (man.revision !== r.revision) problems.push(`${side} manifest: revision mismatch`);
  const out: Revision = {
    revision: r.revision,
    source: null,
    unreadable: null,
    shapeErrors: [],
    defects: [],
    manifest: man,
    manifestSigners: m.signers,
    manifestEnveloped: m.enveloped,
    manifestBadSignature: m.badSignature,
    committerTime: null,
    std: !full
  };
  if (!full) {
    // source profile (A.16.2)
    if (r.treeId !== undefined && gitTreeId(man.tree) !== r.treeId)
      problems.push(`${side} manifest: tree does not rebuild to treeId`);
    if (r.committerTime !== undefined) {
      const t = toSeconds(r.committerTime);
      if (t === null) problems.push(`${side}: committerTime is not RFC 3339`);
      out.committerTime = t;
    }
    if (r.source === null) {
      out.unreadable = "unreadable";
      return out;
    }
    if (!r.source || r.source.v !== "shape.source.v1" || !Array.isArray(r.source.modules)) {
      if (side === "head") problems.push("head: source is not shape.source.v1");
      out.unreadable = "unreadable";
      return out;
    }
    // a lock entry other than std 1.0.0 has no pack: invalid in the head, a base defect (A.16.2(b))
    for (const pin of r.source.lock ?? []) {
      if (pin.name === "std" && pin.version === "1.0.0") continue;
      if (side === "head") problems.push(`head lock: no pack for ${pin.name} ${pin.version}`);
      else
        out.defects.push({
          code: "E-pack",
          subject: `pack ${pin.name}`,
          message: `no pack for ${pin.name} ${pin.version}`
        });
    }
    out.source = r.source;
    return out;
  }
  // full profile (A.16.1)
  if (typeof r.commit !== "string") problems.push(`${side}: commit is missing`);
  else {
    const ci = commitInfo(r.commit);
    if (ci.sha1 !== r.revision) problems.push(`${side}: revision is not the commit's SHA-1`);
    if (ci.tree !== gitTreeId(man.tree))
      problems.push(`${side}: commit tree does not name the manifest's tree`);
    out.committerTime = ci.committerTime;
  }
  const files = Array.isArray(r.files) ? r.files : [];
  const treeShape = new Map(man.tree.filter((t) => isShapeFile(t.path)).map((t) => [t.path, t]));
  const given = new Map<string, string>();
  for (const f of files) {
    if (typeof f?.path !== "string" || typeof f?.text !== "string") {
      problems.push(`${side} files: malformed entry`);
      continue;
    }
    if (given.has(f.path)) problems.push(`${side} files: duplicate ${f.path}`);
    given.set(f.path, f.text);
    const t = treeShape.get(f.path);
    if (!t) problems.push(`${side} files: ${f.path} is not a shape file of the tree`);
    else if (gitBlobId(utf8(f.text)) !== t.blob)
      problems.push(`${side} files: ${f.path} does not have the tree's blob id`);
  }
  for (const p of treeShape.keys())
    if (!given.has(p)) problems.push(`${side} files: shape file ${p} is missing`);
  // lock and packs
  const lockText = given.get("shape.lock");
  let pins: LockPin[] = [];
  if (lockText !== undefined) {
    const parsed = parseLock(lockText);
    if (!parsed) {
      if (side === "head") problems.push("head shape.lock is malformed");
      else out.unreadable = "unreadable";
    } else pins = parsed;
  }
  const packs = Array.isArray(input.packs) ? input.packs : [];
  const modules: SourceModule[] = [];
  for (const pin of pins) {
    const pack = packs.find((p) => p.name === pin.name && p.version === pin.version);
    const ok = !!pack && pin.digest !== undefined && packDigest(pack.files) === pin.digest;
    if (!ok) {
      if (side === "head") problems.push(`head lock: pack ${pin.name} ${pin.version} does not match its pin`);
      else
        out.defects.push({
          code: "E-pack",
          subject: `pack ${pin.name}`,
          message: `pack ${pin.name} ${pin.version} does not match its pin`
        });
      continue;
    }
    if (pin.name === "std" && pin.version === "1.0.0") {
      out.std = true;
      continue;
    }
    for (const f of [...(pack?.files ?? [])].sort((a, b) => cmpStr(a.path, b.path))) {
      try {
        modules.push({ ...parseShapeFile(f.path, f.text), pack: true });
      } catch (e) {
        if (side === "head") problems.push(`head pack ${pin.name}: ${f.path} does not parse`);
        else out.defects.push({ code: "E-pack", subject: `pack ${pin.name}`, message: String(e) });
      }
    }
  }
  if (out.unreadable) return out;
  for (const [path, text] of [...given.entries()].sort((a, b) => cmpStr(a[0], b[0]))) {
    if (path === "shape.lock") continue;
    try {
      modules.push(parseShapeFile(path, text));
    } catch (e) {
      const msg = e instanceof ParseError ? `line ${e.line}: ${e.message}` : String(e);
      if (side === "base") {
        out.unreadable = "unreadable";
        return out;
      }
      out.shapeErrors.push({ code: "E-parse", subject: path, message: msg });
    }
  }
  out.source = {
    v: "shape.source.v1",
    modules,
    lock: pins.map((p) => ({ name: p.name, version: p.version }))
  };
  return out;
}

/** Step 1 of A.7.8 for either profile. */
export function verifyInput(input: CheckInput): Verified | Invalid {
  const problems: string[] = [];
  if (!input || input.contract !== "shape.check.input/v1")
    return { ok: false, problems: ["contract: not shape.check.input/v1"] };
  if (!["change", "audit", "preview"].includes(input.mode))
    problems.push(`mode: ${String(input.mode)}`);
  if (toSeconds(input.now ?? "") === null) problems.push("now: not RFC 3339");
  if (input.mode === "audit" && input.base !== null) problems.push("base: audit mode has no base");
  if (input.mode !== "audit" && !input.base)
    problems.push("base: change and preview need a base (possibly empty)");
  const full = !!input.head && "files" in input.head && !("source" in input.head);
  if (!input.head) return { ok: false, problems: [...problems, "head: missing"] };
  const head = readRevision("head", input.head, input, full, problems);
  const base = input.base ? readRevision("base", input.base, input, full, problems) : null;
  if (full && head && base && head.revision === base.revision)
    problems.push("base and head revisions are equal");
  if (problems.length > 0 || !head || (input.base && !base)) return { ok: false, problems };
  return { ok: true, head, base, profile: full ? "full" : "source" };
}

// ---- canonical input (A.16.3) -----------------------------------------------------------------

function statementOf(r: unknown): unknown {
  const o = r as { payloadType?: unknown; payload?: unknown };
  if (o && typeof o.payloadType === "string" && typeof o.payload === "string") {
    try {
      return JSON.parse(Buffer.from(o.payload, "base64").toString("utf8")) as unknown;
    } catch {
      return r;
    }
  }
  return r;
}

const set = (xs: string[] | undefined): string[] | undefined => (xs ? [...xs].sort(cmpStr) : xs);

function canonDecl(d: Decl): Decl {
  switch (d.decl) {
    case "component":
      return {
        ...d,
        units: d.units ? [...d.units].sort((a, b) => cmpStr(a.name, b.name)) : d.units,
        grants: Array.isArray(d.grants) ? [...d.grants].sort(cmpStr) : d.grants,
        paths: set(d.paths),
        exceptPaths: set(d.exceptPaths),
        allows: set(d.allows),
        relationsComplete: set(d.relationsComplete),
        assumes: d.assumes ? [...d.assumes].sort((a, b) => cmpStr(a.id, b.id)) : d.assumes
      };
    case "resource":
      return { ...d, bind: set(d.bind) };
    case "actor":
      return { ...d, identities: set(d.identities), members: set(d.members) };
    case "provider":
      return {
        ...d,
        observes: set(d.observes),
        decides: set(d.decides),
        produces: [...d.produces].sort(cmpStr),
        sound: d.sound ? [...d.sound].sort(cmpStr) : d.sound
      };
    case "note":
      return { ...d, about: [...d.about].sort(cmpStr) };
    default:
      return d;
  }
}

function declKey(d: Decl): string {
  return `${d.decl}\u0000${d.decl === "hatch" ? d.names.join(",") : d.name}`;
}

function canonSource(s: SourceDoc | null | undefined): unknown {
  if (s === null || s === undefined) return s ?? null;
  return {
    ...s,
    modules: [...s.modules]
      .map((m) => ({
        ...m,
        file: undefined,
        imports: [...(m.imports ?? [])].sort(cmpStr),
        decls: m.decls
          .map(canonDecl)
          .map((d) => ({ d, k: declKey(d), j: jcs(d) }))
          .sort((a, b) => cmpStr(a.k, b.k) || cmpStr(a.j, b.j))
          .map((x) => x.d)
      }))
      .sort((a, b) => cmpStr(a.module, b.module))
  };
}

function canonManifest(st: unknown): unknown {
  const s = st as Statement | undefined;
  const p = s?.predicate?.shape as ManifestPredicate | undefined;
  if (s && p && typeof p === "object" && Array.isArray(p.tree) && Array.isArray(p.entries)) {
    const sorted = sortManifest(p);
    return {
      ...s,
      predicate: {
        ...s.predicate,
        shape: { v: "shape.manifest.v1", revision: p.revision, tree: sorted.tree, entries: sorted.entries }
      }
    };
  }
  return st;
}

function sortByKeys<T>(xs: T[] | undefined, key: (x: T) => string[]): T[] {
  return [...(xs ?? [])]
    .map((x) => ({ x, k: [...key(x), jcs(x)] }))
    .sort((a, b) => {
      for (let i = 0; i < a.k.length; i += 1) {
        const c = cmpStr(a.k[i] as string, b.k[i] as string);
        if (c !== 0) return c;
      }
      return 0;
    })
    .map((y) => y.x);
}

export function canonicalInput(input: CheckInput): unknown {
  const rev = (r: RevisionInput | null | undefined): unknown => {
    if (!r) return r ?? null;
    const out: Record<string, unknown> = { ...r, manifest: canonManifest(r.manifest) };
    if ("source" in r) out.source = canonSource(r.source);
    if (Array.isArray(r.files)) out.files = sortByKeys(r.files, (f) => [f.path]);
    return out;
  };
  const out: Record<string, unknown> = {
    ...input,
    head: rev(input.head),
    base: rev(input.base),
    change: { ...input.change, ids: [...(input.change?.ids ?? [])].sort(cmpStr) },
    authors: sortByKeys(input.authors, (a) => [a.identity]),
    reviews: sortByKeys(input.reviews, (r) => [r.change ?? "", r.identity, r.time ?? "", r.line]),
    records: sortByKeys(input.records, (r) => [H(statementOf(r))]),
    baseRecords: sortByKeys(input.baseRecords, (r) => [H(statementOf(r))]),
    persisted: {
      base: sortByKeys(input.persisted?.base, (p) => [p.path]),
      head: sortByKeys(input.persisted?.head, (p) => [p.path])
    }
  };
  if (Array.isArray(input.packs))
    out.packs = sortByKeys(input.packs, (p) => [p.name, p.version]).map((p) => ({
      ...p,
      files: sortByKeys(p.files, (f) => [f.path])
    }));
  return out;
}

export function inputDigest(input: CheckInput): string {
  try {
    return H(canonicalInput(input));
  } catch {
    return "sha256:invalid";
  }
}
