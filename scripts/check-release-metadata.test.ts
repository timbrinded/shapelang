import { describe, expect, test } from "bun:test";
import { validateReleaseMetadata, type ReleaseMetadata } from "./check-release-metadata";

const synchronized: ReleaseMetadata = {
  cliVersion: "0.7.0",
  codexPluginVersion: "0.7.0",
  claudePluginVersion: "0.7.0",
  releaseNotesVersion: "0.7.0"
};

describe("validateReleaseMetadata", () => {
  test("accepts synchronized CLI and plugin versions", () => {
    expect(validateReleaseMetadata(synchronized)).toEqual({
      version: "0.7.0",
      tag: "v0.7.0",
      pluginTag: "shapelang--v0.7.0"
    });
  });

  test("accepts the matching release tag", () => {
    expect(validateReleaseMetadata(synchronized, "v0.7.0").tag).toBe("v0.7.0");
  });

  test("rejects a mismatched plugin version", () => {
    expect(() => validateReleaseMetadata({ ...synchronized, codexPluginVersion: "0.6.0" })).toThrow(
      "Codex plugin: 0.6.0"
    );
  });

  test("rejects a mismatched release tag", () => {
    expect(() => validateReleaseMetadata(synchronized, "v0.7.1")).toThrow(
      "Release tag v0.7.1 does not match synchronized version v0.7.0"
    );
  });

  test("rejects mismatched release notes", () => {
    expect(() =>
      validateReleaseMetadata({ ...synchronized, releaseNotesVersion: "0.6.0" })
    ).toThrow("Release notes: 0.6.0");
  });

  test("rejects non-release semver forms", () => {
    expect(() => validateReleaseMetadata({ ...synchronized, cliVersion: "0.7.0-beta.1" })).toThrow(
      'CLI package version must be X.Y.Z, got "0.7.0-beta.1"'
    );
  });
});
