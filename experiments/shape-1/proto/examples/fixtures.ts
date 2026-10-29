// Inputs for the worked examples (examples §1–4), with the label digests and record shapes of
// shape1work/model-v4/vectors.py so derived keys, bindings and groups can be compared exactly.
import type { CheckInput } from "../src/io-types.ts";
import { label } from "../src/jcs.ts";
import {
  type ManifestEntry,
  type TreeEntry,
  gitBlobId,
  manifestStatement
} from "../src/manifest.ts";
import type { Statement } from "../src/manifest.ts";
import {
  type CodeCite,
  type ShapeRecord,
  type Signer,
  makeStatement,
  scopeRoot,
  signStatement,
  signerFromSeed
} from "../src/records.ts";
import type { Decl, SourceDoc } from "../src/source.ts";
import { auditSource, ironkvSource } from "./sources.ts";

export const KEYS = {
  sqlEffects: signerFromSeed("01"),
  fastCheck: signerFromSeed("02"),
  reviews: signerFromSeed("03"),
  verus: signerFromSeed("04"),
  verusRefines: signerFromSeed("05"),
  dana: signerFromSeed("06"),
  tsCallGraph: signerFromSeed("07"),
  tsClockScan: signerFromSeed("08"),
  bunTest: signerFromSeed("09")
};

export interface IdSpec {
  id: string;
  kind?: string;
  parent?: string | null;
  file?: string;
  own?: string;
  unit?: string;
  contract?: string;
  closure?: string;
  markers?: Record<string, number>;
  executable?: boolean;
  hatchComplete?: boolean;
}

const SCHEME: Record<string, Record<string, string>> = {
  ts: { file: "ts.file.v1", own: "ts.own.v2", unit: "ts.unit.v2" },
  verus: {
    file: "verus.file.v1",
    own: "verus.own.v2",
    unit: "verus.unit.v2",
    contract: "verus.contract.vir.v2",
    closure: "verus.closure.vir.v2"
  },
  raw: { file: "raw.file.v1", own: "raw.own.v1" },
  pkgjson: { file: "pkgjson.file.v1", own: "pkgjson.own.v1", unit: "pkgjson.unit.v1" }
};

export function manifest(
  revision: string,
  ids: IdSpec[],
  shapeFiles: string[] = ["shape.lock", "shape/audit.shape"]
): Statement {
  const entries: ManifestEntry[] = [];
  const tree: TreeEntry[] = [];
  for (const s of ids) {
    const lang = s.id.split(":")[0] as string;
    const symbol = s.id.includes("#");
    const parent =
      s.parent !== undefined ? s.parent : symbol ? (s.id.split("#")[0] as string) : null;
    for (const p of ["file", "own", "unit", "contract", "closure"] as const) {
      const d =
        s[p] ??
        (p === "file" && !symbol
          ? label(`${s.id} file`)
          : p === "own"
            ? label(`${s.id} own`)
            : undefined);
      if (!d) continue;
      const e: ManifestEntry = {
        id: s.id,
        projection: p,
        scheme: SCHEME[lang]?.[p] ?? `${lang}.${p}.v1`,
        digest: d,
        kind: s.kind ?? (symbol ? "function" : "file"),
        parent
      };
      if (s.markers) e.markers = s.markers;
      if (s.executable) e.executable = true;
      if (s.hatchComplete === false) e.hatchComplete = false;
      entries.push(e);
    }
    if (!symbol) {
      const path = s.id.slice(lang.length + 1);
      tree.push({
        path,
        mode: s.executable && lang === "raw" ? "100755" : "100644",
        blob: gitBlobId(Buffer.from(s.file ?? `${path}`))
      });
    }
  }
  for (const f of shapeFiles)
    tree.push({ path: f, mode: "100644", blob: gitBlobId(Buffer.from(f)) });
  return manifestStatement({ v: "shape.manifest.v1", revision, tree, entries });
}

export function signed(r: ShapeRecord, signers: Signer[]): unknown {
  return signStatement(makeStatement(r), signers);
}

export function cite(id: string, projection: string, digest: string): CodeCite {
  const lang = id.split(":")[0] as string;
  return {
    id,
    projection,
    scheme: SCHEME[lang]?.[projection] ?? `${lang}.${projection}.v1`,
    digest
  };
}

export function baseInput(o: Partial<CheckInput> & Pick<CheckInput, "head">): CheckInput {
  return {
    contract: "shape.check.input/v1",
    mode: "change",
    now: "2026-10-25T12:00:00Z",
    base: null,
    change: { ids: ["github:acme/audit#57"] },
    authors: [],
    reviews: [],
    records: [],
    baseRecords: [],
    persisted: { base: [], head: [] },
    options: { health: true, teeth: false },
    ...o
  };
}

// ---- Example 1 ---------------------------------------------------------------------------------------------

