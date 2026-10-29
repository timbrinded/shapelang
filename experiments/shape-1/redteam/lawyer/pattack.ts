// @ts-nocheck
// Spec-lawyer attacks replayed on the TypeScript prototype (experiments/shape-1/proto), to see
// whether the prototype and the Lean kernel agree on each attack (see kattack.py).
// Run from the repo root: bun experiments/shape-1/redteam/lawyer/pattack.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { derive } from "../../proto/src/derive.ts";
import { coreOutput } from "../../proto/src/render.ts";
import { elaborate } from "../../proto/src/elaborate.ts";
import { label } from "../../proto/src/jcs.ts";
import { manifestStatement } from "../../proto/src/manifest.ts";
import { scopeRoot, signerFromSeed } from "../../proto/src/records.ts";
import {
  EX2,
  EX3,
  EX3S2,
  KEYS,
  baseInput,
  cite,
  ex1,
  ex2,
  ex3,
  ex3s2,
  manifest,
  signed
} from "../../proto/examples/fixtures.ts";

const OUT = join(import.meta.dir, "proto-cases");
mkdirSync(OUT, { recursive: true });
const RESULTS: Record<string, Record<string, unknown>> = {};

function run(name: string, input: unknown) {
  const out = derive(structuredClone(input));
  const core = coreOutput(out);
  writeFileSync(join(OUT, `${name}.input.json`), JSON.stringify(input, null, 1));
  writeFileSync(join(OUT, `${name}.out.json`), JSON.stringify(core, null, 1));
  return { out, core };
}

function summary(out) {
  return {
    verdict: out.verdict,
    errors: out.errors.map((e) => `${e.code} ${e.subject}`),
    rejected: (out.rejected ?? []).map((r) => r.code),
    obligations: out.obligations.map((o) => ({
      kind: o.kind,
      reason: o.reason,
      questions: o.questions,
      severity: o.severity,
      tier: o.tier,
      force: o.force,
      introduced: o.introduced,
      exploited: o.exploited,
      exception: o.exception,
      subject: o.subject,
      claim: o.claim?.ids ?? null,
      binding: o.binding?.slice(0, 19)
    })),
    answered: out.answered.map((a) => ({
      obligation: a.obligation.slice(0, 19),
      as: a.as,
      self: a.self
    })),
    debt: out.debt.map((d) => ({ exception: d.exception, expiresInDays: d.expiresInDays }))
  };
}

function rec(attack: string, variant: string, input: unknown) {
  const { out } = run(`${attack}__${variant}`, input);
  (RESULTS[attack] ??= {})[variant] = summary(out);
  return out;
}

const find = (out, pred) => out.obligations.find(pred);
const modDecls = (src, fn) => ({
  ...src,
  modules: src.modules.map((m) => ({ ...m, decls: fn(m.decls, m.module) }))
});
function remanifest(stmt, revision, fn = (e) => e) {
  const p = structuredClone(stmt.predicate.shape);
  p.revision = revision;
  p.entries = fn(p.entries);
  return manifestStatement(p);
}
const setDigest = (id, proj, digest) => (es) =>
  es.map((e) => (e.id === id && e.projection === proj ? { ...e, digest } : e));

// ---------------------------------------------------------------------------------------------
// A1a: judges narrowing in the head enables the self fallback (L4 removal, normal tier).
// ---------------------------------------------------------------------------------------------
{
  const pol = (judges) => ({
    decl: "policy",
    name: "P",
    tiers: { normal: { floor: "declared", blocks: ["latent-loosening"], maxAge: 365, judges } }
  });
  const withPolicy = (src, judges, dropGuard) =>
    modDecls(src, (ds) => [
      ...ds
        .map((d) => (d.decl === "shape" ? { ...d, policy: "P" } : d))
        .map((d) =>
          d.decl === "component" && dropGuard
            ? { ...d, units: d.units.map((u) => ({ ...u, attach: [] })) }
            : d
        ),
      { decl: "actor", name: "bob", kind: "person", identities: ['github("bob")'] },
      pol(judges)
    ]);
  for (const [variant, headJudges] of [
    ["control_head_policy_unchanged", ["owner", "agents", "bob"]],
    ["attack_head_narrows_judges", ["owner", "agents"]]
  ]) {
    const i = ex3();
    i.base.source = withPolicy(i.base.source, ["owner", "agents", "bob"], false);
    i.head.source = withPolicy(i.head.source, headJudges, true);
    i.head.manifest = i.base.manifest; // no code change, only the shape edit
    i.head.revision = i.base.revision;
    i.records = [];
    const p1 = run(`A1a__${variant}__phase1`, i).out;
    const ob = find(p1, (o) => o.kind === "loosening");
    i.reviews = ob
      ? [
          {
            identity: 'github("tim")',
            line: `shape approve ${ob.binding.slice(0, 19)}`,
            change: EX3.change
          }
        ]
      : [];
    rec("A1a_judges_narrowing_L4", variant, i);
  }
}

// ---------------------------------------------------------------------------------------------
// A2a: producer-changed masks `assumption` (Example 2, no hatch rule; the PR bumps Cargo.lock).
// A38: a proof's own listed hatch assumption with no manifest marker.
// ---------------------------------------------------------------------------------------------
const noRule = (src, tier) =>
  modDecls(src, (ds) =>
    ds
      .filter((d) => !(d.decl === "rule"))
      .map((d) => (d.decl === "law" && d.name === "SetRefinesSpec" && tier ? { ...d, tier } : d))
  );
