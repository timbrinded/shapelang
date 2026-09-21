import { describe, expect, test } from "bun:test";
import { checkShapeModules, parseShapeModule, IncrementalShapeChecker } from "./index.ts";
import { parseAttestationBundle } from "./attestations.ts";

const transition = { base: "a".repeat(40), head: "b".repeat(40) };
const source = `module demo
implementation App {
 paths { "src/**" }
 on_change require shape_update
}
`;
function check(attestations?: unknown, extra = "") {
  const parsed = parseShapeModule(source + extra, "shape/app.shape");
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  return checkShapeModules([{ module: parsed.module, filePath: "shape/app.shape" }], {
    attestationMode: "pr",
    transition,
    changedFiles: ["src/app.ts"],
    attestations
  });
}
function bundle() {
  return {
    version: 1,
    ...transition,
    attestations: [
      {
        obligation: check().obligations![0]!.id,
        kind: "no-shape-change",
        rationale: "Local rename only."
      }
    ]
  };
}
describe("provider-neutral attestations", () => {
  test("missing evidence fails; exact evidence satisfies coverage", () => {
    expect(check().ok).toBe(false);
    expect(check().obligations).toHaveLength(1);
    const result = check(bundle());
    expect(result.ok).toBe(true);
    expect(result.obligations?.[0]?.satisfied).toBe(true);
  });
  test("identity is stable across reruns and changes with the transition", () => {
    expect(check().obligations).toEqual(check().obligations);
    const parsed = parseShapeModule(source);
    if (!parsed.ok) throw new Error("parse failed");
    const other = checkShapeModules([parsed.module], {
      attestationMode: "pr",
      changedFiles: ["src/app.ts"],
      transition: { ...transition, head: "c".repeat(40) }
    });
    expect(other.obligations?.[0]?.id).not.toBe(check().obligations?.[0]?.id);
  });
  test.each([
    ["unsupported_version", { ...bundle(), version: 2 }],
    ["malformed", { ...bundle(), base: "main" }],
    ["malformed", { ...bundle(), unexpected: true }],
    ["malformed", { ...bundle(), attestations: [{ ...bundle().attestations[0], rationale: " " }] }],
    ["stale", { ...bundle(), head: "c".repeat(40) }],
    ["stale", { ...bundle(), base: "c".repeat(40) }],
    [
      "unknown_obligation",
      {
        ...bundle(),
        attestations: [
          { ...bundle().attestations[0], obligation: `shp-obligation-${"0".repeat(64)}` }
        ]
      }
    ],
    [
      "conflicting_duplicates",
      {
        ...bundle(),
        attestations: [
          ...bundle().attestations,
          { ...bundle().attestations[0], rationale: "Different claim" }
        ]
      }
    ]
  ])("rejects %s without waiving coverage", (code, evidence) => {
    const result = check(evidence);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.kind === "attestation_error" && d.code === code)).toBe(
      true
    );
    expect(result.diagnostics.some((d) => d.kind === "missing_shape_update")).toBe(true);
  });
  test("accepts identical duplicates", () => {
    expect(
      check({ ...bundle(), attestations: [...bundle().attestations, ...bundle().attestations] }).ok
    ).toBe(true);
  });
  test("cannot suppress final forbids or docs bindings", () => {
    const result = check(
      bundle(),
      `
resource Log : AppendOnly
component Store {
 grants HardDelete<Log>
 fn purge effects complete { HardDelete<Log> }
}
binding Docs {
 when_changed paths { "src/**" }
 require_changed paths { "docs/app.md" }
 allow attest docs_not_needed
}
`
    );
    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((d) => d.kind)).toContain("final_forbidden_effect");
    expect(result.diagnostics.map((d) => d.kind)).toContain("missing_bound_docs_change");
    expect(result.diagnostics.map((d) => d.kind)).not.toContain("missing_shape_update");
  });
  test("repo default stays compatible; PR mode ignores repo evidence", () => {
    const parsed = parseShapeModule(
      source + `attest no_shape_change { source ts("src/app.ts") reason "Local rename" }`,
      "shape/app.shape"
    );
    if (!parsed.ok) throw new Error("parse failed");
    const modules = [{ module: parsed.module, filePath: "shape/app.shape" }];
    const options = { changedFiles: ["src/app.ts", "shape/app.shape"] };
    expect(checkShapeModules(modules, options).ok).toBe(true);
    expect(checkShapeModules(modules, { ...options, attestationMode: "pr", transition }).ok).toBe(
      false
    );
    expect(checkShapeModules(modules, { ...options, attestations: bundle() }).ok).toBe(false);
  });
  test("PR mode without transition fails closed", () => {
    expect(checkShapeModules([], { attestationMode: "pr" }).diagnostics).toMatchObject([
      { kind: "attestation_error", code: "missing_transition" }
    ]);
  });
  test("incremental cache invalidates when evidence changes", () => {
    const checker = new IncrementalShapeChecker();
    const documents = [{ filePath: "shape/app.shape", source }];
    const options = { attestationMode: "pr" as const, transition, changedFiles: ["src/app.ts"] };
    expect(checker.check(documents, options).result.ok).toBe(false);
    expect(checker.check(documents, { ...options, attestations: bundle() }).result.ok).toBe(true);
    expect(
      checker.check(documents, {
        ...options,
        transition: { ...transition, head: "c".repeat(40) },
        attestations: bundle()
      }).result.ok
    ).toBe(false);
  });
  test("strict versioned contract rejects null and wrong kinds", () => {
    expect(() => parseAttestationBundle(null)).toThrow();
    expect(() =>
      parseAttestationBundle({
        ...bundle(),
        attestations: [{ ...bundle().attestations[0], kind: "docs-not-needed" }]
      })
    ).toThrow();
  });
});
