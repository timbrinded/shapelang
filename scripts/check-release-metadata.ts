import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

export type ReleaseMetadata = {
  cliVersion: string;
  codexPluginVersion: string;
  claudePluginVersion: string;
  releaseNotesVersion: string;
};

export type ReleaseVersionPin = {
  file: string;
  snippet: string;
};

export type ValidatedReleaseMetadata = {
  version: string;
  tag: string;
  pluginTag: string;
};

const SEMVER = /^\d+\.\d+\.\d+$/;

function packageVersion(path: string): string {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as { version?: unknown };
  if (typeof parsed.version !== "string") {
    throw new Error(`${path} must declare a string version`);
  }
  return parsed.version;
}

export function releaseVersionPins(version: string): ReleaseVersionPin[] {
  const tag = `v${version}`;
  return [
    { file: "README.md", snippet: `releases/download/${tag}/install.sh` },
    { file: "README.md", snippet: `releases/download/${tag}/install.ps1` },
    { file: "README.md", snippet: `timbrinded/shapelang@${tag}` },
    { file: "README.md", snippet: `version: ${tag}` },
    { file: "README.md", snippet: `shapelang--${tag}` },
    { file: "AGENTS.md", snippet: `version: ${tag}` },
    {
      file: "docs-site/src/content/docs/learn/quickstart.md",
      snippet: `The current docs pin is \`${tag}\``
    },
    {
      file: "docs-site/src/content/docs/learn/quickstart.md",
      snippet: `releases/download/${tag}/install.sh`
    },
    {
      file: "docs-site/src/content/docs/learn/quickstart.md",
      snippet: `releases/download/${tag}/install.ps1`
    },
    {
      file: "docs-site/src/content/docs/learn/quickstart.md",
      snippet: `timbrinded/shapelang@${tag}`
    },
    {
      file: "docs-site/src/content/docs/learn/ci-workflow.md",
      snippet: `timbrinded/shapelang@${tag}`
    },
    {
      file: "docs-site/src/content/docs/learn/ci-workflow.md",
      snippet: `releases/download/${tag}/install.sh`
    },
    {
      file: "docs-site/src/content/docs/learn/ci-workflow.md",
      snippet: `such as \`${tag}\``
    },
    {
      file: "docs-site/src/content/docs/reference/cli.md",
      snippet: `version \`${version}\` / tag \`${tag}\``
    },
    {
      file: "docs-site/src/content/docs/reference/cli.md",
      snippet: `shp update --version ${tag}`
    },
    {
      file: "docs-site/src/content/docs/reference/cli.md",
      snippet: `"shapeVersion": "${version}"`
    },
    {
      file: "docs-site/src/content/docs/reference/local-development.md",
      snippet: `currently \`${version}\` / \`${tag}\``
    },
    {
      file: ".github/prompts/shape-skills-release.md",
      snippet: `current Shape ${tag} CLI`
    },
    {
      file: ".github/prompts/shape-skills-release.md",
      snippet: `contradicted by ${tag}`
    },
    {
      file: "plugins/shapelang/skills/shape-lang/SKILL.md",
      snippet: `Shape ${tag} commands`
    },
    { file: "shape/delivery.shape", snippet: `docs/releases/${tag}.md` }
  ];
}

export function missingReleasePins(
  version: string,
  files: Readonly<Record<string, string>>
): ReleaseVersionPin[] {
  return releaseVersionPins(version).filter((pin) => !files[pin.file]?.includes(pin.snippet));
}

function readReleasePinFiles(repoRoot: string, version: string): Record<string, string> {
  const files: Record<string, string> = {};
  for (const pin of releaseVersionPins(version)) {
    if (files[pin.file] !== undefined) {
      continue;
    }
    files[pin.file] = readFileSync(resolve(repoRoot, pin.file), "utf8");
  }
  return files;
}

export function loadReleaseMetadata(repoRoot: string): ReleaseMetadata {
  const cliVersion = packageVersion(resolve(repoRoot, "packages/shp-cli/package.json"));
  const releaseNotesPath = resolve(repoRoot, `docs/releases/v${cliVersion}.md`);
  const releaseNotes = readFileSync(releaseNotesPath, "utf8");
  const releaseNotesVersion = releaseNotes.match(/^# Shape v(\d+\.\d+\.\d+)$/m)?.[1];
  if (!releaseNotesVersion) {
    throw new Error(`${releaseNotesPath} must start with a "# Shape vX.Y.Z" heading`);
  }

  const missingPins = missingReleasePins(cliVersion, readReleasePinFiles(repoRoot, cliVersion));
  if (missingPins.length > 0) {
    throw new Error(
      [
        `Public release pins must mention ${cliVersion} / v${cliVersion}.`,
        ...missingPins.map((pin) => `${pin.file} is missing ${JSON.stringify(pin.snippet)}`)
      ].join("\n")
    );
  }

  return {
    cliVersion,
    codexPluginVersion: packageVersion(
      resolve(repoRoot, "plugins/shapelang/.codex-plugin/plugin.json")
    ),
    claudePluginVersion: packageVersion(
      resolve(repoRoot, "plugins/shapelang/.claude-plugin/plugin.json")
    ),
    releaseNotesVersion
  };
}

export function validateReleaseMetadata(
  metadata: ReleaseMetadata,
  requestedTag?: string
): ValidatedReleaseMetadata {
  const versions = [
    ["CLI package", metadata.cliVersion],
    ["Codex plugin", metadata.codexPluginVersion],
    ["Claude plugin", metadata.claudePluginVersion],
    ["Release notes", metadata.releaseNotesVersion]
  ] as const;

  for (const [label, version] of versions) {
    if (!SEMVER.test(version)) {
      throw new Error(`${label} version must be X.Y.Z, got "${version}"`);
    }
  }

  const mismatches = versions.filter(([, version]) => version !== metadata.cliVersion);
  if (mismatches.length > 0) {
    throw new Error(
      [
        `Release versions must match the CLI package version ${metadata.cliVersion}.`,
        ...mismatches.map(([label, version]) => `${label}: ${version}`)
      ].join("\n")
    );
  }

  const tag = `v${metadata.cliVersion}`;
  if (requestedTag !== undefined && requestedTag !== tag) {
    throw new Error(`Release tag ${requestedTag} does not match synchronized version ${tag}`);
  }

  return {
    version: metadata.cliVersion,
    tag,
    pluginTag: `shapelang--${tag}`
  };
}

function main(): void {
  const { values } = parseArgs({
    options: {
      "github-output": { type: "boolean", default: false },
      tag: { type: "string" }
    },
    strict: true
  });
  const repoRoot = resolve(import.meta.dir, "..");
  const result = validateReleaseMetadata(loadReleaseMetadata(repoRoot), values.tag);

  if (values["github-output"]) {
    console.log(`version=${result.version}`);
    console.log(`tag=${result.tag}`);
    console.log(`plugin_tag=${result.pluginTag}`);
    return;
  }

  console.log(`Release metadata is synchronized at ${result.tag}.`);
}

if (import.meta.main) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