for (const tier of ["critical", "final"]) {
  for (const [variant, bump] of [
    ["control_no_lockfile_edit", false],
    ["attack_lockfile_bumped", true]
  ]) {
    const i = ex2();
    i.base.source = noRule(i.base.source, tier);
    i.head.source = noRule(i.head.source, tier);
    if (bump)
      i.head.manifest = remanifest(
        i.head.manifest,
        EX2.head,
        setDigest("raw:ironkv/Cargo.lock", "own", label("Cargo.lock own, bumped"))
      );
    if (bump)
      i.head.manifest = remanifest(
        i.head.manifest,
        EX2.head,
        setDigest("raw:ironkv/Cargo.lock", "file", label("Cargo.lock file, bumped"))
      );
    const p1 = run(`A2a_${tier}__${variant}__phase1`, i).out;
    const ob = find(
      p1,
      (o) => o.kind === "unestablished" && (o.claim?.ids ?? []).includes("ironkv::SetRefinesSpec")
    );
    i.reviews = ob
      ? [
          {
            identity: 'github("dana")',
            line: `shape approve ${ob.binding.slice(0, 19)}`,
            change: EX2.change
          }
        ]
      : [];
    rec(`A2a_pc_masks_assumption_${tier}`, variant, i);
  }
}
{
  for (const [variant, keepMarker] of [
    ["control_manifest_marker", true],
    ["attack_record_lists_hatch_manifest_silent", false]
  ]) {
    const i = ex2();
    i.base.source = noRule(i.base.source);
    i.head.source = noRule(i.head.source);
    if (!keepMarker)
      i.head.manifest = remanifest(i.head.manifest, EX2.head, (es) =>
        es.map((e) => (e.id === EX2.SET ? { ...e, markers: undefined } : e))
      );
    rec("A38_record_hatch_assumption_ignored", variant, i);
  }
}

// ---------------------------------------------------------------------------------------------
// A2b: fake head-only provider turns `missing` into producer-changed (Example 3 step 2 law).
// ---------------------------------------------------------------------------------------------
{
  for (const [variant, fake] of [
    ["control_timeout_only", false],
    ["attack_fake_headonly_provider", true]
  ]) {
    const i = ex3s2({ seededClock: false });
    // the authenticated decider's run timed out: inconclusive (supplied, establishes nothing)
    const csmHead = label("csm unit, head");
    i.head.manifest = remanifest(
      i.head.manifest,
      EX3S2.head,
      setDigest(EX3S2.CSM, "unit", csmHead)
    );
    i.head.manifest = remanifest(
      i.head.manifest,
      EX3S2.head,
      setDigest(EX3S2.CSM, "own", label("csm own, head"))
    );
    const t = (provider, result, signers) =>
      signed(
        {
          v: "shape.evidence.v1",
          kind: "test",
          result,
          provider: { id: provider, version: "1" },
          revision: EX3S2.head,
          time: "2026-10-25T10:00:00Z",
          claim: {
            id: "checker::CheckIsDeterministic",
            fp: "sha256:8620c3bead39262d509d30d813c84d79db4e1ce51b1dd92c904225082519b8c3"
          },
          code: [cite(EX3S2.CSM, "unit", csmHead)],
          harness: [],
          assumptions: []
        },
        signers
      );
    const es = i.head.manifest.predicate.shape.entries
      .filter((e) => e.projection === (e.id.includes("#") ? "unit" : "own"))
      .map((e) => ({ ...cite(e.id, e.projection, e.digest), complete: true, deps: [] }));
    const scanH = signed(
      {
        v: "shape.evidence.v1",
        kind: "observation",
        result: "observes",
        provider: { id: "tooling::tsClockScan", version: "0.1.0" },
        revision: EX3S2.head,
        time: "2026-10-25T10:00:00Z",
        scope: { root: scopeRoot(es), entries: es },
        facts: [{ type: "effect", at: EX3.ISO, verb: "Read", resource: 'ts.call("Date")' }],
        harness: [],
        assumptions: []
      },
      [KEYS.tsClockScan]
    );
    i.records = [t("checker::bunTest", "inconclusive", [KEYS.bunTest]), scanH, i.records[2]];
    if (fake) {
      i.head.source = modDecls(i.head.source, (ds, m) =>
        m === "checker"
          ? [
              ...ds,
              {
                decl: "provider",
                name: "quickCheck",
                produces: ["test"],
                decides: ["template Deterministic"],
                implementation: { paths: ["packages/shp-checker/src/**"] }
              }
            ]
          : ds
      );
      i.records.push(t("checker::quickCheck", "supports", []));
    }
    const p1 = run(`A2b__${variant}__phase1`, i).out;
    const ob = find(
      p1,
      (o) =>
        o.kind === "unestablished" && (o.claim?.ids ?? []).includes("checker::CheckIsDeterministic")
    );
    i.reviews = ob
      ? [{ identity: 'github("ann")', line: `shape approve ${ob.binding.slice(0, 19)}` }]
      : [];
    rec("A2b_pc_masks_missing_fake_provider", variant, i);
  }
}

