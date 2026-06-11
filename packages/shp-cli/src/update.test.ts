import { describe, expect, test } from "bun:test";
import {
  compareReleaseVersions,
  decideReleaseUpdate,
  decideRequestedVersion,
  expectedChecksumForAsset,
  isUnsafeDefaultTarget,
  normalizeReleaseVersion,
  parseReleaseInfo,
  resolveReleasePlatform,
  runUpdate,
  selectReleaseAsset,
  windowsReplacementScript,
  type ReleasePlatform,
  type UpdateServices
} from "./commands/update/impl";

describe("shp update helpers", () => {
  test("maps host platforms to release assets", () => {
    expect(resolveReleasePlatform("linux", "x64")).toEqual({
      releaseOs: "linux",
      releaseArch: "x64",
      executableName: "shp",
      assetName: "shp-linux-x64.tar.gz"
    });
    expect(resolveReleasePlatform("darwin", "arm64").assetName).toBe("shp-darwin-arm64.tar.gz");
    expect(resolveReleasePlatform("win32", "x64")).toEqual({
      releaseOs: "windows",
      releaseArch: "x64",
      executableName: "shp.exe",
      assetName: "shp-windows-x64.tar.gz"
    });
    expect(() => resolveReleasePlatform("darwin", "x64")).toThrow(
      "no shp release asset is published for darwin x64"
    );
    expect(() => resolveReleasePlatform("win32", "arm64")).toThrow(
      "no shp release asset is published for windows arm64"
    );
  });

  test("normalizes and compares release versions semver-style", () => {
    expect(normalizeReleaseVersion("v0.3.0")).toBe("0.3.0");
    expect(compareReleaseVersions("0.10.0", "0.2.0")).toBe(1);
    expect(compareReleaseVersions("1.0.0", "1.0.0")).toBe(0);
    expect(compareReleaseVersions("0.2.0", "0.10.0")).toBe(-1);
  });

  test("decides requested-version and release-version policies separately", () => {
    expect(
      decideRequestedVersion({ installedVersion: "0.4.0", requestedVersion: "0.4.0" })
    ).toEqual({
      kind: "skip",
      message: "shp 0.4.0 is already installed\n"
    });
    expect(
      decideRequestedVersion({ installedVersion: "0.5.0", requestedVersion: "0.4.0" })
    ).toEqual({
      kind: "reject",
      message: "target release v0.4.0 is older than installed version 0.5.0"
    });
    expect(
      decideReleaseUpdate({
        currentVersion: "0.4.0",
        installedVersion: "0.5.0",
        targetVersion: "0.4.0",
        releaseTagName: "v0.4.0"
      })
    ).toEqual({
      kind: "skip",
      message: "shp 0.5.0 is newer than latest release v0.4.0\n"
    });
  });

  test("parses checksums with or without a leading dot slash", () => {
    const checksums = [
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa  ./shp-linux-x64.tar.gz",
      "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb  install.sh"
    ].join("\n");

    expect(expectedChecksumForAsset(checksums, "shp-linux-x64.tar.gz")).toBe(
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    );
    expect(expectedChecksumForAsset(checksums, "install.sh")).toBe(
      "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    );
  });

  test("parses release JSON and selects assets", () => {
    const release = parseReleaseInfo({
      tag_name: "v0.3.0",
      assets: [
        {
          name: "checksums.txt",
          browser_download_url: "https://example.test/checksums.txt"
        },
        {
          name: "shp-linux-x64.tar.gz",
          browser_download_url: "https://example.test/shp-linux-x64.tar.gz",
          digest: "sha256:abc"
        }
      ]
    });

    expect(release.tagName).toBe("v0.3.0");
    expect(selectReleaseAsset(release, "shp-linux-x64.tar.gz")).toEqual({
      name: "shp-linux-x64.tar.gz",
      browserDownloadUrl: "https://example.test/shp-linux-x64.tar.gz",
      digest: "sha256:abc"
    });
  });

  test("rejects malformed release and asset JSON", () => {
    expect(() => parseReleaseInfo({ tag_name: "v0.3.0", assets: "missing" })).toThrow(
      "GitHub release response is missing tag_name or assets"
    );
    expect(() =>
      parseReleaseInfo({
        tag_name: "v0.3.0",
        assets: [{ name: "shp-linux-x64.tar.gz" }]
      })
    ).toThrow("GitHub release asset is missing name or browser_download_url");
  });

  test("recognizes Bun runtime paths as unsafe default targets", () => {
    expect(isUnsafeDefaultTarget("/home/user/.bun/bin/bun")).toBe(true);
    expect(isUnsafeDefaultTarget("C:\\Users\\User\\.bun\\bin\\bun.exe")).toBe(true);
    expect(isUnsafeDefaultTarget("/home/user/.local/bin/shp")).toBe(false);
  });

  test("runs the update flow with mocked services", async () => {
    const writes: string[] = [];
    const downloads: string[] = [];
    const extracted: string[] = [];
    const replaced: string[] = [];
    let removedTemp = false;

    const services: UpdateServices = {
      fetchJson: async () => ({
        tag_name: "v0.4.0",
        assets: [
          {
            name: "checksums.txt",
            browser_download_url: "https://example.test/checksums.txt"
          },
          {
            name: "shp-linux-x64.tar.gz",
            browser_download_url: "https://example.test/shp-linux-x64.tar.gz"
          }
        ]
      }),
      downloadBytes: async (url: string) => {
        downloads.push(url);
        if (url.endsWith("checksums.txt")) {
          return new TextEncoder().encode(
            "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc  shp-linux-x64.tar.gz\n"
          );
        }
        return new Uint8Array([1, 2, 3]);
      },
      makeTempDir: async () => "/tmp/shp-update-test",
      removeDir: async (path: string) => {
        removedTemp = path === "/tmp/shp-update-test";
      },
      pathExists: async (path: string) =>
        path === "/opt/bin/shp" || path === "/tmp/shp-update-test/tree-sitter-language-pack",
      writeFile: async (path: string) => {
        writes.push(path);
      },
      sha256File: async () => "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      extractTarGz: async (archivePath: string, destinationDir: string) => {
        extracted.push(`${archivePath}:${destinationDir}`);
      },
      runVersion: async (binaryPath: string) => ({
        exitCode: 0,
        stdout: binaryPath === "/opt/bin/shp" ? "0.3.0\n" : "0.4.0\n",
        stderr: ""
      }),
      runHelp: async () => validShpHelp(),
      replaceBinary: async (
        sourcePath: string,
        targetPath: string,
        platform: ReleasePlatform,
        parserAssetsPath: string
      ) => {
        replaced.push(`${sourcePath}:${targetPath}:${platform.assetName}:${parserAssetsPath}`);
        return { pending: false };
      }
    };

    const output = await runUpdate(
      {
        currentVersion: "0.3.0",
        dryRun: false,
        targetPath: "/opt/bin/shp",
        defaultTargetPath: "/usr/bin/shp",
        processPlatform: "linux",
        processArch: "x64"
      },
      services
    );

    expect(output).toBe("updated shp 0.3.0 -> 0.4.0 at /opt/bin/shp\n");
    expect(downloads).toEqual([
      "https://example.test/checksums.txt",
      "https://example.test/shp-linux-x64.tar.gz"
    ]);
    expect(writes).toEqual([
      "/tmp/shp-update-test/checksums.txt",
      "/tmp/shp-update-test/shp-linux-x64.tar.gz"
    ]);
    expect(extracted).toEqual(["/tmp/shp-update-test/shp-linux-x64.tar.gz:/tmp/shp-update-test"]);
    expect(replaced).toEqual([
      "/tmp/shp-update-test/shp:/opt/bin/shp:shp-linux-x64.tar.gz:/tmp/shp-update-test/tree-sitter-language-pack"
    ]);
    expect(removedTemp).toBe(true);
  });

  test("updates an explicit stale target when the running version matches latest", async () => {
    const replaced: string[] = [];
    const versionChecks: string[] = [];

    const services: UpdateServices = {
      fetchJson: async () => ({
        tag_name: "v0.4.0",
        assets: [
          {
            name: "checksums.txt",
            browser_download_url: "https://example.test/checksums.txt"
          },
          {
            name: "shp-linux-x64.tar.gz",
            browser_download_url: "https://example.test/shp-linux-x64.tar.gz"
          }
        ]
      }),
      downloadBytes: async (url: string) => {
        if (url.endsWith("checksums.txt")) {
          return new TextEncoder().encode(
            "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc  shp-linux-x64.tar.gz\n"
          );
        }
        return new Uint8Array([1, 2, 3]);
      },
      makeTempDir: async () => "/tmp/shp-update-test",
      removeDir: async () => {},
      pathExists: async (path: string) =>
        path === "/tmp/stale-shp" || path === "/tmp/shp-update-test/tree-sitter-language-pack",
      writeFile: async () => {},
      sha256File: async () => "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      extractTarGz: async () => {},
      runVersion: async (binaryPath: string) => {
        versionChecks.push(binaryPath);
        return {
          exitCode: 0,
          stdout: binaryPath === "/tmp/stale-shp" ? "0.3.0\n" : "0.4.0\n",
          stderr: ""
        };
      },
      runHelp: async () => validShpHelp(),
      replaceBinary: async (
        sourcePath: string,
        targetPath: string,
        platform: ReleasePlatform,
        parserAssetsPath: string
      ) => {
        replaced.push(`${sourcePath}:${targetPath}:${platform.assetName}:${parserAssetsPath}`);
        return { pending: false };
      }
    };

    const output = await runUpdate(
      {
        currentVersion: "0.4.0",
        dryRun: false,
        targetPath: "/tmp/stale-shp",
        defaultTargetPath: "/usr/bin/shp",
        processPlatform: "linux",
        processArch: "x64"
      },
      services
    );

    expect(output).toBe("updated shp 0.3.0 -> 0.4.0 at /tmp/stale-shp\n");
    expect(versionChecks).toEqual(["/tmp/stale-shp", "/tmp/shp-update-test/shp"]);
    expect(replaced).toEqual([
      "/tmp/shp-update-test/shp:/tmp/stale-shp:shp-linux-x64.tar.gz:/tmp/shp-update-test/tree-sitter-language-pack"
    ]);
  });

  test("accepts older shp help text when validating an explicit target", async () => {
    const downloads: string[] = [];
    const services: UpdateServices = {
      fetchJson: async () => ({
        tag_name: "v0.4.0",
        assets: [
          {
            name: "checksums.txt",
            browser_download_url: "https://example.test/checksums.txt"
          },
          {
            name: "shp-linux-x64.tar.gz",
            browser_download_url: "https://example.test/shp-linux-x64.tar.gz"
          }
        ]
      }),
      downloadBytes: async (url: string) => {
        downloads.push(url);
        return new Uint8Array();
      },
      makeTempDir: async () => "/tmp/shp-update-test",
      removeDir: async () => {},
      pathExists: async (path: string) => path === "/tmp/older-shp",
      writeFile: async () => {},
      sha256File: async () => "",
      extractTarGz: async () => {},
      runVersion: async () => ({ exitCode: 0, stdout: "0.3.0\n", stderr: "" }),
      runHelp: async () => olderShpHelp(),
      replaceBinary: async () => ({ pending: false })
    };

    const output = await runUpdate(
      {
        currentVersion: "0.4.0",
        dryRun: true,
        targetPath: "/tmp/older-shp",
        defaultTargetPath: "/usr/bin/shp",
        processPlatform: "linux",
        processArch: "x64"
      },
      services
    );

    expect(output).toContain("would update shp 0.3.0 -> 0.4.0");
    expect(downloads).toEqual([]);
  });

  test("rejects an existing explicit target that is not a shp binary", async () => {
    const services: UpdateServices = {
      fetchJson: async () => {
        throw new Error("release fetch should not run");
      },
      downloadBytes: async () => new Uint8Array(),
      makeTempDir: async () => "/tmp/shp-update-test",
      removeDir: async () => {},
      pathExists: async (path: string) => path === "/tmp/not-shp",
      writeFile: async () => {},
      sha256File: async () => "",
      extractTarGz: async () => {},
      runVersion: async () => ({ exitCode: 0, stdout: "other-tool 1.2.3\n", stderr: "" }),
      runHelp: async () => ({ exitCode: 0, stdout: "usage: other-tool\n", stderr: "" }),
      replaceBinary: async () => ({ pending: false })
    };

    let message = "";
    try {
      await runUpdate(
        {
          currentVersion: "0.3.0",
          dryRun: false,
          targetPath: "/tmp/not-shp",
          defaultTargetPath: "/usr/bin/shp",
          processPlatform: "linux",
          processArch: "x64"
        },
        services
      );
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain("existing --path target /tmp/not-shp did not identify as shp");
  });

  test("rejects an existing explicit target that only reports a bare semver", async () => {
    const services: UpdateServices = {
      fetchJson: async () => {
        throw new Error("release fetch should not run");
      },
      downloadBytes: async () => new Uint8Array(),
      makeTempDir: async () => "/tmp/shp-update-test",
      removeDir: async () => {},
      pathExists: async (path: string) => path === "/tmp/semver-tool",
      writeFile: async () => {},
      sha256File: async () => "",
      extractTarGz: async () => {},
      runVersion: async () => ({ exitCode: 0, stdout: "1.2.3\n", stderr: "" }),
      runHelp: async () => ({ exitCode: 0, stdout: "usage: semver-tool\n", stderr: "" }),
      replaceBinary: async () => ({ pending: false })
    };

    let message = "";
    try {
      await runUpdate(
        {
          currentVersion: "0.3.0",
          dryRun: false,
          targetPath: "/tmp/semver-tool",
          defaultTargetPath: "/usr/bin/shp",
          processPlatform: "linux",
          processArch: "x64"
        },
        services
      );
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain("existing --path target /tmp/semver-tool did not identify as shp");
  });

  test("dry run resolves the release without downloading", async () => {
    const downloads: string[] = [];
    const services: UpdateServices = {
      fetchJson: async () => ({
        tag_name: "v0.4.0",
        assets: [
          {
            name: "checksums.txt",
            browser_download_url: "https://example.test/checksums.txt"
          },
          {
            name: "shp-linux-x64.tar.gz",
            browser_download_url: "https://example.test/shp-linux-x64.tar.gz"
          }
        ]
      }),
      downloadBytes: async (url: string) => {
        downloads.push(url);
        return new Uint8Array();
      },
      makeTempDir: async () => "/tmp/shp-update-test",
      removeDir: async () => {},
      pathExists: async () => false,
      writeFile: async () => {},
      sha256File: async () => "",
      extractTarGz: async () => {},
      runVersion: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
      runHelp: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
      replaceBinary: async () => ({ pending: false })
    };

    const output = await runUpdate(
      {
        currentVersion: "0.3.0",
        dryRun: true,
        targetPath: "/opt/bin/shp",
        defaultTargetPath: "/usr/bin/shp",
        processPlatform: "linux",
        processArch: "x64"
      },
      services
    );

    expect(output).toContain("would update shp 0.3.0 -> 0.4.0");
    expect(output).toContain("asset: shp-linux-x64.tar.gz");
    expect(output).toContain("binary: /opt/bin/shp");
    expect(downloads).toEqual([]);
  });

  test("cleans up staged Windows binary if deferred replacement fails", () => {
    const script = windowsReplacementScript();

    expect(script).toContain("} catch {");
    expect(script).toContain('$BackupAssets = "$TargetAssets.previous-$ParentProcessId"');
    expect(script.indexOf("Move-Item -Force -LiteralPath $SourceAssets")).toBeLessThan(
      script.indexOf("Move-Item -Force -LiteralPath $Source -Destination $Target")
    );
    expect(script).toContain(
      "Move-Item -Force -LiteralPath $SourceAssets -Destination $TargetAssets"
    );
    expect(script).toContain(
      "Remove-Item -LiteralPath $Source -Force -ErrorAction SilentlyContinue"
    );
    expect(script).toContain(
      "Remove-Item -Recurse -Force -LiteralPath $SourceAssets -ErrorAction SilentlyContinue"
    );
    expect(script).toContain(
      "Remove-Item -LiteralPath $MyInvocation.MyCommand.Path -Force -ErrorAction SilentlyContinue"
    );
  });
});

describe("shp update failure paths", () => {
  test("failure harness baseline performs a full update", async () => {
    const { services, calls } = failureHarness();

    const output = await runUpdate(baseUpdateOptions(), services);

    expect(output).toBe("updated shp 0.3.0 -> 0.4.0 at /opt/bin/shp\n");
    expect(calls.replaced).toHaveLength(1);
    expect(calls.removedDirs).toEqual(["/tmp/shp-update-test"]);
  });

  test("rejects an archive whose checksum does not match checksums.txt", async () => {
    const { services, calls } = failureHarness({
      sha256File: async () => "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
    });

    const message = await runUpdateFailureMessage(services);

    expect(message).toContain("checksum verification failed for shp-linux-x64.tar.gz");
    expect(calls.replaced).toEqual([]);
    expect(calls.removedDirs).toEqual(["/tmp/shp-update-test"]);
  });

  test("rejects a checksums.txt that has no entry for the archive", async () => {
    const { services, calls } = failureHarness({
      downloadBytes: async (url: string) => {
        if (url.endsWith("checksums.txt")) {
          return new TextEncoder().encode(
            "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc  shp-darwin-arm64.tar.gz\n"
          );
        }
        return new Uint8Array([1, 2, 3]);
      }
    });

    const message = await runUpdateFailureMessage(services);

    expect(message).toContain("checksum for shp-linux-x64.tar.gz not found");
    expect(calls.replaced).toEqual([]);
    expect(calls.removedDirs).toEqual(["/tmp/shp-update-test"]);
  });

  test("rejects a release that is missing the platform archive asset", async () => {
    const { services, calls } = failureHarness({
      fetchJson: async () => ({
        tag_name: "v0.4.0",
        assets: [
          {
            name: "checksums.txt",
            browser_download_url: "https://example.test/checksums.txt"
          }
        ]
      })
    });

    const message = await runUpdateFailureMessage(services);

    expect(message).toContain("does not include shp-linux-x64.tar.gz");
    expect(calls.replaced).toEqual([]);
    // The failure happens while selecting assets, before any temp dir exists.
    expect(calls.tempDirs).toBe(0);
    expect(calls.removedDirs).toEqual([]);
  });

  test("rejects a release that is missing checksums.txt", async () => {
    const { services, calls } = failureHarness({
      fetchJson: async () => ({
        tag_name: "v0.4.0",
        assets: [
          {
            name: "shp-linux-x64.tar.gz",
            browser_download_url: "https://example.test/shp-linux-x64.tar.gz"
          }
        ]
      })
    });

    const message = await runUpdateFailureMessage(services);

    expect(message).toContain("does not include checksums.txt");
    expect(calls.replaced).toEqual([]);
    expect(calls.tempDirs).toBe(0);
    expect(calls.removedDirs).toEqual([]);
  });

  test("rejects an extracted archive missing the parser assets", async () => {
    const { services, calls } = failureHarness({
      pathExists: async (path: string) => path === "/opt/bin/shp"
    });

    const message = await runUpdateFailureMessage(services);

    expect(message).toContain(
      "shp-linux-x64.tar.gz is missing tree-sitter-language-pack parser assets"
    );
    expect(calls.replaced).toEqual([]);
    expect(calls.removedDirs).toEqual(["/tmp/shp-update-test"]);
  });

  test("rejects a downloaded binary that fails --version", async () => {
    const { services, calls } = failureHarness({
      runVersion: async (binaryPath: string) =>
        binaryPath === "/opt/bin/shp"
          ? { exitCode: 0, stdout: "0.3.0\n", stderr: "" }
          : { exitCode: 1, stdout: "", stderr: "boom" }
    });

    const message = await runUpdateFailureMessage(services);

    expect(message).toContain("downloaded shp failed --version: boom");
    expect(calls.replaced).toEqual([]);
    expect(calls.removedDirs).toEqual(["/tmp/shp-update-test"]);
  });

  test("rejects a downloaded binary that reports the wrong version", async () => {
    const { services, calls } = failureHarness({
      runVersion: async (binaryPath: string) => ({
        exitCode: 0,
        stdout: binaryPath === "/opt/bin/shp" ? "0.3.0\n" : "0.3.9\n",
        stderr: ""
      })
    });

    const message = await runUpdateFailureMessage(services);

    expect(message).toContain("downloaded shp reports 0.3.9, expected 0.4.0");
    expect(calls.replaced).toEqual([]);
    expect(calls.removedDirs).toEqual(["/tmp/shp-update-test"]);
  });

  test("propagates a download failure and still removes the temp dir", async () => {
    const { services, calls } = failureHarness({
      downloadBytes: async () => {
        throw new Error("network down");
      }
    });

    const message = await runUpdateFailureMessage(services);

    expect(message).toContain("network down");
    expect(calls.replaced).toEqual([]);
    expect(calls.removedDirs).toEqual(["/tmp/shp-update-test"]);
  });
});

type FailureHarnessCalls = {
  replaced: string[];
  removedDirs: string[];
  tempDirs: number;
};

// Known-good mocked update flow (mirrors "runs the update flow with mocked
// services"); each failure test overrides exactly one service so the rejection
// is attributable to that single seam.
function failureHarness(overrides: Partial<UpdateServices> = {}): {
  services: UpdateServices;
  calls: FailureHarnessCalls;
} {
  const calls: FailureHarnessCalls = { replaced: [], removedDirs: [], tempDirs: 0 };
  const services: UpdateServices = {
    fetchJson: async () => ({
      tag_name: "v0.4.0",
      assets: [
        {
          name: "checksums.txt",
          browser_download_url: "https://example.test/checksums.txt"
        },
        {
          name: "shp-linux-x64.tar.gz",
          browser_download_url: "https://example.test/shp-linux-x64.tar.gz"
        }
      ]
    }),
    downloadBytes: async (url: string) => {
      if (url.endsWith("checksums.txt")) {
        return new TextEncoder().encode(
          "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc  shp-linux-x64.tar.gz\n"
        );
      }
      return new Uint8Array([1, 2, 3]);
    },
    makeTempDir: async () => {
      calls.tempDirs += 1;
      return "/tmp/shp-update-test";
    },
    removeDir: async (path: string) => {
      calls.removedDirs.push(path);
    },
    pathExists: async (path: string) =>
      path === "/opt/bin/shp" || path === "/tmp/shp-update-test/tree-sitter-language-pack",
    writeFile: async () => {},
    sha256File: async () => "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    extractTarGz: async () => {},
    runVersion: async (binaryPath: string) => ({
      exitCode: 0,
      stdout: binaryPath === "/opt/bin/shp" ? "0.3.0\n" : "0.4.0\n",
      stderr: ""
    }),
    runHelp: async () => validShpHelp(),
    replaceBinary: async (
      sourcePath: string,
      targetPath: string,
      platform: ReleasePlatform,
      parserAssetsPath: string
    ) => {
      calls.replaced.push(`${sourcePath}:${targetPath}:${platform.assetName}:${parserAssetsPath}`);
      return { pending: false };
    },
    ...overrides
  };
  return { services, calls };
}

function baseUpdateOptions() {
  return {
    currentVersion: "0.3.0",
    dryRun: false,
    targetPath: "/opt/bin/shp",
    defaultTargetPath: "/usr/bin/shp",
    processPlatform: "linux" as const,
    processArch: "x64"
  };
}

async function runUpdateFailureMessage(services: UpdateServices): Promise<string> {
  try {
    await runUpdate(baseUpdateOptions(), services);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("expected runUpdate to fail");
}

function validShpHelp() {
  return {
    exitCode: 0,
    stdout: [
      "USAGE",
      "  shp check [--changed-files changed.txt] <files>...",
      "  shp coverage (--changed-files changed.txt) <files>...",
      "  shp fmt [--check] <files>...",
      "  shp update [--version VERSION] [--dry-run] [--path PATH]",
      "When no files are provided, Shape file commands scan shape/**/*.shape by default.",
      ""
    ].join("\n"),
    stderr: ""
  };
}

function olderShpHelp() {
  return {
    exitCode: 0,
    stdout: [
      "Usage:",
      "  shp check [--changed-files changed.txt] [files...]",
      "  shp coverage --changed-files changed.txt [files...]",
      "  shp fmt [--check] [files...]",
      "When no files are provided, commands scan shape/**/*.shape.",
      ""
    ].join("\n"),
    stderr: ""
  };
}
