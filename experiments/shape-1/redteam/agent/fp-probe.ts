// @ts-nocheck
// Fingerprint blind-spot probe (negative suite, category D): each probe is a base/head pair of tiny
// TypeScript trees whose head changes run-time behaviour of one function. It fingerprints both
// trees with the prototype's manifest builder (TypeScript compiler API) and reports whether the
// function's `unit` and `own` digests moved. A probe whose digest does not move is a code change
// the checker cannot see: judgments, answers and deps-complete records citing that digest stay
// fresh, and the identity is not in the code delta or coverage set.
// Run from the repo root: bun experiments/shape-1/redteam/agent/fp-probe.ts [outfile.json]
import { writeFileSync } from "node:fs";
import { manifestFromFiles } from "../../proto/src/manifest-build.ts";
import { loadTypeScript } from "../../proto/src/fingerprint/ts.ts";

const enc = (s) => new TextEncoder().encode(s);
const files = (o) =>
  Object.entries(o).map(([path, text]) => ({ path, mode: "100644", bytes: enc(text) }));

// spec: what A.5.7.2 / A.12.2.10 say the digest must do for this edit
const PROBES = [
  {
    id: "P1",
    name: "imported const from another TS file changes",
    target: "ts:src/purge.ts#purgeOld",
    spec: "must move: env(x) resolves data by canonical initialiser, transitively, re-exports followed (A.5.7.2, A.12.2.10)",
    base: {
      "src/config.ts": "export const RETENTION_DAYS = 30;\n",
      "src/purge.ts":
        'import { RETENTION_DAYS } from "./config.ts";\nexport function purgeOld(now: number) {\n  return `DELETE FROM audit_events WHERE at < ${now - RETENTION_DAYS * 86400}`;\n}\n'
    },
    head: { "src/config.ts": "export const RETENTION_DAYS = 0;\n" }
  },
  {
    id: "P2",
    name: "imported JSON data file changes",
    target: "ts:src/purge.ts#purgeOld",
    spec: "silent: env covers TS data initialisers only; raw data imported into code is outside env (gap)",
    base: {
      "src/retention.json": '{ "days": 30 }\n',
      "src/purge.ts":
        'import cfg from "./retention.json";\nexport function purgeOld(now: number) {\n  return now - cfg.days * 86400;\n}\n'
    },
    head: { "src/retention.json": '{ "days": 0 }\n' }
  },
  {
    id: "P3",
    name: "same-file callee body changes",
    target: "ts:src/clock.ts#isoToday",
    spec: "must not move: functions by identity (A.5.7.2); freshness of the caller relies on deps/coverage",
    base: {
      "src/clock.ts":
        "function fmt(d: Date) {\n  return d.toISOString().slice(0, 10);\n}\nexport function isoToday() {\n  return fmt(new Date());\n}\n"
    },
    head: {
      "src/clock.ts":
        "function fmt(d: Date) {\n  return d.toLocaleDateString();\n}\nexport function isoToday() {\n  return fmt(new Date());\n}\n"
    }
  },
  {
    id: "P4",
    name: "same-file top-level const changes",
    target: "ts:src/purge.ts#purgeOld",
    spec: "must move: data by canonical initialiser",
    base: {
      "src/purge.ts":
        "const DAYS = 30;\nexport function purgeOld(now: number) {\n  return now - DAYS * 86400;\n}\n"
    },
    head: {
      "src/purge.ts":
        "const DAYS = 0;\nexport function purgeOld(now: number) {\n  return now - DAYS * 86400;\n}\n"
    }
  },
  {
    id: "P5",
    name: "same-file const used as an object property value with the same key name",
    target: "ts:src/purge.ts#purgeOld",
    spec: "must move: data by canonical initialiser (free name `days`)",
    base: {
      "src/purge.ts":
        'const days = 30;\nfunction run(q: { table: string; days: number }) {\n  return q;\n}\nexport function purgeOld() {\n  return run({ table: "audit_events", days: days });\n}\n'
    },
    head: {
      "src/purge.ts":
        'const days = 0;\nfunction run(q: { table: string; days: number }) {\n  return q;\n}\nexport function purgeOld() {\n  return run({ table: "audit_events", days: days });\n}\n'
    }
  },
  {
    id: "P6",
    name: "same-file const shadowed by a nested declaration elsewhere in the function",
    target: "ts:src/purge.ts#purgeOld",
    spec: "must move: the outer use of LIMIT is free",
    base: {
      "src/purge.ts":
        "const LIMIT = 30;\nexport function purgeOld(rows: number[]) {\n  const cut = LIMIT;\n  return rows.filter((r) => {\n    const LIMIT = 1;\n    return r > cut + LIMIT;\n  });\n}\n"
    },
    head: {
      "src/purge.ts":
        "const LIMIT = 0;\nexport function purgeOld(rows: number[]) {\n  const cut = LIMIT;\n  return rows.filter((r) => {\n    const LIMIT = 1;\n    return r > cut + LIMIT;\n  });\n}\n"
    }
  },
  {
    id: "P7",
    name: "string literal NFC to NFD (different run-time string)",
    target: "ts:src/match.ts#isCafe",
    spec: "must move: literals by value; NFC and NFD strings are different values",
    base: { "src/match.ts": 'export function isCafe(s: string) {\n  return s === "café";\n}\n' },
    head: { "src/match.ts": 'export function isCafe(s: string) {\n  return s === "café";\n}\n' }
  },
  {
    id: "P8",
    name: "same-file enum member value changes",
    target: "ts:src/purge.ts#purgeOld",
    spec: "must move: data by canonical initialiser (an enum is data)",
    base: {
      "src/purge.ts":
        "enum Days {\n  Keep = 30\n}\nexport function purgeOld(now: number) {\n  return now - Days.Keep * 86400;\n}\n"
    },
    head: {
      "src/purge.ts":
        "enum Days {\n  Keep = 0\n}\nexport function purgeOld(now: number) {\n  return now - Days.Keep * 86400;\n}\n"
    }
  },
  {
    id: "P9",
    name: "re-exported const changes behind a barrel",
    target: "ts:src/purge.ts#purgeOld",
    spec: "must move: re-exports followed, data transitively (A.12.2.10)",
    base: {
      "src/config/values.ts": "export const RETENTION_DAYS = 30;\n",
      "src/config/index.ts": 'export { RETENTION_DAYS } from "./values.ts";\n',
      "src/purge.ts":
        'import { RETENTION_DAYS } from "./config/index.ts";\nexport function purgeOld(now: number) {\n  return now - RETENTION_DAYS * 86400;\n}\n'
    },
    head: { "src/config/values.ts": "export const RETENTION_DAYS = 0;\n" }
  },
  {
    id: "P10",
    name: "control: the function's own body changes",
    target: "ts:src/purge.ts#purgeOld",
    spec: "must move",
    base: {
      "src/purge.ts": "export function purgeOld(now: number) {\n  return now - 30 * 86400;\n}\n"
    },
    head: {
      "src/purge.ts": "export function purgeOld(now: number) {\n  return now - 0 * 86400;\n}\n"
    }
  },
  {
    id: "P11",
    name: "bigint literal replaced by number literal",
    target: "ts:src/ids.ts#isRoot",
    spec: "must move: 1n and 1 are different values",
    base: { "src/ids.ts": "export function isRoot(x: unknown) {\n  return x === 1n;\n}\n" },
    head: { "src/ids.ts": "export function isRoot(x: unknown) {\n  return x === 1;\n}\n" }
  }
];

