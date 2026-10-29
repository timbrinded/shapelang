// Evidence records: the in-toto Statement profile (records §3, A.12.5), DSSE envelopes signed
// with ed25519, and validation RJ01–RJ14 (A.12.6).
import {
  createPrivateKey,
  createPublicKey,
  sign as edSign,
  verify as edVerify,
  type KeyObject
} from "node:crypto";
import { H, jcs } from "./jcs.ts";
import { SCAI_TYPE, STATEMENT_TYPE, type Statement, TEST_RESULT_TYPE } from "./manifest.ts";
import type { JsonValue } from "./model.ts";
import type { RecKind } from "./source.ts";
import { cmpStr, toSeconds } from "./util.ts";

export interface CodeCite {
  id: string;
  projection: string;
  scheme: string;
  digest: string;
}

export interface ScopeEntry extends CodeCite {
  complete: boolean;
  deps: CodeCite[];
}

export type Fact =
  | { type: "effect"; at: string; verb: string; resource: string; n?: number }
  | { type: "call"; at: string; to: string; n?: number }
  | { type: "edge"; at: string; kind: string; to: string; n?: number }
  | { type: "hatch"; at: string; kind: string; n?: number };

export type RecResult =
  | "observes"
  | "supports"
  | "contradicts"
  | "inconclusive"
  | "approves"
  | "equivalent"
  | "implies";

export interface ShapeRecord {
  v: "shape.evidence.v1";
  kind: RecKind;
  result: RecResult;
  provider: { id: string; version: string } | null;
  revision: string;
  time: string;
  claim?: { id: string; fp: string; nf?: string };
  code?: CodeCite[];
  deps?: CodeCite[];
  harness?: CodeCite[];
  scope?: { root: string; entries: ScopeEntry[] };
  facts?: Fact[];
  assumptions?: { id: string; kind: "hatch" | "named" | "tool" }[];
  bound?: Record<string, JsonValue>;
  counterexample?: JsonValue;
  judge?: string;
  identity?: string;
  about?: { change: string; refs: string[] };
  pair?: { space: "claim" | "code"; from: string; to: string };
}

export interface DsseEnvelope {
  payloadType: string;
  payload: string;
  signatures: { keyid: string; sig: string }[];
}

/** A parsed record: id = H(JCS(statement)); signers are the verified signing identities. */
export interface ParsedRecord {
  id: string;
  statement: Statement;
  shape: ShapeRecord;
  signers: string[];
  signed: boolean;
  /** signatures that could not be verified in the prototype (e.g. Sigstore bundles) */
  unverifiable: string[];
  badSignature: boolean;
}

const RESULTS: Record<RecKind, RecResult[]> = {
  observation: ["observes"],
  test: ["supports", "contradicts", "inconclusive"],
  proof: ["supports", "contradicts", "inconclusive"],
  judgment: ["supports", "contradicts", "approves"],
  equivalence: ["equivalent", "implies"]
};

export function scopeRoot(entries: CodeCite[]): string {
  const sorted = entries
    .map((e) => ({ id: e.id, projection: e.projection, scheme: e.scheme, digest: e.digest }))
    .sort(
      (a, b) =>
        cmpStr(a.id, b.id) || cmpStr(a.projection, b.projection) || cmpStr(a.scheme, b.scheme)
    );
  return H({ v: "shape.scope.v1", entries: sorted });
}

/** Builds the in-toto statement for a record, with subjects per A.12.1.7. */
export function makeStatement(r: ShapeRecord): Statement {
  const subject: Statement["subject"] = [];
  if (r.claim)
    subject.push({
      name: `shape:claim/${r.claim.id}`,
      digest: { sha256: r.claim.fp.replace(/^sha256:/, "") }
    });
  for (const c of [...(r.code ?? []), ...(r.deps ?? [])]) {
    subject.push({
      name: `shape:code/${c.id}@${c.projection}`,
      digest: { sha256: c.digest.replace(/^sha256:/, "") },
      annotations: { "shape.scheme": c.scheme }
    });
  }
  if (r.scope)
    subject.push({
      name: `shape:scope/${r.provider?.id ?? "-"}/${r.revision}`,
      digest: { sha256: r.scope.root.replace(/^sha256:/, "") }
    });
  if (r.about)
    subject.push({
      name: `shape:answer/${r.about.change}`,
      digest: { sha256: H(r.about).slice(7) }
    });
  subject.sort((a, b) => cmpStr(a.name, b.name));
  const isTest = r.kind === "test";
  const predicate: Statement["predicate"] = isTest
    ? {
        result:
          r.result === "supports" ? "PASSED" : r.result === "contradicts" ? "FAILED" : "WARNED",
        configuration: [],
        url: "",
        passedTests: [],
        warnedTests: [],
        failedTests: [],
        shape: r as unknown as JsonValue
      }
    : {
        attributes: [
          {
            attribute: `SHAPE_${r.result.toUpperCase()}`,
            conditions: { "shape.kind": r.kind }
          }
        ],
        ...(r.provider
          ? {
              producer: {
                uri: r.provider.id,
                annotations: { version: r.provider.version, "shape.provider": r.provider.id }
              }
            }
          : {}),
        shape: r as unknown as JsonValue
      };
  return {
    _type: STATEMENT_TYPE,
    subject,
    predicateType: isTest ? TEST_RESULT_TYPE : SCAI_TYPE,
    predicate
  };
}

