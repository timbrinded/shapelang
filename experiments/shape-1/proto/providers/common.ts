// Shared plumbing for the Shape 1.0 prototype evidence providers: provider declarations (what a
// provider produces, observes or decides, and its soundness), manifests built exactly as
// `shape1 check` builds them, code citations, record emission through the core library
// (makeStatement, DSSE signing) and self-validation against RJ01–RJ14 (records §3, A.12.5-6).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { elaborate } from "../src/elaborate.ts";
import { loadModel, readSidecar } from "../src/loader.ts";
import { type SourceFileBytes, buildManifest, filesFromDir, filesFromGit } from "../src/manifest-build.ts";
import { type ManifestIndex, type ManifestPredicate, type Statement, gitTreeId, indexManifest, manifestStatement } from "../src/manifest.ts";
import type { ESF } from "../src/model.ts";
import {
  type CodeCite,
  type ParsedRecord,
  type Rejection,
  type ShapeRecord,
  type Signer,
  makeStatement,
  parseRecord,
  signStatement,
  signerFromSeed,
  validateRecord
} from "../src/records.ts";
import type { Decl, SourceDoc } from "../src/source.ts";
import { cmpStr, fromSeconds, toSeconds } from "../src/util.ts";

export const REPO_ROOT = resolve(import.meta.dir, "../../../..");
export const PROTO_ROOT = resolve(import.meta.dir, "..");

export type ProviderDecl = Extract<Decl, { decl: "provider" }>;
export type Soundness = ("presence" | "absence")[];

/** A provider as the shape declares it: its Q, the version its records carry, and the
 *  shape.source.v1 declaration (produces, channels, decides, soundness, implementation). */
export interface ProviderInfo {
  q: string;
  version: string;
  decl: ProviderDecl;
}

export function providerName(q: string): string {
  const i = q.lastIndexOf("::");
  return i >= 0 ? q.slice(i + 2) : q;
}

// ---- arguments -------------------------------------------------------------------------------------

export interface Args {
  cmd: string;
  flags: Map<string, string[]>;
  bools: Set<string>;
  rest: string[];
}

export function parseArgs(argv: string[], bools: string[]): Args {
  const [cmd = "help", ...rest] = argv;
  const flags = new Map<string, string[]>();
  const bset = new Set<string>();
  const pos: string[] = [];
  const known = new Set(bools);
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i] as string;
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      const name = eq > 0 ? a.slice(2, eq) : a.slice(2);
      if (known.has(name)) bset.add(name);
      else {
        const v = eq > 0 ? a.slice(eq + 1) : (rest[++i] ?? "");
        flags.set(name, [...(flags.get(name) ?? []), v]);
      }
    } else pos.push(a);
  }
  return { cmd, flags, bools: bset, rest: pos };
}

export const one = (a: Args, k: string): string | undefined => a.flags.get(k)?.[0];
export const many = (a: Args, k: string): string[] => a.flags.get(k) ?? [];

// ---- manifests ------------------------------------------------------------------------------------

export interface Manifested {
  statement: Statement;
  index: ManifestIndex;
  revision: string;
  backend: string;
  /** the files the manifest was built from (null when a prebuilt manifest was given) */
  files: SourceFileBytes[] | null;
  /** path → bytes, for scanners */
  read: (path: string) => string | null;
}

function revParse(dir: string, ref: string): string | null {
  const r = spawnSync("git", ["rev-parse", ref], { cwd: dir });
  return r.status === 0 ? r.stdout.toString().trim() : null;
}

/** Builds a manifest exactly as `shape1 check` does: revision = the git commit for --git, the
 *  given --revision, else gitTreeId(tree). Or loads a prebuilt manifest statement. */
