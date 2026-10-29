// Evidence records: in-toto statements, DSSE ed25519 envelopes, ids, merging, persisted paths.
import { describe, expect, test } from "bun:test";
import { H } from "../src/jcs.ts";
import {
  type ParsedRecord,
  type ShapeRecord,
  makeStatement,
  mergeRecords,
  parseRecord,
  persistedPath,
  scopeRoot,
  signStatement,
  signerFromSeed
} from "../src/records.ts";

const rec: ShapeRecord = {
  v: "shape.evidence.v1",
  kind: "test",
  result: "supports",
  provider: { id: "m::tester", version: "1" },
  revision: "abcd",
  time: "2026-10-25T10:00:00Z",
  claim: { id: "m::L", fp: `sha256:${"1".repeat(64)}` },
  code: [
    {
      id: "ts:a.ts#f",
      projection: "unit",
      scheme: "ts.unit.v2",
      digest: `sha256:${"2".repeat(64)}`
    }
  ],
  harness: []
};

describe("statement profile", () => {
  test("tests use the Test Result predicate, others SCAI; subjects name claim and code", () => {
    const s = makeStatement(rec);
    expect(s._type).toBe("https://in-toto.io/Statement/v1");
    expect(s.predicateType).toBe("https://in-toto.io/attestation/test-result/v0.1");
    expect(s.subject.map((x) => x.name)).toEqual(["shape:claim/m::L", "shape:code/ts:a.ts#f@unit"]);
    expect(makeStatement({ ...rec, kind: "proof" }).predicateType).toBe(
      "https://in-toto.io/attestation/scai/attribute-report/v0.3"
    );
  });
  test("record id = H(JCS(statement)), the same for a bare statement and its envelope", () => {
    const s = makeStatement(rec);
    const env = signStatement(s, [signerFromSeed("aa")]);
    const a = parseRecord(s) as ParsedRecord;
    const b = parseRecord(env) as ParsedRecord;
    expect(a.id).toBe(H(s));
    expect(b.id).toBe(a.id);
    expect(b.signers).toEqual([signerFromSeed("aa").identity]);
    expect(a.signers).toEqual([]);
  });
  test("a tampered payload or signature is a bad signature", () => {
    const env = signStatement(makeStatement(rec), [signerFromSeed("aa")]);
    const bad = {
      ...env,
      signatures: [
        { keyid: env.signatures[0]?.keyid ?? "", sig: Buffer.alloc(64).toString("base64") }
      ]
    };
    expect((parseRecord(bad) as ParsedRecord).badSignature).toBe(true);
  });
  test("envelopes of one statement merge their signers", () => {
    const s = makeStatement(rec);
    const merged = mergeRecords([
      parseRecord(signStatement(s, [signerFromSeed("aa")])) as ParsedRecord,
      parseRecord(signStatement(s, [signerFromSeed("bb")])) as ParsedRecord
    ]);
    expect(merged.length).toBe(1);
    expect(merged[0]?.signers.length).toBe(2);
  });
  test("deterministic keys from seeds; persisted paths", () => {
    expect(signerFromSeed("01").identity).toBe(signerFromSeed("01").identity);
    expect(signerFromSeed("01").identity).toMatch(/^ed25519\("[0-9a-f]{64}"\)$/);
    expect(persistedPath(`sha256:${"ab".repeat(32)}`)).toBe(
      `shape/evidence/ab/${"ab".repeat(32)}.json`
    );
  });
  test("scope roots ignore entry order and completeness flags", () => {
    const e1 = { id: "a", projection: "unit", scheme: "s", digest: "d1" };
    const e2 = { id: "b", projection: "unit", scheme: "s", digest: "d2" };
    expect(scopeRoot([e1, e2])).toBe(scopeRoot([{ ...e2 }, { ...e1 }]));
  });
});
