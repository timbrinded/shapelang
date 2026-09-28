import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

test.each([
  ["native parser packages", "treeSitterNativePackageSpecifiers"],
  ["release targets", "TREE_SITTER_NATIVE_BINDING_TARGETS"]
])("stops a release build when reading the %s fails", (_, failingRead) => {
  const result = runReleaseBuild(failingRead);

  expect(result.stderr).toContain("fixture metadata read failed");
  expect(result.status).toBe(37);
  expect(result.releaseFiles).toEqual([]);
});

test("stops a release build when no release targets are listed", () => {
  const result = runReleaseBuild("no read fails");

  expect(result.stderr).toContain("error: no release targets listed");
  expect(result.status).toBe(1);
  expect(result.releaseFiles).toEqual([]);
});

// Runs a copy of the build script with a fake `bun` whose metadata reads print
// nothing, except that the read whose `-e` source names `failingRead` fails.
function runReleaseBuild(failingRead: string) {
  const root = mkdtempSync(join(tmpdir(), "shape-release-build-"));
  try {
    const scripts = join(root, "scripts");
    const tools = join(root, "tools");
    mkdirSync(scripts);
    mkdirSync(tools);
    const script = join(scripts, "build-release-assets.sh");
    copyFileSync(join(import.meta.dir, "build-release-assets.sh"), script);
    writeFileSync(join(root, "install.sh"), "fixture __SHAPE_DEFAULT_VERSION__\n");
    writeFileSync(join(root, "install.ps1"), "fixture __SHAPE_DEFAULT_VERSION__\n");
    writeFileSync(
      join(tools, "bun"),
      `#!/bin/sh
case "$2" in
  *"$BUILD_TEST_FAILING_READ"*)
    echo "fixture metadata read failed" >&2
    exit 37
    ;;
esac
`,
      { mode: 0o755 }
    );
    for (const name of ["zstd", "sha256sum"]) {
      writeFileSync(join(tools, name), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    }

    const result = spawnSync("bash", [script], {
      cwd: root,
      encoding: "utf8",
      timeout: 10_000,
      env: {
        ...process.env,
        PATH: `${tools}${delimiter}${process.env.PATH ?? ""}`,
        BUILD_TEST_FAILING_READ: failingRead,
        SHAPE_RELEASE_VERSION: "v0.0.0-test"
      }
    });
    expect(result.error).toBeUndefined();
    return {
      status: result.status,
      stderr: result.stderr,
      releaseFiles: ["install.sh", "install.ps1", "checksums.txt"].filter((name) =>
        existsSync(join(root, "dist/release", name))
      )
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