export const EX1 = {
  base: "1111111111111111111111111111111111111111",
  head: "9f2c1e7a6b5d4c3b2a19081726354453627180aa",
  change: "github:acme/audit#57",
  PURGE_FILE: "sha256:ba062333d9091f522631b641c25afdab1107d546f76d365933ecd3cfdff77e61",
  PURGE_UNIT: "sha256:f60c501bff9e4c1bde932d78e58977e86d40c7890605c25bedbc684a1aa4bcc7",
  STORE_FILE: "sha256:a955648ac042149dbcf0ad36204b4e22132bec3f16e7b60385bb4cdced0b4138",
  STORE_UNIT: "sha256:df38d45acb53c51e2faaca77f1229602ab595acdd158a52f2a526d1fa3408f08"
};

export const IDS = {
  sqlEffects: KEYS.sqlEffects.identity,
  fastCheck: KEYS.fastCheck.identity,
  reviews: KEYS.reviews.identity
};

function ex1BaseIds(): IdSpec[] {
  return [
    { id: "pkgjson:package.json" },
    { id: "raw:bun.lock" },
    { id: "ts:src/audit/store.ts", file: EX1.STORE_FILE, own: label("ts:src/audit/store.ts own") },
    {
      id: "ts:src/audit/store.ts#appendEvent",
      own: label("appendEvent own"),
      unit: EX1.STORE_UNIT
    },
    { id: "ts:test/audit/history.test.ts", own: label("history.test.ts own") }
  ];
}

export type Ex1Variant =
  | "audit"
  | "empty-base"
  | "A"
  | "B"
  | "B-weak"
  | "Bprime"
  | "Bsecond"
  | "C"
  | "C-answered";

