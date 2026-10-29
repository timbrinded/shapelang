import { expect } from "bun:test";
import { mkdir, mkdtemp, open, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";

const packageRoot = resolve(import.meta.dir, "..");
const requireFromPackage = createRequire(join(packageRoot, "package.json"));

export interface NativeDiagnostic {
  file: string | undefined;
  line: number | undefined;
  column: number | undefined;
  code: string;
  message: string;
}

export interface NativeResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  diagnostics: NativeDiagnostic[];
}

export interface ContractEntry {
  name: string;
  exported?: string;
  signature: string;
  effects?: "unknown" | "complete {}";
}

export function contract(entries: ContractEntry[], prefix = ""): string {
  return `${prefix}module native.contract\n\ncomponent Math {\n${entries
    .map(
      (entry) =>
        `  fn ${entry.name}\n` +
        `    source ts(${JSON.stringify(`src/math.ts#${entry.exported ?? entry.name}`)})\n` +
        `    signature ts(${JSON.stringify(entry.signature)})\n` +
        `    effects ${entry.effects ?? "unknown"}`
    )
    .join("\n")}\n}\n`;
}

export function parseNativeDiagnostics(output: string): NativeDiagnostic[] {
  const diagnostics: NativeDiagnostic[] = [];
  for (const line of output.split(/\r?\n/)) {
    const located = /^(.*?)\((\d+),(\d+)\): error ([A-Za-z][\w-]*\d+): (.*)$/.exec(line);
    if (located) {
      diagnostics.push({
        file: located[1]?.replaceAll("\\", "/"),
        line: Number(located[2]),
        column: Number(located[3]),
        code: located[4] ?? "",
        message: located[5] ?? ""
      });
      continue;
    }
    const unlocated = /^error ([A-Za-z][\w-]*\d+): (.*)$/.exec(line);
    if (unlocated) {
      diagnostics.push({
        file: undefined,
        line: undefined,
        column: undefined,
        code: unlocated[1] ?? "",
        message: unlocated[2] ?? ""
      });
    }
  }
  return diagnostics;
}

export async function nativeCompiler(): Promise<{ node: string; bin: string }> {
  const node = Bun.which("node");
  if (!node) throw new Error("Native contract tests require Node 24 or later on PATH.");
  let metadataPath: string;
  try {
    metadataPath = requireFromPackage.resolve("typescript/package.json");
  } catch {
    throw new Error(
      "Native contract tests require the package-local typescript@7.1.0-beta dependency; run bun install."
    );
  }
  const metadata: unknown = JSON.parse(await readFile(metadataPath, "utf8"));
  if (typeof metadata !== "object" || metadata === null) {
    throw new Error("The selected TypeScript package has invalid metadata.");
  }
  const fields = metadata as Record<string, unknown>;
  if (fields.version !== "7.1.0-beta") {
    throw new Error(
      `Native contract tests require TypeScript 7.1.0-beta; found ${String(fields.version)}.`
    );
  }
  const bin = fields.bin;
  const relativeBin =
    typeof bin === "string"
      ? bin
      : typeof bin === "object" && bin !== null
        ? (bin as Record<string, unknown>).tsc
        : undefined;
  if (typeof relativeBin !== "string") {
    throw new Error("The selected TypeScript package does not declare its tsc executable.");
  }
  return { node, bin: resolve(dirname(metadataPath), relativeBin) };
}

export class NativeFixture {
  readonly buildInfo: string;

  private constructor(
    readonly root: string,
    private readonly compiler: { node: string; bin: string }
  ) {
    this.buildInfo = join(root, "native.tsbuildinfo");
  }

