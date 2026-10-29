// The version 7 form of the worked examples' inputs (M0, m0/golden/inputs): the changes the M0
// freeze made to the version 6 example inputs, each with its clause. Applied by fixtures.ts to
// every builder output, so the 21 named scenarios equal the frozen golden inputs exactly.
//   (1) manifest entries carry refs ([]), executable and hatchComplete [A.12.7.5, A.3.2.4, A.3.4.4,
//       A.15.5, D27];
//   (2) effect facts of the presence-sound observers carry n: 1, re-signed [A.12.6 RJ14, D15];
//   (3) Example 1's shape names the manifest identity and both manifests are DSSE-signed by it
//       [syntax §1, A.5.2.17, D27];
//   (4) Example 1 Variant C answered: the relay's answer records replace the review lines
//       [A.14.1.8, A.7.6.3];
//   (5) Example 3 Step 1: a review relay, whose claim judgment replaces the judge line [D28];
//       tim's base-era judgment is persisted in persisted.base and persisted.head [A.16.4(b), D12].
import type { CheckInput } from "../src/io-types.ts";
import { jcs } from "../src/jcs.ts";
import {
  type ManifestEntry,
  type ManifestPredicate,
  type Statement,
  gitBlobId,
  manifestStatement
} from "../src/manifest.ts";
import {
  type ShapeRecord,
  type Signer,
  makeStatement,
  persistedPath,
  recordId,
  signStatement,
  signerFromSeed
} from "../src/records.ts";

const KEY: Record<string, Signer> = {
  "audit::sqlEffects": signerFromSeed("01"),
  "audit::fastCheck": signerFromSeed("02"),
  "audit::reviews": signerFromSeed("03"),
  "tooling::tsClockScan": signerFromSeed("08"),
  "tooling::reviews": signerFromSeed("0c")
};
export const MANIFEST_EX1 = signerFromSeed("0d");
export const RELAY_EX3 = KEY["tooling::reviews"] as Signer;
const PRESENCE_SOUND_OBSERVERS = new Set(["audit::sqlEffects", "tooling::tsClockScan"]);
const SCRIPT_EXTS = [
  "sh",
  "bash",
  "zsh",
  "fish",
  "py",
  "rb",
  "pl",
  "php",
  "ps1",
  "bat",
  "cmd",
  "sql"
];

type Env = { payloadType: string; payload: string; signatures: { keyid: string; sig: string }[] };
const decode = (env: Env): Statement =>
  JSON.parse(Buffer.from(env.payload, "base64").toString("utf8")) as Statement;

/** A.3.2.4, A.12.2.7, A.15.5: registered languages and command code are executable; raw files on
 *  the script list or of mode 100755 too; package.json and other raw data are not. */
function executableOf(fileId: string, mode: string | undefined): boolean {
  const lang = fileId.split(":")[0];
  if (lang === "ts" || lang === "verus" || lang === "rust") return true;
  if (lang === "pkgjson") return fileId.includes("#scripts.");
  if (lang === "raw") {
    const path = fileId.slice(4);
    const ext = path.includes(".") ? (path.split(".").pop() ?? "") : "";
    return SCRIPT_EXTS.includes(ext) || mode === "100755";
  }
  return false;
}

function v7Manifest(
  m: CheckInput["head"]["manifest"],
  sign: boolean,
  extraTree: { path: string; mode: string; blob: string }[] = []
): CheckInput["head"]["manifest"] {
  const stmt = ("predicate" in m ? m : decode(m as Env)) as Statement;
  const p = stmt.predicate.shape as ManifestPredicate;
  const tree = [...p.tree, ...extraTree.filter((t) => !p.tree.some((x) => x.path === t.path))];
  const modeOf = new Map(tree.map((t) => [t.path, t.mode]));
  const entries = p.entries.map((e): ManifestEntry => {
    const file = e.id.split("#")[0] as string;
    const path = file.slice(file.indexOf(":") + 1);
    return {
      ...e,
      refs: e.refs ?? [],
      executable: executableOf(file, modeOf.get(path)),
      hatchComplete: e.hatchComplete !== false
    };
  });
  const st = manifestStatement({ ...p, tree, entries });
  return sign ? (signStatement(st, [MANIFEST_EX1]) as CheckInput["head"]["manifest"]) : st;
}

