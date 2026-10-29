import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { runTsContractGate } from "./index.ts";
import { lockedIntended } from "../native-test-helpers.ts";
import { TESTED_TYPESCRIPT_VERSION } from "./types.ts";

// These are gate unit tests with real files and a deliberately tiny Node
// compiler fixture. They establish inventory, configuration, and process
// wiring, not compatibility with TypeScript's native mapper implementation.
// Native compilation has a separate integration test owner.

const packageRoot = join(import.meta.dir, "../..");

type Config = {
  version: number;
  repoRoot: string;
  compiler: { package: string; version: string };
  projects: { name: string; tsconfig: string; include: string[]; exclude?: string[] }[];
};

type CompilerState = {
  files: string[];
  compilerOptions: Record<string, unknown>;
  references?: { path: string }[];
  check: { exitCode: number; stdout: string; stderr: string };
};

type Fixture = {
  root: string;
  configPath: string;
  config: Config;
  state: CompilerState;
  saveConfig: () => Promise<void>;
  saveState: () => Promise<void>;
  run: () => ReturnType<typeof runTsContractGate>;
};

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true }))
  );
});

async function put(root: string, path: string, text: string): Promise<void> {
  const absolute = join(root, path);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, text);
}

async function json(root: string, path: string, value: unknown): Promise<void> {
  await put(root, path, `${JSON.stringify(value, null, 2)}\n`);
}

function contract(source = "src/a.ts"): string {
  // The fixture implementation only returns a constant: no effect is hidden
  // by its empty effect summary. Type assertions belong to mapper tests.
  return `module app
component Api {
  fn f
    source ts("${source}#f")
    signature ts("() => number")
    effects complete {}
}
`;
}

function tsconfig(files = ["./src/a.ts", "./src/a.shape"]): Record<string, unknown> {
  return {
    compilerOptions: { strict: true, noEmit: true },
    contentMappers: [
      {
        package: "@shape/shp-ts-contract",
        extensions: [".shape"],
        options: { repoRoot: "." }
      }
    ],
    files
  };
}

async function fixture(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "shape-ts-gate-"));
  temporaryDirectories.push(root);
  const configPath = join(root, "shape-contract.json");
  const config: Config = {
    version: 1,
    repoRoot: ".",
    compiler: { package: "typescript", version: TESTED_TYPESCRIPT_VERSION },
    projects: [{ name: "app", tsconfig: "tsconfig.json", include: ["src/**/*.ts"] }]
  };
  const state: CompilerState = {
    files: ["./src/a.ts", "./src/a.shape"],
    compilerOptions: { strict: true },
    check: { exitCode: 0, stdout: "", stderr: "" }
  };
  await Promise.all([
    json(root, "shape-contract.json", config),
    json(root, "tsconfig.json", tsconfig()),
    json(root, "compiler-state.json", state),
    put(root, "src/a.ts", "export function f(): number { return 1; }\n"),
    put(root, "src/a.shape", contract()),
    mkdir(join(root, "node_modules/@shape"), { recursive: true }).then(() =>
      symlink(packageRoot, join(root, "node_modules/@shape/shp-ts-contract"), "junction")
    ),
    json(root, "node_modules/typescript/package.json", {
      name: "typescript",
      version: TESTED_TYPESCRIPT_VERSION,
      type: "commonjs",
      bin: { tsc: "./bin/tsc.cjs" }
    }),
    put(
      root,
      "node_modules/typescript/bin/tsc.cjs",
      `
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "../../..");
const args = process.argv.slice(2);
fs.appendFileSync(path.join(root, "compiler-log.jsonl"), JSON.stringify(args) + "\\n");
const state = JSON.parse(fs.readFileSync(path.join(root, "compiler-state.json"), "utf8"));
if (args.includes("--showConfig")) {
  process.stdout.write(JSON.stringify({ files: state.files, compilerOptions: state.compilerOptions, references: state.references }));
} else {
  process.stdout.write(state.check.stdout);
  process.stderr.write(state.check.stderr);
  process.exitCode = state.check.exitCode;
}
`
    )
  ]);
  return {
    root,
    configPath,
    config,
    state,
    saveConfig: () => json(root, "shape-contract.json", config),
    saveState: () => json(root, "compiler-state.json", state),
    run: () => runTsContractGate({ configPath, runExternalCode: true })
  };
}