// ---------------------------------------------------------------------------------------------
// A4: coverage answer by the component owner alone, with an unmet critical claim of another team.
// ---------------------------------------------------------------------------------------------
{
  const src = {
    v: "shape.source.v1",
    modules: [
      {
        module: "x",
        imports: ["std"],
        decls: [
          { decl: "shape", name: "Shop", owner: "Platform" },
          { decl: "actor", name: "StoreTeam", kind: "team", members: ["kate"] },
          { decl: "actor", name: "SecTeam", kind: "team", members: ["sam"] },
          { decl: "actor", name: "Platform", kind: "team", members: ["alex"] },
          { decl: "actor", name: "kate", kind: "person", identities: ['github("kate")'] },
          { decl: "actor", name: "sam", kind: "person", identities: ['github("sam")'] },
          { decl: "actor", name: "alex", kind: "person", identities: ['github("alex")'] },
          {
            decl: "actor",
            name: "bot",
            kind: "agent",
            operator: "alex",
            identities: ['github("bot[bot]")']
          },
          {
            decl: "resource",
            name: "Ledger",
            owner: "SecTeam",
            tier: "critical",
            bind: ['pg.table("ledger")']
          },
          { decl: "component", name: "Store", owner: "StoreTeam", paths: ["src/store/**/*.ts"] },
          {
            decl: "rule",
            name: "LedgerIsAppendOnly",
            owner: "SecTeam",
            tier: "critical",
            clauses: [{ forbid: "effect", atom: "HardDelete<Ledger>" }]
          }
        ]
      }
    ]
  };
  const sf = ["shape.lock", "shape/x.shape"];
  const bm = manifest(
    "a4".padEnd(40, "0"),
    [{ id: "ts:src/store/a.ts" }, { id: "ts:src/store/a.ts#f", unit: label("f unit") }],
    sf
  );
  const hm = manifest(
    "a4".padEnd(40, "1"),
    [
      { id: "ts:src/store/a.ts" },
      { id: "ts:src/store/a.ts#f", unit: label("f unit") },
      { id: "ts:src/store/purge.ts" },
      { id: "ts:src/store/purge.ts#purge", unit: label("purge unit") }
    ],
    sf
  );
  for (const [variant, who] of [
    ["control_sam_only", ["sam"]],
    ["attack_kate_only", ["kate"]],
    ["spec_kate_and_sam", ["kate", "sam"]]
  ]) {
    const i = baseInput({
      change: { ids: ["github:acme/x#1"] },
      head: { revision: "a4".padEnd(40, "1"), source: src, manifest: hm },
      base: { revision: "a4".padEnd(40, "0"), source: src, manifest: bm },
      authors: [{ identity: 'github("bot[bot]")', verified: true, bot: true }]
    });
    const p1 = run(`A4__${variant}__phase1`, i).out;
    const ob = find(p1, (o) => o.kind === "coverage");
    i.reviews = ob
      ? who.map((w) => ({
          identity: `github("${w}")`,
          line: `shape approve ${ob.binding.slice(0, 19)}`
        }))
      : [];
    rec("A4_coverage_unmet_claim_owner", variant, i);
  }
}

// ---------------------------------------------------------------------------------------------
// A5a: a final informal law (RefactorSensitive on a final unit) established by one agent.
// ---------------------------------------------------------------------------------------------
{
  for (const [variant, who] of [
    ["control_no_judgment", null],
    ["attack_one_agent_judges", 'github("review-bot[bot]")'],
    ["attack_one_person_judges", 'github("ann")']
  ]) {
    const i = ex3();
    const f = (src) =>
      modDecls(src, (ds) => [
        ...ds.map((d) =>
          d.decl === "shape"
            ? { ...d, policy: "P" }
            : d.decl === "actor" && d.name === "ShapeMaintainers"
              ? { ...d, members: ["tim", "ann"] }
              : d.decl === "component"
                ? { ...d, units: d.units.map((u) => ({ ...u, tier: "final", effects: undefined })) }
                : d
        ),
        { decl: "actor", name: "ann", kind: "person", identities: ['github("ann")'] },
        {
          decl: "actor",
          name: "reviewBot",
          kind: "agent",
          operator: "ann",
          identities: ['github("review-bot[bot]")']
        },
        {
          decl: "policy",
          name: "P",
          tiers: {
            critical: {
              floor: "tested",
              blocks: ["unestablished", "coverage", "latent-loosening"],
              maxAge: 90,
              judges: ["owner", "agents"]
            }
          }
        }
      ]);
    i.base.source = f(i.base.source);
    i.head.source = f(i.head.source);
    i.reviews = who
      ? [
          {
            identity: who,
            line: "shape judge tooling::ShpCli.isoToday/RefactorSensitive/law",
            change: EX3.change
          }
        ]
      : [];
    rec("A5a_final_informal_law_single_judge", variant, i);
  }
}

// ---------------------------------------------------------------------------------------------
// A6: rebinding the final forbid's resource code.
// ---------------------------------------------------------------------------------------------
for (const [variant, bind] of [
  ["control_binding_kept", 'pg.table("audit_events")'],
  ["attack_binding_moved", 'pg.table("audit_events_v2")']
]) {
  const i = ex1("B");
  i.head.source = modDecls(i.head.source, (ds) =>
    ds.map((d) => (d.decl === "resource" ? { ...d, bind: [bind] } : d))
  );
  rec("A6_rebind_resource_code_final", variant, i);
}