export function ex1(variant: Ex1Variant, extra: Partial<CheckInput> = {}): CheckInput {
  const baseShape = auditSource({ ids: IDS });
  const baseMan = manifest(EX1.base, ex1BaseIds());
  const t = "2026-10-25T09:12:44Z";
  const fastCheckRecord = (rev: string, code: CodeCite[]): unknown =>
    signed(
      {
        v: "shape.evidence.v1",
        kind: "test",
        result: "supports",
        provider: { id: "audit::fastCheck", version: "3.23.0" },
        revision: rev,
        time: t,
        claim: {
          id: "audit::EventsArePreserved",
          fp: "sha256:2da8fb7008513c5d4434893c76fcb70a4dab922e56ed89f988b390962a63dff3"
        },
        code,
        harness: [cite("ts:test/audit/history.test.ts", "own", label("history.test.ts own"))],
        assumptions: [],
        bound: { runs: 200 }
      },
      [KEYS.fastCheck]
    );
  const obs = (
    rev: string,
    entries: { id: string; projection: string; digest: string }[],
    facts: ShapeRecord["facts"]
  ): unknown => {
    const es = entries.map((e) => ({
      ...cite(e.id, e.projection, e.digest),
      complete: true,
      deps: []
    }));
    return signed(
      {
        v: "shape.evidence.v1",
        kind: "observation",
        result: "observes",
        provider: { id: "audit::sqlEffects", version: "2.3.1" },
        revision: rev,
        time: t,
        scope: { root: scopeRoot(es), entries: es },
        facts,
        harness: [],
        assumptions: []
      },
      [KEYS.sqlEffects]
    );
  };
  const appendFact = {
    type: "effect" as const,
    at: "ts:src/audit/store.ts#appendEvent",
    verb: "Append",
    resource: 'pg.table("public.audit_events")'
  };
  const storeEntries = [
    { id: "ts:src/audit/store.ts", projection: "file", digest: EX1.STORE_FILE },
    { id: "ts:src/audit/store.ts#appendEvent", projection: "unit", digest: EX1.STORE_UNIT }
  ];
  const authors = [{ identity: 'github("acme-code-agent[bot]")', verified: true, bot: true }];
  if (variant === "audit") {
    return baseInput({
      mode: "audit",
      head: { revision: EX1.base, source: baseShape, manifest: baseMan },
      base: null,
      records: [
        obs(EX1.base, storeEntries, [appendFact]),
        fastCheckRecord(EX1.base, [
          cite("ts:src/audit/store.ts#appendEvent", "unit", EX1.STORE_UNIT),
          cite("ts:src/audit/store.ts", "own", label("ts:src/audit/store.ts own"))
        ])
      ],
      ...extra
    });
  }
  if (variant === "empty-base") {
    return baseInput({
      head: { revision: EX1.head, source: baseShape, manifest: manifest(EX1.head, ex1BaseIds()) },
      base: {
        revision: EX1.base,
        source: { v: "shape.source.v1", modules: [] },
        manifest: baseMan
      },
      records: [
        obs(EX1.head, storeEntries, [appendFact]),
        fastCheckRecord(EX1.head, [
          cite("ts:src/audit/store.ts#appendEvent", "unit", EX1.STORE_UNIT),
          cite("ts:src/audit/store.ts", "own", label("ts:src/audit/store.ts own"))
        ])
      ],
      authors,
      ...extra
    });
  }
  const purgeOwnFn = label("ts:src/audit/purge.ts#purgeOldEvents own, head");
  const purgeOwnFile = label("ts:src/audit/purge.ts own, head");
  let headIds: IdSpec[] = [
    ...ex1BaseIds(),
    { id: "ts:src/audit/purge.ts", file: EX1.PURGE_FILE, own: purgeOwnFile },
    { id: "ts:src/audit/purge.ts#purgeOldEvents", own: purgeOwnFn, unit: EX1.PURGE_UNIT }
  ];
  let purgeAt = "ts:src/audit/purge.ts#purgeOldEvents";
  let purgeEntries = [
    { id: "ts:src/audit/purge.ts", projection: "file", digest: EX1.PURGE_FILE },
    { id: "ts:src/audit/purge.ts#purgeOldEvents", projection: "unit", digest: EX1.PURGE_UNIT }
  ];
  if (variant === "Bprime") {
    purgeAt = "ts:scripts/purge-audit.ts#purgeOldEvents";
    headIds = [
      ...ex1BaseIds(),
      {
        id: "ts:scripts/purge-audit.ts",
        file: label("purge-audit file"),
        own: label("purge-audit own")
      },
      {
        id: "ts:scripts/purge-audit.ts#purgeOldEvents",
        own: label("purge-audit fn own"),
        unit: label("purge-audit fn unit")
      }
    ];
    purgeEntries = [
      { id: "ts:scripts/purge-audit.ts", projection: "file", digest: label("purge-audit file") },
      {
        id: "ts:scripts/purge-audit.ts#purgeOldEvents",
        projection: "unit",
        digest: label("purge-audit fn unit")
      }
    ];
  }
  if (variant === "Bsecond") {
    headIds = [
      ...ex1BaseIds(),
      {
        id: "raw:src/audit/purge.sh",
        file: label("purge.sh file"),
        own: label("raw:src/audit/purge.sh own, head"),
        executable: true
      }
    ];
  }
  const purgeFact = {
    type: "effect" as const,
    at: purgeAt,
    verb: "HardDelete",
    resource: 'pg.table("public.audit_events")'
  };
  const headMan = manifest(EX1.head, headIds);
  const variantShape =
    variant === "A"
      ? auditSource({ ids: IDS, grantHardDelete: true, declarePurge: true })
      : variant === "C" || variant === "C-answered"
        ? auditSource({ ids: IDS, grantHardDelete: true, declarePurge: true, dropAppendOnly: true })
        : variant === "B-weak"
          ? auditSource({ ids: IDS, dropPresence: true })
          : baseShape;
  const lawReq: CodeCite[] =
    variant === "Bprime" || variant === "Bsecond"
      ? [
          cite("ts:src/audit/store.ts#appendEvent", "unit", EX1.STORE_UNIT),
          cite("ts:src/audit/store.ts", "own", label("ts:src/audit/store.ts own"))
        ]
      : [
          cite("ts:src/audit/store.ts#appendEvent", "unit", EX1.STORE_UNIT),
          cite("ts:src/audit/store.ts", "own", label("ts:src/audit/store.ts own")),
          cite("ts:src/audit/purge.ts#purgeOldEvents", "unit", EX1.PURGE_UNIT),
          cite("ts:src/audit/purge.ts", "own", purgeOwnFile)
        ];
  const records: unknown[] = [
    obs(
      EX1.head,
      variant === "Bsecond" ? storeEntries : [...purgeEntries, ...storeEntries],
      variant === "Bsecond" ? [appendFact] : [purgeFact, appendFact]
    ),
    fastCheckRecord(EX1.head, lawReq)
  ];
  const reviews: CheckInput["reviews"] = [];
  if (variant === "C-answered") {
    reviews.push({
      identity: 'github("bob")',
      line: "shape approve bd:8d771e08d86d43b2 bd:2785f31d20281bdd",
      change: EX1.change
    });
    reviews.push({
      identity: 'github("carol")',
      line: "shape approve bd:8d771e08d86d43b2",
      change: EX1.change
    });
  }
  return baseInput({
    head: { revision: EX1.head, source: variantShape, manifest: headMan },
    base: { revision: EX1.base, source: baseShape, manifest: baseMan },
    records,
    authors,
    reviews,
    ...extra
  });
}

// ---- Example 2 ---------------------------------------------------------------------------------------------

