import { describe, expect, test } from "bun:test";
import {
  contract,
  expectNativePass,
  NativeFixture,
  requireContractFailure,
  requireNativeDiagnostic,
  type NativeDiagnostic,
  type NativeResult
} from "./native-test-helpers.js";

const reference = "docs-site/src/content/docs/reference/typescript-content-mapping.md";
const invariant = (title: string, section: string): string =>
  `[locked-intended] ${title} — anchor: ${reference}#${section}`;

function expectedPosition(text: string, needle: string): { line: number; column: number } {
  const offset = text.indexOf(needle);
  if (offset < 0) throw new Error(`Fixture does not contain ${JSON.stringify(needle)}.`);
  const preceding = text.slice(0, offset);
  return { line: preceding.split("\n").length, column: offset - preceding.lastIndexOf("\n") };
}

function expectSignatureFailure(
  result: NativeResult,
  text: string,
  signature: string
): NativeDiagnostic {
  const diagnostic = requireContractFailure(result);
  expect(diagnostic.code).toMatch(/^(TS|shape-ts)\d+$/);
  expect(diagnostic.message).toMatch(/false|true|signature|match|assignable/i);
  expect({ line: diagnostic.line, column: diagnostic.column }).toEqual(
    expectedPosition(text, signature)
  );
  return diagnostic;
}

function expectMapperFailure(result: NativeResult, cause: RegExp): NativeDiagnostic {
  const diagnostic = requireNativeDiagnostic(
    result,
    (item) => item.file === "src/math.shape" && item.code.startsWith("shape-ts")
  );
  expect(diagnostic.code).toMatch(/^shape-ts\d+$/);
  expect(diagnostic.line).toBeGreaterThan(0);
  expect(diagnostic.column).toBeGreaterThan(0);
  expect(diagnostic.message).toMatch(cause);
  return diagnostic;
}

