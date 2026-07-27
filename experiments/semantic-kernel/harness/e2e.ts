import assert from "node:assert/strict";
import { join } from "node:path";
import {
  checkShapeModules,
  compareCodepointStrings,
  parseShapeModule,
  type CheckModuleInput,
  type SemanticDiagnostic
} from "../../../packages/shp-checker/src/index.ts";
import { createKernelRequestV1, parseKernelResponseV1, type KernelResponseV1 } from "./protocol.ts";
import {
  loadWasmKernel,
  runNativeKernel,
  semanticKernelRoot,
  wasmTypeDeclarations
} from "./runtime.ts";

type CandidatePinDiagnostic = Extract<
  SemanticDiagnostic,
  { kind: "candidate_pin_fingerprint_mismatch" }
>;

const current = await loadFixtures(["pin-current.shape"]);
const stale = await loadFixtures(["pin-stale.shape"]);
const multiple = await loadFixtures(["pin-order-a.shape", "pin-order-z.shape"]);
assert.equal(current.productionDiagnostics.length, 0);
assert.equal(stale.productionDiagnostics.length, 1);
assert.equal(multiple.productionDiagnostics.length, 2);

const wasm = await loadWasmKernel();
await verifySuccessfulCase(current, wasm.check_facts_json);
await verifySuccessfulCase(stale, wasm.check_facts_json);
const multipleResponse = await verifySuccessfulCase(multiple, wasm.check_facts_json);
assert.deepEqual(
  multipleResponse.diagnostics.map((diagnostic) => diagnostic.candidateEffect),
  ["a::CandidateZ", "z::CandidateA"]
);

const omittedFilePathRequest = JSON.stringify({
  schemaVersion: 1,
  facts: [
    {
      kind: "resource",
      name: "fixture::Anchor",
      provenance: { label: "resource fixture::Anchor" }
    },
    {
      kind: "candidate_effect",
      name: "fixture::Candidate",
      anchor: "fixture::Anchor",
      fingerprintProvider: "ast.semantic_subtree_v1",
      fingerprintValue: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      provenance: { label: "effect candidate fixture::Candidate" }
    }
  ]
});
const omittedFilePathNative = await runNativeKernel(omittedFilePathRequest);
assert.equal(omittedFilePathNative.exitCode, 0, omittedFilePathNative.stderr);
const omittedFilePathWasm = wasm.check_facts_json(omittedFilePathRequest);
assert.equal(omittedFilePathNative.stdout, omittedFilePathWasm);
assert.doesNotMatch(omittedFilePathNative.stdout, /filePath/);
const omittedFilePathResponse = parseKernelResponseV1(omittedFilePathNative.stdout);
assert.ok(
  omittedFilePathResponse.diagnostics[0]?.causes.every(
    (cause) => cause.provenance.filePath === undefined
  )
);

const invalidRequests = [
  '{"schemaVersion":2,"facts":[]}',
  '{"schemaVersion":1,"facts":[],"extra":true}',
  '{"schemaVersion":1,"facts":[{"kind":"resource","name":"x","provenance":{"label":"x"},"extra":true}]}',
  '{"schemaVersion":1,"facts":[{"kind":"resource","name":"x","provenance":{"label":"first"}},{"kind":"resource","name":"x","provenance":{"label":"second"}}]}',
  '{"schemaVersion":1,"facts":[{"kind":"resource","name":"x","provenance":{"filePath":null,"label":"x"}}]}',
  '{"schemaVersion":1,"facts":[{"kind":"candidate_effect","name":"x","anchor":null,"provenance":{"label":"x"}}]}',
  '{"schemaVersion":1,"facts":[{"kind":"candidate_effect","name":"x","fingerprintProvider":null,"provenance":{"label":"x"}}]}',
  '{"schemaVersion":1,"facts":[{"kind":"candidate_effect","name":"x","fingerprintValue":null,"provenance":{"label":"x"}}]}',
  '{"schemaVersion":1,"facts":['
];
for (const invalid of invalidRequests) {
  const native = await runNativeKernel(invalid);
  assert.equal(native.exitCode, 2);
  assert.equal(native.stdout, "");
  assert.match(
    native.stderr,
    /duplicate kernel fact identity|invalid kernel request|unsupported kernel schema version/
  );
  assert.throws(() => wasm.check_facts_json(invalid));
}

