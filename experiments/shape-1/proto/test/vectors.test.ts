// Conformance with experiments/shape-1/spec/vectors/vectors.py (version 7): claim NFs and fps, schemaFps, fact ids, keys,
// bindings, groups, refs, scope root and answer digests (A.1.1, A.12.11).
import { describe, expect, test } from "bun:test";
import { elaborate } from "../src/elaborate.ts";
import { factId } from "../src/evidence.ts";
import { H, label } from "../src/jcs.ts";
import { scopeRoot } from "../src/records.ts";
import type { SourceDoc } from "../src/source.ts";
import { EX1, IDS, KEYS, ex1, ex2, ex3, ex4 } from "../examples/fixtures.ts";
import { auditSource, ironkvSource } from "../examples/sources.ts";
import { ob, run } from "./helpers.ts";

// version 7 values (experiments/shape-1/spec/vectors/vectors.py, A.1.1, A.12.11): the AppendOnly
// clause forbids Update [D13] and the hatch clause set is one clause per declared hatch verb plus
// Undeclared, with no Hatch clause [D1]
const V = {
  "fp ex1.appendonly": "sha256:3fe8f5ac7169085e744c2b83e26fdd5285328148b8300b68510efd4de6b0aef8",
  "fp ex1.authority.base":
    "sha256:987106a04014478f6935873a3a96a3fc65c384de7b145c679dbf6cc9d082eaa4",
  "fp ex1.authority.headC":
    "sha256:1765c00ea02cf35cf1a1fa83357a00dfc0900fe4cec525ec621113f1a2a2bfa4",
  "fp ex1.history.law": "sha256:2da8fb7008513c5d4434893c76fcb70a4dab922e56ed89f988b390962a63dff3",
  "fp ex2.confine Undeclared":
    "sha256:6cd2e34ae382f2271643ee1e21eb71ea70700a980a610cd7ab8e9442b5698cd7",
  "fp ex2.confine admit": "sha256:999e379d3817b66b3501c0baf222cb1b96e6c63827c578e4cddfc81023f1479f",
  "fp ex2.confine assume":
    "sha256:1584bb88c66cbc8b0a51502299e8e8ca660d8cfeba2e7f93a99491072752a6d4",
  "fp ex2.confine assume_specification":
    "sha256:7ef4d39fc5cce5e25236a2a941202e9d641dadf699801666a3d2680b276c889e",
  "fp ex2.confine axiom": "sha256:260f9bab2f56feaf9250511bf2a69f1f6fff5917e8c87f7e8f206c143da0038a",
  "fp ex2.confine external":
    "sha256:36262b4b629215dac8004587babf2559d6a16db087f7fdb0797acbd0ae25e023",
  "fp ex2.confine external_body":
    "sha256:9dbce5edea4f3d2e68dd82851ca84ae7df7ef74169a691818bf64762fb03a6ba",
  "fp ex2.confine ts_expect_error":
    "sha256:6092a1b156904692bd72a9b6e8dacc4e477bdd07f23e916f7525ee72c688ba19",
  "fp ex2.confine ts_ignore":
    "sha256:7707fdede7e747cb54a9dfb2e6741c02f7eefbc1bcd6ed6d42cffefe3fe97982",
  "fp ex2.confine ts_nocheck":
    "sha256:d128502010fc47e3538fcfed1434e86d87234063fe37bace434d52113f285337",
  "fp ex2.confine uninterp":
    "sha256:f3592ed13e19e6106bf38dc88d42a17fd347bef1977d06dd0e1edd5426ddfe9c",
  "fp ex2.confine unsafe":
    "sha256:c062e5c3410c9114f907d26eaf96bec52364b90a82975aa04ba6b2bea3dbbb0c",
  "fp ex2.law.faithful": "sha256:3d6b9e247facc73677afbf88e873548e4c05981cb24d158eee0bc01fb1ad7b68",
  "fp ex2.law.set": "sha256:60a867af53d80a7f7691530f9ae5869779c05abccd602cd75b2baad28a85db38",
  "fp ex2.surface": "sha256:f3119983e55f6aae012d4804f39af9f73ecafb27fc5fdccc6040b906efb7b03a",
  "fp ex3.clock.broad": "sha256:aec13714cfbf9d940347d169ced70b3084f8be334f592d3940f16e52d855e555",
  "fp ex3.clock.checker": "sha256:866e06e6bddd0add1cd7a6103d38d09c31bed7b56936712bd6318cd6497ba0f1",
  "fp ex3.det.law": "sha256:8620c3bead39262d509d30d813c84d79db4e1ce51b1dd92c904225082519b8c3",
  "fp ex3.refactor.law": "sha256:c414eadc238d87c4e004899e9f2fe5a2ecfe615dae7eb8a242714426a059a077",
  "fp ex4.complete": "sha256:8dd0a5e5758d7fb923f3db80037d2c237d9f74aea75853489ede5be5c25576a9",
  "fp ex4.cycle": "sha256:d1d638be608c2992cf53437af4abd104b9bad53c9d3b7a6fd89ffb5198e3f159",
  "fp ex4.relation": "sha256:8a8f0d5a3028807a000c01ba1931674925ae1ec29d8ba70658140153cfff5116",
  "fp kernel.isolation": "sha256:c4ace26a2f4f95a4dc7b637e7dec39e75cb99c4b5708b981fce354c3a1b91fcb"
};

