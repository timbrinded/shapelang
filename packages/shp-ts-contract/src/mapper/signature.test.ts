import { describe, expect, test } from "bun:test";
import { validateSignatureFragment } from "./signature.ts";

describe("authored TypeScript signature boundaries", () => {
  test.each([
    "() => void",
    "\n (value: unknown) => unknown \t",
    '<T extends { value: string; }>(value: T) => T["value"]',
    "{ (value: string): number; (value: number): string; }",
    "(values: readonly [string, ...number[]]) => Promise<{ ok: true; value?: number; }>",
    "(this: { name: string }, value?: number) => void",
    '(value: import("./models").Item) => import("./models").Result',
    '() => "typeof __ShapeSource"',
    '(value: "// @ts-ignore; ) ] }") => "/* not a comment */"',
    String.raw`(value: "escaped \"quote\"; )") => "\\"`,
    "(value: ') ] }; // @ts-nocheck') => 'quoted delimiters'",
    "() => `literal ) ] }; // @ts-ignore`",
    "<T>(value: T) => T extends string ? { value: T; } : [T]"
  ])("allows a contained type expression: %s", (signature) => {
    expect(validateSignatureFragment(signature)).toBeUndefined();
  });

  test.each(["", " ", "\n\t\r\n", "\uFEFF"])("rejects an empty signature: %j", (signature) => {
    expect(validateSignatureFragment(signature)).toContain("type expression");
  });

  test.each([
    "() => void;\n// @ts-ignore",
    "() => void; export type Hidden = never",
    "() => void;",
    "{ (value: string): string; };"
  ])("rejects an alias-terminating semicolon: %s", (signature) => {
    expect(validateSignatureFragment(signature)).toContain("top-level semicolon");
  });

  test.each([
    "() => void\n// @ts-ignore",
    "// @ts-nocheck\n() => void",
    "/* @ts-ignore */ () => void",
    "() => /* ordinary comment */ void",
    "{ f: string; // @ts-expect-error\n g: number }",
    "<<<<<<< HEAD\n() => void"
  ])("rejects comments and directive-like trivia: %s", (signature) => {
    expect(validateSignatureFragment(signature)).toContain("comments, directives");
  });

  test.each([
    ") => void",
    "() => [string",
    "() => { value: string",
    "(value: [string) => void",
    "() => { value: [string}]",
    "() => void)\nexport type Hidden = never\n(unknown"
  ])("rejects delimiters that can escape the wrapper: %s", (signature) => {
    expect(validateSignatureFragment(signature)).toContain("delimiters");
  });

  test.each(['() => "unfinished', "() => 'unfinished", "() => `unfinished", "/* unfinished"])(
    "rejects an unterminated token: %s",
    (signature) => {
      expect(validateSignatureFragment(signature)).toContain("unterminated");
    }
  );

  test.each(["() => \u0001", "#!/usr/bin/env node\n() => void"])(
    "rejects tokens the scanner cannot recognize: %j",
    (signature) => {
      expect(validateSignatureFragment(signature)).toContain("unrecognized");
    }
  );

  test.each(["() => `${string}`", "() => `prefix${string}suffix`", "() => `${{ value: string }}`"])(
    "reports unsupported template substitutions rather than guessing nesting: %s",
    (signature) => {
      expect(validateSignatureFragment(signature)).toContain("template substitutions");
    }
  );

  test.each([
    "__ShapeExpected0",
    "() => __ShapeSource",
    "{ value: __ShapeHelper<string>; }",
    String.raw`\u005f\u005fShapeSource`,
    String.raw`__Sh\u0061peSource`,
    String.raw`__\u{53}hapeSource`
  ])("reserves decoded generated helper identifiers: %s", (signature) => {
    expect(validateSignatureFragment(signature)).toContain("reserved for generated checks");
  });

  test.each([
    '(typeof __ShapeSource)["answer"]',
    'typeof import("./math.js")["answer"]',
    '(value: string) => typeof import("./math.js").answer',
    "{ value: typeof answer; }",
    String.raw`\u0074ypeof answer`
  ])("rejects authored type queries explicitly: %s", (signature) => {
    expect(validateSignatureFragment(signature)).toContain("typeof type queries");
  });
});