// ---------------------------------------------------------------------------------------------
// A8: base glob tie; A50: move new code out of a final component; A7: L3 search order.
// ---------------------------------------------------------------------------------------------
const actorsZ = [
  { decl: "shape", name: "S", owner: "Team" },
  { decl: "actor", name: "Team", kind: "team", members: ["pat", "quinn"] },
  { decl: "actor", name: "pat", kind: "person", identities: ['github("pat")'] },
  { decl: "actor", name: "quinn", kind: "person", identities: ['github("quinn")'] },
  { decl: "actor", name: "bot", kind: "agent", operator: "pat", identities: ['github("bot[bot]")'] }
];
const mod = (name, decls) => ({
  v: "shape.source.v1",
  modules: [{ module: name, imports: ["std"], decls }]
});
{
  for (const [variant, lax, strict] of [
    ["lax_component_sorts_first", "Alpha", "Beta"],
    ["strict_component_sorts_first", "Beta", "Alpha"]
  ]) {
    const R = {
      decl: "resource",
      name: "R",
      owner: "Team",
      tier: "critical",
      bind: ['pg.table("r")']
    };
    const laxC = {
      decl: "component",
      name: lax,
      owner: "Team",
      tier: "critical",
      paths: ["src/**/*.ts"],
      grants: ["Read<R>", "Write<R>"]
    };
    const strictC = {
      decl: "component",
      name: strict,
      owner: "Team",
      tier: "critical",
      paths: ["src/**/*.ts"],
      grants: ["Read<R>"]
    };
    const sf = ["shape.lock", "shape/z.shape"];
    const m = manifest(
      "a8".padEnd(40, "0"),
      [{ id: "ts:src/m.ts" }, { id: "ts:src/m.ts#f", unit: label("f unit") }],
      sf
    );
    const i = baseInput({
      change: { ids: ["github:acme/z#1"] },
      head: {
        revision: "a8".padEnd(40, "0"),
        source: mod("z", [...actorsZ, R, laxC]),
        manifest: m
      },
      base: {
        revision: "a8".padEnd(40, "0"),
        source: mod("z", [...actorsZ, R, laxC, strictC]),
        manifest: m
      },
      authors: [{ identity: 'github("bot[bot]")', verified: true, bot: true }]
    });
    rec("A8_base_glob_tie_name_dependence", variant, i);
  }
}
{
  const R = {
    decl: "resource",
    name: "Ledger",
    owner: "Team",
    tier: "final",
    bind: ['pg.table("ledger")']
  };
  const vault = {
    decl: "component",
    name: "Vault",
    owner: "Team",
    tier: "final",
    paths: ["src/vault/**/*.ts"],
    grants: ["Read<Ledger>"]
  };
  const scratch = (paths) => ({
    decl: "component",
    name: "Scratch",
    owner: "Team",
    tier: "low",
    paths,
    grants: ["Read<Ledger>"]
  });
  const sf = ["shape.lock", "shape/w.shape"];
  const bm = manifest(
    "50".padEnd(40, "0"),
    [{ id: "ts:src/vault/v.ts" }, { id: "ts:src/vault/v.ts#read", unit: label("read unit") }],
    sf
  );
  const hm = manifest(
    "50".padEnd(40, "1"),
    [
      { id: "ts:src/vault/v.ts" },
      { id: "ts:src/vault/v.ts#read", unit: label("read unit") },
      { id: "ts:src/vault/purge/p.ts" },
      { id: "ts:src/vault/purge/p.ts#purge", unit: label("purge unit") }
    ],
    sf
  );
  for (const [variant, paths] of [
    ["control_new_code_stays_in_final_component", ["src/scratch/**/*.ts"]],
    [
      "attack_glob_moves_new_code_to_low_component",
      ["src/scratch/**/*.ts", "src/vault/purge/**/*.ts"]
    ]
  ]) {
    const i = baseInput({
      change: { ids: ["github:acme/w#1"] },
      head: {
        revision: "50".padEnd(40, "1"),
        source: mod("w", [...actorsZ, R, vault, scratch(paths)]),
        manifest: hm
      },
      base: {
        revision: "50".padEnd(40, "0"),
        source: mod("w", [...actorsZ, R, vault, scratch(["src/scratch/**/*.ts"])]),
        manifest: bm
      },
      authors: [{ identity: 'github("bot[bot]")', verified: true, bot: true }]
    });
    rec("A50_move_code_out_of_final_authority", variant, i);
  }
}
{
  const comps = ["A", "B", "C"].map((n) => ({
    decl: "component",
    name: n,
    owner: "Team",
    tier: "low",
    paths: [`src/${n.toLowerCase()}/**/*.ts`]
  }));
  const rule = {
    decl: "rule",
    name: "AdoesNotReachC",
    tier: "low",
    clauses: [{ forbid: "path", from: ["component A"], to: ["component C"], over: ["calls"] }]
  };
  const calls = {
    decl: "provider",
    name: "calls",
    produces: ["observation"],
    observes: ["call(ts)"],
    sound: [],
    identity: KEYS.tsCallGraph.identity,
    implementation: { digest: "sha256:" + "c".repeat(64) }
  };
  const sf = ["shape.lock", "shape/y.shape"];
  const m = manifest(
    "a7".padEnd(40, "0"),
    [
      { id: "ts:src/a/a.ts" },
      { id: "ts:src/a/a.ts#f", unit: label("f unit") },
      { id: "ts:src/b/b.ts" },
      { id: "ts:src/c/c.ts" },
      { id: "ts:src/c/c.ts#g", unit: label("g unit") }
    ],
    sf
  );
  for (const [variant, facts] of [
    ["control_no_observed_edge", []],
    [
      "attack_observed_edge_A_to_C",
      [{ type: "call", at: "ts:src/a/a.ts#f", to: "ts:src/c/c.ts#g" }]
    ]
  ]) {
    const es = [{ ...cite("ts:src/a/a.ts#f", "unit", label("f unit")), complete: false, deps: [] }];
    const r = signed(
      {
        v: "shape.evidence.v1",
        kind: "observation",
        result: "observes",
        provider: { id: "y::calls", version: "1" },
        revision: "a7".padEnd(40, "0"),
        time: "2026-10-25T10:00:00Z",
        scope: { root: scopeRoot(es), entries: es },
        facts,
        harness: [],
        assumptions: []
      },
      [KEYS.tsCallGraph]
    );
    const i = baseInput({
      change: { ids: ["github:acme/y#1"] },
      head: {
        revision: "a7".padEnd(40, "0"),
        source: mod("y", [...actorsZ, ...comps, calls]),
        manifest: m
      },
      base: {
        revision: "a7".padEnd(40, "0"),
        source: mod("y", [...actorsZ, ...comps, rule, calls]),
        manifest: m
      },
      records: [r],
      authors: [{ identity: 'github("bot[bot]")', verified: true, bot: true }]
    });
    rec("A7_L3_search_order_exploited", variant, i);
  }
}

