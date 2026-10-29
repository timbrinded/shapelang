import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { emitContract } from "./emit.ts";

const repoRoot = resolve("/contract-repo");
const fileName = resolve(repoRoot, "src/math.shape");
function emit(content: string, path = fileName) {
  return emitContract({ content, fileName: path, repoRoot });
}
function module(body: string): string {
  return `module app.contract\ncomponent Api {\n${body}\n}\n`;
}
function registration(
  name = "answer",
  source = "src/math.ts#answer",
  signature = "() => number"
): string {
  return `fn ${name} source ts(${JSON.stringify(source)}) signature ts(${JSON.stringify(signature)}) effects unknown`;
}

describe("pure TypeScript contract transform", () => {
  test("an empty authored contract imports its sibling at a mapped file position", () => {
    const result = emit(module(""));
    expect(result.diagnostics).toEqual([]);
    expect(result.extension).toBe(".ts");
    const line = 'import type * as __ShapeSource from "./math.js";';
    expect(result.text.startsWith(`${line}\n`)).toBe(true);
    expect(result.mappings[0]).toEqual([0, line.length, 0, 1, 1, 0]);
  });

  test("authored unknown effects are valid; all assertions precede wrapped fragments", () => {
    const result = emit(
      module(registration() + "\n" + registration("second", "src/math.ts#second"))
    );
    expect(result.diagnostics).toEqual([]);
    const fragment = result.text.indexOf("type __ShapeExpected0 = [(() => number)];");
    expect(fragment).toBeGreaterThan(result.text.indexOf("export type __ShapeMatch1"));
    expect(fragment).toBeGreaterThan(
      result.text.indexOf("export type __ShapeMissingRegistrations")
    );
  });

  test.each([
    ["missing source", 'fn answer signature ts("() => number") effects unknown', 1003],
    ["wrong sibling", registration("answer", "src/other.ts#answer"), 1003],
    ["missing export anchor", registration("answer", "src/math.ts"), 1003],
    ["empty export anchor", registration("answer", "src/math.ts#"), 1003],
    ["unsupported language", registration().replace("source ts", "source js"), 1003],
    ["missing signature", 'fn answer source ts("src/math.ts#answer") effects unknown', 1004],
    [
      "unsupported signature language",
      registration().replace("signature ts", "signature js"),
      1004
    ],
    ["duplicate registration", registration() + "\n" + registration("other"), 1005],
    [
      "directive injection",
      registration("answer", "src/math.ts#answer", "() => void;\n// @ts-ignore"),
      1004
    ],
    // Langium would read these as the plain letters u and x.
    [
      "unicode escape in a source anchor",
      'fn answer source ts("src/\\u006dath.ts#answer") signature ts("() => number") effects unknown',
      1003
    ],
    [
      "hex escape in a signature",
      `fn answer source ts("src/math.ts#answer") signature ts('(mode: "\\x41") => void') effects unknown`,
      1004
    ]
  ])("rejects %s without emitting a partial successful contract", (_name, body, code) => {
    const result = emit(module(String(body)));
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(Number(code));
    expect(result.text).toBe("export {};\n");
    expect(result.mappings).toEqual([]);
  });

  test("parse failures and generated origins are explicit mapper errors", () => {
    expect(emit("module app component {").diagnostics[0]?.code).toBe(1001);
    expect(
      emit(module("").replace("app.contract", "shape.generated.ast.math")).diagnostics[0]?.code
    ).toBe(1002);
    expect(
      emit(module(""), resolve(repoRoot, "shape/generated/ast/math.shape")).diagnostics[0]?.code
    ).toBe(1002);
  });

  test("a parse error at the end of input is an empty span at the end of the contract", () => {
    // The compiler rejects a whole transform whose span runs past the contract.
    const content = "module app\ncomponent Api {\n";
    expect(emit(content).diagnostics).toEqual([
      expect.objectContaining({ code: 1001, start: content.length, length: 0 })
    ]);
  });

  test("Shape imports and changes cannot be silently ignored", () => {
    expect(emit("module app\nimport other.contract\ncomponent Api {}\n").diagnostics[0]?.code).toBe(
      1002
    );
    expect(emit("module app\nchange Review {}\n").diagnostics[0]?.code).toBe(1002);
  });

  test.each([
    resolve(repoRoot, "../outside.shape"),
    resolve(repoRoot, "src/math.d.shape"),
    resolve(repoRoot, "src/math.ts")
  ])("rejects a contract outside the supported sibling layout: %s", (path) =>
    expect(emit(module(""), path).diagnostics[0]?.code).toBe(1007)
  );

  test("anchors and signatures use the Shape parser's decoded string values", () => {
    const source = module(registration("answer", 'src/math.ts#strange-"name')).replaceAll(
      " ts(",
      " typescript("
    );
    const result = emit(source);
    expect(result.diagnostics).toEqual([]);
    expect(result.text).toContain(
      'export type __ShapeRegistered0 = __ShapeAssert<__ShapeRegistered<typeof __ShapeSource, "strange-\\"name", "src/math.ts">>;'
    );
    // An escaped backslash before u stays a TypeScript escape inside the fragment.
    const decoded = module(
      `fn answer source ts('src/math.ts#answer') signature ts('(mode: \\'on\\' | "\\\\u0041") => void') effects unknown`
    );
    const decodedResult = emit(decoded);
    expect(decodedResult.diagnostics).toEqual([]);
    expect(decodedResult.text).toContain(
      `type __ShapeExpected0 = [((mode: 'on' | "\\u0041") => void)];`
    );
  });

  test("mappings retain raw STRING payload lengths after emoji, CRLF and escapes", () => {
    const signature = '(value: "😀") => "quoted\\value"';
    const raw = JSON.stringify(signature);
    const content = (
      "// 😀\n" + module(registration("answer", "src/math.ts#answer", signature))
    ).replaceAll("\n", "\r\n");
    const result = emit(content);
    expect(result.diagnostics).toEqual([]);
    const payloadStart = content.indexOf(raw) + 1;
    const mapped = result.mappings.filter((mapping) => mapping[2] === payloadStart);
    expect(mapped.length).toBeGreaterThan(0);
    expect(mapped.every((mapping) => mapping[3] === raw.length - 2)).toBe(true);
    expect(result.text).toContain(`[(${signature})];`);
  });
});