/** keys, bindings, groups, refs and answer digests of the version 7 vectors.py */
const V7_OUT = {
  "key ex1.B.contradiction": "ob:98ff6f5f02010232b459f9b228f17abb7f78b90094b40b37a3e9a12bb3c32fd2",
  "binding ex1.B.contradiction":
    "bd:1c907a8a119dd310a06e0e9ec876c2db0f003b4c1a33ca0b9d3d851b3e2d72c9",
  "group ex1.B": "g:e49eeaef1d87eb9aae889d4019cf944a91aeb22e46ef77341f2cf8aef85d314b",
  "key ex1.Bprime.contradiction":
    "ob:66055a3355822d3b2a2e0d299eca90a40134f1a2ec90f98a44f923b036b1bdd9",
  "key ex1.Bsecond.coverage.ungoverned":
    "ob:155fa0bf253e0793716dee7451858de84676f017da2d47ee65a8e9d24a457c67",
  "binding ex1.Bsecond.coverage.ungoverned":
    "bd:55aeb9df71bf26a0b65a79a17d84b6ebb853da1c5be9ccbaa3aa61cd269027df",
  "key ex1.C.forbid": "ob:e8ec989a6cf48d9a11cc0aec2006e60bfb0200faed2798b0a3144d4e77b91585",
  "key ex1.C.authority": "ob:ca99c5461b8ff9a8410d4389337b30099a13b1a78bf99bd8f9cc107df9d04054",
  "binding ex1.C.forbid": "bd:a7514dcb4cfb7068eb51a981fe81680557d8c8d2e219c890c9eb09294d0ae084",
  "binding ex1.C.authority": "bd:6bca5b3fe0d0787dfeb54eaf39595334ba4f7e526ef539c12f907d650c796e12",
  "ref ex1.C.forbid": "bd:a7514dcb4cfb7068",
  "ref ex1.C.authority": "bd:6bca5b3fe0d0787d",
  "group ex1.C": "g:9f2b9e1c945e64187b39b5210fdc1218ca8249dfff9d7f26654c29d954985f2c",
  "answer subject digest ex1.C bob":
    "sha256:032ab91f227efdd58843dd1c64ba1c1ffb5f82c30731c08f36e9fdc9c23d8314",
  "answer subject digest ex1.C carol":
    "sha256:ee776f8f2ec7de3755051239298b8a0f0a1bb281ba69b060e942e0df8dd0ffdb"
};

const SCHEMA = {
  "std::AppendOnly": "sha256:cf26a16ce7df73f5a8f0b200c43dacb573cfd012fe0c29676d659bcf7d6d4079",
  "std::Bounded": "sha256:a8a3741ae3f04fdbd835de17c9106feb7a9ec709d55553b200a3accd603e33d3",
  "std::Deterministic": "sha256:5dd1f7b8369f9557a9403b64a20f9d62e456c9960127a258755161b56e21d3e0",
  "std::HistoryPreserved":
    "sha256:3c5937e280af3a8d80cde26bd287b0a9a5454d81eb01f305653b3e8e978dbeb9",
  "std::RefactorSensitive":
    "sha256:a3dc08d2aa6d63dc0ec6b9026302a86b5efeb43523667268a3c18075a7f50837",
  "std::ReviewedSurface": "sha256:b6d6d42a87ca0b278b7ac26ea86bda2682396fa365a0119dcf91a5f2e6a8d143",
  "std::Verified": "sha256:6441cc042e70ee30fee0cd4f6e0ff91d308581804ff3b1f5c9cb6c7152808081"
};