export function recordId(stmt: Statement): string {
  return H(stmt);
}

// ---- ed25519 keys and DSSE ----------------------------------------------------------------

const PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export interface Signer {
  privateKey: KeyObject;
  publicHex: string;
  identity: string;
}

/** Deterministic ed25519 key from a 32-byte hex seed (for tests and local providers). */
export function signerFromSeed(seedHex: string): Signer {
  const seed = Buffer.from(seedHex.padStart(64, "0").slice(0, 64), "hex");
  const privateKey = createPrivateKey({
    key: Buffer.concat([PKCS8_PREFIX, seed]),
    format: "der",
    type: "pkcs8"
  });
  const spki = createPublicKey(privateKey).export({ format: "der", type: "spki" });
  const publicHex = Buffer.from(spki).subarray(SPKI_PREFIX.length).toString("hex");
  return { privateKey, publicHex, identity: `ed25519("${publicHex}")` };
}

function pae(payloadType: string, body: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from(`DSSEv1 ${Buffer.byteLength(payloadType)} ${payloadType} ${body.length} `),
    body
  ]);
}

export const DSSE_TYPE = "application/vnd.in-toto+json";

export function signStatement(stmt: Statement, signers: Signer[]): DsseEnvelope {
  const body = Buffer.from(jcs(stmt));
  return {
    payloadType: DSSE_TYPE,
    payload: body.toString("base64"),
    signatures: signers.map((s) => ({
      keyid: s.publicHex,
      sig: edSign(null, pae(DSSE_TYPE, body), s.privateKey).toString("base64")
    }))
  };
}

function verifyEd25519(publicHex: string, data: Buffer, sigB64: string): boolean {
  try {
    if (!/^[0-9a-f]{64}$/.test(publicHex)) return false;
    const key = createPublicKey({
      key: Buffer.concat([SPKI_PREFIX, Buffer.from(publicHex, "hex")]),
      format: "der",
      type: "spki"
    });
    return edVerify(null, data, key, Buffer.from(sigB64, "base64"));
  } catch {
    return false;
  }
}

/** Parses a statement or DSSE envelope. Returns null when it is not even JSON-shaped (RJ01). */
export function parseRecord(input: unknown): ParsedRecord | { error: string } {
  if (!input || typeof input !== "object") return { error: "not an object" };
  const obj = input as Record<string, unknown>;
  let stmt: Statement;
  let signers: string[] = [];
  let signed = false;
  let badSignature = false;
  const unverifiable: string[] = [];
  if (typeof obj.payloadType === "string" && typeof obj.payload === "string") {
    const env = obj as unknown as DsseEnvelope;
    const body = Buffer.from(env.payload, "base64");
    try {
      stmt = JSON.parse(body.toString("utf8")) as Statement;
    } catch {
      return { error: "envelope payload is not JSON" };
    }
    for (const s of env.signatures ?? []) {
      signed = true;
      if (s.keyid.startsWith("sigstore:")) {
        unverifiable.push(s.keyid);
        continue;
      }
      if (verifyEd25519(s.keyid, pae(env.payloadType, body), s.sig))
        signers.push(`ed25519("${s.keyid}")`);
      else badSignature = true;
    }
  } else {
    stmt = obj as unknown as Statement;
  }
  signers = [...new Set(signers)].sort(cmpStr);
  const shape = (stmt?.predicate?.shape ?? null) as ShapeRecord | null;
  if (!shape || typeof shape !== "object") return { error: "no predicate.shape" };
  return {
    id: recordId(stmt),
    statement: stmt,
    shape,
    signers,
    signed,
    unverifiable,
    badSignature
  };
}

/** Envelopes of one statement are one record: signers unioned (A.5.1.1). */
export function mergeRecords(list: ParsedRecord[]): ParsedRecord[] {
  const byId = new Map<string, ParsedRecord>();
  for (const r of list) {
    const prev = byId.get(r.id);
    if (!prev) byId.set(r.id, { ...r, signers: [...r.signers], unverifiable: [...r.unverifiable] });
    else {
      prev.signers = [...new Set([...prev.signers, ...r.signers])].sort(cmpStr);
      prev.unverifiable = [...new Set([...prev.unverifiable, ...r.unverifiable])].sort(cmpStr);
      prev.signed = prev.signed || r.signed;
      prev.badSignature = prev.badSignature || r.badSignature;
    }
  }
  return [...byId.values()].sort((a, b) => cmpStr(a.id, b.id));
}