// ---------------------------------------------------------------------------------------------
// A13: named judges satisfy the final two-person rule (Example 1 Variant C).
// ---------------------------------------------------------------------------------------------
{
  const f = (src) =>
    modDecls(src, (ds) => [
      ...ds.map((d) => (d.decl === "shape" ? { ...d, policy: "P" } : d)),
      { decl: "actor", name: "dave", kind: "person", identities: ['github("dave")'] },
      { decl: "actor", name: "erin", kind: "person", identities: ['github("erin")'] },
      {
        decl: "policy",
        name: "P",
        tiers: {
          critical: {
            floor: "tested",
            blocks: ["unestablished", "coverage", "latent-loosening"],
            maxAge: 90,
            judges: ["dave", "erin"]
          }
        }
      }
    ]);
  const i0 = ex1("C");
  i0.base.source = f(i0.base.source);
  i0.head.source = f(i0.head.source);
  const p1 = run("A13__phase1", i0).out;
  const refs = p1.obligations
    .filter((o) => o.kind === "loosening")
    .map((o) => o.binding.slice(0, 19));
  for (const [variant, who] of [
    ["owners_bob_and_carol_answer", ["bob", "carol"]],
    ["outsiders_dave_and_erin_answer", ["dave", "erin"]]
  ]) {
    const i = structuredClone(i0);
    i.reviews = who.map((w) => ({
      identity: `github("${w}")`,
      line: `shape approve ${refs.join(" ")}`,
      change: "github:acme/audit#57"
    }));
    rec("A13_named_judges_final_two_person", variant, i);
  }
}

// ---------------------------------------------------------------------------------------------
// A14: hosted-law closure change (spec weakened) with a fresh proof; A39: final law through admit.
// ---------------------------------------------------------------------------------------------
{
  const strip = (src) =>
    modDecls(src, (ds) =>
      ds.filter((d) => d.decl !== "rule" && !(d.decl === "law" && d.name === "SetContractFaithful"))
    );
  for (const [variant, weaken] of [
    ["control_spec_unchanged", false],
    ["attack_spec_weakened", true]
  ]) {
    const i = ex2();
    i.base.source = strip(i.base.source);
    i.head.source = strip(i.head.source);
    const clo = weaken ? label("set closure, weakened") : EX2.SET_CLOSURE;
    i.head.manifest = remanifest(i.head.manifest, EX2.head, (es) =>
      es.map((e) =>
        e.id === EX2.SET
          ? {
              ...e,
              markers: undefined,
              ...(e.projection === "closure"
                ? { digest: clo }
                : e.projection === "contract" && weaken
                  ? { digest: label("set contract, weakened") }
                  : {})
            }
          : e
      )
    );
    i.records = [
      signed(
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
          code: [cite(EX2.SET, "unit", EX2.SET_UNIT_H), cite(EX2.SET, "closure", clo)],
          deps: [cite(EX2.INSERT, "contract", label("insert contract"))],
          harness: [],
          assumptions: [
            { id: "z3@4.12.5", kind: "tool" },
            { id: "verus@dccae1d", kind: "tool" }
          ]
        },
        [KEYS.verus]
      ),
      ...i.records.slice(2)
    ];
    rec("A14_hosted_law_closure_change", variant, i);
  }
}
{
  for (const [variant, kind] of [
    ["control_assume_allowed_by_boundary", "assume"],
    ["attack_admit_allowed_by_boundary", "admit"]
  ]) {
    const i = ex2();
    const f = (src) =>
      modDecls(src, (ds) =>
        ds
          .filter((d) => d.decl !== "rule")
          .map((d) =>
            d.decl === "component" && d.name === "DelegationMap"
              ? { ...d, boundary: true, allows: [kind] }
              : d.decl === "law" && d.name === "SetRefinesSpec"
                ? { ...d, tier: "final" }
                : d
          )
      );
    i.base.source = f(i.base.source);
    i.head.source = f(i.head.source);
    const mk = (e) => (e.id === EX2.SET ? { ...e, markers: { [kind]: 1 } } : e);
    i.head.manifest = remanifest(i.head.manifest, EX2.head, (es) => es.map(mk));
    i.base.manifest = remanifest(i.base.manifest, EX2.base, (es) => es.map(mk));
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
          { id: `${EX2.SET}/${kind}`, kind: "hatch" },
          { id: "z3@4.12.5", kind: "tool" },
          { id: "verus@dccae1d", kind: "tool" }
        ]
      },
      [KEYS.verus]
    );
    i.records = [proof, ...i.records.slice(1)];
    rec("A39_final_law_through_admit", variant, i);
  }
}

// ---------------------------------------------------------------------------------------------
// A34: phase 2 after the relay commit: same entries, new revision.
// ---------------------------------------------------------------------------------------------
{
  for (const [variant, rev] of [
    ["phase1_head", EX3S2.head],
    ["phase2_after_relay_commit", "9".repeat(40)]
  ]) {
    const i = ex3s2();
    i.head.manifest = remanifest(i.head.manifest, rev);
    i.head.revision = rev;
    rec("A34_relay_commit_stales_revision_tied_records", variant, i);
  }
}

