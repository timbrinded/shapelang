// Test fixtures for the providers: temporary source trees, check inputs and small shapes.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { CheckInput } from "../../src/io-types.ts";
import type { Statement } from "../../src/manifest.ts";
import type { Decl, SourceDoc } from "../../src/source.ts";
import { PROTO_ROOT } from "../common.ts";

export const PBT = join(PROTO_ROOT, "providers/laws/pbt.ts");

const made: string[] = [];

/** Writes files into a fresh temporary directory ($SHAPE_TMP or the OS temp dir). */
export function tree(files: Record<string, string>): string {
  const dir = mkdtempSync(join(process.env.SHAPE_TMP ?? tmpdir(), "shape-prov-test-"));
  made.push(dir);
  for (const [p, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), text);
  }
  return dir;
}

export function cleanup(): void {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
}

export function shape(module: string, decls: Decl[], owner = "alice"): SourceDoc {
  return {
    v: "shape.source.v1",
    modules: [
      {
        module,
        imports: ["std"],
        decls: [
          { decl: "shape", name: "Demo", owner },
          { decl: "actor", name: "alice", kind: "person", identities: ['github("alice")'] },
          { decl: "actor", name: "bob", kind: "person", identities: ['github("bob")'] },
          ...decls
        ]
      }
    ]
  };
}

export function input(o: {
  source: SourceDoc;
  manifest: Statement;
  revision: string;
  records?: unknown[];
  mode?: CheckInput["mode"];
  base?: CheckInput["base"];
  now?: string;
}): CheckInput {
  return {
    contract: "shape.check.input/v1",
    mode: o.mode ?? "audit",
    now: o.now ?? "2026-10-25T12:00:00Z",
    head: { revision: o.revision, source: o.source, manifest: o.manifest },
    base: o.mode === "audit" || o.mode === undefined ? null : (o.base ?? null),
    change: { ids: ["test#1"] },
    authors: [{ identity: 'github("carol")', verified: true, bot: false }],
    reviews: [],
    records: o.records ?? [],
    baseRecords: [],
    persisted: { base: [], head: [] },
    options: { health: true, teeth: false }
  };
}
