// trust provider: vprobe-semantics Rust/Verus markers, Bend and Lean identities and markers,
// #print axioms → assumptions, the manifest overlay in derive, Lean proof records, and the H5 replay.
import { afterAll, describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { derive } from "../../src/derive.ts";
import { indexManifest } from "../../src/manifest.ts";
import { signerFromSeed } from "../../src/records.ts";
import type { Decl } from "../../src/source.ts";
import { REPO_ROOT, manifestFor } from "../common.ts";
import { bendIdentities, markOpenLaws, scanBend } from "../trust/bend.ts";
import { leanAssumptions, leanProject, parsePrintAxioms, scanLean } from "../trust/lean.ts";
import {
  leanProofProvider,
  leanProofRecords,
  overlayInput,
  overlayManifest,
  trustReport
} from "../trust/provider.ts";
import { replayAll } from "../trust/replay.ts";
import { asHatchKinds, auditRust, vprobeTcb } from "../trust/rust.ts";
import { cleanup, input, shape, tree } from "./fixture.ts";

afterAll(cleanup);

const VERUS = `use vstd::prelude::*;
verus! {
// assume(false) in a comment never counts; neither does "admit()" in a string
#[verifier::external_body]
fn io_send(x: u64) { let s = "assume(x)"; }
#[verifier(external)]
fn raw() {}
pub fn set(x: u64) { assume(x > 0); proof { admit(); } }
pub axiom fn ax();
pub assume_specification[ std::vec::Vec::push ](v: &mut Vec<u8>, x: u8);
#[verifier::external_type_specification]
pub struct ExVec(Vec<u8>);
}
`;

describe("rust/verus (vprobe semantics)", () => {
  test("tcb_scan counts markers from the token tree only", () => {
    expect(vprobeTcb(VERUS)).toEqual({
      admit: 1,
      assume: 1,
      assume_specification: 1,
      axiom_fn: 1,
      external: 1,
      external_body: 1,
      external_type_specification: 1
    });
    expect(asHatchKinds({ external_fn_specification: 2, external: 1, axiom_fn: 1 })).toEqual({
      axiom: 1,
      external: 3
    });
  });
  test("audit compares the manifest's markers with vprobe's per file", async () => {
    const root = tree({ "src/lib.rs": VERUS });
    const man = await manifestFor({ root, noTypeScript: true });
    const [row] = auditRust(man.index, man.read);
    expect(row?.lang).toBe("verus");
    expect(row?.vprobe).toEqual({
      admit: 1,
      assume: 1,
      assume_specification: 1,
      axiom: 1,
      external: 1,
      external_body: 1,
      external_type_specification: 1
    });
    // the core manifest has no std kind for external_type_specification
    expect(row?.delta).toEqual({ external_type_specification: -1 });
  });
});

const BEND = `import Base

# @unsafe in a comment never counts
def twice(n: Nat) -> Nat:
  match n:
    case 0n:
      0n
    case 1n+p:
      1n+1n+twice(p)

@unsafe
def halve(+n: U32, acc: U32) -> U32:
  halve.go(U32.is_le(n, 1), n, acc)

def halve.go(b: Bool, n: U32, acc: U32) -> U32:
  pick(Hc, chr_is(c, '#'), n,
  acc)

def fast?(n: Nat) -> Nat:
  ?TODO

def Clock.now() -> IO(U32):
  import "./clock.js"

law twice_succ:
  for n: Nat
  {twice(1n+n) == 1n+1n+twice(n) : Nat}
`;

describe("bend", () => {
  test("identities nest dotted names; markers for unsafe, sugar, foreign, holes, open laws", () => {
    const s = scanBend("demo/main.bend", BEND);
    markOpenLaws([s]);
    const ids = bendIdentities(s);
    expect(ids.map((x) => [x.id, x.parent, x.markers])).toEqual([
      ["bend:demo/main.bend", null, {}],
      ["bend:demo/main.bend#Clock.now", "bend:demo/main.bend", { foreign: 1 }],
      ["bend:demo/main.bend#fast", "bend:demo/main.bend", { hole: 1, unsafe: 1 }],
      ["bend:demo/main.bend#halve", "bend:demo/main.bend", { unsafe: 1 }],
      ["bend:demo/main.bend#halve.go", "bend:demo/main.bend#halve", {}],
      ["bend:demo/main.bend#twice", "bend:demo/main.bend", {}],
      ["bend:demo/main.bend#twice_succ", "bend:demo/main.bend", { open_law: 1 }]
    ]);
    expect(ids.every((x) => x.hatchComplete)).toBe(true);
  });
});

const LEAN_LIB = `namespace Demo
/-- a lemma with a hole; sorry in this comment never counts -/
theorem helper (n : Nat) : n + 0 = n := by
  sorry

def double (n : Nat) : Nat := n + n

axiom magic : 1 = 2

theorem clean (n : Nat) : double n = n + n := rfl

theorem uses (n : Nat) : n + 0 = n := helper n

theorem viaAxiom : 1 = 2 := magic
end Demo
`;

describe("lean", () => {
  test("declarations with namespaces, markers and closures; macros break hatch-completeness", () => {
    const s = scanLean("Demo/Lib.lean", LEAN_LIB);
    expect(s.decls.map((d) => [d.kind, d.name, d.markers])).toEqual([
      ["theorem", "Demo.helper", { sorry: 1 }],
      ["def", "Demo.double", {}],
      ["axiom", "Demo.magic", { axiom: 1 }],
      ["theorem", "Demo.clean", {}],
      ["theorem", "Demo.uses", {}],
      ["theorem", "Demo.viaAxiom", {}]
    ]);
    expect(s.hatchComplete).toBe(true);
    expect(
      scanLean("M.lean", 'macro "trustme" : term => `(sorry)\ntheorem t : True := trustme\n')
        .hatchComplete
    ).toBe(false);
  });
  test("#print axioms → assumptions: standard axioms are the toolchain, sorry is located in the cone", () => {
    const out = `'Demo.clean' does not depend on any axioms
'Demo.uses' depends on axioms: [propext,
 sorryAx]
'Demo.viaAxiom' depends on axioms: [Demo.magic]`;
    const ax = parsePrintAxioms(out);
    expect([...ax.entries()]).toEqual([
      ["Demo.clean", []],
      ["Demo.uses", ["propext", "sorryAx"]],
      ["Demo.viaAxiom", ["Demo.magic"]]
    ]);
    const p = leanProject([scanLean("Demo/Lib.lean", LEAN_LIB)]);
    expect(leanAssumptions(p, "Demo.uses", ["propext", "sorryAx"], "4.34.0")).toEqual({
      assumptions: [
        { id: "lean:Demo/Lib.lean#Demo.helper/sorry", kind: "hatch" },
        { id: "lean@4.34.0", kind: "tool" }
      ],
      inherited: ["Demo.helper"]
    });
    expect(leanAssumptions(p, "Demo.viaAxiom", ["Demo.magic"], "4.34.0").assumptions).toEqual([
      { id: "lean:Demo/Lib.lean#Demo.magic/axiom", kind: "hatch" }
    ]);
  });
});

describe("overlay and derive", () => {
  const files = {
    "bend/main.bend": BEND,
    "bend/clock.js": "export const now = () => 0;\n",
    "Demo/Lib.lean": LEAN_LIB,
    "lakefile.toml": 'name = "demo"\n',
    "lean-toolchain": "leanprover/lean4:v4.34.0\n"
  };
  test("bend and lean files become registered identities; the manifest still indexes", async () => {
    const root = tree(files);
    const man = await manifestFor({ root, noTypeScript: true });
    const o = overlayManifest(man.statement, man.read);
    const idx = indexManifest(o.statement);
    expect(idx.problems).toEqual([]);
    expect(idx.index?.ids.has("raw:bend/main.bend")).toBe(false);
    expect(idx.index?.ids.get("bend:bend/main.bend#halve")?.markers).toEqual({ unsafe: 1 });
    expect(idx.index?.ids.get("lean:Demo/Lib.lean#Demo.helper")?.digests.has("closure")).toBe(true);
    expect(o.bend.markers).toEqual({ foreign: 1, hole: 1, open_law: 1, unsafe: 2 });
    expect(o.lean.markers).toEqual({ axiom: 1, sorry: 1 });
  });

  test("HatchesStayAtBoundaries contradicts Bend unsafe outside a boundary, not inside", async () => {
    const root = tree(files);
    const man = await manifestFor({ root, noTypeScript: true });
    const o = overlayManifest(man.statement, man.read);
    const revision = man.revision;
    const rule: Decl = {
      decl: "rule",
      name: "NoHatches",
      template: { name: "HatchesStayAtBoundaries", args: [] },
      tier: "critical"
    };
    const outside = derive(
      input({
        source: shape("demo", [
          { decl: "component", name: "Game", owner: "alice", paths: ["bend/**"] },
          rule
        ]),
        manifest: o.statement,
        revision
      })
    );
    const hatchSubjects = outside.obligations
      .filter((x) => x.kind === "contradiction")
      .map(
        (x) => `${(x.subject as { code: string }).code} ${(x.subject as { atom: string }).atom}`
      );
    expect(hatchSubjects).toContain("bend:bend/main.bend#halve unsafe<std::Trust>");
    expect(hatchSubjects).toContain("bend:bend/main.bend#Clock.now Hatch<std::Trust>");
    expect(hatchSubjects).toContain("lean:Demo/Lib.lean#Demo.helper Hatch<std::Trust>");
    const inside = derive(
      input({
        source: shape("demo", [
          {
            decl: "component",
            name: "Game",
            boundary: true,
            owner: "alice",
            paths: ["bend/**"],
            allows: ["unsafe"]
          },
          rule
        ]),
        manifest: o.statement,
        revision
      })
    );
    // The boundary excepts itself from the unsafe clause, but the `Hatch` catch-all clause
    // (effect.forbid(Hatch<Trust>, [*], [])) protects ↓Hatch, which holds every declared hatch verb,
    // so allowed hatches inside boundaries are still contradicted (spec defect, A.4.2.4 vs A.3.4.3).
    const halve = inside.obligations.filter(
      (x) => (x.subject as { code?: string }).code === "bend:bend/main.bend#halve"
    );
    expect(halve.map((x) => x.claim?.ids[0])).toEqual(["demo::NoHatches/dc8454f26ba4"]);
    expect(halve.some((x) => x.claim?.ids[0]?.endsWith("/e73e76608d8a"))).toBe(false);
  });

  test("Lean proof records: a clean theorem establishes its hosted law; a sorry in the cone leaves it unestablished (assumption)", async () => {
    const root = tree(files);
    const man = await manifestFor({ root, noTypeScript: true });
    const o = overlayManifest(man.statement, man.read);
    const index = indexManifest(o.statement).index;
    if (!index) throw new Error("no index");
    const om = { ...man, statement: o.statement, index };
    const signer = signerFromSeed("31");
    const info = leanProofProvider({
      q: "demo::lean",
      identity: signer.identity,
      implementation: ["lakefile.toml", "lean-toolchain"]
    });
    const src = shape("demo", [
      { decl: "component", name: "Proofs", owner: "alice", tier: "critical", paths: ["Demo/**"] },
      {
        decl: "law",
        name: "DoubleSpec",
        on: ['code lean("Demo/Lib.lean#Demo.clean")'],
        statement: 'lean("Demo/Lib.lean#Demo.clean")',
        evidence: { level: "proven" },
        tier: "critical"
      },
      {
        decl: "law",
        name: "UsesSpec",
        on: ['code lean("Demo/Lib.lean#Demo.uses")'],
        statement: 'lean("Demo/Lib.lean#Demo.uses")',
        evidence: { level: "proven" },
        tier: "critical"
      },
      info.decl
    ]);
    const axioms =
      "'Demo.clean' does not depend on any axioms\n'Demo.uses' depends on axioms: [propext, sorryAx]\n";
    const r = leanProofRecords({
      info,
      source: src,
      man: om,
      project: o.project,
      printAxioms: axioms,
      built: true,
      signer,
      time: "2026-10-25T10:00:00Z"
    });
    expect(r.rejected).toEqual([]);
    expect(r.records.map((x) => x.shape.claim?.id)).toEqual(["demo::DoubleSpec", "demo::UsesSpec"]);
    expect(r.records[1]?.shape.code?.map((c) => `${c.id}@${c.projection}`)).toEqual([
      "lean:Demo/Lib.lean#Demo.uses@closure",
      "lean:Demo/Lib.lean#Demo.uses@unit"
    ]);
    expect(r.records[1]?.shape.deps?.map((c) => c.id)).toEqual(["lean:Demo/Lib.lean#Demo.helper"]);
    const out = derive(
      input({
        source: src,
        manifest: o.statement,
        revision: man.revision,
        records: r.records.map((x) => x.record)
      })
    );
    expect(out.rejected).toEqual([]);
    const obs = out.obligations.map((x) => [x.kind, x.reason, x.claim?.ids[0]]);
    expect(obs).toEqual([["unestablished", "assumption", "demo::UsesSpec"]]);
  });

  test("overlayInput rewrites a ready CheckInput's manifests", async () => {
    const root = tree(files);
    const man = await manifestFor({ root, noTypeScript: true });
    const inp = input({
      source: shape("demo", []),
      manifest: man.statement,
      revision: man.revision
    });
    const out = overlayInput(inp, man.read);
    expect(indexManifest(out.head.manifest).index?.ids.has("bend:bend/main.bend#halve")).toBe(true);
    expect(derive(out).verdict).not.toBe("invalid");
  });

  test("the trust report audits Rust, inventories Bend and Lean, and maps axioms", async () => {
    const root = tree({ ...files, "src/lib.rs": VERUS });
    const man = await manifestFor({ root, noTypeScript: true });
    const { report } = trustReport(man, {
      printAxioms:
        "'Demo.uses' depends on axioms: [sorryAx]\n'Nope.x' does not depend on any axioms\n"
    });
    expect(report.rust.files).toBe(1);
    expect(report.bend.identities).toBe(7);
    expect(report.lean.unresolved).toEqual(["Nope.x"]);
    expect(report.lean.theorems.find((t) => t.name === "Demo.uses")?.inherited).toEqual([
      "Demo.helper"
    ]);
    expect(report.soundness.sound).toEqual(["presence", "absence"]);
  });
});

describe("H5 replay", () => {
  test("reproduces E9's per-file count-diff baseline on the recorded per-commit data", () => {
    const dir = join(REPO_ROOT, "experiments/verus-probes/results/per-commit");
    const files = readdirSync(dir)
      .filter((f) => f.endsWith(".json.gz"))
      .sort()
      .map((f) => join(dir, f));
    const { total } = replayAll(files);
    expect(total).toMatchObject({
      commits: 2202,
      withEvent: 1073,
      b3: 909,
      bodyOnly: 164,
      grow: 586,
      growB3: 586,
      growS1: 586,
      s2: 1073
    });
    expect(total.s1).toBeLessThan(total.b3);
  });
});
