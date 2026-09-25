import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { validateSkillPackage } from "./check-skills";

test("shipped skill package satisfies routing, resource, fixture, metadata, and CLI contracts", () => {
  const repositoryRoot = resolve(import.meta.dir, "..");
  expect(validateSkillPackage(repositoryRoot)).toEqual([]);
});
