import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Glob } from "bun";
import { lockedIntended, NativeFixture } from "./native-test-helpers.ts";

// Each case under fixtures/ts-contract is a small project: TypeScript sources, their
// sibling Shape contracts, a tsconfig.json registering the mapper, and expected.txt,
// the exact output a developer sees from the pinned compiler. The structured
// assertions live in native-integration.test.ts; these pin the whole message text.
const casesRoot = resolve(import.meta.dir, "../../../fixtures/ts-contract");

const cases = [
  {
    name: "matching-contract",
    section: "exact-signatures",
    title: "a source that agrees with its contract type-checks cleanly"
  },
  {
    name: "unregistered-export",
    section: "export-coverage",
    title: "a callable export without a reviewed fn is a type error"
  },
  {
    name: "signature-drift",
    section: "exact-signatures",
    title: "an export whose type changes away from its reviewed signature is a type error"
  },
  {
    name: "missing-export",
    section: "exact-signatures",
    title: "a reviewed fn whose export is gone is a type error at its source anchor"
  },
  {
    name: "imported-type-drift",
    section: "exact-signatures",
    title: "a change to an imported type breaks the contract of an unchanged module"
  },
  {
    name: "untyped-export",
    section: "export-coverage",
    title: "an export the compiler cannot type is uncertain and fails its signature"
  },
  {
    name: "weakened-strictness",
    section: "opt-in",
    title: "a project that disables strict checking is refused"
  }
];

describe("TypeScript contract fixture projects", () => {
  for (const { name, section, title } of cases) {
    test(
      lockedIntended(`${name}: ${title}`, section),
      async () => {
        const directory = join(casesRoot, name);
        await using fixture = await NativeFixture.create();
        // The case's own tsconfig.json replaces the fixture's default one.
        for await (const path of new Glob("**/*").scan({ cwd: directory })) {
          if (path !== "expected.txt") {
            await fixture.write(path, await readFile(join(directory, path), "utf8"));
          }
        }
        const expected = (await readFile(join(directory, "expected.txt"), "utf8")).trimEnd();
        const result = await fixture.check();
        expect(result.stdout.trimEnd()).toBe(expected);
        expect(result.stderr).toBe("");
        expect(result.exitCode).toBe(expected ? 2 : 0);
      },
      60_000
    );
  }
});