export async function manifestFor(opts: {
  root?: string;
  git?: string;
  rev?: string;
  revision?: string;
  manifest?: string;
  noTypeScript?: boolean;
  files?: SourceFileBytes[];
}): Promise<Manifested> {
  let files: SourceFileBytes[] | null = opts.files ?? null;
  let revision = opts.revision;
  if (!files && opts.git) {
    const repo = resolve(opts.git);
    const ref = opts.rev ?? "HEAD";
    files = filesFromGit(repo, ref);
    revision = revision ?? revParse(repo, ref) ?? undefined;
  } else if (!files && opts.root) files = filesFromDir(resolve(opts.root));
  let statement: Statement;
  let backend = "prebuilt";
  if (opts.manifest) {
    statement = JSON.parse(readFileSync(opts.manifest, "utf8")) as Statement;
  } else {
    if (!files) throw new Error("manifestFor: need --root, --git or --manifest");
    const draft = await buildManifest({ repoRoot: REPO_ROOT, revision: revision ?? "pending", files, noTypeScript: opts.noTypeScript });
    const pred = draft.statement.predicate.shape as ManifestPredicate;
    const rev = revision ?? gitTreeId(pred.tree);
    statement = manifestStatement({ ...pred, revision: rev });
    backend = draft.backend;
  }
  const { index, problems } = indexManifest(statement);
  if (!index) throw new Error(`manifest: ${problems.map((p) => `${p.code} ${p.detail}`).join("; ")}`);
  const byPath = new Map((files ?? []).map((f) => [f.path, f]));
  const root = opts.root ? resolve(opts.root) : null;
  const read = (path: string): string | null => {
    const f = byPath.get(path);
    if (f) return Buffer.from(f.bytes).toString("utf8");
    if (root) {
      try {
        return readFileSync(join(root, path), "utf8");
      } catch {
        return null;
      }
    }
    return null;
  };
  return { statement, index, revision: index.revision, backend, files, read };
}

/** The (id, projection, scheme, digest) a record cites, copied from the manifest. */
export function cite(index: ManifestIndex, id: string, projection: string): CodeCite | null {
  const info = index.ids.get(id);
  const digest = info?.digests.get(projection);
  const scheme = info?.schemes.get(projection);
  if (!info || digest === undefined || scheme === undefined) return null;
  return { id, projection, scheme, digest };
}

/** The file identity of a tracked path (ts:, rust:, verus:, raw:, …). */
export function fileIdentity(index: ManifestIndex, path: string): string | null {
  for (const info of index.ids.values()) if (info.symbol === null && info.path === path) return info.id;
  return null;
}

