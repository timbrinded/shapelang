import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const semanticKernelRoot = join(import.meta.dir, "..");
const nativeBinary = join(
  semanticKernelRoot,
  "target",
  "release",
  process.platform === "win32" ? "shape-semantic-kernel.exe" : "shape-semantic-kernel"
);
const wasmDirectory = join(semanticKernelRoot, "target", "wasm-web");
export const wasmBinary = join(wasmDirectory, "shape_semantic_kernel_bg.wasm");
export const wasmTypeDeclarations = join(wasmDirectory, "shape_semantic_kernel.d.ts");

export type NativeKernelResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type WasmKernelBindings = {
  default(input: { module_or_path: ArrayBuffer }): Promise<unknown>;
  check_facts_json(input: string): string;
};

let wasmBindingsPromise: Promise<WasmKernelBindings> | undefined;

export async function runNativeKernel(input: string): Promise<NativeKernelResult> {
  if (!existsSync(nativeBinary)) {
    throw new Error(`Native semantic kernel not built: ${nativeBinary}`);
  }
  const child = Bun.spawn([nativeBinary], {
    cwd: semanticKernelRoot,
    stdin: new Blob([input]),
    stdout: "pipe",
    stderr: "pipe"
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text()
  ]);
  return { exitCode, stdout, stderr };
}

export function loadWasmKernel(): Promise<WasmKernelBindings> {
  wasmBindingsPromise ??= loadWasmKernelUncached();
  return wasmBindingsPromise;
}

async function loadWasmKernelUncached(): Promise<WasmKernelBindings> {
  const modulePath = join(wasmDirectory, "shape_semantic_kernel.js");
  if (!existsSync(modulePath) || !existsSync(wasmBinary)) {
    throw new Error(`Browser-targeted semantic kernel not built: ${wasmDirectory}`);
  }
  const loaded: unknown = await import(pathToFileURL(modulePath).href);
  if (!isWasmKernelBindings(loaded)) {
    throw new Error("Generated wasm-bindgen module does not expose the expected bindings.");
  }
  await loaded.default({ module_or_path: await Bun.file(wasmBinary).arrayBuffer() });
  return loaded;
}

function isWasmKernelBindings(value: unknown): value is WasmKernelBindings {
  return (
    typeof value === "object" &&
    value !== null &&
    "default" in value &&
    typeof value.default === "function" &&
    "check_facts_json" in value &&
    typeof value.check_facts_json === "function"
  );
}