async function compilerInvocations(root: string): Promise<string[][]> {
  const text = await readFile(join(root, "compiler-log.jsonl"), "utf8").catch(() => "");
  return text
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as string[]);
}

/** Configuration and inventory failures must stop before any mapper runs. */
async function expectNoNativeCheck(root: string): Promise<void> {
  const invocations = await compilerInvocations(root);
  expect(invocations.some((args) => args.includes("--noEmit"))).toBe(false);
}

function requireFailure(result: Awaited<ReturnType<typeof runTsContractGate>>, kind: string) {
  expect(result.ok).toBe(false);
  expect(result.exitCode).not.toBe(0);
  const diagnostic = result.diagnostics.find((entry) => entry.kind === kind);
  if (!diagnostic)
    throw new Error(`Missing diagnostic ${kind}: ${JSON.stringify(result.diagnostics)}`);
  expect(diagnostic.path.length).toBeGreaterThan(0);
  expect(diagnostic.message.length).toBeGreaterThan(0);
  return diagnostic;
}

describe("TypeScript contract gate unit tests", () => {
  test("runs the selected project compiler after checking both source and contract roots", async () => {
    const f = await fixture();
    const result = await f.run();
    expect(result).toMatchObject({ ok: true, exitCode: 0, diagnostics: [] });
    expect(result.projects).toHaveLength(1);
    expect(result.projects[0]?.name).toBe("app");
    expect(result.projects[0]?.sources).toHaveLength(1);
    const calls = await compilerInvocations(f.root);
    expect(calls.some((args) => args.includes("--showConfig"))).toBe(true);
    const checking = calls.filter((args) => !args.includes("--showConfig"));
    expect(checking).toHaveLength(1);
    expect(checking[0]).toContain("--noEmit");
    expect(checking[0]).toContain("--runExternalCode");
    expect(checking[0]).toContain(join(f.root, "tsconfig.json"));
  });

  test("requires external-code consent before starting the compiler", async () => {
    const f = await fixture();
    const result = await runTsContractGate({ configPath: f.configPath, runExternalCode: false });
    requireFailure(result, "consent_required");
    expect(await compilerInvocations(f.root)).toEqual([]);
  });

  test("preserves compiler diagnostics and nonzero status instead of replacing them with success", async () => {
    const f = await fixture();
    f.state.check = {
      exitCode: 2,
      stdout:
        "src/a.shape(3,7): error TS2344: Type 'false' does not satisfy the constraint 'true'.\n",
      stderr: "native compiler stderr\n"
    };
    await f.saveState();
    const result = await f.run();
    expect(result.ok).toBe(false);
    expect(result.exitCode).not.toBe(0);
    const output = result.nativeOutputs.find((entry) => entry.stage === "check");
    expect(output).toEqual({ project: "app", stage: "check", ...f.state.check });
  });

  test("requires a sibling contract for a newly added source outside the compiler inventory", async () => {
    const f = await fixture();
    await put(f.root, "src/new.ts", "export function fresh(): number { return 2; }\n");
    const diagnostic = requireFailure(await f.run(), "missing_contract");
    expect(diagnostic.path).toBe(join(f.root, "src/new.shape"));
    expect(diagnostic.causedBy.join("\n")).toContain("src/new.ts");
    await expectNoNativeCheck(f.root);
  });

  test("does not let Git ignore rules hide a governed source with no contract", async () => {
    const f = await fixture();
    const init = Bun.spawn(["git", "init", "--quiet", f.root], { stdout: "pipe", stderr: "pipe" });
    expect(await init.exited).toBe(0);
    await put(f.root, ".gitignore", "src/ignored.ts\n");
    await put(f.root, "src/ignored.ts", "export function ignored(): number { return 2; }\n");
    const ignored = Bun.spawn(["git", "check-ignore", "--quiet", "src/ignored.ts"], {
      cwd: f.root,
      stdout: "pipe",
      stderr: "pipe"
    });
    expect(await ignored.exited).toBe(0);
    const diagnostic = requireFailure(await f.run(), "missing_contract");
    expect(diagnostic.path).toBe(join(f.root, "src/ignored.shape"));
  });

  test("leaves explicitly excluded sources outside the contract requirement", async () => {
    const f = await fixture();
    f.config.projects[0]!.exclude = ["src/excluded/**"];
    await f.saveConfig();
    await put(
      f.root,
      "src/excluded/not-registered.ts",
      "This is deliberately invalid TypeScript.\n"
    );
    expect(await f.run()).toMatchObject({ ok: true, exitCode: 0, diagnostics: [] });
  });

  test("does not inspect a symbolic-link directory under an explicitly excluded subtree", async () => {
    const f = await fixture();
    f.config.projects[0]!.exclude = ["src/excluded/**"];
    await f.saveConfig();
    await put(f.root, "outside/unregistered.ts", "This is deliberately invalid TypeScript.\n");
    await symlink("../outside", join(f.root, "src/excluded"));
    const result = await f.run();
    expect(result).toMatchObject({ ok: true, exitCode: 0, diagnostics: [] });
    expect(result.projects[0]?.sources).toEqual([join(f.root, "src/a.ts")]);
  });

  test("does not census node_modules or Git internals as governed source files", async () => {
    const f = await fixture();
    f.config.projects[0]!.include = ["**/*.ts"];
    await f.saveConfig();
    await put(f.root, "node_modules/foreign/unregistered.ts", "export const dependency = 1;\n");
    await put(f.root, ".git/hidden.ts", "not source\n");
    const result = await f.run();
    expect(result).toMatchObject({ ok: true, exitCode: 0, diagnostics: [] });
    expect(result.projects[0]?.sources).toHaveLength(1);
  });

  // .tsx, .mts and .cts siblings are covered by the rename test below.
  test("rejects a selected declaration file", async () => {
    const f = await fixture();
    await put(f.root, "src/unsupported.d.ts", "export const unsupported = 1;\n");
    const diagnostic = requireFailure(await f.run(), "unsupported_source");
    expect(diagnostic.path).toBe(join(f.root, "src/unsupported.d.ts"));
  });

  test("requires project-local TypeScript rather than falling back to a global executable", async () => {
    const f = await fixture();
    await rm(join(f.root, "node_modules/typescript"), { recursive: true });
    requireFailure(await f.run(), "compiler_not_found");
    expect(await compilerInvocations(f.root)).toEqual([]);
  });

  test("rejects compiler metadata at a different version before invoking it", async () => {
    const f = await fixture();
    await json(f.root, "node_modules/typescript/package.json", {
      name: "typescript",
      version: "7.1.0-dev.20990101",
      bin: { tsc: "./bin/tsc.cjs" }
    });
    requireFailure(await f.run(), "compiler_version_mismatch");
    expect(await compilerInvocations(f.root)).toEqual([]);
  });

  test.each(["./src/a.ts", "./src/a.shape"])(
    "requires %s in the compiler's resolved root files",
    async (omitted) => {
      const f = await fixture();
      f.state.files = f.state.files.filter((path) => path !== omitted);
      await f.saveState();
      const diagnostic = requireFailure(
        await f.run(),
        omitted.endsWith(".shape") ? "contract_not_in_project" : "source_not_in_project"
      );
      expect(diagnostic.path).toBe(join(f.root, omitted));
      await expectNoNativeCheck(f.root);
    }
  );

  test("rejects additional .shape compiler roots outside the selected source inventory", async () => {
    const f = await fixture();
    await put(f.root, "outside/unselected.ts", "export function f(): number { return 1; }\n");
    await put(f.root, "outside/unselected.shape", contract("outside/unselected.ts"));
    f.state.files.push("./outside/unselected.ts", "./outside/unselected.shape");
    await f.saveState();
    const diagnostic = requireFailure(await f.run(), "unexpected_contract");
    expect(diagnostic.path).toBe(join(f.root, "outside/unselected.shape"));
    expect(diagnostic.causedBy).toContain(join(f.root, "tsconfig.json"));
    await expectNoNativeCheck(f.root);
  });

  test("requires a local mapper registration even when compiler roots include the contract", async () => {
    const f = await fixture();
    await json(f.root, "tsconfig.json", {
      compilerOptions: { strict: true },
      files: f.state.files
    });
    requireFailure(await f.run(), "invalid_mapper");
    await expectNoNativeCheck(f.root);
  });

  test.each([
    { package: "another-mapper", extensions: [".shape"], options: { repoRoot: "." } },
    { package: "@shape/shp-ts-contract", extensions: [".ts"], options: { repoRoot: "." } },
    {
      package: "@shape/shp-ts-contract",
      extensions: [".shape"],
      options: { repoRoot: ".", typo: true }
    },
    { package: "@shape/shp-ts-contract", extensions: [".shape"], options: { repoRoot: "src" } }
  ])("rejects ambiguous or incorrect mapper registration %#", async (mapper) => {
    const f = await fixture();
    await json(f.root, "tsconfig.json", { ...tsconfig(), contentMappers: [mapper] });
    requireFailure(await f.run(), "invalid_mapper");
    await expectNoNativeCheck(f.root);
  });

  test("rejects two registrations for the same .shape extension", async () => {
    const f = await fixture();
    const mapper = {
      package: "@shape/shp-ts-contract",
      extensions: [".shape"],
      options: { repoRoot: "." }
    };
    await json(f.root, "tsconfig.json", { ...tsconfig(), contentMappers: [mapper, mapper] });
    requireFailure(await f.run(), "invalid_mapper");
  });

  test(
    lockedIntended(
      "source anchors are read as the Shape parser decodes them, so a \\u escape cannot spell the sibling path",
      "contract-layout"
    ),
    async () => {
      const f = await fixture();
      await put(
        f.root,
        "src/a.shape",
        contract().replace('source ts("src/a.ts#f")', "source typescript('src/a.ts#f')")
      );
      expect(await f.run()).toMatchObject({ ok: true, exitCode: 0, diagnostics: [] });

      // An escape the Shape reader knows is compared after decoding: \a reads as a.
      await put(
        f.root,
        "src/a.shape",
        contract().replace('source ts("src/a.ts#f")', 'source ts("src/\\a.ts#f")')
      );
      expect(await f.run()).toMatchObject({ ok: true, exitCode: 0, diagnostics: [] });

      // \u and \x would decode to plain letters, so they are refused rather than misread.
      await put(
        f.root,
        "src/a.shape",
        contract().replace('source ts("src/a.ts#f")', 'source ts("src/\\u0061.ts#f")')
      );
      const diagnostic = requireFailure(await f.run(), "invalid_contract");
      expect(diagnostic.path).toBe(join(f.root, "src/a.shape"));
      expect(diagnostic.causedBy).toEqual([join(f.root, "src/a.ts")]);
      // The anchor's text starts at line 4, column 16 of the contract.
      expect(diagnostic.message).toStartWith(
        "4:16 shape-ts1003: Shape strings read \\u and \\x escapes"
      );
    }
  );

  test("rejects a contract that describes another source file", async () => {
    const f = await fixture();
    await put(f.root, "src/a.shape", contract("src/another.ts"));
    const diagnostic = requireFailure(await f.run(), "invalid_contract");
    expect(diagnostic.message).toContain(
      '4:16 shape-ts1003: Api.f needs a source anchor ts("src/a.ts#exportName")'
    );
    await expectNoNativeCheck(f.root);
  });

  test("does not turn this API-contract gate into an effects-completeness gate", async () => {
    const f = await fixture();
    await put(f.root, "src/a.shape", contract().replace("effects complete {}", "effects unknown"));
    expect(await f.run()).toMatchObject({ ok: true, exitCode: 0, diagnostics: [] });
  });

  test("rejects generated AST modules as a substitute for authored contracts", async () => {
    const f = await fixture();
    await put(
      f.root,
      "src/a.shape",
      contract().replace("module app", "module shape.generated.ast.app")
    );
    const diagnostic = requireFailure(await f.run(), "invalid_contract");
    expect(diagnostic.path).toBe(join(f.root, "src/a.shape"));
    expect(diagnostic.message).toStartWith("1:1 shape-ts1002: Generated AST drafts");
    await expectNoNativeCheck(f.root);
  });

  test.each([
    ["malformed JSON", '{"version":'],
    ["duplicate key", '{"version":1,"version":1}'],
    ["comments in strict JSON", '{/* comment */"version":1}'],
    [
      "unknown top-level key",
      JSON.stringify({ version: 1, repoRoot: ".", compiler: {}, projects: [], typo: true })
    ]
  ])("rejects %s without invoking the compiler", async (_label, source) => {
    const f = await fixture();
    await writeFile(f.configPath, source!);
    requireFailure(await f.run(), "invalid_config");
    expect(await compilerInvocations(f.root)).toEqual([]);
  });

  test("rejects project globs that escape the repository", async () => {
    const f = await fixture();
    f.config.projects[0]!.include = ["../outside/**/*.ts"];
    await f.saveConfig();
    requireFailure(await f.run(), "invalid_config");
    expect(await compilerInvocations(f.root)).toEqual([]);
  });

  test("accepts JSONC in tsconfig while keeping the authored gate configuration strict JSON", async () => {
    const f = await fixture();
    await put(
      f.root,
      "tsconfig.json",
      `// Native TypeScript configuration permits comments.\n${JSON.stringify(tsconfig(), null, 2).replace(/\n}$/, ",\n}")}\n`
    );
    expect(await f.run()).toMatchObject({ ok: true, exitCode: 0, diagnostics: [] });
  });

  // The options themselves are the mapper's shared predicate (protocol.test.ts); the gate
  // applies it to the resolved configuration before any mapper runs.
  test("rejects compiler options that disable contract checking", async () => {
    const f = await fixture();
    f.state.compilerOptions = { strict: false };
    await f.saveState();
    requireFailure(await f.run(), "invalid_compiler");
    await expectNoNativeCheck(f.root);
  });

  test("rejects module suffixes that can redirect a contract to a different implementation", async () => {
    const f = await fixture();
    f.state.compilerOptions.moduleSuffixes = [".native", ""];
    await f.saveState();
    const diagnostic = requireFailure(await f.run(), "invalid_compiler");
    expect(diagnostic.path).toBe(join(f.root, "tsconfig.json"));
    expect(diagnostic.message).toContain("different source file");
    await expectNoNativeCheck(f.root);
  });

  test("accepts an explicit unsuffixed-only module resolution setting", async () => {
    const f = await fixture();
    f.state.compilerOptions.moduleSuffixes = [""];
    await f.saveState();
    expect(await f.run()).toMatchObject({ ok: true, exitCode: 0, diagnostics: [] });
    expect((await compilerInvocations(f.root)).some((args) => args.includes("--noEmit"))).toBe(
      true
    );
  });

  test("rejects an empty governed selection rather than silently approving a misspelled glob", async () => {
    const f = await fixture();
    f.config.projects[0]!.include = ["source/**/*.ts"];
    await f.saveConfig();
    const diagnostic = requireFailure(await f.run(), "empty_selection");
    expect(diagnostic.path).toBe(join(f.root, "tsconfig.json"));
  });

  test.each(["src/a.ts", "src/a.shape"])(
    "rejects symbolic-link substitution of %s",
    async (path) => {
      const f = await fixture();
      const original = await readFile(join(f.root, path), "utf8");
      await put(f.root, "other-file", original);
      await rm(join(f.root, path));
      await symlink("../other-file", join(f.root, path));
      const diagnostic = requireFailure(await f.run(), "unsafe_path");
      expect(diagnostic.path).toBe(join(f.root, path));
    }
  );

  test("returns source inventory in a stable order independent of file creation and compiler order", async () => {
    const f = await fixture();
    for (const name of ["z", "b"]) {
      await put(f.root, `src/${name}.ts`, "export function f(): number { return 1; }\n");
      await put(f.root, `src/${name}.shape`, contract(`src/${name}.ts`));
      f.state.files.unshift(`./src/${name}.shape`, `./src/${name}.ts`);
    }
    await f.saveState();
    const result = await f.run();
    expect(result).toMatchObject({ ok: true, exitCode: 0, diagnostics: [] });
    expect(result.projects[0]?.sources).toEqual(
      ["a", "b", "z"].map((name) => join(f.root, `src/${name}.ts`))
    );
  });

  test("resolves gate repoRoot from its config and mapper repoRoot from the tsconfig directory", async () => {
    const f = await fixture();
    f.config.repoRoot = "..";
    f.config.projects[0]!.tsconfig = "configs/tsconfig.json";
    f.state.files = ["../src/a.ts", "../src/a.shape"];
    await f.saveState();
    await json(f.root, "configs/shape-contract.json", f.config);
    await json(f.root, "configs/tsconfig.json", {
      ...tsconfig(f.state.files),
      contentMappers: [
        {
          package: "@shape/shp-ts-contract",
          extensions: [".shape"],
          options: { repoRoot: ".." }
        }
      ]
    });
    const result = await runTsContractGate({
      configPath: join(f.root, "configs/shape-contract.json"),
      runExternalCode: true
    });
    expect(result).toMatchObject({ ok: true, exitCode: 0, diagnostics: [] });
    expect(result.projects[0]?.sources).toEqual([join(f.root, "src/a.ts")]);
  });

  test("completes every project's inventory before invoking any native mapper", async () => {
    const f = await fixture();
    f.config.projects.push({
      name: "other",
      tsconfig: "other/tsconfig.json",
      include: ["other/**/*.ts"]
    });
    await f.saveConfig();
    await put(f.root, "other/new.ts", "export function fresh(): number { return 2; }\n");
    const diagnostic = requireFailure(await f.run(), "missing_contract");
    expect(diagnostic.path).toBe(join(f.root, "other/new.shape"));
    const calls = await compilerInvocations(f.root);
    expect(calls.some((args) => args.includes("--showConfig"))).toBe(true);
    expect(calls.some((args) => args.includes("--noEmit"))).toBe(false);
  });

  test.each([".tsx", ".mts", ".cts"])(
    lockedIntended(
      "a .ts selector still reports a selected file renamed to %s",
      "selected-source-gate"
    ),
    async (extension) => {
      const f = await fixture();
      await put(
        f.root,
        `src/renamed${extension}`,
        "export function renamed(): number { return 1; }\n"
      );
      const diagnostic = requireFailure(await f.run(), "unsupported_source");
      expect(diagnostic.path).toBe(join(f.root, `src/renamed${extension}`));
      expect(diagnostic.causedBy).toEqual([join(f.root, "tsconfig.json")]);
      expect(await compilerInvocations(f.root)).toEqual([]);
    }
  );

  test(
    lockedIntended(
      "explicit excludes keep .tsx, .mts and .cts files out of a .ts selector",
      "selected-source-gate"
    ),
    async () => {
      const f = await fixture();
      f.config.projects[0]!.exclude = ["src/**/*.tsx", "src/**/*.mts", "src/**/*.cts"];
      await f.saveConfig();
      for (const extension of [".tsx", ".mts", ".cts"])
        await put(
          f.root,
          `src/renamed${extension}`,
          "export function renamed(): number { return 1; }\n"
        );
      const result = await f.run();
      expect(result).toMatchObject({ ok: true, exitCode: 0, diagnostics: [] });
      expect(result.projects[0]?.sources).toEqual([join(f.root, "src/a.ts")]);
    }
  );

  test(
    lockedIntended(
      "only a JavaScript compiler root in the selected tree is unsupported, until it is excluded",
      "selected-source-gate"
    ),
    async () => {
      const f = await fixture();
      // Without allowJs a JavaScript file is no compiler root, so even a link is not governed.
      await put(f.root, "vendor/bundle.js", "export function bundled() { return 1; }\n");
      await symlink("../vendor/bundle.js", join(f.root, "src/vendor.js"));
      expect(await f.run()).toMatchObject({ ok: true, exitCode: 0, diagnostics: [] });
      await rm(join(f.root, "compiler-log.jsonl"));

      await put(f.root, "src/legacy.js", "export function legacy() { return 1; }\n");
      await put(f.root, "tools/build.js", "export function build() { return 1; }\n");
      f.state.files.push("./src/legacy.js", "./tools/build.js");
      await f.saveState();
      const diagnostic = requireFailure(await f.run(), "unsupported_source");
      expect(diagnostic.path).toBe(join(f.root, "src/legacy.js"));
      expect(diagnostic.causedBy).toEqual([join(f.root, "tsconfig.json")]);
      await expectNoNativeCheck(f.root);

      // tools/build.js stays a root outside the selected tree and is not reported.
      f.config.projects[0]!.exclude = ["src/**/*.js"];
      await f.saveConfig();
      expect(await f.run()).toMatchObject({ ok: true, exitCode: 0, diagnostics: [] });
    }
  );

  test(
    lockedIntended("two projects may not claim the same source", "selected-source-gate"),
    async () => {
      const f = await fixture();
      f.config.projects.push({ name: "other", tsconfig: "other.json", include: ["src/a.ts"] });
      await f.saveConfig();
      await json(f.root, "other.json", tsconfig());
      const diagnostic = requireFailure(await f.run(), "ambiguous_project");
      expect(diagnostic.path).toBe(join(f.root, "src/a.ts"));
      expect(diagnostic.causedBy).toEqual([f.configPath]);
      expect(diagnostic.message).toContain("both app and other");
      await expectNoNativeCheck(f.root);
    }
  );

  // The compiler loads the nearest linked directory itself. tsconfig paths and package
  // exports redirect module resolution only, so neither may hide a stale link.
  test.each(["a plain link", "a tsconfig paths alias", "a package exports map"])(
    lockedIntended(
      "the project must link the mapper package this gate runs from, despite %s",
      "opt-in"
    ),
    async (variant) => {
      const f = await fixture();
      const link = join(f.root, "node_modules/@shape/shp-ts-contract");
      await rm(link);
      const foreign = join(f.root, "other-checkout");
      await json(f.root, "other-checkout/package.json", {
        name: "@shape/shp-ts-contract",
        version: "0.0.0",
        ...(variant === "a package exports map"
          ? { exports: { "./package.json": "./current/package.json" } }
          : {})
      });
      await symlink(packageRoot, join(foreign, "current"), "junction");
      await symlink(foreign, link, "junction");
      if (variant === "a tsconfig paths alias") {
        await json(f.root, "tsconfig.json", {
          ...tsconfig(),
          compilerOptions: {
            strict: true,
            noEmit: true,
            paths: { "@shape/*": [join(dirname(packageRoot), "*")] }
          }
        });
      }
      const diagnostic = requireFailure(await f.run(), "invalid_mapper");
      expect(diagnostic.path).toBe(join(f.root, "tsconfig.json"));
      expect(diagnostic.message).toContain(await realpath(foreign));
      expect(diagnostic.message).toContain(await realpath(packageRoot));
      expect(await compilerInvocations(f.root)).toEqual([]);
    }
  );

  test(
    lockedIntended(
      "project references are rejected before native checking",
      "selected-source-gate"
    ),
    async () => {
      const f = await fixture();
      f.state.references = [{ path: "../core" }];
      await f.saveState();
      const diagnostic = requireFailure(await f.run(), "invalid_compiler");
      expect(diagnostic.path).toBe(join(f.root, "tsconfig.json"));
      expect(diagnostic.message).toMatch(/references/);
      await expectNoNativeCheck(f.root);
    }
  );
});
