import { describe, expect, test } from "bun:test";
import { formatShapeSource } from "@shape/shp-checker";
import {
  contract,
  diagnosticAt,
  expectCoverageFailure,
  expectNativePass,
  expectSignatureFailure,
  lockedIntended,
  NativeFixture,
  requireContractFailure,
  requireNativeDiagnostic,
  type NativeDiagnostic,
  type NativeResult
} from "./native-test-helpers.js";

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
    lockedIntended(
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
    lockedIntended(
      "whole callable equality retains generics, overload order, earlier overloads and this",
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
            // The same overloads in the opposite order resolve calls differently.
            signature: "{ (value: string): string; (value: number): number }",
            good: "export function answer(input: string): string;\nexport function answer(input: number): number;\nexport function answer(input: string | number): string | number { return input; }\n",
            bad: "export function answer(input: number): number;\nexport function answer(input: string): string;\nexport function answer(input: string | number): string | number { return input; }\n"
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
    lockedIntended(
      "an export the compiler cannot type fails its signature and keeps the file's coverage",
      "exact-signatures"
    ),
    async () => {
      const untypedImplementation = "export function answer() { return 'text'; }\n";
      const cases = [
        {
          // skipLibCheck hides the dependency's own unresolved re-export.
          compilerOptions: { skipLibCheck: true },
          files: {
            "node_modules/lib/package.json": JSON.stringify({
              name: "lib",
              type: "module",
              types: "index.d.ts"
            }),
            "node_modules/lib/index.d.ts": 'export { answer } from "./missing.js";\n',
            "src/math.ts": 'export { answer } from "lib";\nexport function extra(): void {}\n'
          }
        },
        {
          // The directive hides TS7016 for an untyped JavaScript module.
          compilerOptions: {},
          files: {
            "src/impl.js": untypedImplementation,
            "src/math.ts":
              '// @ts-ignore\nexport { answer } from "./impl.js";\nexport function extra(): void {}\n'
          }
        },
        {
          // noImplicitAny: false accepts the untyped module without any directive.
          compilerOptions: { noImplicitAny: false },
          files: {
            "src/impl.js": untypedImplementation,
            "src/math.ts": 'export { answer } from "./impl.js";\nexport function extra(): void {}\n'
          }
        }
      ];
      for (const entry of cases) {
        const fixture = await NativeFixture.create(undefined, {
          compilerOptions: entry.compilerOptions
        });
        try {
          const shape = contract([{ name: "answer", signature: "() => number" }]);
          await fixture.write("src/math.shape", shape);
          await fixture.write("src/math.ts", "export function answer(): number { return 42; }\n");
          expectNativePass(await fixture.check());

          for (const [path, text] of Object.entries(entry.files)) await fixture.write(path, text);
          const result = await fixture.check();
          expect(expectSignatureFailure(result, shape, "() => number").message).toMatch(
            /signature: any; exact: false/
          );
          expectCoverageFailure(result, "uncertainExportTypes", ["answer"]);
          expectCoverageFailure(result, "unregisteredCallableExports", ["extra"]);
        } finally {
          await fixture.close();
        }
      }
    },
    120_000
  );

  test(
    lockedIntended(
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
        expectCoverageFailure(await fixture.check(), "unregisteredCallableExports", ["extra"]);

        // A removed export is reported once, on the anchor that names it.
        await fixture.write("src/math.ts", "export const unrelated = 1;\n");
        const removedResult = await fixture.check();
        const removed = diagnosticAt(removedResult, shape, "src/math.ts#answer");
        expect(removed.code).toBe("TS2344");
        expect(removed.message).toMatch(/src\/math\.ts has no export named 'answer'/);
        expect(removedResult.diagnostics.filter((item) => item.file === "src/math.shape")).toEqual([
          removed
        ]);

        // Object.prototype members are apparent properties of every module type,
        // but are not exports of it.
        const inherited = contract([{ name: "toString", signature: "() => string" }]);
        await fixture.write("src/math.shape", inherited);
        const inheritedResult = await fixture.check();
        expect(diagnosticAt(inheritedResult, inherited, "src/math.ts#toString").message).toMatch(
          /src\/math\.ts has no export named 'toString'/
        );

        await fixture.write("src/math.shape", contract([]));
        expectNativePass(await fixture.check());
        await fixture.write(
          "src/math.ts",
          [
            "export function answer(): number { return 42; }",
            "export function alpha(): void {}",
            "export function beta(): void {}",
            "export function gamma(): void {}"
          ].join("\n")
        );
        const empty = expectCoverageFailure(await fixture.check(), "unregisteredCallableExports", [
          "alpha",
          "answer",
          "beta",
          "gamma"
        ]);
        expect(empty.message).not.toMatch(/__Shape|typeof import/);
      } finally {
        await fixture.close();
      }
    },
    120_000
  );

  test(
    lockedIntended(
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
        expectSignatureFailure(
          await fixture.check(),
          shape,
          "(input: string) => string",
          "forwarded"
        );
      } finally {
        await fixture.close();
      }
    },
    60_000
  );

  test(
    lockedIntended(
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
          expectCoverageFailure(await fixture.check(), "uncertainExportTypes", ["uncertain"]);
        }
        await fixture.write(
          "src/math.ts",
          "class RuntimeFunction extends Function {}\nexport declare const uncertain: RuntimeFunction;\n"
        );
        expectCoverageFailure(await fixture.check(), "uncertainExportTypes", ["uncertain"]);
        const callableUnion = "(() => number) | ((input: string) => string)";
        const registered = contract([{ name: "uncertain", signature: callableUnion }]);
        await fixture.write("src/math.ts", `export declare const uncertain: ${callableUnion};\n`);
        await fixture.write("src/math.shape", registered);
        const ambiguous = await fixture.check();
        expectCoverageFailure(ambiguous, "uncertainExportTypes", ["uncertain"]);
        const unsupported = diagnosticAt(ambiguous, registered, callableUnion);
        expect(unsupported.code).toBe("TS2344");
        expect(unsupported.message).toMatch(
          /the reviewed signature for 'uncertain' must be exactly one callable type/
        );
      } finally {
        await fixture.close();
      }
    },
    120_000
  );

  test(
    lockedIntended(
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
    lockedIntended(
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
    lockedIntended(
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
    lockedIntended("a reviewed signature must be exactly one callable type", "contract-layout"),
    async () => {
      const fixture = await NativeFixture.create();
      try {
        await fixture.write("src/math.ts", "export function answer(): number { return 42; }\n");
        await fixture.write(
          "src/math.shape",
          contract([{ name: "answer", signature: "() => number" }])
        );
        expectNativePass(await fixture.check());
        // never and any would satisfy any comparison, so only this assertion rejects them.
        for (const signature of ["never", "any", "number"]) {
          const shape = contract([{ name: "answer", signature }]);
          await fixture.write("src/math.shape", shape);
          const result = await fixture.check();
          const unsupported = diagnosticAt(result, shape, `${signature}")`);
          expect(unsupported.code).toBe("TS2344");
          expect(unsupported.message).toMatch(
            /the reviewed signature for 'answer' must be exactly one callable type/
          );
          expect(result.diagnostics.filter((item) => item.file === "src/math.shape")).toEqual([
            unsupported
          ]);
        }
      } finally {
        await fixture.close();
      }
    },
    60_000
  );

  test(
    lockedIntended(
      "type-only star re-exports add no callable export obligations",
      "export-coverage"
    ),
    async () => {
      const fixture = await NativeFixture.create();
      try {
        await fixture.write(
          "src/models.ts",
          "export interface User { name: string }\nexport function createUser(name: string): User { return { name }; }\n"
        );
        await fixture.write(
          "src/math.shape",
          contract([{ name: "answer", signature: "() => number" }])
        );
        const reexport = 'export type * from "./models.js";\n';
        await fixture.write(
          "src/math.ts",
          `${reexport}export function answer(): number { return 42; }\n`
        );
        expectNativePass(await fixture.check());

        // A genuine unknown export exists at runtime and is still reported.
        await fixture.write(
          "src/math.ts",
          `${reexport}export function answer(): number { return 42; }\nexport declare const realUnknown: unknown;\nexport function extra(): void {}\n`
        );
        const result = await fixture.check();
        expectCoverageFailure(result, "unregisteredCallableExports", ["extra", "realUnknown"]);
        expectCoverageFailure(result, "uncertainExportTypes", ["realUnknown"]);
      } finally {
        await fixture.close();
      }
    },
    60_000
  );

  test(
    lockedIntended(
      "an optional callable member of an export = object is covered and uncertain",
      "export-coverage"
    ),
    async () => {
      const fixture = await NativeFixture.create();
      try {
        await fixture.write(
          "package.json",
          JSON.stringify({ name: "shape-native-fixture", private: true, type: "commonjs" })
        );
        await fixture.write(
          "src/math.shape",
          contract([{ name: "go", signature: "() => number" }])
        );
        await fixture.write(
          "src/math.ts",
          "const api: { go: () => number } = { go: () => 1 };\nexport = api;\n"
        );
        expectNativePass(await fixture.check());

        // An optional member may be absent at runtime, so its type includes undefined.
        await fixture.write(
          "src/math.ts",
          "const api: { go: () => number; run?: () => void } = { go: () => 1 };\nexport = api;\n"
        );
        const unregistered = await fixture.check();
        expectCoverageFailure(unregistered, "unregisteredCallableExports", ["run"]);
        expectCoverageFailure(unregistered, "uncertainExportTypes", ["run"]);

        // Registering it does not make the member disappear: its signature fails instead.
        const shape = contract([
          { name: "go", signature: "() => number" },
          { name: "run", signature: "() => void" }
        ]);
        await fixture.write("src/math.shape", shape);
        const registered = await fixture.check();
        const uncertain = expectCoverageFailure(registered, "uncertainExportTypes", ["run"]);
        const mismatch = expectSignatureFailure(registered, shape, "() => void", "run");
        expect(mismatch.message).toMatch(/signature: \(\(\) => void\) \| undefined; exact: false/);
        expect(registered.diagnostics.filter((item) => item.file === "src/math.shape")).toEqual([
          uncertain,
          mismatch
        ]);
      } finally {
        await fixture.close();
      }
    },
    60_000
  );

  test(
    lockedIntended(
      "an unresolved sibling source remains a native error located on the contract",
      "exact-signatures"
    ),
    async () => {
      const fixture = await NativeFixture.create(["src/math.shape"]);
      try {
        await fixture.write(
          "src/math.shape",
          contract([{ name: "answer", signature: "() => number" }])
        );
        await fixture.write("src/math.ts", "export function answer(): number { return 42; }\n");
        expectNativePass(await fixture.check());

        await fixture.remove("src/math.ts");
        const missing = requireNativeDiagnostic(
          await fixture.check(),
          (item) => item.code === "TS2307"
        );
        expect(missing.file).toBe("src/math.shape");
        expect({ line: missing.line, column: missing.column }).toEqual({ line: 1, column: 1 });
        expect(missing.message).toMatch(/Cannot find module '\.\/math\.js'/);
      } finally {
        await fixture.close();
      }
    },
    60_000
  );

  test(
    lockedIntended(
      "formatting a contract keeps its native verdict, including multi-line signatures",
      "contract-layout"
    ),
    async () => {
      const fixture = await NativeFixture.create();
      try {
        // Raw newlines, a tab and escaped quotes inside a double-quoted Shape string.
        const signature = "(\n      mode: 'on' | \"off\",\n\tcount: number\n    ) => void";
        const authoredPayload = signature.replaceAll('"', '\\"');
        const authored = contract([{ name: "answer", signature: "SIGNATURE" }]).replace(
          '"SIGNATURE"',
          `"${authoredPayload}"`
        );
        const formatting = formatShapeSource(authored, "src/math.shape");
        if (!formatting.ok) throw new Error("The authored contract does not format.");
        const formatted = formatting.formatted;
        expect(formatted).not.toBe(authored);

        const messages: string[] = [];
        for (const [text, payload] of [
          [authored, authoredPayload],
          [formatted, JSON.stringify(signature).slice(1, -1)]
        ] as const) {
          await fixture.write("src/math.shape", text);
          await fixture.write(
            "src/math.ts",
            'export declare function answer(mode: "on" | "off", count: number): void;\n'
          );
          expectNativePass(await fixture.check());
          await fixture.write(
            "src/math.ts",
            'export declare function answer(mode: "on" | "off", count: string): void;\n'
          );
          messages.push(expectSignatureFailure(await fixture.check(), text, payload).message);
        }
        expect(messages[1]).toBe(messages[0]);
      } finally {
        await fixture.close();
      }
    },
    120_000
  );

  test(
    lockedIntended(
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
    lockedIntended(
      "projects that weaken strict checking, directly or by inheritance, are refused",
      "opt-in"
    ),
    async () => {
      // Without strictNullChecks the drift to `number | undefined` compares equal to `number`.
      const drifting =
        "export function answer(flag: boolean): number | undefined { return flag ? 42 : undefined; }\n";
      const shape = contract([{ name: "answer", signature: "(flag: boolean) => number" }]);
      const checkWith = async (
        config: Parameters<typeof NativeFixture.create>[1],
        base?: object
      ): Promise<NativeResult> => {
        const fixture = await NativeFixture.create(undefined, config);
        try {
          if (base) await fixture.write("tsconfig.base.json", JSON.stringify(base));
          await fixture.write("src/math.shape", shape);
          await fixture.write("src/math.ts", drifting);
          return await fixture.check();
        } finally {
          await fixture.close();
        }
      };

      // TypeScript 7 checks strictly when strict is omitted, so the drift itself is reported.
      const defaults = await checkWith({ compilerOptions: { strict: undefined } });
      expectSignatureFailure(defaults, shape, "(flag: boolean) => number");

      for (const result of [
        await checkWith({ compilerOptions: { strict: false } }),
        await checkWith(
          { extends: "./tsconfig.base.json" },
          { compilerOptions: { strictNullChecks: false } }
        )
      ]) {
        const refused = requireNativeDiagnostic(
          result,
          (item) => item.file === "src/math.shape" && item.code === "shape-ts1006"
        );
        expect({ line: refused.line, column: refused.column }).toEqual({ line: 1, column: 1 });
        expect(refused.message).toMatch(/requires strict checking/);
        expect(result.diagnostics.filter((item) => item.code === "TS2344")).toEqual([]);
      }
    },
    120_000
  );

  test(
    lockedIntended(
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
        expectCoverageFailure(sourceWarm, "unregisteredCallableExports", ["added"]);
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
