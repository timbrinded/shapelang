import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { validateSkillPackage } from "./check-skills";

// validateSkillPackage spawns `node --check` and `bun shp <route> --help` for every
// documented command, so it outlasts bun's 5s default on slow CI runners; at the
// timeout bun kills the in-flight child and the check reports a spurious failure.
test("shipped skill package satisfies routing, resource, fixture, metadata, and CLI contracts", () => {
  const repositoryRoot = resolve(import.meta.dir, "..");
  expect(validateSkillPackage(repositoryRoot)).toEqual([]);
}, 60_000);