describe("native TypeScript contract checking", () => {
  test(
    invariant(
      "a reviewed void signature rejects a newly returned number with unused checks enabled",
      "exact-signatures"
    ),
    async () => {
      const fixture = await NativeFixture.create();
      try {
        const shape = contract([{ name: "answer", signature: "() => void" }]);
        await fixture.write("src/math.shape", shape);
        await fixture.write("src/math.ts", "export function answer(): void {}\n");
        expectNativePass(await fixture.check());

        await fixture.write("src/math.ts", "export function answer(): number { return 42; }\n");
        expectSignatureFailure(await fixture.check(), shape, "() => void");
      } finally {
        await fixture.close();
      }
    },
    60_000
  );

  test(
    invariant(
      "whole callable equality retains generics, earlier overloads and this",
      "exact-signatures"
    ),
    async () => {
      const fixture = await NativeFixture.create();
      try {
        const cases = [
          {
            signature: "<U>(value: U) => U",
            good: "export function answer<T>(input: T): T { return input; }\n",
            bad: "export function answer(input: unknown): unknown { return input; }\n"
          },
          {
            signature: "{ (value: string): string; (value: number): number }",
            good: "export function answer(input: string): string;\nexport function answer(input: number): number;\nexport function answer(input: string | number): string | number { return input; }\n",
            bad: "export function answer(input: string): boolean;\nexport function answer(input: number): number;\nexport function answer(input: string | number): boolean | number { return typeof input === 'number' ? input : true; }\n"
          },
          {
            signature: "(this: { value: number }, amount: number) => number",
            good: "export function answer(this: { value: number }, input: number): number { return this.value + input; }\n",
            bad: "export function answer(this: { value: string }, input: number): number { return Number(this.value) + input; }\n"
          }
        ];
        for (const entry of cases) {
          const shape = contract([{ name: "answer", signature: entry.signature }]);
          await fixture.write("src/math.shape", shape);
          await fixture.write("src/math.ts", entry.good);
          expectNativePass(await fixture.check());
          await fixture.write("src/math.ts", entry.bad);
          expectSignatureFailure(await fixture.check(), shape, entry.signature);
        }
      } finally {
        await fixture.close();
      }
    },
    120_000
  );

  test(
    invariant(
      "export coverage rejects additions, missing declarations and empty contracts",
      "export-coverage"
    ),
    async () => {
      const fixture = await NativeFixture.create();
      try {
        const shape = contract([{ name: "answer", signature: "() => number" }]);
        await fixture.write("src/math.shape", shape);
        await fixture.write("src/math.ts", "export function answer(): number { return 42; }\n");
        expectNativePass(await fixture.check());

        await fixture.write(
          "src/math.ts",
          "export function answer(): number { return 42; }\nexport function extra(): string { return 'new'; }\n"
        );
        const added = requireContractFailure(await fixture.check());
        expect(added.line).toBeGreaterThan(0);
        expect(added.column).toBeGreaterThan(0);
        expect(added.message).toMatch(/extra|coverage|false|never|registered/i);

        await fixture.write("src/math.ts", "export const unrelated = 1;\n");
        const removed = requireNativeDiagnostic(
          await fixture.check(),
          (diagnostic) => diagnostic.file === "src/math.shape" && diagnostic.code === "TS2339"
        );
        expect(removed.message).toMatch(/answer/);
        expect({ line: removed.line, column: removed.column }).toEqual(
          expectedPosition(shape, "() => number")
        );

        await fixture.write("src/math.shape", contract([]));
        expectNativePass(await fixture.check());
        await fixture.write("src/math.ts", "export function answer(): number { return 42; }\n");
        const empty = requireContractFailure(await fixture.check());
        expect(empty.message).toMatch(/answer|coverage|false|never|registered/i);
        expect(empty.line).toBeGreaterThan(0);
        expect(empty.column).toBeGreaterThan(0);
      } finally {
        await fixture.close();
      }
    },
    120_000
  );

  test(
    invariant(
      "export anchors resolve aliases, re-exports, default and string names",
      "exact-signatures"
    ),
    async () => {
      const fixture = await NativeFixture.create();
      try {
        await fixture.write(
          "src/dependency.ts",
          "export function remote(value: string): string { return value; }\n"
        );
        await fixture.write(
          "src/math.ts",
          [
            "function original(value: number): number { return value; }",
            'export { original as alias, original as "strange-name" };',
            "export default original;",
            'export { remote as forwarded } from "./dependency.js";'
          ].join("\n")
        );
        const entries = [
          { name: "Alias", exported: "alias", signature: "(input: number) => number" },
          { name: "StringName", exported: "strange-name", signature: "(input: number) => number" },
          { name: "Default", exported: "default", signature: "(input: number) => number" },
          { name: "Reexport", exported: "forwarded", signature: "(input: string) => string" }
        ];
        const shape = contract(entries);
        await fixture.write("src/math.shape", shape);
        expectNativePass(await fixture.check());
        await fixture.write(
          "src/dependency.ts",
          "export function remote(value: string): number { return value.length; }\n"
        );
        expectSignatureFailure(await fixture.check(), shape, "(input: string) => string");
      } finally {
        await fixture.close();
      }
    },
    60_000
  );

  test(
    invariant(
      "uncertain export types cannot disappear from the callable inventory",
      "export-coverage"
    ),
    async () => {
      const fixture = await NativeFixture.create();
      try {
        await fixture.write("src/math.shape", contract([]));
        await fixture.write(
          "src/math.ts",
          "export const value: number = 1;\nexport class Service { method(): number { return 1; } }\n"
        );
        expectNativePass(await fixture.check());
        for (const type of [
          "any",
          "unknown",
          "never",
          "Function",
          "Function & { readonly brand: 'function' }",
          "(() => number) | undefined"
        ]) {
          await fixture.write("src/math.ts", `export declare const uncertain: ${type};\n`);
          const diagnostic = requireContractFailure(await fixture.check());
          expect(diagnostic.line).toBeGreaterThan(0);
          expect(diagnostic.column).toBeGreaterThan(0);
          expect(diagnostic.message).toMatch(/uncertain|false|never|coverage|unknown/i);
        }
        await fixture.write(
          "src/math.ts",
          "class RuntimeFunction extends Function {}\nexport declare const uncertain: RuntimeFunction;\n"
        );
        const inherited = requireContractFailure(await fixture.check());
        expect(inherited.line).toBeGreaterThan(0);
        expect(inherited.column).toBeGreaterThan(0);
        expect(inherited.message).toMatch(/uncertain|false|never|coverage|unknown/i);
        const callableUnion = "(() => number) | ((input: string) => string)";
        await fixture.write("src/math.ts", `export declare const uncertain: ${callableUnion};\n`);
        await fixture.write(
          "src/math.shape",
          contract([{ name: "uncertain", signature: callableUnion }])
        );
        const ambiguous = requireContractFailure(await fixture.check());
        expect(ambiguous.line).toBeGreaterThan(0);
        expect(ambiguous.column).toBeGreaterThan(0);
        expect(ambiguous.message).toMatch(/uncertain|false|never|union|ambiguous/i);
      } finally {
        await fixture.close();
      }
    },
    120_000
  );

  test(
    invariant(
      "authored unknown effects remain usable but generated drafts are rejected",
      "contract-layout"
    ),
    async () => {
      const fixture = await NativeFixture.create();
      const shape = contract([{ name: "answer", signature: "() => number", effects: "unknown" }]);
      try {
        await fixture.write("src/math.ts", "export function answer(): number { return 42; }\n");
        await fixture.write("src/math.shape", shape);
        expectNativePass(await fixture.check());
      } finally {
        await fixture.close();
      }

      const generatedSource = "shape/generated/ast/math.ts";
      const generatedContract = "shape/generated/ast/math.shape";
      const generated = await NativeFixture.create([generatedSource, generatedContract]);
      try {
        await generated.write(generatedSource, "export function answer(): number { return 42; }\n");
        await generated.write(
          generatedContract,
          shape
            .replace("module native.contract", "module shape.generated.ast.math")
            .replace("src/math.ts#answer", `${generatedSource}#answer`)
        );
        const diagnostic = requireNativeDiagnostic(
          await generated.check(),
          (item) => item.file === generatedContract && item.code.startsWith("shape-ts")
        );
        expect(diagnostic.line).toBeGreaterThan(0);
        expect(diagnostic.column).toBeGreaterThan(0);
        expect(diagnostic.message).toMatch(/generated|draft/i);
      } finally {
        await generated.close();
      }
    },
    60_000
  );

  test(
    invariant(
      "type fragments reject suppression and self-derived or private expectations",
      "contract-layout"
    ),
    async () => {
      const fixture = await NativeFixture.create();
      try {
        await fixture.write("src/math.ts", "export function answer(): number { return 42; }\n");
        await fixture.write(
          "src/math.shape",
          contract([{ name: "answer", signature: "() => number" }])
        );
        expectNativePass(await fixture.check());
        await fixture.write(
          "src/math.shape",
          contract([{ name: "answer", signature: "() => void\n// @ts-ignore\n" }])
        );
        expectMapperFailure(await fixture.check(), /signature|directive|fragment|suppress/i);

        await fixture.write(
          "src/math.shape",
          contract([
            {
              name: "answer",
              signature: 'typeof import("./math.js").answer'
            }
          ])
        );
        expectMapperFailure(await fixture.check(), /typeof|signature|query/i);

        await fixture.write(
          "src/math.ts",
          "export function answer(...args: never[]): unknown { return args; }\n"
        );
        await fixture.write(
          "src/math.shape",
          contract([
            {
              name: "answer",
              signature: "(...args: never[]) => unknown"
            }
          ])
        );
        expectNativePass(await fixture.check());
        for (const signature of ["__ShapeCallable", "__Sh\\u0061peCallable"]) {
          await fixture.write("src/math.shape", contract([{ name: "answer", signature }]));
          expectMapperFailure(await fixture.check(), /signature|private|reserved|identifier/i);
        }
      } finally {
        await fixture.close();
      }
    },
    60_000
  );

  test(
    invariant(
      "native signature diagnostics preserve UTF16 columns and CRLF lines",
      "diagnostics-and-freshness"
    ),
    async () => {
      const fixture = await NativeFixture.create();
      try {
        const shape = contract([{ name: "answer", signature: "() => void" }], "// 😀 reviewed\n")
          .replace("    signature", "    /* 😀 */ signature")
          .replaceAll("\n", "\r\n");
        await fixture.write("src/math.shape", shape);
        await fixture.write("src/math.ts", "export function answer(): void {}\r\n");
        expectNativePass(await fixture.check());
        await fixture.write("src/math.ts", "export function answer(): number { return 42; }\r\n");
        expectSignatureFailure(await fixture.check(), shape, "() => void");
      } finally {
        await fixture.close();
      }
    },
    60_000
  );

  test(
    invariant(
      "native execution requires consent and explicitly listed contracts cannot disappear",
      "opt-in"
    ),
    async () => {
      const fixture = await NativeFixture.create();
      try {
        await fixture.write("src/math.ts", "export function answer(): number { return 42; }\n");
        await fixture.write(
          "src/math.shape",
          contract([{ name: "answer", signature: "() => number" }])
        );
        expectNativePass(await fixture.check());

        const noConsent = requireNativeDiagnostic(
          await fixture.check({ external: false }),
          (diagnostic) => diagnostic.code === "TS18068"
        );
        expect(noConsent.file).toBe("tsconfig.json");
        expect(noConsent.line).toBeGreaterThan(0);
        expect(noConsent.column).toBeGreaterThan(0);
        expect(noConsent.message).toMatch(/runExternalCode/);

        await fixture.remove("src/math.shape");
        const missing = requireNativeDiagnostic(
          await fixture.check(),
          (diagnostic) => diagnostic.code === "TS6053"
        );
        expect(missing.message.replaceAll("\\", "/")).toMatch(/src\/math\.shape.*not found/);
        expect(missing.file).toBeUndefined();
      } finally {
        await fixture.close();
      }
    },
    60_000
  );

  test(
    invariant(
      "warm checks match clean checks after source and dependency changes",
      "diagnostics-and-freshness"
    ),
    async () => {
      const fixture = await NativeFixture.create();
      try {
        const shape = contract([{ name: "answer", signature: "() => number" }]);
        await fixture.write("src/math.shape", shape);
        await fixture.write("src/math.ts", 'export { remote as answer } from "./dependency.js";\n');
        await fixture.write(
          "src/dependency.ts",
          "export function remote(): number { return 42; }\n"
        );
        expectNativePass(await fixture.check({ incremental: true }));

        await fixture.write(
          "src/dependency.ts",
          "export function remote(): string { return 'changed'; }\n"
        );
        const dependencyWarm = await fixture.check({ incremental: true });
        expectSignatureFailure(dependencyWarm, shape, "() => number");
        await fixture.remove("native.tsbuildinfo");
        const dependencyClean = await fixture.check({ incremental: true });
        expectSignatureFailure(dependencyClean, shape, "() => number");
        expect(dependencyWarm.diagnostics).toEqual(dependencyClean.diagnostics);

        await fixture.write(
          "src/dependency.ts",
          "export function remote(): number { return 42; }\n"
        );
        expectNativePass(await fixture.check({ incremental: true }));
        await fixture.write(
          "src/math.ts",
          'export { remote as answer } from "./dependency.js";\nexport function added(): void {}\n'
        );
        const sourceWarm = await fixture.check({ incremental: true });
        const coverage = requireContractFailure(sourceWarm);
        expect(coverage.message).toMatch(/added|coverage|false|never|registered/i);
        expect(coverage.line).toBeGreaterThan(0);
        expect(coverage.column).toBeGreaterThan(0);
        await fixture.remove("native.tsbuildinfo");
        const sourceClean = await fixture.check({ incremental: true });
        requireContractFailure(sourceClean);
        expect(sourceWarm.diagnostics).toEqual(sourceClean.diagnostics);
      } finally {
        await fixture.close();
      }
    },
    120_000
  );
});