export const EX2 = {
  base: "2222222222222222222222222222222222222222",
  head: "3333333333333333333333333333333333333333",
  change: "github:acme/ironkv#12",
  SET: "verus:ironkv/src/delegation_map_v.rs#DelegationMap::set",
  SET_UNIT_B: "sha256:6f1180911c9d6b41b4441e993941c6b6b61d238815faa7cbde959751ae1b03ff",
  SET_UNIT_H: "sha256:5ab2582637d304f0050e6e6eb48b9a3f0ddca246e9d3777c775b0673f6034faf",
  SET_CLOSURE: "sha256:447e6db6d5159076b32ae28c0f6c41582e1c285506d6182931d52d7d9a1b1d0b",
  SET_CONTRACT: label("set contract"),
  HOST: "verus:ironkv/src/host_t.rs#Host::send",
  INSERT: "verus:ironkv/src/delegation_map_v.rs#StrictlyOrderedVec::insert"
};

export function ex2(
  o: { exception?: boolean; approve?: boolean; hostMarkers?: boolean } = {}
): CheckInput {
  const src = ironkvSource({
    verus: KEYS.verus.identity,
    verusRefines: KEYS.verusRefines.identity,
    danaKey: KEYS.dana.identity,
    exception: o.exception
  });
  const baseSrc = ironkvSource({
    verus: KEYS.verus.identity,
    verusRefines: KEYS.verusRefines.identity,
    danaKey: KEYS.dana.identity
  });
  const host = o.hostMarkers ?? true;
  const common = (side: "b" | "h"): IdSpec[] => [
    {
      id: "verus:ironkv/src/delegation_map_v.rs",
      file: label(`dmap file ${side}`),
      own: label("dmap own")
    },
    {
      id: EX2.SET,
      own: label(side === "b" ? "ironkv set own, base" : "ironkv set own, head"),
      unit: side === "b" ? EX2.SET_UNIT_B : EX2.SET_UNIT_H,
      contract: EX2.SET_CONTRACT,
      closure: EX2.SET_CLOSURE,
      ...(side === "h" ? { markers: { assume: 1 } } : {})
    },
    {
      id: EX2.INSERT,
      own: label("insert own"),
      unit: label("insert unit"),
      contract: label("insert contract"),
      closure: label("insert closure")
    },
    { id: "verus:ironkv/src/host_t.rs", file: label("host file"), own: label("host own") },
    {
      id: EX2.HOST,
      own: label("host send own"),
      unit: label("host send unit"),
      contract: label("host send contract"),
      closure: label("host send closure"),
      ...(host ? { markers: { external_body: 1 } } : {})
    },
    { id: "raw:ironkv/Cargo.toml" },
    { id: "raw:ironkv/Cargo.lock" }
  ];
  const sf = ["shape.lock", "shape/ironkv.shape"];
  const baseMan = manifest(EX2.base, common("b"), sf);
  const headMan = manifest(EX2.head, common("h"), sf);
  const proof = signed(
    {
      v: "shape.evidence.v1",
      kind: "proof",
      result: "supports",
      provider: { id: "ironkv::verus", version: "dccae1d" },
      revision: EX2.head,
      time: "2026-10-25T10:00:00Z",
      claim: {
        id: "ironkv::SetRefinesSpec",
        fp: "sha256:60a867af53d80a7f7691530f9ae5869779c05abccd602cd75b2baad28a85db38"
      },
      code: [cite(EX2.SET, "unit", EX2.SET_UNIT_H), cite(EX2.SET, "closure", EX2.SET_CLOSURE)],
      deps: [cite(EX2.INSERT, "contract", label("insert contract"))],
      harness: [],
      assumptions: [
        { id: `${EX2.SET}/assume`, kind: "hatch" },
        { id: "z3@4.12.5", kind: "tool" },
        { id: "verus@dccae1d", kind: "tool" }
      ],
      bound: { rlimit: 10 }
    },
    [KEYS.verus]
  );
  const danaContract = signed(
    {
      v: "shape.evidence.v1",
      kind: "judgment",
      result: "supports",
      provider: null,
      revision: EX2.base,
      time: "2026-10-01T09:00:00Z",
      claim: {
        id: "ironkv::SetContractFaithful",
        fp: "sha256:3d6b9e247facc73677afbf88e873548e4c05981cb24d158eee0bc01fb1ad7b68"
      },
      code: [cite(EX2.SET, "contract", EX2.SET_CONTRACT)],
      judge: "ironkv::dana"
    },
    [KEYS.dana]
  );
  const danaSurface = signed(
    {
      v: "shape.evidence.v1",
      kind: "judgment",
      result: "supports",
      provider: null,
      revision: EX2.base,
      time: "2026-10-01T09:00:00Z",
      claim: {
        id: "ironkv::HostTrusted/ReviewedSurface/law",
        fp: "sha256:f3119983e55f6aae012d4804f39af9f73ecafb27fc5fdccc6040b906efb7b03a"
      },
      code: [cite(EX2.HOST, "unit", label("host send unit"))],
      judge: "ironkv::dana"
    },
    [KEYS.dana]
  );
  const reviews: CheckInput["reviews"] = o.approve
    ? [
        {
          identity: 'github("dana")',
          line: "shape approve bd:2ea660886d27e5e3 bd:1da36a42e325dc5a",
          change: EX2.change
        }
      ]
    : [];
  return baseInput({
    change: { ids: [EX2.change] },
    head: { revision: EX2.head, source: src, manifest: headMan },
    base: { revision: EX2.base, source: baseSrc, manifest: baseMan },
    records: [proof, danaContract, ...(host ? [danaSurface] : [])],
    authors: [{ identity: 'github("kv-agent[bot]")', verified: true, bot: true }],
    reviews
  });
}

