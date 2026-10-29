import { expect } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { resolveCompiler, type Compiler } from "./gate/compiler.ts";
import { captureProcess } from "./gate/process.ts";

const packageRoot = resolve(import.meta.dir, "..");
const reference = "docs-site/src/content/docs/reference/typescript-content-mapping.md";

/** TESTING.md label for a law stated in a section of the content-mapping reference. */
export function lockedIntended(title: string, section: string): string {
  return `[locked-intended] ${title} — anchor: ${reference}#${section}`;
}

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

interface ContractEntry {
  name: string;
  exported?: string;
  signature: string;
}

export function contract(entries: ContractEntry[]): string {
  return `module native.contract\n\ncomponent Math {\n${entries
    .map(
      (entry) =>
        `  fn ${entry.name}\n` +
        `    source ts(${JSON.stringify(`src/math.ts#${entry.exported ?? entry.name}`)})\n` +
        `    signature ts(${JSON.stringify(entry.signature)})\n` +
        "    effects unknown"
    )
    .join("\n")}\n}\n`;
}

function parseNativeDiagnostics(output: string): NativeDiagnostic[] {
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

/** A temporary project for the pinned compiler; declare it with `await using`. */
export class NativeFixture {
  private constructor(
    readonly root: string,
    private readonly compiler: Compiler
  ) {}

  /** `config.compilerOptions` entries override the defaults; an `undefined` value omits one. */
  static async create(
    files = ["src/math.ts", "src/math.shape"],
    config: { extends?: string; compilerOptions?: Record<string, unknown> } = {}
  ): Promise<NativeFixture> {
    // The package's own pinned compiler, located and validated as the gate does.
    const compiler = await resolveCompiler(join(packageRoot, "package.json"));
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
          extends: config.extends,
          compilerOptions: {
            target: "ES2022",
            module: "NodeNext",
            moduleResolution: "NodeNext",
            strict: true,
            noEmit: true,
            noUnusedLocals: true,
            noUnusedParameters: true,
            types: [],
            ...config.compilerOptions
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
      this.compiler.wrapper,
      "--pretty",
      "false",
      "--project",
      join(this.root, "tsconfig.json")
    ];
    if (options.external !== false) args.push("--runExternalCode");
    if (options.incremental) {
      args.push("--incremental", "--tsBuildInfoFile", join(this.root, "native.tsbuildinfo"));
    }
    // The mapper is launched as `bun`; the fixture's bin directory provides this runtime.
    const output = await captureProcess(this.compiler.node, args, this.root, {
      timeoutMs: 20_000,
      env: {
        ...process.env,
        PATH: `${join(this.root, "bin")}${delimiter}${process.env.PATH ?? ""}`
      }
    });
    return { ...output, diagnostics: parseNativeDiagnostics(`${output.stdout}\n${output.stderr}`) };
  }

  async [Symbol.asyncDispose](): Promise<void> {
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

function expectedPosition(text: string, needle: string): { line: number; column: number } {
  const offset = text.indexOf(needle);
  if (offset < 0) throw new Error(`Fixture does not contain ${JSON.stringify(needle)}.`);
  const preceding = text.slice(0, offset);
  return { line: preceding.split("\n").length, column: offset - preceding.lastIndexOf("\n") };
}

export function diagnosticAt(result: NativeResult, text: string, needle: string): NativeDiagnostic {
  const at = expectedPosition(text, needle);
  return requireNativeDiagnostic(
    result,
    (item) => item.file === "src/math.shape" && item.line === at.line && item.column === at.column
  );
}

/** A mismatch names the export and prints the found and reviewed types side by side. */
export function expectSignatureFailure(
  result: NativeResult,
  text: string,
  signature: string,
  exported = "answer"
): NativeDiagnostic {
  const diagnostic = diagnosticAt(result, text, signature);
  expect(diagnostic.code).toBe("TS2344");
  expect(diagnostic.message).toMatch(
    new RegExp(
      `^Type '\\{ export: ${JSON.stringify(exported)}; signature: .*; exact: false; \\}' does not satisfy the constraint '\\{ export: ${JSON.stringify(exported)}; signature: .*; exact: true; \\}'`
    )
  );
  return diagnostic;
}

/** File-level coverage failures sit at the contract's start and list every offending export. */
export function expectCoverageFailure(
  result: NativeResult,
  label: "unregisteredCallableExports" | "uncertainExportTypes",
  exported: string[]
): NativeDiagnostic {
  const diagnostic = requireNativeDiagnostic(
    result,
    (item) => item.file === "src/math.shape" && item.message.startsWith(`Type '{ ${label}: `)
  );
  expect(diagnostic.code).toBe("TS2344");
  expect({ line: diagnostic.line, column: diagnostic.column }).toEqual({ line: 1, column: 1 });
  const listed = new RegExp(
    `^Type '\\{ ${label}: (.*); \\}' does not satisfy the constraint 'true'\\.$`
  ).exec(diagnostic.message)?.[1];
  expect(listed?.split(" | ").sort()).toEqual(exported.map((name) => JSON.stringify(name)).sort());
  return diagnostic;
}