// ---- validation -------------------------------------------------------------------------------

export interface ValidationContext {
  now: number;
  mode: "change" | "audit" | "preview";
  persisted: boolean;
  /** providers declared in the base (by Q) and head-only providers (empty for base records) */
  baseProviders: Map<string, { produces: string[]; identity: string | null; persist: boolean }>;
  headProviders: Map<string, { produces: string[]; identity: string | null; persist: boolean }>;
  /** authenticated providers (a base identity no other base provider shares) → identity */
  authenticated: Map<string, string>;
  /** providers presence-sound under G* (a) (base records: base only) (RJ14, A.16.6(b)) */
  presence: Set<string>;
  /** base actors: Q → identities, kind, operator */
  actors: Map<string, { identities: string[]; kind: string; operator: string | null }>;
  /** identity → actor Q (base) */
  actorByIdentity: Map<string, string>;
  /** the review relay (base provider producing judgment), if any */
  relays: Map<string, string | null>;
  headRevision: string;
  baseRevision: string | null;
  /** (id, projection, scheme) → digest per revision */
  manifests: Map<string, Map<string, string>>;
  trees: Map<string, Set<string>>;
}

export interface Rejection {
  record: string;
  code: string;
  detail: string;
}

export function validateRecord(r: ParsedRecord, ctx: ValidationContext): Rejection | null {
  const s = r.shape;
  const rej = (code: string, detail: string): Rejection => ({ record: r.id, code, detail });
  // RJ01 form or predicateType
  if (r.statement._type !== STATEMENT_TYPE) return rej("RJ01", "not an in-toto Statement v1");
  if (r.statement.predicateType !== SCAI_TYPE && r.statement.predicateType !== TEST_RESULT_TYPE)
    return rej("RJ01", "unknown predicateType");
  if (s.v !== "shape.evidence.v1") return rej("RJ01", "predicate.shape.v is not shape.evidence.v1");
  if (!(s.kind in RESULTS) || !(RESULTS[s.kind] ?? []).includes(s.result))
    return rej("RJ01", `bad kind/result ${s.kind}/${s.result}`);
  const t = toSeconds(s.time ?? "");
  if (t === null || !s.time.endsWith("Z")) return rej("RJ01", "time is not RFC 3339 UTC");
  if (typeof s.revision !== "string" || !/^[0-9a-f]{4,64}$/.test(s.revision))
    return rej("RJ01", "bad revision");
  // RJ02 subjects against fields
  const subj = new Map(r.statement.subject.map((x) => [x.name, x.digest?.sha256 ?? ""]));
  if (s.claim) {
    if (!/^sha256:[0-9a-f]{64}$/.test(s.claim.fp)) return rej("RJ01", "bad claim fp");
    if (s.claim.nf !== undefined && H(JSON.parse(s.claim.nf)) !== s.claim.fp)
      return rej("RJ02", "claim nf does not hash to fp");
    if (subj.get(`shape:claim/${s.claim.id}`) !== s.claim.fp.slice(7))
      return rej("RJ02", "claim subject mismatch");
  }
  for (const c of [...(s.code ?? []), ...(s.deps ?? [])]) {
    if (subj.get(`shape:code/${c.id}@${c.projection}`) !== c.digest.replace(/^sha256:/, ""))
      return rej("RJ02", `code subject mismatch ${c.id}`);
  }
  if (s.about && subj.get(`shape:answer/${s.about.change}`) !== H(s.about).slice(7))
    return rej("RJ02", "answer subject mismatch");
  if (
    s.scope &&
    subj.get(`shape:scope/${s.provider?.id ?? "-"}/${s.revision}`) !== s.scope.root.replace(/^sha256:/, "")
  )
    return rej("RJ02", "scope subject mismatch");
  // RJ03 scope root
  if (s.scope && s.scope.root !== scopeRoot(s.scope.entries))
    return rej("RJ03", "scope root mismatch");
  // RJ04 provider in neither shape; non-judgment without provider
  const pq = s.provider?.id ?? null;
  if (!pq && s.kind !== "judgment") return rej("RJ04", "non-judgment record without provider");
  const baseP = pq ? ctx.baseProviders.get(pq) : undefined;
  const headP = pq ? ctx.headProviders.get(pq) : undefined;
  if (pq && !baseP && !headP) return rej("RJ04", `provider ${pq} is declared in neither shape`);
  // RJ05 kind not in produces (base; head for head-only)
  if (pq) {
    const produces = baseP ? baseP.produces : (headP?.produces ?? []);
    if (!produces.includes(s.kind)) return rej("RJ05", `${pq} does not produce ${s.kind}`);
  }
  // RJ06 future-dated
  if (t > ctx.now) return rej("RJ06", "time after now*");
  // RJ07 signature
  const preview = ctx.mode === "preview";
  if (r.badSignature && !preview) return rej("RJ07", "invalid signature");
  const authenticatedProvider = pq ? (ctx.authenticated.get(pq) ?? null) : null;
  const mustSign =
    !preview && (s.kind === "judgment" || ctx.persisted || authenticatedProvider !== null);
  if (mustSign && r.signers.length === 0)
    return rej(
      "RJ07",
      r.unverifiable.length > 0
        ? "signature not verifiable by the prototype"
        : "unsigned record that must be signed"
    );
  // RJ08 wrong signer
  if (!preview && authenticatedProvider && !r.signers.includes(authenticatedProvider))
    return rej("RJ08", `not signed by ${pq}'s base identity`);
  if (s.kind === "judgment") {
    // RJ09 unknown judge or operator-less agent
    const judge = s.judge ? ctx.actors.get(s.judge) : undefined;
    if (!s.judge || !judge) return rej("RJ09", `unknown judge ${s.judge ?? "(none)"}`);
    if (judge.kind === "agent" && !judge.operator) return rej("RJ09", "operator-less agent");
    if (!preview) {
      const relayed = pq !== null && ctx.relays.has(pq);
      if (relayed) {
        const relayId = ctx.relays.get(pq ?? "") ?? null;
        if (relayId && !r.signers.includes(relayId))
          return rej("RJ08", "relay record not signed by the relay");
        if (!s.identity || !judge.identities.includes(s.identity))
          return rej("RJ08", "relay names an identity that is not the judge's");
      } else if (!r.signers.some((x) => judge.identities.includes(x)))
        return rej("RJ08", "judgment not signed by its judge");
    }
  }
  // RJ10 empty citations; persisted proof without deps
  if (
    (s.kind === "test" || s.kind === "proof" || (s.kind === "judgment" && s.claim)) &&
    (s.code ?? []).length === 0
  )
    return rej("RJ10", "empty citations");
  if (ctx.persisted && s.kind === "proof" && (s.deps ?? []).length === 0)
    return rej("RJ10", "persisted proof without deps");
  // RJ11 persisted record kinds: judgments and signed persist proofs (A.5.8.2)
  if (
    ctx.persisted &&
    !(s.kind === "judgment" || (s.kind === "proof" && !!pq && !!baseP?.persist))
  )
    return rej("RJ11", "persisted record is not a judgment or persist proof");
  // RJ12 fact paths absent from the tree; RJ13 digests contradicting the revision's manifest
  const tree = ctx.trees.get(s.revision);
  if (tree && tree.size > 0) {
    for (const f of s.facts ?? []) {
      const p = factPath(f.at);
      if (!tree.has(p)) return rej("RJ12", `fact path ${p} absent from the tree`);
    }
  }
  const man = ctx.manifests.get(s.revision);
  if (man) {
    const cites = [
      ...(s.code ?? []),
      ...(s.deps ?? []),
      ...(s.harness ?? []),
      ...(s.scope?.entries ?? [])
    ];
    for (const c of cites) {
      const d = man.get(`${c.id}\u0000${c.projection}\u0000${c.scheme}`);
      if (d !== undefined && d !== c.digest)
        return rej("RJ13", `${c.id}@${c.projection} contradicts the revision's manifest`);
    }
  }
  // RJ14 missing harness; hatch facts in an observation
  if (
    (s.kind === "observation" || s.kind === "test" || s.kind === "proof") &&
    !Array.isArray(s.harness)
  )
    return rej("RJ14", "missing harness");
  if (s.kind === "observation" && (s.facts ?? []).some((f) => f.type === "hatch"))
    return rej("RJ14", "hatch facts in an observation");
  // a presence-sound observer reports n on every effect fact (A.5.2.1, D15)
  if (
    s.kind === "observation" &&
    pq &&
    ctx.presence.has(pq) &&
    (s.facts ?? []).some((f) => f.type === "effect" && typeof f.n !== "number")
  )
    return rej("RJ14", "effect fact without n from a presence-sound observer");
  return null;
}

function factPath(at: string): string {
  const colon = at.indexOf(":");
  const rest = colon >= 0 ? at.slice(colon + 1) : at;
  const hash = rest.indexOf("#");
  return hash >= 0 ? rest.slice(0, hash) : rest;
}

/** `shape/evidence/<2 hex>/<64 hex>.json` for a record id (A.5.8.2). */
export function persistedPath(id: string): string {
  const hex = id.replace(/^sha256:/, "");
  return `shape/evidence/${hex.slice(0, 2)}/${hex}.json`;
}
