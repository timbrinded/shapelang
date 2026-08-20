import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { validateSkillPackage } from "./check-skills";

test("shipped skill package satisfies routing, resource, fixture, metadata, and CLI contracts", () => {
  const repositoryRoot = resolve(import.meta.dir, "..");
  expect(validateSkillPackage(repositoryRoot)).toEqual([]);

  const routingCases = JSON.parse(
    readFileSync(resolve(repositoryRoot, "plugins/shapelang/skills/routing-cases.json"), "utf8")
  ) as Array<{
    kind: string;
    expected_skill: string | null;
    excluded_skills?: string[];
  }>;
  expect(
    routingCases
      .filter((item) => item.expected_skill === "shape-index")
      .every((item) => item.kind === "direct")
  ).toBe(true);
  expect(
    routingCases.filter((item) => item.excluded_skills?.includes("shape-index")).length
  ).toBeGreaterThanOrEqual(2);
  expect(
    routingCases
      .filter((item) => item.expected_skill === "unix-system-visualiser")
      .map((item) => item.kind)
      .sort()
  ).toEqual(["direct", "incomplete", "indirect"]);
});