// ---------------------------------------------------------------------------------------------
// NM: exits from preexisting final drift; A3: two exceptions; A9/A29: observer silence at normal.
// ---------------------------------------------------------------------------------------------
const CF = "ts:packages/shp-checker/src/checker/rules/guards.ts#checkFreshness";
function clockShape(rule, extra = []) {
  return mod("tooling", [
    { decl: "shape", name: "Shape", owner: "ShapeMaintainers" },
    { decl: "actor", name: "ShapeMaintainers", kind: "team", members: ["tim", "ann", "bob"] },
    { decl: "actor", name: "tim", kind: "person", identities: ['github("tim")'] },
    { decl: "actor", name: "ann", kind: "person", identities: ['github("ann")'] },
    { decl: "actor", name: "bob", kind: "person", identities: ['github("bob")'] },
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
    { decl: "resource", name: "ShapeSource" },
    { decl: "component", name: "ShpCli", paths: ["packages/shp-cli/src/**/*.ts"] },
    {
      decl: "component",
      name: "ShapeRuleEngine",
      paths: ["packages/shp-checker/src/checker/rules/**/*.ts"],
      grants: ["Read<ShapeSource>"]
    },
    ...(rule ? [rule] : []),
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
      identity: KEYS.tsClockScan.identity,
      implementation: {
        paths: ["tools/clock-scan.ts", "tsconfig.json", "package.json", "bun.lock"]
      }
    },
    ...extra
  ]);
}
const clockRule = (tier, except) => ({
  decl: "rule",
  name: "CheckerNeverReadsClock",
  tier,
  clauses: [
    {
      forbid: "effect",
      atom: "Read<SystemClock>",
      within: ["component ShapeRuleEngine"],
      ...(except ? { except } : {})
    }
  ]
});
const sfc = ["shape.lock", "shape/tooling.shape"];
const clockIds = (side, o = {}) => [
  {
    id: "ts:packages/shp-checker/src/checker/rules/guards.ts",
    own: label(`guards own ${o.cf ?? "b"}`)
  },
  { id: CF, own: label(`cf own ${o.cf ?? "b"}`), unit: label(`cf unit ${o.cf ?? "b"}`) },
  { id: "raw:README.md", own: label(`readme ${side}`), file: label(`readme file ${side}`) },
  { id: "ts:tools/clock-scan.ts", own: label(`scan own ${o.scan ?? "b"}`) }
];
function scan(rev, cfTag, facts) {
  const es = [{ ...cite(CF, "unit", label(`cf unit ${cfTag}`)), complete: true, deps: [] }];
  return signed(
    {
      v: "shape.evidence.v1",
      kind: "observation",
      result: "observes",
      provider: { id: "tooling::tsClockScan", version: "1" },
      revision: rev,
      time: "2026-10-25T10:00:00Z",
      scope: { root: scopeRoot(es), entries: es },
      facts,
      harness: [],
      assumptions: []
    },
    [KEYS.tsClockScan]
  );
}
const NOWF = { type: "effect", at: CF, verb: "Read", resource: 'ts.call("Date.now")' };
const RB = "b".repeat(40);
const RH = "c".repeat(40);
{
  for (const [variant, headRule] of [
    ["a_unrelated_change", clockRule("final")],
    ["b_lower_to_critical_same_nf", clockRule("critical")],
    ["c_remove_forbid", null],
    ["d_perturbed_nf_at_critical", clockRule("critical", ["component ShpCli"])]
  ]) {
    const i = baseInput({
      change: { ids: ["github:acme/shape#9"] },
      head: {
        revision: RH,
        source: clockShape(headRule),
        manifest: manifest(RH, clockIds("h"), sfc)
      },
      base: {
        revision: RB,
        source: clockShape(clockRule("final")),
        manifest: manifest(RB, clockIds("b"), sfc)
      },
      records: [scan(RH, "b", [NOWF])],
      baseRecords: [scan(RB, "b", [NOWF])],
      authors: [{ identity: 'github("claude[bot]")', verified: true, bot: true }]
    });
    const p1 = run(`NM__${variant}__phase1`, i).out;
    const refs = p1.obligations
      .filter((o) => o.kind === "loosening")
      .map((o) => o.binding.slice(0, 19));
    if (refs.length)
      i.reviews = ["ann", "bob"].map((w) => ({
        identity: `github("${w}")`,
        line: `shape approve ${refs.join(" ")}`
      }));
    rec("NM_final_drift_exit_non_monotone", variant, i);
  }
}
{
  const exc = [
    {
      decl: "exception",
      name: "AaaRuleWaiver",
      waives: ["contradiction"],
      target: "rule CheckerNeverReadsClock",
      owner: "ShapeMaintainers",
      expires: "2027-09-01"
    },
    {
      decl: "exception",
      name: "ZzzAuthorityWaiver",
      waives: ["contradiction"],
      target: "authority ShapeRuleEngine",
      owner: "ShapeMaintainers",
      expires: "2026-10-30"
    }
  ];
  for (const [variant, now] of [
    ["now_2026-10-25", "2026-10-25T12:00:00Z"],
    ["now_2026-11-01_after_short_expiry", "2026-11-01T12:00:00Z"]
  ]) {
    const i = baseInput({
      now,
      change: { ids: ["github:acme/shape#10"] },
      head: {
        revision: RH,
        source: clockShape(clockRule("critical"), exc),
        manifest: manifest(RH, clockIds("h"), sfc)
      },
      base: {
        revision: RB,
        source: clockShape(clockRule("critical"), exc),
        manifest: manifest(RB, clockIds("b"), sfc)
      },
      records: [scan(RH, "b", [NOWF])],
      baseRecords: [scan(RB, "b", [NOWF])],
      authors: [{ identity: 'github("claude[bot]")', verified: true, bot: true }]
    });
    rec("A3_two_exceptions_expiry", variant, i);
  }
}
{
  for (const [variant, scanTag, recs] of [
    ["control_scanner_reports", "b", () => [scan(RH, "h", [NOWF])]],
    ["attack_scanner_edited_reports_nothing", "h", () => [scan(RH, "h", [])]],
    ["attack_only_base_revision_record", "b", () => [scan(RB, "b", [])]],
    ["control_scanner_edited_still_reports", "h", () => [scan(RH, "h", [NOWF])]]
  ]) {
    const i = baseInput({
      change: { ids: ["github:acme/shape#11"] },
      head: {
        revision: RH,
        source: clockShape(clockRule("normal")),
        manifest: manifest(RH, clockIds("h", { cf: "h", scan: scanTag }), sfc)
      },
      base: {
        revision: RB,
        source: clockShape(clockRule("normal")),
        manifest: manifest(RB, clockIds("b"), sfc)
      },
      records: recs(),
      authors: [{ identity: 'github("claude[bot]")', verified: true, bot: true }]
    });
    rec("A9_A29_observer_silence_normal_tier", variant, i);
  }
}

