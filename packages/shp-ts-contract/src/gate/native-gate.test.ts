import { expect, test } from "bun:test";
import { symlink } from "node:fs/promises";
import { createRequire } from "node:module";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { contract, lockedIntended, NativeFixture } from "../native-test-helpers.ts";
import { runTsContractGate } from "./index.ts";
import { captureProcess } from "./process.ts";
import { TESTED_TYPESCRIPT_VERSION } from "./types.ts";

/** A gate project on the real pinned compiler with a reviewed contract for `answer`. */
async function gateFixture(
  config?: Parameters<typeof NativeFixture.create>[1]
): Promise<NativeFixture> {
  const fixture = await NativeFixture.create(undefined, config);
  const typescriptRoot = dirname(createRequire(import.meta.url).resolve("typescript/package.json"));
  await symlink(typescriptRoot, join(fixture.root, "node_modules/typescript"), "junction");
  await fixture.write("src/math.shape", contract([{ name: "answer", signature: "() => number" }]));
  await fixture.write(
    "shape-contract.json",
    JSON.stringify({
      version: 1,
      repoRoot: ".",
      compiler: { package: "typescript", version: TESTED_TYPESCRIPT_VERSION },
      projects: [{ name: "app", tsconfig: "tsconfig.json", include: ["src/**/*.ts"] }]
    })
  );
  return fixture;
}

/** The mapper is launched as `bun`; the fixture's bin directory provides it. */
async function runGate(fixture: NativeFixture): ReturnType<typeof runTsContractGate> {
  const path = process.env.PATH;
  process.env.PATH = `${join(fixture.root, "bin")}${delimiter}${path ?? ""}`;
  try {
    return await runTsContractGate({
      configPath: join(fixture.root, "shape-contract.json"),
      runExternalCode: true
    });
  } finally {
    process.env.PATH = path;
  }
}

test(
  lockedIntended(
    "the CLI gates a real native project and newly ignored files",
    "selected-source-gate"
  ),
  async () => {
    await using fixture = await gateFixture();
    await fixture.write("src/math.ts", "export function answer(): number { return 42; }\n");
    await fixture.write(".gitignore", "src/ignored.ts\n");
    const cliPath = fileURLToPath(new URL("../../../shp-cli/src/index.ts", import.meta.url));
    const command = [
      process.execPath,
      cliPath,
      "ts-contract",
      "--config",
      join(fixture.root, "shape-contract.json"),
      "--run-external-code"
    ];
    await fixture.write(
      "run-cli.ts",
      [
        `process.env.PATH = ${JSON.stringify(`${join(fixture.root, "bin")}${delimiter}${process.env.PATH ?? ""}`)};`,
        `process.argv = ${JSON.stringify(command)};`,
        `await import(${JSON.stringify(cliPath)});`
      ].join("\n")
    );
    const run = () =>
      captureProcess(process.execPath, [join(fixture.root, "run-cli.ts")], fixture.root);
    const matching = await run();
    expect(matching.exitCode).toBe(0);
    expect(matching.stderr).toBe("");
    expect(matching.stdout).toContain("1");

    await fixture.write("src/math.ts", "export function answer(): string { return 'changed'; }\n");
    const mismatch = await run();
    expect(mismatch.exitCode).not.toBe(0);
    expect(mismatch.stdout + mismatch.stderr).toContain("src/math.shape(");
    expect(mismatch.stdout + mismatch.stderr).toContain("TS2344");

    await fixture.write("src/ignored.ts", "export const newlyAdded = () => true;\n");
    const missing = await run();
    expect(missing.exitCode).not.toBe(0);
    expect(missing.stderr).toContain("missing_contract");
    expect(missing.stderr).toContain("src/ignored.shape");
    expect(missing.stdout + missing.stderr).not.toContain("TS2344");
  },
  30_000
);

test(
  lockedIntended(
    "an omitted strict setting is accepted because TypeScript 7 checks strictly by default",
    "selected-source-gate"
  ),
  async () => {
    await using fixture = await gateFixture({ compilerOptions: { strict: undefined } });
    await fixture.write("src/math.ts", "export function answer(): number { return 42; }\n");
    const matching = await runGate(fixture);
    expect(matching).toMatchObject({ ok: true, exitCode: 0, diagnostics: [] });
    expect(matching.nativeOutputs.find((output) => output.stage === "check")?.exitCode).toBe(0);

    // number | undefined differs from number only under strictNullChecks, so this
    // failure shows that strict checking is in force without the strict key.
    await fixture.write(
      "src/math.ts",
      "export function answer(): number | undefined { return 42; }\n"
    );
    const drift = await runGate(fixture);
    expect(drift.diagnostics.map((diagnostic) => diagnostic.kind)).toEqual(["compiler_failed"]);
    const check = drift.nativeOutputs.find((output) => output.stage === "check");
    expect(check?.exitCode).not.toBe(0);
    expect(check?.stdout).toMatch(/^src\/math\.shape\(\d+,\d+\): error TS2344: /m);
  },
  60_000
);

test(
  lockedIntended(
    "an inherited strictNullChecks: false is rejected before native checking",
    "selected-source-gate"
  ),
  async () => {
    await using fixture = await gateFixture({
      extends: "./tsconfig.base.json",
      compilerOptions: { strict: undefined }
    });
    await fixture.write(
      "tsconfig.base.json",
      JSON.stringify({ compilerOptions: { strictNullChecks: false } })
    );
    await fixture.write("src/math.ts", "export function answer(): number { return 42; }\n");
    const result = await runGate(fixture);
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({
      kind: "invalid_compiler",
      path: join(fixture.root, "tsconfig.json")
    });
    expect(result.diagnostics[0]?.message).toContain("strictNullChecks");
    expect(result.nativeOutputs.some((output) => output.stage === "check")).toBe(false);
  },
  60_000
);
