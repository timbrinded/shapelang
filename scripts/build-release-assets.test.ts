import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

test.each([1, 2])("stops a release build when metadata read %i fails", (failureAt) => {
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
calls=0
if [ -f "$BUILD_TEST_CALLS" ]; then
  read -r calls < "$BUILD_TEST_CALLS"
fi
calls=$((calls + 1))
printf '%s\\n' "$calls" > "$BUILD_TEST_CALLS"
if [ "$calls" -eq "$BUILD_TEST_FAILURE_AT" ]; then
  echo "fixture metadata read failed" >&2
  exit 37
fi
`,
      { mode: 0o755 }
    );
    for (const name of ["zstd", "sha256sum"]) {
      writeFileSync(join(tools, name), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    }

    const result = spawnSync(process.platform === "win32" ? "bash" : "/bin/bash", [script], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${tools}${delimiter}${process.env.PATH ?? ""}`,
        BUILD_TEST_CALLS: join(root, "calls"),
        BUILD_TEST_FAILURE_AT: String(failureAt),
        SHAPE_RELEASE_VERSION: "v0.0.0-test"
      }
    });

    expect(result.error).toBeUndefined();
    expect(result.stderr).toContain("fixture metadata read failed");
    expect(result.status).toBe(37);
    for (const name of ["install.sh", "install.ps1", "checksums.txt"]) {
      expect(existsSync(join(root, "dist/release", name))).toBe(false);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
