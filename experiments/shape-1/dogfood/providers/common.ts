// Shared provider plumbing for the dogfood: provider identities (fixed dogfood seeds, not
// secrets), manifest citations, signing and writing records.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Statement } from "../../proto/src/manifest.ts";
import {
  type CodeCite,
  type DsseEnvelope,
  type ShapeRecord,
  makeStatement,
  recordId,
  signStatement,
  signerFromSeed
} from "../../proto/src/records.ts";

export interface ProviderId {
  q: string;
  version: string;
  seed: string;
}

/** Seeds are sha256("shape-dogfood-provider-<name>"); public keys are declared in shape1.yaml. */
export const PROVIDERS = {
  bunTest: {
    q: "shape.governance::bunTest",
    version: "0.1.0",
    seed: "09ecfb4142249dcffb3077ab078f72a3978e71153d0b146a430f7de8b2e7eec1"
  },
  tsClockScan: {
    q: "shape.governance::tsClockScan",
    version: "0.1.0",
    seed: "2867793dda7d9916ac71667769ac579fde273a191827f84c3fa747d62505fae0"
  },
  tsCalls: {
    q: "shape.governance::tsCalls",
    version: "0.1.0",
    seed: "5a353d72a3b2c89b5a24cb8cd8fc11723ee7ee4964754174b9b0a5c6cc476955"
  }
} as const satisfies Record<string, ProviderId>;

export interface ManifestView {
  revision: string;
  /** id → projection → cite */
  cites: Map<string, Map<string, CodeCite>>;
  /** tracked paths */
  paths: Set<string>;
}

interface Entry {
  id: string;
  projection: string;
  scheme: string;
  digest: string;
}

export function viewOf(manifest: Statement): ManifestView {
  const pred = manifest.predicate.shape as unknown as {
    revision: string;
    tree: { path: string }[];
    entries: Entry[];
  };
  const cites = new Map<string, Map<string, CodeCite>>();
  for (const e of pred.entries) {
    const m = cites.get(e.id) ?? new Map<string, CodeCite>();
    m.set(e.projection, { id: e.id, projection: e.projection, scheme: e.scheme, digest: e.digest });
    cites.set(e.id, m);
  }
  return { revision: pred.revision, cites, paths: new Set(pred.tree.map((t) => t.path)) };
}

export function cite(v: ManifestView, id: string, projection: string): CodeCite | null {
  return v.cites.get(id)?.get(projection) ?? null;
}

/** The file identity of a tracked path (whatever its language), at `file` projection. */
export function fileCite(v: ManifestView, path: string): CodeCite | null {
  for (const lang of ["ts", "rust", "verus", "pkgjson", "gha", "raw"]) {
    const c = cite(v, `${lang}:${path}`, "file");
    if (c) return c;
  }
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
    .sort((a, b) =>
      a.id < b.id
        ? -1
        : a.id > b.id
          ? 1
          : a.projection < b.projection
            ? -1
            : a.projection > b.projection
              ? 1
              : 0
    );
}

export function emit(p: ProviderId, rec: ShapeRecord): { envelope: DsseEnvelope; id: string } {
  const stmt = makeStatement(rec);
  return { envelope: signStatement(stmt, [signerFromSeed(p.seed)]), id: recordId(stmt) };
}

export function writeJsonl(path: string, xs: unknown[]): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, xs.map((x) => JSON.stringify(x)).join("\n") + (xs.length > 0 ? "\n" : ""));
}

/** Record time: one hour before the check's `now` (records must not be future-dated). */
export function recordTime(now: string): string {
  return new Date(Date.parse(now) - 3600_000).toISOString().replace(/\.\d{3}Z$/, "Z");
}