// ---------------------------------------------------------------------------------------------
// A12: judges intersected as strings; A10: judge lines across pushes.
// ---------------------------------------------------------------------------------------------
{
  const f = (src, judges) =>
    modDecls(src, (ds) => [
      ...ds.map((d) =>
        d.decl === "shape"
          ? { ...d, policy: "P" }
          : d.decl === "actor" && d.name === "ShapeMaintainers"
            ? { ...d, members: ["tim", "ann"] }
            : d
      ),
      { decl: "actor", name: "ann", kind: "person", identities: ['github("ann")'] },
      {
        decl: "policy",
        name: "P",
        tiers: { normal: { floor: "declared", blocks: ["latent-loosening"], maxAge: 365, judges } }
      }
    ]);
  for (const [variant, hj] of [
    ["control_unchanged", ["owner"]],
    ["attack_judges_owner_to_member", ["ann"]]
  ]) {
    const i = ex3();
    i.base.source = f(i.base.source, ["owner"]);
    i.head.source = f(i.head.source, hj);
    i.head.manifest = i.base.manifest;
    i.head.revision = i.base.revision;
    const p1 = run(`A12__${variant}__phase1`, i).out;
    const ob = find(p1, (o) => o.kind === "loosening");
    if (ob)
      i.reviews = [
        {
          identity: 'github("ann")',
          line: `shape approve ${ob.binding.slice(0, 19)}`,
          change: EX3.change
        }
      ];
    rec("A12_judges_string_intersection", variant, i);
  }
}
{
  const f = (src) =>
    modDecls(src, (ds) => [
      ...ds.map((d) =>
        d.decl === "actor" && d.name === "ShapeMaintainers"
          ? { ...d, members: ["tim", "ann"] }
          : d.decl === "component"
            ? { ...d, units: d.units.map((u) => ({ ...u, tier: "critical", effects: undefined })) }
            : d
      ),
      { decl: "actor", name: "ann", kind: "person", identities: ['github("ann")'] }
    ]);
  for (const [variant, isoHead] of [
    ["push1_reviewed_by_ann", EX3.ISO_H],
    ["push2_never_reviewed", label("isoToday unit, push 2")]
  ]) {
    const i = ex3();
    i.base.source = f(i.base.source);
    i.head.source = f(i.head.source);
    i.head.manifest = remanifest(i.head.manifest, EX3.head, setDigest(EX3.ISO, "unit", isoHead));
    i.reviews = [
      {
        identity: 'github("ann")',
        line: "shape judge tooling::ShpCli.isoToday/RefactorSensitive/law",
        change: EX3.change
      }
    ];
    rec("A10_judge_line_not_bound_to_revision", variant, i);
  }
}