  static async create(files = ["src/math.ts", "src/math.shape"]): Promise<NativeFixture> {
    const compiler = await nativeCompiler();
    const root = await mkdtemp(join(tmpdir(), "shape-native-contract-"));
    const fixture = new NativeFixture(root, compiler);
    await mkdir(join(root, "src"), { recursive: true });
    await mkdir(join(root, "node_modules/@shape"), { recursive: true });
    await mkdir(join(root, "bin"), { recursive: true });
    await symlink(packageRoot, join(root, "node_modules/@shape/shp-ts-contract"), "junction");
    await symlink(
      process.execPath,
      join(root, "bin", process.platform === "win32" ? "bun.exe" : "bun"),
      "file"
    );
    await fixture.write(
      "package.json",
      JSON.stringify({ name: "shape-native-fixture", private: true, type: "module" })
    );
    await fixture.write(
      "tsconfig.json",
      JSON.stringify(
        {
          compilerOptions: {
            target: "ES2022",
            module: "NodeNext",
            moduleResolution: "NodeNext",
            strict: true,
            noEmit: true,
            noUnusedLocals: true,
            noUnusedParameters: true,
            types: []
          },
          contentMappers: [
            {
              package: "@shape/shp-ts-contract",
              extensions: [".shape"],
              options: { repoRoot: "." }
            }
          ],
          files
        },
        null,
        2
      )
    );
    return fixture;
  }

  async write(path: string, text: string): Promise<void> {
    const target = join(this.root, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, text);
  }

  async remove(path: string): Promise<void> {
    await rm(join(this.root, path), { force: true });
  }

  async check(options: { external?: boolean; incremental?: boolean } = {}): Promise<NativeResult> {
    const args = [
      this.compiler.node,
      this.compiler.bin,
      "--pretty",
      "false",
      "--project",
      join(this.root, "tsconfig.json")
    ];
    if (options.external !== false) args.push("--runExternalCode");
    if (options.incremental) args.push("--incremental", "--tsBuildInfoFile", this.buildInfo);
    const stdoutPath = join(this.root, "compiler.stdout");
    const stderrPath = join(this.root, "compiler.stderr");
    const stdoutFile = await open(stdoutPath, "w");
    const stderrFile = await open(stderrPath, "w");
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const child = Bun.spawn(args, {
        cwd: this.root,
        env: {
          ...process.env,
          PATH: `${join(this.root, "bin")}${delimiter}${process.env.PATH ?? ""}`
        },
        stdout: stdoutFile.fd,
        stderr: stderrFile.fd
      });
      timeout = setTimeout(() => child.kill(), 20_000);
      const exitCode = await child.exited;
      const [stdout, stderr] = await Promise.all([
        readFile(stdoutPath, "utf8"),
        readFile(stderrPath, "utf8")
      ]);
      return {
        exitCode,
        stdout,
        stderr,
        diagnostics: parseNativeDiagnostics(`${stdout}\n${stderr}`)
      };
    } finally {
      clearTimeout(timeout);
      await Promise.all([stdoutFile.close(), stderrFile.close()]);
    }
  }

  async close(): Promise<void> {
    await rm(this.root, { recursive: true, force: true });
  }
}

export function expectNativePass(result: NativeResult): void {
  expect(result.stderr).toBe("");
  expect(result.diagnostics).toEqual([]);
  expect(result.stdout).toBe("");
  expect(result.exitCode).toBe(0);
}

export function requireNativeDiagnostic(
  result: NativeResult,
  predicate: (diagnostic: NativeDiagnostic) => boolean
): NativeDiagnostic {
  expect(result.exitCode).not.toBe(0);
  const diagnostic = result.diagnostics.find(predicate);
  if (!diagnostic) {
    throw new Error(`Expected native diagnostic was absent.\n${result.stdout}\n${result.stderr}`);
  }
  return diagnostic;
}

export function requireContractFailure(result: NativeResult): NativeDiagnostic {
  return requireNativeDiagnostic(
    result,
    (diagnostic) =>
      diagnostic.file === "src/math.shape" &&
      (diagnostic.code.startsWith("TS") || diagnostic.code.startsWith("shape-ts"))
  );
}