const declarations = await Bun.file(wasmTypeDeclarations).text();
assert.match(declarations, /export function check_facts_json\(input: string\): string;/);

console.log(
  "Experimental semantic kernel E2E passed: TypeScript facts -> native Rust and browser-targeted WASM."
);

async function loadFixtures(fileNames: readonly string[]): Promise<{
  requestJson: string;
  productionDiagnostics: CandidatePinDiagnostic[];
}> {
  const modules: CheckModuleInput[] = [];
  for (const fileName of fileNames) {
    const filePath = join(semanticKernelRoot, "fixtures", fileName);
    const source = await Bun.file(filePath).text();
    const parsed = parseShapeModule(source, filePath);
    if (!parsed.ok) {
      throw new Error(parsed.diagnostics.map((diagnostic) => diagnostic.message).join("\n"));
    }
    modules.push({ module: parsed.module, filePath });
  }
  const result = checkShapeModules(modules, {
    enforceBindings: false,
    includeFacts: true
  });
  if (!result.facts) {
    throw new Error(`Checker did not return facts for ${fileNames.join(", ")}.`);
  }
  const unexpectedDiagnostics = result.diagnostics.filter(
    (diagnostic) => diagnostic.kind !== "candidate_pin_fingerprint_mismatch"
  );
  assert.deepEqual(
    unexpectedDiagnostics,
    [],
    `Parity fixtures produced non-target diagnostics: ${fileNames.join(", ")}`
  );
  return {
    requestJson: JSON.stringify(createKernelRequestV1(result.facts)),
    productionDiagnostics: result.diagnostics.filter(
      (diagnostic): diagnostic is CandidatePinDiagnostic =>
        diagnostic.kind === "candidate_pin_fingerprint_mismatch"
    )
  };
}

async function verifySuccessfulCase(
  fixture: {
    requestJson: string;
    productionDiagnostics: CandidatePinDiagnostic[];
  },
  checkWasm: (input: string) => string
): Promise<KernelResponseV1> {
  const native = await runNativeKernel(fixture.requestJson);
  assert.equal(native.exitCode, 0, native.stderr);
  assert.equal(native.stderr, "");
  const wasmJson = checkWasm(fixture.requestJson);
  assert.equal(native.stdout, wasmJson);

  const response = parseKernelResponseV1(native.stdout);
  assertProductionParity(response, fixture.productionDiagnostics);
  for (const diagnostic of response.diagnostics) {
    assert.deepEqual(
      diagnostic.causes.map((cause) => cause.role),
      diagnostic.actual === undefined
        ? ["candidate_effect", "anchor"]
        : ["candidate_effect", "anchor", "actual_fingerprint"]
    );
    assert.ok(
      diagnostic.causes.every(
        (cause) =>
          cause.provenance.filePath?.endsWith(".shape") === true &&
          cause.provenance.label.length > 0
      )
    );
  }
  return response;
}

function assertProductionParity(
  response: KernelResponseV1,
  production: CandidatePinDiagnostic[]
): void {
  assert.equal(response.ok, production.length === 0);
  assert.deepEqual(
    response.diagnostics.map(toSemanticSummary).toSorted(compareSemanticSummaries),
    production.map(toSemanticSummary).toSorted(compareSemanticSummaries)
  );
}

type CandidatePinSemanticSummary = {
  candidateEffect: string;
  anchor: string;
  provider: string;
  expected: string;
  actual: string | undefined;
};

function toSemanticSummary(
  diagnostic: CandidatePinDiagnostic | KernelResponseV1["diagnostics"][number]
): CandidatePinSemanticSummary {
  return {
    candidateEffect: diagnostic.candidateEffect,
    anchor: diagnostic.anchor,
    provider: diagnostic.provider,
    expected: diagnostic.expected,
    actual: diagnostic.actual
  };
}

function compareSemanticSummaries(
  left: CandidatePinSemanticSummary,
  right: CandidatePinSemanticSummary
): number {
  return compareCodepointStrings(JSON.stringify(left), JSON.stringify(right));
}
