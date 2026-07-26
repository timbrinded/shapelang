import { checkShapeModules, parseShapeModule } from "../../../packages/shp-checker/src/index.ts";
import { createKernelRequestV1, parseKernelResponseV1 } from "./protocol.ts";
import { loadWasmKernel, runNativeKernel, wasmBinary } from "./runtime.ts";

const SAMPLE_COUNTS = [1, 100, 1000] as const;
const ACTUAL = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const EXPECTED = "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const wasm = await loadWasmKernel();

console.log("| candidate pins | TypeScript full check | native JSON process | WASM JSON call |");
console.log("| ---: | ---: | ---: | ---: |");

for (const count of SAMPLE_COUNTS) {
  const source = benchmarkShapeSource(count);
  const initial = checkSource(source, count);
  const requestJson = JSON.stringify(createKernelRequestV1(initial.facts));

  const typescriptMs = await medianDuration(7, 2, () => {
    checkSource(source, count);
  });
  const nativeMs = await medianDuration(5, 1, async () => {
    const result = await runNativeKernel(requestJson);
    if (result.exitCode !== 0) {
      throw new Error(result.stderr);
    }
    assertDiagnosticCount(result.stdout, count);
  });
  const wasmMs = await medianDuration(21, 3, () => {
    assertDiagnosticCount(wasm.check_facts_json(requestJson), count);
  });

  console.log(
    `| ${count.toLocaleString("en-GB")} | ${formatMs(typescriptMs)} | ${formatMs(nativeMs)} | ${formatMs(wasmMs)} |`
  );
}

console.log("");
console.log(`WASM artifact: ${(Bun.file(wasmBinary).size / 1024).toFixed(1)} KiB`);
console.log(`Bun ${Bun.version}; ${process.platform} ${process.arch}`);

function checkSource(source: string, expectedDiagnostics: number) {
  const parsed = parseShapeModule(source, "benchmark.shape");
  if (!parsed.ok) {
    throw new Error(parsed.diagnostics.map((diagnostic) => diagnostic.message).join("\n"));
  }
  const result = checkShapeModules([{ module: parsed.module, filePath: "benchmark.shape" }], {
    enforceBindings: false,
    includeFacts: true
  });
  const diagnosticCount = result.diagnostics.filter(
    (diagnostic) => diagnostic.kind === "candidate_pin_fingerprint_mismatch"
  ).length;
  if (diagnosticCount !== expectedDiagnostics || !result.facts) {
    throw new Error(
      `Expected ${expectedDiagnostics} candidate pin diagnostics, got ${diagnosticCount}.`
    );
  }
  return { facts: result.facts };
}

function assertDiagnosticCount(json: string, expected: number): void {
  const response = parseKernelResponseV1(json);
  if (response.diagnostics.length !== expected) {
    throw new Error(`Expected ${expected} kernel diagnostics, got ${response.diagnostics.length}.`);
  }
}

async function medianDuration(
  samples: number,
  warmups: number,
  operation: () => void | Promise<void>
): Promise<number> {
  for (let index = 0; index < warmups; index += 1) {
    await operation();
  }
  const durations: number[] = [];
  for (let index = 0; index < samples; index += 1) {
    const startedAt = performance.now();
    await operation();
    durations.push(performance.now() - startedAt);
  }
  durations.sort((left, right) => left - right);
  const middle = durations[Math.floor(durations.length / 2)];
  if (middle === undefined) {
    throw new Error("Benchmark requires at least one sample.");
  }
  return middle;
}

function formatMs(duration: number): string {
  return `${duration.toFixed(duration < 1 ? 3 : 2)} ms`;
}

function benchmarkShapeSource(candidateCount: number): string {
  const candidates = Array.from({ length: candidateCount }, (_, index) => {
    const name = `Candidate${index.toString().padStart(5, "0")}`;
    return `
effect candidate ${name} {
  fn Store.append
  effect Append<Event>
  source ts("src/store.ts:1-3")
  confidence low
  pin Anchor fingerprint ast.semantic_subtree_v1("${EXPECTED}")
}`;
  }).join("\n");

  return `module benchmark

resource Event

resource Anchor {
  fingerprint ast.semantic_subtree_v1("${ACTUAL}")
}

component Store {
  grants Append<Event>
  fn append
    effects complete {
      Append<Event>
    }
}
${candidates}
`;
}