// ---- Example 3 ---------------------------------------------------------------------------------------------

export const EX3 = {
  base: "4444444444444444444444444444444444444444",
  head: "5555555555555555555555555555555555555555",
  change: "github:smoothbrains/shapelang#200",
  ISO: "ts:packages/shp-cli/src/freshness.ts#isoToday",
  ISO_B: "sha256:3018423164cf0d769cf3a0b13c4f5a70297ad51908b34467dcf8eb9ca4193703",
  ISO_H: "sha256:6f68619e784427af2372e479a15e284f6054a0fb6540a8287959d16cd4cc02fb"
};

export function ex3Source(): SourceDoc {
  const decls: Decl[] = [
    { decl: "shape", name: "Shape", owner: "ShapeMaintainers" },
    { decl: "actor", name: "ShapeMaintainers", kind: "team", members: ["tim"] },
    { decl: "actor", name: "tim", kind: "person", identities: ['github("tim")'] },
    {
      decl: "actor",
      name: "claude",
      kind: "agent",
      operator: "tim",
      identities: ['github("claude[bot]")']
    },
    { decl: "resource", name: "SystemClock" },
    {
      decl: "component",
      name: "ShpCli",
      paths: ["packages/shp-cli/src/**/*.ts"],
      units: [
        {
          name: "isoToday",
          attach: [{ name: "RefactorSensitive" }],
          bind: 'ts("packages/shp-cli/src/freshness.ts#isoToday")',
          effects: { mode: "complete", atoms: [{ atom: "Read<SystemClock>" }] }
        }
      ]
    },
    {
      decl: "note",
      name: "ClockReadAtCliBoundary",
      kind: "memory",
      about: ["unit ShpCli.isoToday"],
      text: "The CLI reads the clock once, at the boundary; the checker never does.",
      confidence: "high"
    }
  ];
  return { v: "shape.source.v1", modules: [{ module: "tooling", imports: ["std"], decls }] };
}

export function ex3(o: { judgeLine?: boolean } = {}): CheckInput {
  const ids = (side: "b" | "h"): IdSpec[] => [
    { id: "ts:packages/shp-cli/src/freshness.ts", own: label(`freshness own ${side}`) },
    { id: EX3.ISO, own: label(`isoToday own ${side}`), unit: side === "b" ? EX3.ISO_B : EX3.ISO_H },
    {
      id: "ts:packages/shp-cli/src/freshness.ts#checkWindow",
      own: label("checkWindow own"),
      unit: label("checkWindow unit")
    }
  ];
  const sf = ["shape.lock", "shape/tooling.shape"];
  const judgment = signed(
    {
      v: "shape.evidence.v1",
      kind: "judgment",
      result: "supports",
      provider: null,
      revision: EX3.base,
      time: "2026-09-01T09:00:00Z",
      claim: {
        id: "tooling::ShpCli.isoToday/RefactorSensitive/law",
        fp: "sha256:c414eadc238d87c4e004899e9f2fe5a2ecfe615dae7eb8a242714426a059a077"
      },
      code: [cite(EX3.ISO, "unit", EX3.ISO_B)],
      judge: "tooling::tim"
    },
    [signerFromSeed("0a")]
  );
  const src = ex3Source();
  const timKey = signerFromSeed("0a").identity;
  const withKey = (s: SourceDoc): SourceDoc => ({
    ...s,
    modules: s.modules.map((m) => ({
      ...m,
      decls: m.decls.map((d) =>
        d.decl === "actor" && d.name === "tim" ? { ...d, identities: ['github("tim")', timKey] } : d
      )
    }))
  });
  return baseInput({
    change: { ids: [EX3.change] },
    head: { revision: EX3.head, source: withKey(src), manifest: manifest(EX3.head, ids("h"), sf) },
    base: { revision: EX3.base, source: withKey(src), manifest: manifest(EX3.base, ids("b"), sf) },
    records: [judgment],
    authors: [{ identity: 'github("claude[bot]")', verified: true, bot: true }],
    reviews: o.judgeLine
      ? [
          {
            identity: 'github("tim")',
            line: "shape judge tooling::ShpCli.isoToday/RefactorSensitive/law",
            change: EX3.change
          }
        ]
      : []
  });
}