function withN(env: unknown): unknown {
  const e = env as Env;
  if (typeof e?.payload !== "string") return env;
  const st = decode(e);
  const shape = structuredClone(st.predicate.shape) as unknown as ShapeRecord;
  if (shape.kind !== "observation" || !PRESENCE_SOUND_OBSERVERS.has(shape.provider?.id ?? ""))
    return env;
  let changed = false;
  for (const f of shape.facts ?? [])
    if (f.type === "effect" && f.n === undefined) {
      f.n = 1;
      changed = true;
    }
  if (!changed) return env;
  return signStatement(makeStatement(shape), [KEY[shape.provider?.id ?? ""] as Signer]);
}

function judgment(r: Omit<ShapeRecord, "v" | "kind">, signer: Signer): unknown {
  return signStatement(makeStatement({ v: "shape.evidence.v1", kind: "judgment", ...r }), [signer]);
}

/** The version 7 input of a worked example; `name` is the golden scenario's name. */
export function toV7(name: string, input: CheckInput): CheckInput {
  const x = structuredClone(input);
  const ex1 = name.startsWith("ex1-");
  const ex3s1 = name.startsWith("ex3-step1");
  x.records = x.records.map(withN);
  x.baseRecords = x.baseRecords.map(withN);
  // (5b) tim's base-era judgment moves from records to persisted.base and persisted.head
  const extraTree: { path: string; mode: string; blob: string }[] = [];
  if (ex3s1) {
    const keep: unknown[] = [];
    for (const r of x.records) {
      const st = decode(r as Env);
      const s = st.predicate.shape as unknown as ShapeRecord;
      if (s.kind === "judgment" && s.judge === "tooling::tim" && s.revision === x.base?.revision) {
        const path = persistedPath(recordId(st));
        x.persisted = {
          base: [...x.persisted.base, { path, record: r }],
          head: [...x.persisted.head, { path, record: r }]
        };
        extraTree.push({ path, mode: "100644", blob: gitBlobId(Buffer.from(jcs(r))) });
      } else keep.push(r);
    }
    x.records = keep;
  }
  // (1), (3)
  for (const side of ["head", "base"] as const) {
    const rev = x[side];
    if (!rev) continue;
    rev.manifest = v7Manifest(rev.manifest, ex1, extraTree);
    if (ex1 && rev.source)
      for (const m of rev.source.modules)
        for (const d of m.decls) if (d.decl === "shape") d.manifest = MANIFEST_EX1.identity;
  }
  // (4) Example 1 Variant C answered: the relay's answer records
  if (name === "ex1-C-answered") {
    const rel = KEY["audit::reviews"] as Signer;
    const ans = (judge: string, gh: string, refs: string[]): unknown =>
      judgment(
        {
          result: "approves",
          provider: { id: "audit::reviews", version: "1.0.0" },
          revision: x.head.revision,
          time: "2026-10-25T11:30:00Z",
          judge,
          identity: gh,
          about: { change: "github:acme/audit#57", refs: [...refs].sort() }
        },
        rel
      );
    x.records.push(
      ans("audit::bob", 'github("bob")', ["bd:a7514dcb4cfb7068", "bd:6bca5b3fe0d0787d"]),
      ans("audit::carol", 'github("carol")', ["bd:a7514dcb4cfb7068"])
    );
    x.reviews = [];
  }
  // (5) Example 3 Step 1: the relay, and its claim judgment for the judge line
  if (ex3s1) {
    const relay = {
      decl: "provider" as const,
      name: "reviews",
      produces: ["judgment" as const],
      identity: RELAY_EX3.identity,
      implementation: {
        digest: "sha256:4e1a7000c0ffee00000000000000000000000000000000000000000000000100"
      }
    };
    for (const side of ["head", "base"] as const)
      for (const m of x[side]?.source?.modules ?? [])
        if (m.module === "tooling") m.decls.push({ ...relay });
    if (name === "ex3-step1-judged") {
      x.records.push(
        judgment(
          {
            result: "supports",
            provider: { id: "tooling::reviews", version: "1.0.0" },
            revision: x.head.revision,
            time: "2026-10-25T11:00:00Z",
            claim: {
              id: "tooling::ShpCli.isoToday/RefactorSensitive/law",
              fp: "sha256:c414eadc238d87c4e004899e9f2fe5a2ecfe615dae7eb8a242714426a059a077"
            },
            code: [
              {
                id: "ts:packages/shp-cli/src/freshness.ts#isoToday",
                projection: "unit",
                scheme: "ts.unit.v2",
                digest: "sha256:6f68619e784427af2372e479a15e284f6054a0fb6540a8287959d16cd4cc02fb"
              }
            ],
            judge: "tooling::tim",
            identity: 'github("tim")',
            about: { change: "github:smoothbrains/shapelang#200", refs: [] }
          },
          RELAY_EX3
        )
      );
      x.reviews = [];
    }
  }
  return x;
}