export function sortCites(xs: CodeCite[]): CodeCite[] {
  const seen = new Set<string>();
  return xs
    .filter((c) => {
      const k = `${c.id}\u0000${c.projection}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => cmpStr(a.id, b.id) || cmpStr(a.projection, b.projection));
}

// ---- shapes ----------------------------------------------------------------------------------------

/** Loads a shape: a shape.source.v1 file (--source), or a model directory (--model, 0.x files
 *  migrated plus the sidecar). */
export function loadSource(opts: { source?: string; model?: string; sidecar?: string; maintainers?: string[] }): SourceDoc {
  if (opts.source) {
    const text = readFileSync(opts.source, "utf8");
    const doc = (opts.source.endsWith(".yaml") || opts.source.endsWith(".yml") ? Bun.YAML.parse(text) : JSON.parse(text)) as SourceDoc;
    if (doc.v !== "shape.source.v1") throw new Error(`${opts.source}: not shape.source.v1`);
    return doc;
  }
  if (opts.model) {
    const dir = resolve(opts.model);
    try {
      return loadModel(dir, { sidecar: opts.sidecar, maintainers: opts.maintainers }).source;
    } catch (e) {
      const side = readSidecar(dir, opts.sidecar);
      if (side) return side;
      throw e;
    }
  }
  throw new Error("need --source <shape1.json> or --model <dir>");
}

export function elaborateAt(source: SourceDoc, time: string): ESF {
  return elaborate(source, { now: toSeconds(time) ?? 0, lenient: true });
}

// ---- records ---------------------------------------------------------------------------------------

export interface Emitted {
  id: string;
  /** the statement, or its DSSE envelope when signed */
  record: unknown;
  shape: ShapeRecord;
}

/** RFC 3339 UTC seconds; providers may read the clock (the checker never does). */
export function recordTime(explicit?: string): string {
  if (explicit) {
    const t = toSeconds(explicit);
    if (t === null) throw new Error(`bad --time ${explicit}`);
    return fromSeconds(t);
  }
  return fromSeconds(Math.floor(Date.now() / 1000));
}

export function signerOf(seed: string | undefined): Signer | null {
  return seed ? signerFromSeed(seed) : null;
}

/** Builds the in-toto statement through the core library and signs it when a key is given. */
export function emit(rec: ShapeRecord, signer: Signer | null): Emitted {
  const stmt = makeStatement(rec);
  const record = signer ? signStatement(stmt, [signer]) : stmt;
  const parsed = parseRecord(record);
  if ("error" in parsed) throw new Error(`emit: ${parsed.error}`);
  return { id: parsed.id, record, shape: rec };
}

/** Validates an emitted record against RJ01–RJ14 as a checker would, with the provider
 *  declared in base and head (its identity from the signer, when any). */
export function selfValidate(e: Emitted, info: ProviderInfo, man: ManifestIndex, nowIso: string, actors?: Map<string, { identities: string[]; kind: string; operator: string | null }>): Rejection | null {
  const parsed = parseRecord(e.record) as ParsedRecord;
  const identity = info.decl.identity ?? null;
  const prov = new Map([[info.q, { produces: info.decl.produces as string[], identity }]]);
  const digests = new Map<string, string>();
  for (const x of man.ids.values()) for (const [p, d] of x.digests) digests.set(`${x.id}\u0000${p}\u0000${x.schemes.get(p)}`, d);
  return validateRecord(parsed, {
    now: toSeconds(nowIso) ?? 0,
    mode: "change",
    persisted: false,
    baseProviders: prov,
    headProviders: prov,
    actors: actors ?? new Map(),
    actorByIdentity: new Map(),
    relays: new Map(),
    headRevision: man.revision,
    baseRevision: null,
    manifests: new Map([[man.revision, digests]]),
    trees: new Map([[man.revision, man.paths]])
  });
}

let stdoutChain: Promise<unknown> = Promise.resolve();

/** Writes to stdout through Bun.write, in order, which completes for pipes (process.stdout.write
 *  followed by process.exit truncates piped output at 128 KiB). Await flushStdout() before exit. */
function toStdout(text: string): void {
  stdoutChain = stdoutChain.then(() => Bun.write(Bun.stdout, text));
}

export async function flushStdout(): Promise<void> {
  await stdoutChain;
}

/** Writes records as JSON lines (stdout when no path), or one <hex>.json per record when the
 *  path ends with "/". */
export function writeRecords(path: string | undefined, records: Emitted[]): void {
  if (path && path.endsWith("/")) {
    mkdirSync(path, { recursive: true });
    for (const r of records) writeFileSync(join(path, `${r.id.slice(7)}.json`), `${JSON.stringify(r.record)}\n`);
    return;
  }
  const text = records.map((r) => JSON.stringify(r.record)).join("\n") + (records.length > 0 ? "\n" : "");
  if (!path || path === "-") toStdout(text);
  else {
    mkdirSync(dirname(resolve(path)), { recursive: true });
    writeFileSync(path, text);
  }
}

export function writeJson(path: string | undefined, value: unknown): void {
  const text = `${JSON.stringify(value, null, 1)}\n`;
  if (!path || path === "-") toStdout(text);
  else {
    mkdirSync(dirname(resolve(path)), { recursive: true });
    writeFileSync(path, text);
  }
}

/** {num, den}: shares stay float-free (A.0.4). */
export function share(num: number, den: number): { num: number; den: number } {
  return { num, den };
}

/** One decimal percentage for human-readable summaries only (never hashed). */
export function pct(num: number, den: number): string {
  return den === 0 ? "n/a" : `${(Math.round((1000 * num) / den) / 10).toFixed(1)}%`;
}