// ---------------------------------------------------------------------------------------------
// EQ1: a claim-space `implies` record makes a weaker head path forbid an heir of the base one
//      (A.5.6.1 requires the provider to decide both claims; nobody decides checker claims).
// EQ2: a code-space `equivalent` record from a provider with no declared scope revalidates a
//      guard judgment across an edit of the guarded TS unit.
// DH:  a test record whose harness digest no longer matches M_h (harness not in this delta).
// ---------------------------------------------------------------------------------------------
{
  const eqKey = signerFromSeed("0e");
  const eqProv = {
    decl: "provider",
    name: "refines",
    produces: ["equivalence"],
    decides: ["equivalence"],
    sound: ["presence"],
    identity: eqKey.identity,
    implementation: { digest: "sha256:" + "e".repeat(64) }
  };
  const comps = ["A", "B", "C"].map((n) => ({
    decl: "component",
    name: n,
    owner: "Team",
    tier: "critical",
    paths: [`src/${n.toLowerCase()}/**/*.ts`]
  }));
  const ruleB = {
    decl: "rule",
    name: "Isolation",
    tier: "critical",
    clauses: [{ forbid: "path", from: ["component A"], to: ["component C"], over: ["calls"] }]
  };
  const ruleH = {
    decl: "rule",
    name: "Isolation",
    tier: "critical",
    clauses: [{ forbid: "path", from: ["component A"], to: ["component B"], over: ["calls"] }]
  };
  const sf = ["shape.lock", "shape/q.shape"];
  const m = manifest(
    "e1".padEnd(40, "0"),
    [{ id: "ts:src/a/a.ts" }, { id: "ts:src/b/b.ts" }, { id: "ts:src/c/c.ts" }],
    sf
  );
  const bsrc = mod("q", [...actorsZ, ...comps, ruleB, eqProv]);
  const hsrc = mod("q", [...actorsZ, ...comps, ruleH, eqProv]);
  const fpOf = (src) =>
    elaborate(src, { now: "2026-10-25T12:00:00Z" }).claims.find((c) => c.op === "path.forbid").fp;
  for (const [variant, withRec] of [
    ["control_no_implies_record", false],
    ["attack_implies_record_head_to_base", true]
  ]) {
    const r = signed(
      {
        v: "shape.evidence.v1",
        kind: "equivalence",
        result: "implies",
        provider: { id: "q::refines", version: "1" },
        revision: "e1".padEnd(40, "0"),
        time: "2026-10-25T10:00:00Z",
        pair: { space: "claim", from: fpOf(hsrc), to: fpOf(bsrc) },
        code: [],
        harness: [],
        assumptions: []
      },
      [eqKey]
    );
    const i = baseInput({
      change: { ids: ["github:acme/q#1"] },
      head: { revision: "e1".padEnd(40, "0"), source: hsrc, manifest: m },
      base: { revision: "e1".padEnd(40, "0"), source: bsrc, manifest: m },
      records: withRec ? [r] : [],
      authors: [{ identity: 'github("bot[bot]")', verified: true, bot: true }]
    });
    rec("EQ1_claim_implies_record_for_checker_claim", variant, i);
  }
}
{
  const eqKey = signerFromSeed("0e");
  for (const [variant, withRec] of [
    ["control_guard_stale", false],
    ["attack_code_equivalence_record", true]
  ]) {
    const i = ex3();
    const f = (src) =>
      modDecls(src, (ds) => [
        ...ds,
        {
          decl: "provider",
          name: "verusRefines",
          produces: ["equivalence"],
          decides: ["equivalence"],
          sound: ["presence"],
          identity: eqKey.identity,
          implementation: { digest: "sha256:" + "f".repeat(64) }
        }
      ]);
    i.base.source = f(i.base.source);
    i.head.source = f(i.head.source);
    if (withRec)
      i.records.push(
        signed(
          {
            v: "shape.evidence.v1",
            kind: "equivalence",
            result: "equivalent",
            provider: { id: "tooling::verusRefines", version: "1" },
            revision: EX3.head,
            time: "2026-10-25T10:00:00Z",
            pair: { space: "code", from: EX3.ISO_B, to: EX3.ISO_H },
            code: [],
            harness: [],
            assumptions: []
          },
          [eqKey]
        )
      );
    rec("EQ2_code_equivalence_revalidates_guard", variant, i);
  }
}
{
  const i = ex3s2();
  const dc = (src) =>
    modDecls(src, (ds) =>
      ds.map((d) =>
        d.decl === "provider" && d.name === "bunTest" ? { ...d, depsComplete: true } : d
      )
    );
  i.base.source = dc(i.base.source);
  i.head.source = dc(i.head.source);
  const old = signed(
    {
      v: "shape.evidence.v1",
      kind: "test",
      result: "supports",
      provider: { id: "checker::bunTest", version: "1.4.2" },
      revision: "a".repeat(40),
      time: "2026-10-25T10:00:00Z",
      claim: {
        id: "checker::CheckIsDeterministic",
        fp: "sha256:8620c3bead39262d509d30d813c84d79db4e1ce51b1dd92c904225082519b8c3"
      },
      code: [cite(EX3S2.CSM, "unit", label("csm unit"))],
      deps: [cite("ts:packages/shp-checker/src/checker/api.ts", "own", label("api own"))],
      harness: [
        cite(EX3S2.DET, "own", label("determinism.test.ts own, older")),
        cite(EX3S2.HARN, "own", label("behavioural/harness.ts own"))
      ],
      assumptions: []
    },
    [KEYS.bunTest]
  );
  i.records = [old, ...i.records.slice(1)];
  rec("DH_stale_harness_digest", "harness_digest_mismatch_not_in_delta", i);
}

// ---------------------------------------------------------------------------------------------
// UA: the agent pushes from an unmapped, non-bot machine account: authors* is empty, so its
//     operator alice answers her own agent's final loosening as if independent.
// ---------------------------------------------------------------------------------------------
{
  for (const [variant, author] of [
    [
      "control_mapped_agent",
      { identity: 'github("acme-code-agent[bot]")', verified: true, bot: true }
    ],
    [
      "attack_unmapped_machine_user",
      { identity: 'github("acme-helper")', verified: true, bot: false }
    ]
  ]) {
    const i = ex1("C");
    i.authors = [author];
    const p1 = run(`UA__${variant}__phase1`, i).out;
    const refs = p1.obligations
      .filter((o) => o.kind === "loosening" || o.kind === "coverage")
      .map((o) => o.binding.slice(0, 19));
    i.reviews = ["bob", "alice"].map((w) => ({
      identity: `github("${w}")`,
      line: `shape approve ${refs.join(" ")}`,
      change: "github:acme/audit#57"
    }));
    rec("UA_unmapped_human_author", variant, i);
  }
}

writeFileSync(join(import.meta.dir, "proto-results.json"), JSON.stringify(RESULTS, null, 1));
for (const [a, vs] of Object.entries(RESULTS).sort()) {
  console.log(`== ${a}`);
  for (const [v, r] of Object.entries(vs).sort()) {
    const obs = r.obligations
      .map(
        (o) =>
          `${o.kind}/${o.reason ?? o.force ?? "-"}/${o.severity}/${o.tier}${o.exception ? `/exc=${o.exception}` : ""}${o.exploited ? "/expl" : ""}${o.questions ? `/${o.questions.join("+")}` : ""}`
      )
      .join("; ");
    console.log(
      `  ${v.padEnd(48)} ${String(r.verdict).padEnd(8)} errs=${JSON.stringify(r.errors)} rej=${JSON.stringify(r.rejected)} ans=${JSON.stringify(r.answered.map((x) => x.as + (x.self ? "(self)" : "")))} debt=${JSON.stringify(r.debt)} | ${obs}`
    );
  }
}
