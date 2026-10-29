// @ts-nocheck
// DRT7 converter: a version 7 checker input (shape.check.input/v1, source or full profile) to the
// kernel case shape.kernel.case/v1 (records §4, A.11.2.1, kernel/README.md "Case format"), using
// the version 7 prototype's pre-pass (proto/src/prepass.ts). Nothing here evaluates the model.
//
//   bun experiments/shape-1/trials/DRT7/convert.ts <input.json> <out.kcase.json>
//
// The case carries what only the pre-pass can compute (A.16.3): inputDigest, rejected and
// clockClamped. Cells are never supplied (the kernel computes them, A.8.1.4 [D23]).
// Readings this converter takes (each is the pre-pass's, not the kernel's):
//   - records: input.records and persisted.head, one per statement id, each with `authenticated`
//     (a verified signature by the identity its role requires), `persistedBase` (A.16.4(b)) and
//     `rejected` (A.12.6); rejected records are passed flagged, so the kernel counts the lists the
//     input supplied (health baseObservations, A.16.30) but uses none of them;
//   - reviews: lines whose `change` is set and is no change id are dropped (they belong to another
//     change; the prototype ignores them for every line kind); `ref` is review: + 16 hex of H(line
//     object as the input gave it) (A.16.28);
//   - head ESF errors: the elaborator's plus E-parse, E-evidence-path and E-evidence-rewrite;
//     base ESF errors: the elaborator's plus the base defects of A.6.4.2;
//   - an unreadable base is `esf: null, unreadable: true`; an empty base is the ESF of a source with
//     no modules (A.16.17).
import { readFileSync, writeFileSync } from "node:fs";
import { prepass } from "../../proto/src/prepass.ts";

function recordEntry(r) {
  if (!r.parsed) return { id: r.id, rejected: true, authenticated: false, persistedBase: false };
  return {
    id: r.id,
    predicate: { shape: r.parsed.shape },
    authenticated: r.authenticated,
    persistedBase: r.persistedBase,
    rejected: r.rejection !== null
  };
}

/** { kind: "case", kcase, pp } | { kind: "invalid", problems, inputDigest } */
export function convert(input) {
  const pp = prepass(input);
  if (!pp.ok) return { kind: "invalid", problems: pp.problems, inputDigest: pp.inputDigest };
  const v = pp.verified;
  const kcase = {
    contract: "shape.kernel.case/v1",
    mode: pp.mode,
    now: pp.now,
    change: { ids: [...(input.change?.ids ?? [])] },
    authors: [...pp.gv.authors].sort(),
    unmappedBot: pp.gv.unmappedBot,
    head: {
      revision: v.head.revision,
      esf: pp.head,
      manifest: input.head.manifest,
      manifestAuthenticated: pp.headManifestAuthenticated
    },
    base: !pp.hasBase
      ? null
      : {
          revision: v.base.revision,
          esf: pp.baseUnreadable ? null : pp.base,
          ...(pp.baseUnreadable ? { unreadable: true } : {}),
          manifest: input.base.manifest,
          manifestAuthenticated: pp.baseManifestAuthenticated
        },
    records: pp.records.map(recordEntry),
    baseRecords: pp.hasBase ? pp.baseRecords.map(recordEntry) : [],
    reviews: pp.reviews.map((r) => ({
      actor: r.actor,
      identity: r.identity,
      line: r.line,
      ...(r.change !== null ? { change: r.change } : {}),
      ref: r.ref
    })),
    inputDigest: pp.inputDigest,
    rejected: pp.rejected.map((r) => ({ record: r.record, code: r.code, detail: r.detail })),
    clockClamped: pp.clockClamped,
    options: input.options ?? { health: true, teeth: false }
  };
  return { kind: "case", kcase, pp };
}

if (import.meta.main) {
  const [inPath, outPath] = process.argv.slice(2);
  if (!inPath || !outPath) {
    process.stderr.write("usage: bun convert.ts <input.json> <out.kcase.json>\n");
    process.exit(2);
  }
  const r = convert(JSON.parse(readFileSync(inPath, "utf8")));
  if (r.kind !== "case") {
    process.stderr.write(`invalid input (the pre-pass rejects it): ${r.problems.join("; ")}\n`);
    process.exit(1);
  }
  writeFileSync(outPath, JSON.stringify(r.kcase));
}
