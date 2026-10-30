import { expect, test } from "bun:test";
import {
  contract,
  expectNativePass,
  expectSignatureFailure,
  NativeFixture,
  requireNativeDiagnostic
} from "./native-test-helpers.js";

test(
  "[characterization] const type parameters can change inference without failing contract equality — " +
    "current behaviour: native callable equality ignores the const modifier; " +
    "follow-up: retain call-site coverage for inference-sensitive APIs; " +
    "anchor: docs-site/src/content/docs/reference/typescript-content-mapping.md#exact-signatures",
  async () => {
    await using fixture = await NativeFixture.create([
      "src/math.ts",
      "src/math.shape",
      "src/caller.ts"
    ]);
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
  },
  60_000
);

test(
  "[characterization] an inline distributive conditional over the signature's own type parameter never matches — " +
    "current behaviour: TypeScript 7.1.0-beta treats two separately declared generic signatures whose result " +
    "distributes over their type parameter as different, even when written identically (6.0.3 treats them as equal); " +
    "follow-up: report the identity difference to typescript-go and drop the exported-alias workaround once fixed; " +
    "anchor: docs-site/src/content/docs/reference/typescript-content-mapping.md#exact-signatures",
  async () => {
    await using fixture = await NativeFixture.create([
      "src/math.ts",
      "src/math.shape",
      "src/types.ts"
    ]);
    await fixture.write("src/types.ts", "export type IsText<T> = T extends string ? 1 : 2;\n");
    await fixture.write(
      "src/math.ts",
      "export declare function pick<T>(value: T): T extends string ? 1 : 2;\n"
    );
    const inline = "<T>(value: T) => T extends string ? 1 : 2";
    const inlineContract = contract([{ name: "pick", signature: inline }]);
    await fixture.write("src/math.shape", inlineContract);
    const verbatim = expectSignatureFailure(await fixture.check(), inlineContract, inline, "pick");
    // Both sides print identically; only the compiler's identity check separates them.
    expect(verbatim.message).toContain(`signature: ${inline}; exact: false;`);
    expect(verbatim.message).toContain(`signature: ${inline}; exact: true;`);

    const aliased = "<U>(value: U) => import('./types.js').IsText<U>";
    const aliasedContract = contract([{ name: "pick", signature: aliased }]);
    await fixture.write("src/math.shape", aliasedContract);
    expectNativePass(await fixture.check());

    // The workaround still detects drift in the implementation's conditional.
    await fixture.write(
      "src/math.ts",
      "export declare function pick<T>(value: T): T extends number ? 1 : 2;\n"
    );
    expectSignatureFailure(await fixture.check(), aliasedContract, aliased, "pick");
  },
  60_000
);