const NOW = 1793000000;
const fps = (doc: SourceDoc): Set<string> =>
  new Set(elaborate(doc, { now: NOW }).claims.map((c) => c.fp));

const CHECKER = [
  "ShapeBindings",
  "ShapeChecker",
  "ShapeDiagnostics",
  "ShapeModelLowerer",
  "ShapeModuleResolver",
  "ShapePreludeRegistry",
  "ShapeRuleEngine",
  "ShapeStringHelpers"
];

function vectorWorld(): SourceDoc {
  return {
    v: "shape.source.v1",
    modules: [
      {
        module: "checker",
        imports: ["std"],
        decls: [
          { decl: "shape", name: "Shape", owner: "tooling::ShapeMaintainers" },
          ...CHECKER.map((n) => ({
            decl: "component" as const,
            name: n,
            units: n === "ShapeChecker" ? [{ name: "checkShapeModules" }] : undefined
          })),
          { decl: "component", name: "ShapeRuleEngine2" },
          {
            decl: "law",
            name: "CheckIsDeterministic",
            template: { name: "Deterministic", args: ["ShapeChecker.checkShapeModules"] },
            tier: "critical"
          },
          {
            decl: "rule",
            name: "KernelIsolation",
            clauses: [
              {
                forbid: "path",
                from: ["tooling::ShpCli", "ShapeChecker", "tooling::ShapeEditorServices"],
                to: ["runtime::ExperimentalSemanticKernel"],
                over: ["calls"]
              }
            ]
          }
        ]
      },
      {
        module: "checker.incremental",
        imports: ["std"],
        decls: [{ decl: "component", name: "ShapeIncrementalChecker" }]
      },
      {
        module: "runtime",
        imports: ["std"],
        decls: [{ decl: "component", name: "ExperimentalSemanticKernel" }]
      },
      {
        module: "tooling",
        imports: ["std", "checker"],
        decls: [
          { decl: "actor", name: "ShapeMaintainers", kind: "team", members: ["tim", "ann"] },
          { decl: "actor", name: "tim", kind: "person" },
          { decl: "actor", name: "ann", kind: "person" },
          { decl: "resource", name: "SystemClock", bind: ['ts.call("Date.now")'] },
          { decl: "component", name: "ShapeEditorServices" },
          {
            decl: "component",
            name: "ShpCli",
            units: [{ name: "isoToday", attach: [{ name: "RefactorSensitive" }] }]
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
                  ...CHECKER.map((n) => `component checker::${n}`),
                  "component checker.incremental::ShapeIncrementalChecker"
                ]
              }
            ]
          },
          {
            decl: "rule",
            name: "Broad",
            clauses: [
              { forbid: "effect", atom: "Read<SystemClock>", except: ["unit ShpCli.isoToday"] }
            ]
          },
          {
            decl: "note",
            name: "ClockReadAtCliBoundary",
            kind: "memory",
            about: ["unit ShpCli.isoToday"]
          }
        ]
      }
    ]
  };
}

describe("claim fingerprints", () => {
  test("example 1 (syntax §1) and Variant C authority", () => {
    const base = fps(auditSource({ ids: IDS }));
    expect(base.has(V["fp ex1.appendonly"])).toBe(true);
    expect(base.has(V["fp ex1.authority.base"])).toBe(true);
    expect(base.has(V["fp ex1.history.law"])).toBe(true);
    const c = fps(
      auditSource({ ids: IDS, grantHardDelete: true, declarePurge: true, dropAppendOnly: true })
    );
    expect(c.has(V["fp ex1.authority.headC"])).toBe(true);
    expect(c.has(V["fp ex1.appendonly"])).toBe(false);
  });
  test("example 2: twelve hatch clauses (one per declared verb plus Undeclared, D1), hosted and informal laws, surface", () => {
    const s = fps(
      ironkvSource({
        verus: KEYS.verus.identity,
        verusRefines: KEYS.verusRefines.identity,
        danaKey: KEYS.dana.identity
      })
    );
    for (const k of Object.keys(V).filter((x) => x.startsWith("fp ex2.")))
      expect(s.has(V[k as keyof typeof V])).toBe(true);
  });
  test("example 3 rules and laws, kernel isolation (A.12.11)", () => {
    const s = fps(vectorWorld());
    expect(s.has(V["fp ex3.clock.checker"])).toBe(true);
    expect(s.has(V["fp ex3.clock.broad"])).toBe(true);
    expect(s.has(V["fp ex3.det.law"])).toBe(true);
    expect(s.has(V["fp ex3.refactor.law"])).toBe(true);
    expect(s.has(V["fp kernel.isolation"])).toBe(true);
  });
  test("example 4 relation, cycle and relations complete", () => {
    const e = ex4({ complete: true });
    const s = fps(e.head.source as SourceDoc);
    expect(s.has(V["fp ex4.relation"])).toBe(true);
    expect(s.has(V["fp ex4.cycle"])).toBe(true);
    expect(s.has(V["fp ex4.complete"])).toBe(true);
  });
  test("std template schemaFps", () => {
    const e = elaborate(auditSource({ ids: IDS }), { now: NOW });
    for (const [q, fp] of Object.entries(SCHEMA))
      expect(e.templates.find((t) => t.q === q)?.schemaFp).toBe(fp);
  });
  test("owner, tier, names and layout never change fp", () => {
    const a = auditSource({ ids: IDS });
    const b = JSON.parse(JSON.stringify(a)) as SourceDoc;
    const res = b.modules[0]?.decls.find((d) => d.decl === "resource");
    if (res && res.decl === "resource") {
      res.tier = "normal";
      res.owner = "Platform";
    }
    expect(fps(b).has(V["fp ex1.appendonly"])).toBe(true);
  });
});