// ---- Example 4 ---------------------------------------------------------------------------------------------

export const EX4 = {
  base: "6666666666666666666666666666666666666666",
  head: "6666666666666666666666666666666666666666"
};

export function ex4Source(
  o: { complete?: boolean; diagnosticsRelation?: boolean } = {}
): SourceDoc {
  const decls: Decl[] = [
    { decl: "shape", name: "Checker", owner: "ShapeMaintainers" },
    { decl: "actor", name: "ShapeMaintainers", kind: "team", members: ["tim"] },
    { decl: "actor", name: "tim", kind: "person", identities: ['github("tim")'] },
    { decl: "component", name: "ShapeChecker", paths: ["packages/shp-checker/src/**/*.ts"] },
    {
      decl: "component",
      name: "ShapeRuleEngine",
      paths: [
        "packages/shp-checker/src/checker/derivations.ts",
        "packages/shp-checker/src/checker/rules/**/*.ts"
      ],
      ...(o.complete ? { relationsComplete: ["calls"] } : {})
    },
    {
      decl: "component",
      name: "ShapeModelLowerer",
      paths: ["packages/shp-checker/src/checker/lowering/**/*.ts"]
    },
    {
      decl: "component",
      name: "ShapeDiagnostics",
      paths: ["packages/shp-checker/src/checker/diagnostics/**/*.ts"]
    },
    {
      decl: "relation",
      name: "ShapeRuleEngineReadsLoweredFacts",
      kind: "calls",
      connects: ["ShapeRuleEngine", "ShapeModelLowerer"]
    },
    ...(o.diagnosticsRelation
      ? [
          {
            decl: "relation" as const,
            name: "ShapeRuleEngineReports",
            kind: "calls",
            connects: ["ShapeRuleEngine", "ShapeDiagnostics"]
          }
        ]
      : []),
    {
      decl: "rule",
      name: "no_runtime_dependency_cycles",
      clauses: [{ forbid: "cycle", over: ["calls"] }]
    },
    {
      decl: "provider",
      name: "tsCallGraph",
      produces: ["observation"],
      observes: ["call(ts)"],
      sound: [],
      identity: KEYS.tsCallGraph.identity,
      implementation: { paths: ["tools/callgraph.ts"] }
    }
  ];
  return { v: "shape.source.v1", modules: [{ module: "checker", imports: ["std"], decls }] };
}

export function ex4(o: { complete?: boolean; headDiagnostics?: boolean } = {}): CheckInput {
  const F = "ts:packages/shp-checker/src/checker/lowering/facts.ts";
  const C = "ts:packages/shp-checker/src/checker/lowering/context.ts";
  const D = "ts:packages/shp-checker/src/checker/derivations.ts";
  const ids: IdSpec[] = [
    { id: F },
    { id: C },
    { id: D },
    { id: `${D}#requirementsForTarget`, unit: label("rft unit") },
    { id: `${D}#shapeTraitBearers`, unit: label("stb unit") },
    { id: `${D}#requiresReevaluation`, unit: label("rr unit") },
    { id: "ts:packages/shp-checker/src/checker/diagnostics/report.ts" },
    { id: "ts:tools/callgraph.ts" }
  ];
  const sf = ["shape.lock", "shape/checker.shape"];
  const man = manifest(EX4.head, ids, sf);
  const entries = [F, C, D].map((id) => ({
    ...cite(id, "file", label(`${id} file`)),
    complete: false,
    deps: []
  }));
  const rec = signed(
    {
      v: "shape.evidence.v1",
      kind: "observation",
      result: "observes",
      provider: { id: "checker::tsCallGraph", version: "0.1.0" },
      revision: EX4.head,
      time: "2026-10-25T09:00:00Z",
      scope: { root: scopeRoot(entries), entries },
      facts: [
        { type: "call", at: F, to: `${D}#requirementsForTarget` },
        { type: "call", at: F, to: `${D}#shapeTraitBearers` },
        { type: "call", at: C, to: `${D}#requiresReevaluation` }
      ],
      harness: [],
      assumptions: []
    },
    [KEYS.tsCallGraph]
  );
  return baseInput({
    change: { ids: ["github:smoothbrains/shapelang#201"] },
    head: {
      revision: EX4.head,
      source: ex4Source({ complete: o.complete, diagnosticsRelation: o.headDiagnostics }),
      manifest: man
    },
    base: { revision: EX4.base, source: ex4Source({ complete: o.complete }), manifest: man },
    records: [rec],
    authors: [{ identity: 'github("tim")', verified: true, bot: false }]
  });
}

// ---- Example 3, Step 2: the checkable parts --------------------------------------------------------------

