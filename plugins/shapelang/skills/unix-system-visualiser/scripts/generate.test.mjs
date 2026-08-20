import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildAtlasModel } from "../lib/atlas-model.mjs";

const repoRoot = resolve(import.meta.dir, "../../../../..");
const generatorPath = resolve(import.meta.dir, "generate.mjs");

describe("Unix System Visualiser generator", () => {
  test("generates byte-identical visualisers from a recursively discovered Shape model", async () => {
    const fixtureRoot = resolve(repoRoot, "fixtures/skills/unix-system-visualiser/connected");
    const researchRoot = join(fixtureRoot, ".research");
    await mkdir(researchRoot, { recursive: true });
    const outputRoot = await mkdtemp(join(researchRoot, "visualiser-generator-"));
    try {
      const firstPath = join(outputRoot, "first.html");
      const secondPath = join(outputRoot, "second.html");
      const first = await runVisualiser(fixtureRoot, firstPath);
      const second = await runVisualiser(fixtureRoot, secondPath);

      expect(first.exitCode).toBe(0);
      expect(first.stderr).toBe("");
      expect(second.exitCode).toBe(0);
      expect(second.stderr).toBe("");

      const firstHtml = await Bun.file(firstPath).text();
      const secondHtml = await Bun.file(secondPath).text();
      const atlas = embeddedAtlas(firstHtml);
      expect(firstHtml).toBe(secondHtml);
      expect(firstHtml.match(/<style>/g)).toHaveLength(1);
      expect(firstHtml.match(/<script type="module">/g)).toHaveLength(1);
      expect(firstHtml).not.toContain("__STYLE_CSS__");
      expect(firstHtml).not.toContain("__ATLAS_MODEL_JSON__");
      expect(firstHtml).not.toContain("__RENDERER_JS__");
      expect(firstHtml).toContain("window.__unixSystemVisualiser = testingApi");
      for (const journeyOperation of [
        "journeyIds",
        "selectJourney",
        "playJourney",
        "pauseJourney",
        "restartJourney",
        "nextJourneyStep",
        "previousJourneyStep",
        "seekJourneyStep",
        "setJourneySpeed",
        "journeySnapshot"
      ]) {
        expect(firstHtml).toContain(journeyOperation);
      }
      for (const [alias, operation] of [
        ["select", "selectJourney"],
        ["play", "playJourney"],
        ["pause", "pauseJourney"],
        ["restart", "restartJourney"],
        ["next", "nextJourneyStep"],
        ["previous", "previousJourneyStep"],
        ["seek", "seekJourneyStep"],
        ["setSpeed", "setJourneySpeed"]
      ]) {
        expect(firstHtml).toContain(`${alias}: ${operation}`);
      }
      expect(firstHtml).not.toContain("window.__shapePlane");
      for (const legacyAdapter of [
        "nodeByQualifiedName",
        "nodesByShapeName",
        "referenceValue",
        "resolveNode"
      ]) {
        expect(firstHtml).not.toContain(legacyAdapter);
      }
      expect(atlas.schemaVersion).toBe(1);
      expect(
        atlas.nodes.some((node) => node.modelId === "unix_visualiser_fixture::SystemEvent")
      ).toBe(true);
      expect(atlas.districts).toContainEqual(
        expect.objectContaining({
          module: "unix_visualiser_fixture",
          files: ["shape/nested/module-metadata.shape", "shape/nested/system.shape"]
        })
      );
      expect(atlas.journeys).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "authored",
            steps: expect.arrayContaining([
              expect.objectContaining({
                nodeId: "component:unix_visualiser_fixture::SystemConsole"
              }),
              expect.objectContaining({ nodeId: "component:unix_visualiser_fixture::EventStore" })
            ])
          }),
          expect.objectContaining({
            kind: "inferred",
            steps: expect.arrayContaining([
              expect.objectContaining({
                nodeId: "component:unix_visualiser_fixture::SystemConsole"
              }),
              expect.objectContaining({ nodeId: "component:unix_visualiser_fixture::EventStore" })
            ])
          })
        ])
      );
      expect(firstHtml).not.toContain("GeneratedSyntaxAnchor");
      expect(firstHtml).not.toContain("generatedAt");

      const statsLine = first.stdout.trim().split(/\r?\n/).at(-1);
      expect(statsLine).toBeDefined();
      expect(JSON.parse(statsLine ?? "{}")).toEqual({
        documents: 2,
        modules: 1,
        resources: 1,
        components: 2,
        functions: 2,
        effects: 1,
        relations: 2,
        implementations: 1,
        bindings: 1,
        rules: 1,
        memories: 1
      });
    } finally {
      await rm(outputRoot, { recursive: true, force: true });
    }
  });

  test("uses exact qualified identities when local names are duplicated", () => {
    const atlas = buildAtlasModel(inspectionFixture());
    const services = atlas.nodes.filter((node) => node.label === "Service");
    expect(services.map((node) => node.modelId).sort()).toEqual([
      "alpha::Service",
      "beta::Service"
    ]);
    expect(atlas.edges).toContainEqual({
      from: "relation:alpha::CrossModule",
      to: "component:alpha::Service",
      kind: "relation"
    });
    expect(atlas.edges).toContainEqual({
      from: "relation:alpha::CrossModule",
      to: "component:beta::Service",
      kind: "relation"
    });
    expect(atlas.nodes.some((node) => node.modelId === "generated::GeneratedSyntaxAnchor")).toBe(
      false
    );
  });

  test("rejects unresolved authored references", () => {
    const inspection = inspectionFixture();
    inspection.relations[0].endpoints[1].id = "missing::Service";
    inspection.relations[0].to = "missing::Service";

    expect(() => buildAtlasModel(inspection)).toThrow(
      "alpha::CrossModule.endpoints references unavailable authored declaration missing::Service"
    );
  });

  test("rejects duplicate qualified declaration ids", () => {
    const inspection = inspectionFixture();
    inspection.resources.push({ ...inspection.resources[0], name: "Duplicate" });

    expect(() => buildAtlasModel(inspection)).toThrow(
      "Shape inspection contains duplicate declaration id alpha::State"
    );
  });

  test("refuses the default output when Git does not ignore it", async () => {
    const fixtureRoot = resolve(
      repoRoot,
      "fixtures/skills/unix-system-visualiser/unignored-output"
    );
    const outputRoot = join(fixtureRoot, ".research");
    try {
      const result = await runVisualiser(fixtureRoot);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("default output is not ignored by Git");
      expect(await Bun.file(join(outputRoot, "unix-system-visualiser/index.html")).exists()).toBe(
        false
      );
    } finally {
      await rm(outputRoot, { recursive: true, force: true });
    }
  });

  test("refuses an output path that escapes through a symbolic link", async () => {
    const fixtureRoot = resolve(repoRoot, "fixtures/skills/unix-system-visualiser/connected");
    const researchRoot = join(fixtureRoot, ".research");
    const externalRoot = await mkdtemp(join(tmpdir(), "shape-visualiser-external-"));
    const linkedDirectory = join(researchRoot, "linked-output");
    await mkdir(researchRoot, { recursive: true });
    await symlink(externalRoot, linkedDirectory, "dir");
    try {
      const result = await runVisualiser(fixtureRoot, join(linkedDirectory, "index.html"));

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("output path must not contain symbolic links");
      expect(await Bun.file(join(externalRoot, "index.html")).exists()).toBe(false);
    } finally {
      await rm(linkedDirectory, { force: true });
      await rm(externalRoot, { recursive: true, force: true });
    }
  });

  test("refuses a semantically invalid Shape model", async () => {
    const fixtureRoot = resolve(repoRoot, "fixtures/skills/unix-system-visualiser/invalid-model");
    const outputRoot = join(fixtureRoot, ".research");
    try {
      const result = await runVisualiser(fixtureRoot);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("error: missing grant");
      expect(await Bun.file(join(outputRoot, "unix-system-visualiser/index.html")).exists()).toBe(
        false
      );
    } finally {
      await rm(outputRoot, { recursive: true, force: true });
    }
  });
});

