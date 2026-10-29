import { expect, test } from "bun:test";
import { symlink } from "node:fs/promises";
import { createRequire } from "node:module";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { contract, NativeFixture } from "../native-test-helpers.ts";
import { captureProcess } from "./process.ts";

test("[locked-intended] the CLI gates a real native project and newly ignored files — anchor: docs-site/src/content/docs/reference/typescript-content-mapping.md#selected-source-gate", async () => {
  const fixture = await NativeFixture.create();
  try {
    const typescriptRoot = dirname(
      createRequire(import.meta.url).resolve("typescript/package.json")
    );
    await symlink(typescriptRoot, join(fixture.root, "node_modules/typescript"), "junction");
    await fixture.write("src/math.ts", "export function answer(): number { return 42; }\n");
    await fixture.write(
      "src/math.shape",
      contract([{ name: "answer", signature: "() => number" }])
    );
    await fixture.write(".gitignore", "src/ignored.ts\n");
    await fixture.write(
      "shape-contract.json",
      JSON.stringify({
        version: 1,
        repoRoot: ".",
        compiler: { package: "typescript", version: "7.1.0-beta" },
        projects: [{ name: "app", tsconfig: "tsconfig.json", include: ["src/**/*.ts"] }]
      })
    );
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
  } finally {
    await fixture.close();
  }
}, 30_000);