export const EX3S2 = {
  base: "7777777777777777777777777777777777777777",
  head: "8888888888888888888888888888888888888888",
  CSM: "ts:packages/shp-checker/src/checker/api.ts#checkShapeModules",
  FRESH: "ts:packages/shp-checker/src/checker/rules/guards.ts#checkFreshness",
  DET: "ts:packages/shp-checker/src/behavioural/determinism.test.ts",
  HARN: "ts:packages/shp-checker/src/behavioural/harness.ts"
};

const CHECKER9 = [
  "ShapeBindings",
  "ShapeChecker",
  "ShapeDiagnostics",
  "ShapeModelLowerer",
  "ShapeModuleResolver",
  "ShapePreludeRegistry",
  "ShapeRuleEngine",
  "ShapeStringHelpers"
];

export function ex3s2Source(o: { refactorSensitive?: boolean } = {}): SourceDoc {
  const keyOf = (k: Signer): string => k.identity;
  return {
    v: "shape.source.v1",
    modules: [
      {
        module: "checker",
        imports: ["std", "tooling"],
        decls: [
          ...CHECKER9.map((n): Decl => {
            if (n === "ShapeChecker")
              return {
                decl: "component",
                name: n,
                paths: ["packages/shp-checker/src/checker/api.ts"],
                grants: "none",
                units: [{ name: "checkShapeModules" }]
              };
            if (n === "ShapeRuleEngine")
              return {
                decl: "component",
                name: n,
                paths: ["packages/shp-checker/src/checker/rules/**/*.ts"],
                grants: "none"
              };
            return { decl: "component", name: n };
          }),
          {
            decl: "law",
            name: "CheckIsDeterministic",
            template: { name: "Deterministic", args: ["ShapeChecker.checkShapeModules"] },
            tier: "critical",
            evidence: { level: "tested", by: ["bunTest"] }
          },
          {
            decl: "provider",
            name: "bunTest",
            produces: ["test"],
            decides: ["template Deterministic"],
            sound: ["presence"],
            identity: keyOf(KEYS.bunTest),
            implementation: { paths: ["bunfig.toml", "package.json", "bun.lock"] }
          }
        ]
      },
      {
        module: "checker.incremental",
        imports: ["std"],
        decls: [{ decl: "component", name: "ShapeIncrementalChecker" }]
      },
      {
        module: "tooling",
        imports: ["std", "checker"],
        decls: [
          { decl: "shape", name: "Shape", owner: "ShapeMaintainers" },
          { decl: "actor", name: "ShapeMaintainers", kind: "team", members: ["tim", "ann"] },
          { decl: "actor", name: "tim", kind: "person", identities: ['github("tim")'] },
          { decl: "actor", name: "ann", kind: "person", identities: ['github("ann")'] },
          {
            decl: "actor",
            name: "claude",
            kind: "agent",
            operator: "tim",
            identities: ['github("claude[bot]")']
          },
          {
            decl: "resource",
            name: "SystemClock",
            bind: [
              'ts.call("Date.now")',
              'ts.call("Date")',
              'ts.call("performance.now")',
              'ts.call("process.hrtime")'
            ]
          },
          {
            decl: "component",
            name: "ShpCli",
            paths: ["packages/shp-cli/src/**/*.ts"],
            units: [
              {
                name: "isoToday",
                ...(o.refactorSensitive === false
                  ? {}
                  : { attach: [{ name: "RefactorSensitive" }] }),
                bind: 'ts("packages/shp-cli/src/freshness.ts#isoToday")',
                effects: { mode: "complete", atoms: [{ atom: "Read<SystemClock>" }] }
              }
            ]
          },
          {
            decl: "rule",
            name: "CheckerNeverReadsClock",
            tier: "critical",
            clauses: [
              {
                forbid: "effect",
                atom: "Read<SystemClock>",
                within: [
                  ...CHECKER9.map((n) => `component checker::${n}`),
                  "component checker.incremental::ShapeIncrementalChecker"
                ]
              }
            ]
          },
          {
            decl: "note",
            name: "ClockReadAtCliBoundary",
            kind: "memory",
            about: ["unit ShpCli.isoToday", "law checker::CheckIsDeterministic"]
          },
          {
            decl: "provider",
            name: "tsClockScan",
            produces: ["observation"],
            observes: [
              'effect(ts.call("Date.now"))',
              'effect(ts.call("Date"))',
              'effect(ts.call("performance.now"))',
              'effect(ts.call("process.hrtime"))'
            ],
            sound: ["presence", "absence"],
            identity: keyOf(KEYS.tsClockScan),
            implementation: {
              paths: ["tools/clock-scan.ts", "tsconfig.json", "package.json", "bun.lock"]
            }
          }
        ]
      }
    ]
  };
}

