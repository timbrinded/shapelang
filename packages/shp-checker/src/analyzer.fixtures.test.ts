import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { analyzeSourceText } from "./index.ts";

const repoRoot = resolve(import.meta.dir, "../../..");

const fixtureFamilies = [
  {
    name: "SQL",
    destructive: "fixtures/source/analyzer/sql/destructive.sql",
    safe: "fixtures/source/analyzer/sql/safe.sql"
  },
  {
    name: "Kysely",
    destructive: "fixtures/source/analyzer/kysely/destructive.ts",
    safe: "fixtures/source/analyzer/kysely/safe.ts"
  },
  {
    name: "Prisma",
    destructive: "fixtures/source/analyzer/prisma/destructive.ts",
    safe: "fixtures/source/analyzer/prisma/safe.ts"
  },
  {
    name: "Drizzle",
    destructive: "fixtures/source/analyzer/drizzle/destructive.ts",
    safe: "fixtures/source/analyzer/drizzle/safe.ts"
  }
] as const;

function readFixture(path: string): string {
  return readFileSync(resolve(repoRoot, path), "utf8");
}

describe("Shape analyzer fixture corpus", () => {
  for (const family of fixtureFamilies) {
    test(`${family.name} destructive fixture snapshots hints`, () => {
      const hints = analyzeSourceText(family.destructive, readFixture(family.destructive));

      for (const effect of ["HardDelete", "Truncate", "DropStorage"] as const) {
        expect(hints.some((hint) => hint.effect === effect)).toBe(true);
      }
      const snapshotHints = hints.map((hint) => ({
        ...hint,
        evidence: hint.evidence.replaceAll("\n", "\\n")
      }));
      expect(snapshotHints).toMatchSnapshot();
    });

    test(`${family.name} safe fixture produces no destructive hints`, () => {
      expect(analyzeSourceText(family.safe, readFixture(family.safe))).toEqual([]);
    });
  }
});
