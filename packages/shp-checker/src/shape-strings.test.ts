import { describe, expect, test } from "bun:test";
import {
  normalizeShapePath,
  normalizeShapeSourcePath,
  unquoteShapeString
} from "./shape-strings.ts";

describe("Shape string helpers", () => {
  test("normalizes source references consistently", () => {
    expect(normalizeShapeSourcePath("./src\\audit\\store.ts#appendEvent")).toBe(
      "src/audit/store.ts"
    );
    expect(normalizeShapeSourcePath(unquoteShapeString("'./src/audit/store.ts:12-16'"))).toBe(
      "src/audit/store.ts"
    );
    expect(normalizeShapeSourcePath("src/audit/store.ts:12")).toBe("src/audit/store.ts");
  });

  test("normalizes paths and quoted shape strings", () => {
    expect(normalizeShapePath(".\\src\\audit\\store.ts")).toBe("src/audit/store.ts");
    expect(normalizeShapePath("./src/audit/store.ts")).toBe("src/audit/store.ts");
    expect(unquoteShapeString("'src/audit/store.ts'")).toBe("src/audit/store.ts");
    expect(unquoteShapeString('"src/audit/store.ts"')).toBe("src/audit/store.ts");
  });
});