export function ex3s2(
  o: {
    harnessEdited?: boolean;
    dropRecord?: boolean;
    seededClock?: boolean;
    removeRefactorSensitive?: boolean;
  } = {}
): CheckInput {
  const ids = (side: "b" | "h"): IdSpec[] => [
    { id: "ts:packages/shp-checker/src/checker/api.ts", own: label("api own") },
    { id: EX3S2.CSM, own: label("csm own"), unit: label("csm unit") },
    {
      id: "ts:packages/shp-checker/src/checker/rules/guards.ts",
      own: label(`guards own ${side === "h" && o.seededClock ? "h" : "b"}`)
    },
    {
      id: EX3S2.FRESH,
      own: label(`fresh own ${side === "h" && o.seededClock ? "h" : "b"}`),
      unit: label(`fresh unit ${side === "h" && o.seededClock ? "h" : "b"}`)
    },
    {
      id: EX3S2.DET,
      own: label(
        side === "h" && o.harnessEdited
          ? "determinism.test.ts own, edited"
          : "determinism.test.ts own"
      )
    },
    { id: EX3S2.HARN, own: label("behavioural/harness.ts own") },
    { id: "ts:packages/shp-cli/src/freshness.ts", own: label("freshness own") },
    { id: EX3.ISO, own: label("isoToday own"), unit: EX3.ISO_B }
  ];
  const sf = ["shape.lock", "shape/checker.shape", "shape/tooling.shape"];
  const baseMan = manifest(EX3S2.base, ids("b"), sf);
  const headMan = manifest(EX3S2.head, ids("h"), sf);
  const detHead = label(
    o.harnessEdited ? "determinism.test.ts own, edited" : "determinism.test.ts own"
  );
  const test = signed(
    {
      v: "shape.evidence.v1",
      kind: "test",
      result: "supports",
      provider: { id: "checker::bunTest", version: "1.4.2" },
      revision: EX3S2.head,
      time: "2026-10-25T10:00:00Z",
      claim: {
        id: "checker::CheckIsDeterministic",
        fp: "sha256:8620c3bead39262d509d30d813c84d79db4e1ce51b1dd92c904225082519b8c3"
      },
      code: [cite(EX3S2.CSM, "unit", label("csm unit"))],
      harness: [
        cite(EX3S2.DET, "own", detHead),
        cite(EX3S2.HARN, "own", label("behavioural/harness.ts own"))
      ],
      assumptions: [],
      bound: { runs: 720 }
    },
    [KEYS.bunTest]
  );
  const es = ids("h").map((info) => {
    const proj = info.unit ? "unit" : "own";
    return { ...cite(info.id, proj, (info.unit ?? info.own) as string), complete: true, deps: [] };
  });
  const scan = signed(
    {
      v: "shape.evidence.v1",
      kind: "observation",
      result: "observes",
      provider: { id: "tooling::tsClockScan", version: "0.1.0" },
      revision: EX3S2.head,
      time: "2026-10-25T10:00:00Z",
      scope: { root: scopeRoot(es), entries: es },
      facts: [
        { type: "effect", at: EX3.ISO, verb: "Read", resource: 'ts.call("Date")' },
        ...(o.seededClock
          ? [
              {
                type: "effect" as const,
                at: EX3S2.FRESH,
                verb: "Read",
                resource: 'ts.call("Date.now")'
              }
            ]
          : [])
      ],
      harness: [],
      assumptions: []
    },
    [KEYS.tsClockScan]
  );
  const refactorJudgment = signed(
    {
      v: "shape.evidence.v1",
      kind: "judgment",
      result: "supports",
      provider: null,
      revision: EX3S2.base,
      time: "2026-09-01T09:00:00Z",
      claim: {
        id: "tooling::ShpCli.isoToday/RefactorSensitive/law",
        fp: "sha256:c414eadc238d87c4e004899e9f2fe5a2ecfe615dae7eb8a242714426a059a077"
      },
      code: [cite(EX3.ISO, "unit", EX3.ISO_B)],
      judge: "tooling::ann"
    },
    [signerFromSeed("0b")]
  );
  const withAnnKey = (s: SourceDoc): SourceDoc => ({
    ...s,
    modules: s.modules.map((m) => ({
      ...m,
      decls: m.decls.map((d) =>
        d.decl === "actor" && d.name === "ann"
          ? { ...d, identities: ['github("ann")', signerFromSeed("0b").identity] }
          : d
      )
    }))
  });
  return baseInput({
    change: { ids: ["github:smoothbrains/shapelang#202"] },
    head: {
      revision: EX3S2.head,
      source: withAnnKey(ex3s2Source({ refactorSensitive: !o.removeRefactorSensitive })),
      manifest: headMan
    },
    base: { revision: EX3S2.base, source: withAnnKey(ex3s2Source()), manifest: baseMan },
    records: [...(o.dropRecord ? [] : [test]), scan, refactorJudgment],
    authors: [{ identity: 'github("claude[bot]")', verified: true, bot: true }]
  });
}