function embeddedAtlas(html) {
  const match = html.match(/const atlas = (.*);/);
  if (!match?.[1]) {
    throw new Error("generated HTML does not contain an atlas model");
  }
  return JSON.parse(match[1]);
}

function inspectionFixture() {
  const declaration = (id, name, module, origin = "authored") => ({
    id,
    name,
    module,
    file: `shape/${module}.shape`,
    origin
  });
  return {
    schemaVersion: 1,
    shapeVersion: "0.7.0",
    documents: [
      { file: "shape/alpha.shape", module: "alpha", imports: ["beta"], origin: "authored" },
      { file: "shape/beta.shape", module: "beta", imports: [], origin: "authored" },
      {
        file: "shape/generated.shape",
        module: "generated",
        imports: [],
        origin: "generated_ast"
      }
    ],
    resources: [
      { ...declaration("alpha::State", "State", "alpha"), traits: [], fingerprints: [] },
      {
        ...declaration(
          "generated::GeneratedSyntaxAnchor",
          "GeneratedSyntaxAnchor",
          "generated",
          "generated_ast"
        ),
        traits: [],
        fingerprints: []
      }
    ],
    components: [
      {
        ...declaration("alpha::Service", "Service", "alpha"),
        classifiers: [],
        grants: [],
        owns: ["alpha::State"],
        functions: []
      },
      {
        ...declaration("beta::Service", "Service", "beta"),
        classifiers: [],
        grants: [],
        owns: [],
        functions: []
      }
    ],
    functions: [],
    relations: [
      {
        ...declaration("alpha::CrossModule", "CrossModule", "alpha"),
        kind: "calls",
        ordered: true,
        from: "alpha::Service",
        to: "beta::Service",
        endpoints: [
          { id: "alpha::Service", index: 0 },
          { id: "beta::Service", index: 1 }
        ],
        fingerprintExpectations: []
      }
    ],
    implementations: [],
    bindings: [],
    rules: [],
    memories: [],
    stats: {}
  };
}

async function runVisualiser(repository, output) {
  const args = [
    "bun",
    generatorPath,
    "--repo",
    repository,
    "--shape-command",
    "bun ../../../../packages/shp-cli/src/index.ts"
  ];
  if (output) {
    args.push("--output", output);
  }
  const child = Bun.spawn(args, {
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe"
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text()
  ]);
  return { exitCode, stdout, stderr };
}