describe("facts, keys, bindings, groups, refs", () => {
  test("fact ids (aliases canonicalised)", () => {
    expect(
      factId({
        type: "effect",
        at: "ts:src/audit/purge.ts#purgeOldEvents",
        verb: "HardDelete",
        resource: 'pg.table("public.audit_events")'
      })
    ).toBe("sha256:51ed979304abfea638295c5bec1e63db15cfa26c3425a552f31ae7ca312dc279");
    for (const alias of [
      'pg.table("AUDIT_EVENTS")',
      'pg.table("audit_events")',
      'pg.table("public.audit_events")'
    ])
      expect(
        factId({
          type: "effect",
          at: "ts:src/audit/purge.ts#purgeOldEvents",
          verb: "HardDelete",
          resource: alias
        })
      ).toBe("sha256:51ed979304abfea638295c5bec1e63db15cfa26c3425a552f31ae7ca312dc279");
    expect(
      factId({
        type: "hatch",
        at: "verus:ironkv/src/delegation_map_v.rs#DelegationMap::set",
        kind: "assume",
        n: 1
      })
    ).toBe("sha256:56e82502df98e91af9bce2036fe8e32c91062147e3d1f2773495aa3551b32a47");
    expect(factId({ type: "declared", claim: V["fp ex4.relation"] })).toBe(
      "sha256:fecfe7218a4d08dc02bd87eb767a297f35df73510eaada61e93f0aac349f596e"
    );
    expect(
      factId({
        type: "effect",
        at: "ts:packages/shp-checker/src/checker/rules/guards.ts#checkFreshness",
        verb: "Read",
        resource: 'ts.call("globalThis.Date.now")'
      })
    ).toBe("sha256:fedfa0b09d953521b133cd23472c44fba3a187a4b97d64f01324f5fb0a682a3e");
  });
  test("scope root of Example 1's observation", () => {
    expect(
      scopeRoot([
        {
          id: "ts:src/audit/purge.ts",
          projection: "file",
          scheme: "ts.file.v1",
          digest: EX1.PURGE_FILE
        },
        {
          id: "ts:src/audit/purge.ts#purgeOldEvents",
          projection: "unit",
          scheme: "ts.unit.v2",
          digest: EX1.PURGE_UNIT
        },
        {
          id: "ts:src/audit/store.ts",
          projection: "file",
          scheme: "ts.file.v1",
          digest: EX1.STORE_FILE
        },
        {
          id: "ts:src/audit/store.ts#appendEvent",
          projection: "unit",
          scheme: "ts.unit.v2",
          digest: EX1.STORE_UNIT
        }
      ])
    ).toBe("sha256:ae2c60231357f6ff73bea4f8b87aaa62ac35f64ebc4c82fcb9a9b1410afda15e");
  });
  // version 7 (m0/golden/deltas.json ex1-B): the contradiction's claim is the AppendOnly Update
  // forbid [D13], so its key, binding and group are the vectors.py v7 values
  test("Example 1 Variant B: key, binding, group", () => {
    const o = ob(run(ex1("B")), V7_OUT["key ex1.B.contradiction"]);
    expect(o?.binding).toBe(V7_OUT["binding ex1.B.contradiction"]);
    expect(o?.group).toBe(V7_OUT["group ex1.B"]);
  });
  test("Example 1 B′ key and B″ coverage key and binding", () => {
    // version 7: B′'s key follows the Update forbid [D13]; B″'s binding delta holds the unmet
    // (claim, channel) pair [D22] (m0/golden/deltas.json ex1-Bprime, ex1-Bsecond)
    expect(ob(run(ex1("Bprime")), V7_OUT["key ex1.Bprime.contradiction"])).toBeDefined();
    const c = ob(run(ex1("Bsecond")), V7_OUT["key ex1.Bsecond.coverage.ungoverned"]);
    expect(c?.binding).toBe(V7_OUT["binding ex1.Bsecond.coverage.ungoverned"]);
  });
  test("Example 1 Variant C: loosening keys, bindings and refs", () => {
    // version 7: the forbid subject is the Update forbid [D13] and both parts carry the v7 L1
    // deltas (levels per atom of ↓Update, authority+ HardDelete and Update) [D17]
    const out = run(ex1("C"));
    const f = ob(out, V7_OUT["key ex1.C.forbid"]);
    const a = ob(out, V7_OUT["key ex1.C.authority"]);
    expect(f?.binding).toBe(V7_OUT["binding ex1.C.forbid"]);
    expect(a?.binding).toBe(V7_OUT["binding ex1.C.authority"]);
    expect(f?.binding.slice(0, 19)).toBe(V7_OUT["ref ex1.C.forbid"]);
    expect(a?.binding.slice(0, 19)).toBe(V7_OUT["ref ex1.C.authority"]);
    expect(f?.group).toBe(V7_OUT["group ex1.C"]);
  });
  test("answer subject digests (A.14.1.8)", () => {
    // version 7: the answers cite the v7 refs of Variant C (bob both, carol the final forbid)
    expect(
      H({
        change: "github:acme/audit#57",
        refs: [V7_OUT["ref ex1.C.authority"], V7_OUT["ref ex1.C.forbid"]]
      })
    ).toBe(V7_OUT["answer subject digest ex1.C bob"]);
    expect(H({ change: "github:acme/audit#57", refs: [V7_OUT["ref ex1.C.forbid"]] })).toBe(
      V7_OUT["answer subject digest ex1.C carol"]
    );
  });
  test("Example 2: keys, bindings, group", () => {
    const out = run(ex2());
    expect(
      ob(out, "ob:815d7ebb9678dbead1b3bef2195fa49bbf807b46d53827e5a944e8009cfc4403")?.binding
    ).toBe("bd:2ea660886d27e5e3e377c2e500e48bcb542e347d272df45c3ca3a92e4491972a");
    const u = ob(out, "ob:8b9a1c953f7ed31c50f09fcd65a8e27bdb6d9a40db449c8fd69946b621161e7d");
    expect(u?.binding).toBe("bd:1da36a42e325dc5acd89366516a304d11c2ce32f9dba52dc6934ad33a2c0535d");
    expect(u?.group).toBe("g:f16ee5b2da967ed85fed5a5b7527502f641bd97d0d74292f7e9eaa67b0cda56a");
  });
  test("Example 3: refactor law key and binding", () => {
    const u = ob(run(ex3()), "ob:5b2b722c136fd4da308e0f1e74276988e91427030963ada796bc16b9a9137bf0");
    expect(u?.binding).toBe("bd:904f519651548b32b48d40a8582cc3851352274a2fc41a0be64a31fa845bb1ed");
  });
  test("Example 4: cycle key, binding, group", () => {
    const o = ob(run(ex4()), "ob:6efc5ef79a4f52afb377a55833ed8d9b6fd57521da5d44328afeab6daf0a6547");
    expect(o?.binding).toBe("bd:45ee0c48b6cfaddb2725e47f1c0e0d0698adc42ebc94a790a0c30701f3a3ede0");
    expect(o?.group).toBe("g:1a3d754f198b44004f2556aa978842a7569c0c08460960f1a7ae0851480bac6e");
    expect(o?.witness).toContain(
      "sha256:1bb37b4784f7693a1df6d67a5da2f0c801b511f6ec25de26d95a17a1b90e1e59"
    );
    expect(
      ob(
        run(ex4({ complete: true, headDiagnostics: true })),
        "ob:03dbcad44e521c74572328aee4806e784a440ff4f53fc5355876d7365c05673d"
      )
    ).toBeDefined();
  });
  test("labels are SHA-256 of their text", () => {
    expect(label("history.test.ts own")).toBe(
      "sha256:1a247c54cb6fe0d53af890a9690f67297e8e351a90980f166716d2050f7aabdd"
    );
  });
});
