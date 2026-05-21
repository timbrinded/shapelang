import manifestJson from "../package.json" with { type: "json" };

export const SHP_VERSION = readManifestVersion(manifestJson);

function readManifestVersion(value: unknown): string {
  if (typeof value !== "object" || value === null || !("version" in value)) {
    throw new Error("packages/shp-cli/package.json is missing version");
  }

  const { version } = value;
  if (typeof version !== "string" || version.length === 0) {
    throw new Error("packages/shp-cli/package.json version must be a non-empty string");
  }

  return version;
}