const ts = await loadTypeScript(process.cwd());
const results = [];
for (const p of PROBES) {
  const baseFiles = files(p.base);
  const headFiles = files({ ...p.base, ...p.head });
  const mb = manifestFromFiles("b", baseFiles, ts);
  const mh = manifestFromFiles("h", headFiles, ts);
  const dig = (m, proj) =>
    m.entries.find((e) => e.id === p.target && e.projection === proj)?.digest ?? null;
  const moved = {
    unit: dig(mb, "unit") !== dig(mh, "unit"),
    own: dig(mb, "own") !== dig(mh, "own")
  };
  const changedIds = [
    ...new Set(
      mh.entries
        .filter(
          (e) =>
            mb.entries.find((x) => x.id === e.id && x.projection === e.projection)?.digest !==
            e.digest
        )
        .map((e) => e.id)
    )
  ].sort();
  results.push({
    id: p.id,
    name: p.name,
    target: p.target,
    spec: p.spec,
    unitMoved: moved.unit,
    ownMoved: moved.own,
    baseUnit: dig(mb, "unit"),
    headUnit: dig(mh, "unit"),
    changedIds
  });
}
console.log(`TypeScript ${ts?.version ?? "none (lexical fallback)"}`);
for (const r of results)
  console.log(
    `${r.id} unit ${r.unitMoved ? "moved " : "SAME  "} own ${r.ownMoved ? "moved" : "SAME "}  ${r.name}  [changed: ${r.changedIds.join(", ") || "-"}]`
  );
if (process.argv[2])
  writeFileSync(
    process.argv[2],
    `${JSON.stringify({ typescript: ts?.version ?? null, results }, null, 1)}\n`
  );
