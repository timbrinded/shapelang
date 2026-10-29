import { expect, test } from "bun:test";
import {
  contract,
  expectNativePass,
  NativeFixture,
  requireNativeDiagnostic
} from "./native-test-helpers.js";

test(
  "[characterization] const type parameters can change inference without failing contract equality — " +
    "current behaviour: native callable equality ignores the const modifier; " +
    "follow-up: retain call-site coverage for inference-sensitive APIs; " +
    "anchor: docs-site/src/content/docs/reference/typescript-content-mapping.md#exact-signatures",
  async () => {
    const fixture = await NativeFixture.create(["src/math.ts", "src/math.shape", "src/caller.ts"]);
    try {
      await fixture.write(
        "src/math.shape",
        contract([{ name: "answer", signature: "<const T>(value: T) => T" }])
      );
      await fixture.write(
        "src/math.ts",
        "export function answer<const T>(value: T): T { return value; }\n"
      );
      await fixture.write(
        "src/caller.ts",
        'import { answer } from "./math.js";\n' +
          'const inferred = answer(["a", "b"]);\n' +
          'export const expected: readonly ["a", "b"] = inferred;\n'
      );
      expectNativePass(await fixture.check());

      await fixture.write(
        "src/math.ts",
        "export function answer<T>(value: T): T { return value; }\n"
      );
      const changed = await fixture.check();
      const diagnostic = requireNativeDiagnostic(
        changed,
        (item) => item.file === "src/caller.ts" && item.code === "TS2322"
      );
      expect(diagnostic.line).toBe(3);
      expect(diagnostic.message).toMatch(/string\[\]/);
      expect(diagnostic.message).toContain('readonly ["a", "b"]');
      expect(changed.diagnostics.some((item) => item.file === "src/math.shape")).toBe(false);

      // Keep the reviewed const-generic contract unchanged. Once the caller
      // accepts the widened result, native checking passes despite its drift.
      await fixture.write(
        "src/caller.ts",
        'import { answer } from "./math.js";\n' +
          'const inferred = answer(["a", "b"]);\n' +
          "export const expected: string[] = inferred;\n"
      );
      expectNativePass(await fixture.check());
    } finally {
      await fixture.close();
    }
  },
  60_000
);
