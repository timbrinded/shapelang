import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { chmod, copyFile, mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import type { CliContext } from "../../context";
import { CliDiagnosticError, EXIT_FAILURE, EXIT_USAGE } from "../../errors";
import { stdout } from "../../io";
import { SHP_VERSION } from "../../version";

const DEFAULT_REPOSITORY = "timbrinded/shapelang";
const GITHUB_API = "https://api.github.com";

export type UpdateFlags = {
  readonly version?: string;
  readonly dryRun?: boolean;
  readonly path?: string;
};

export type ReleasePlatform = {
  readonly releaseOs: "linux" | "darwin" | "windows";
  readonly releaseArch: "x64" | "arm64";
  readonly assetName: string;
  readonly executableName: "shp" | "shp.exe";
};

export type ReleaseAsset = {
  readonly name: string;
  readonly browserDownloadUrl: string;
  readonly digest?: string;
};

export type ReleaseInfo = {
  readonly tagName: string;
  readonly assets: readonly ReleaseAsset[];
};

export type CommandResult = {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
};

export type ReplaceResult = {
  readonly pending: boolean;
};

export type UpdateServices = {
  readonly fetchJson: (url: string) => Promise<unknown>;
  readonly downloadBytes: (url: string) => Promise<Uint8Array>;
  readonly makeTempDir: () => Promise<string>;
  readonly removeDir: (path: string) => Promise<void>;
  readonly writeFile: (path: string, bytes: Uint8Array) => Promise<void>;
  readonly sha256File: (path: string) => Promise<string>;
  readonly extractTarGz: (archivePath: string, destinationDir: string) => Promise<void>;
  readonly runVersion: (binaryPath: string) => Promise<CommandResult>;
  readonly replaceBinary: (
    sourcePath: string,
    targetPath: string,
    platform: ReleasePlatform
  ) => Promise<ReplaceResult>;
};

export type UpdateOptions = {
  readonly currentVersion: string;
  readonly requestedVersion?: string;
  readonly dryRun: boolean;
  readonly targetPath?: string;
  readonly defaultTargetPath: string;
  readonly processPlatform: NodeJS.Platform;
  readonly processArch: string;
  readonly repository?: string;
};

export default async function update(this: CliContext, flags: UpdateFlags): Promise<void> {
  stdout(
    this,
    await runUpdate({
      currentVersion: SHP_VERSION,
      requestedVersion: flags.version,
      dryRun: flags.dryRun ?? false,
      targetPath: flags.path,
      defaultTargetPath: process.execPath,
      processPlatform: process.platform,
      processArch: process.arch
    })
  );
}

export async function runUpdate(
  options: UpdateOptions,
  services: UpdateServices = defaultUpdateServices
): Promise<string> {
  const targetPath = resolveTargetPath(options.targetPath, options.defaultTargetPath);
  if (!options.targetPath && isUnsafeDefaultTarget(targetPath)) {
    throw usageError(
      `refusing to update ${targetPath}; run a compiled shp binary or pass --path PATH`
    );
  }

  const platform = resolveReleasePlatform(options.processPlatform, options.processArch);
  const currentVersion = normalizeReleaseVersion(options.currentVersion);
  const repository = options.repository ?? DEFAULT_REPOSITORY;

  if (options.requestedVersion) {
    const requestedVersion = normalizeReleaseVersion(options.requestedVersion);
    const comparison = compareReleaseVersions(requestedVersion, currentVersion);
    if (comparison === 0) {
      return `shp ${currentVersion} is already installed\n`;
    }
    if (comparison < 0) {
      throw usageError(
        `target release v${requestedVersion} is older than current version ${currentVersion}`
      );
    }
  }

  const release = parseReleaseInfo(
    await services.fetchJson(releaseApiUrl(repository, options.requestedVersion))
  );
  const targetVersion = normalizeReleaseVersion(release.tagName);
  const comparison = compareReleaseVersions(targetVersion, currentVersion);
  if (!options.requestedVersion && comparison === 0) {
    return `shp ${currentVersion} is already up to date\n`;
  }
  if (!options.requestedVersion && comparison < 0) {
    return `shp ${currentVersion} is newer than latest release ${release.tagName}\n`;
  }

  const archiveAsset = selectReleaseAsset(release, platform.assetName);
  const checksumAsset = selectReleaseAsset(release, "checksums.txt");

  if (options.dryRun) {
    return [
      `would update shp ${currentVersion} -> ${targetVersion}`,
      `release: ${release.tagName}`,
      `asset: ${archiveAsset.name}`,
      `binary: ${targetPath}`,
      ""
    ].join("\n");
  }

  const tempDir = await services.makeTempDir();
  try {
    const archivePath = join(tempDir, archiveAsset.name);
    const checksumBytes = await services.downloadBytes(checksumAsset.browserDownloadUrl);
    await services.writeFile(join(tempDir, checksumAsset.name), checksumBytes);
    await services.writeFile(
      archivePath,
      await services.downloadBytes(archiveAsset.browserDownloadUrl)
    );

    const checksumText = new TextDecoder().decode(checksumBytes);
    const expectedChecksum = expectedChecksumForAsset(checksumText, archiveAsset.name);
    const actualChecksum = await services.sha256File(archivePath);
    if (expectedChecksum !== actualChecksum) {
      throw failureError(`checksum verification failed for ${archiveAsset.name}`);
    }

    await services.extractTarGz(archivePath, tempDir);
    const extractedBinaryPath = join(tempDir, platform.executableName);
    const versionResult = await services.runVersion(extractedBinaryPath);
    if (versionResult.exitCode !== 0) {
      throw failureError(
        `downloaded ${platform.executableName} failed --version: ${versionResult.stderr.trim()}`
      );
    }
    if (versionResult.stdout.trim() !== targetVersion) {
      throw failureError(
        `downloaded ${platform.executableName} reports ${versionResult.stdout.trim()}, expected ${targetVersion}`
      );
    }

    const replaceResult = await services.replaceBinary(extractedBinaryPath, targetPath, platform);
    if (replaceResult.pending) {
      return `staged shp ${targetVersion}; it will replace ${targetPath} after this process exits\n`;
    }
    return `updated shp ${currentVersion} -> ${targetVersion} at ${targetPath}\n`;
  } finally {
    await services.removeDir(tempDir);
  }
}

export function resolveReleasePlatform(platform: NodeJS.Platform, arch: string): ReleasePlatform {
  const releaseOs = platform === "win32" ? "windows" : platform === "darwin" ? "darwin" : platform;
  if (releaseOs !== "linux" && releaseOs !== "darwin" && releaseOs !== "windows") {
    throw usageError(`unsupported operating system: ${platform}`);
  }

  const releaseArch =
    arch === "x64" || arch === "amd64" ? "x64" : arch === "arm64" ? "arm64" : arch;
  if (releaseArch !== "x64" && releaseArch !== "arm64") {
    throw usageError(`unsupported architecture: ${arch}`);
  }
  if (releaseOs === "windows" && releaseArch === "arm64") {
    throw usageError("no shp release asset is published for Windows ARM64");
  }

  return {
    releaseOs,
    releaseArch,
    executableName: releaseOs === "windows" ? "shp.exe" : "shp",
    assetName: `shp-${releaseOs}-${releaseArch}.tar.gz`
  };
}

export function normalizeReleaseVersion(version: string): string {
  const normalized = version.trim().replace(/^v/, "");
  if (!/^\d+\.\d+\.\d+$/.test(normalized)) {
    throw usageError(`invalid release version: ${version}`);
  }
  return normalized;
}

export function compareReleaseVersions(left: string, right: string): number {
  const leftParts = versionParts(left);
  const rightParts = versionParts(right);
  for (let index = 0; index < leftParts.length; index += 1) {
    const leftPart = leftParts[index];
    const rightPart = rightParts[index];
    if (leftPart === undefined || rightPart === undefined) {
      throw usageError("invalid release version comparison");
    }
    if (leftPart !== rightPart) {
      return leftPart > rightPart ? 1 : -1;
    }
  }
  return 0;
}

export function parseReleaseInfo(value: unknown): ReleaseInfo {
  const release = record(value);
  const tagName = release?.tag_name;
  const assets = release?.assets;
  if (typeof tagName !== "string" || !Array.isArray(assets)) {
    throw failureError("GitHub release response is missing tag_name or assets");
  }

  return {
    tagName,
    assets: assets.map(parseReleaseAsset)
  };
}

export function selectReleaseAsset(release: ReleaseInfo, name: string): ReleaseAsset {
  const asset = release.assets.find((candidate) => candidate.name === name);
  if (!asset) {
    throw failureError(`release ${release.tagName} does not include ${name}`);
  }
  return asset;
}

export function expectedChecksumForAsset(checksumsText: string, assetName: string): string {
  for (const line of checksumsText.split(/\r?\n/)) {
    const match = /^([a-fA-F0-9]{64})\s+\*?(.+)$/.exec(line.trim());
    if (!match) {
      continue;
    }

    const [, checksum, path] = match;
    if (checksum && stripLeadingDotSlash(path ?? "") === assetName) {
      return checksum.toLowerCase();
    }
  }
  throw failureError(`checksum for ${assetName} not found`);
}

export function isUnsafeDefaultTarget(path: string): boolean {
  const executable = path.split(/[\\/]/).at(-1)?.toLowerCase();
  return executable === "bun" || executable === "bun.exe";
}

function resolveTargetPath(targetPath: string | undefined, defaultTargetPath: string): string {
  return resolve(targetPath ?? defaultTargetPath);
}

function releaseApiUrl(repository: string, requestedVersion: string | undefined): string {
  if (!requestedVersion) {
    return `${GITHUB_API}/repos/${repository}/releases/latest`;
  }
  return `${GITHUB_API}/repos/${repository}/releases/tags/v${normalizeReleaseVersion(requestedVersion)}`;
}

function parseReleaseAsset(value: unknown): ReleaseAsset {
  const asset = record(value);
  const name = asset?.name;
  const browserDownloadUrl = asset?.browser_download_url;
  const digest = asset?.digest;
  if (typeof name !== "string" || typeof browserDownloadUrl !== "string") {
    throw failureError("GitHub release asset is missing name or browser_download_url");
  }

  return {
    name,
    browserDownloadUrl,
    digest: typeof digest === "string" ? digest : undefined
  };
}

function versionParts(version: string): readonly number[] {
  return normalizeReleaseVersion(version)
    .split(".")
    .map((part) => Number(part));
}

function stripLeadingDotSlash(path: string): string {
  return path.startsWith("./") ? path.slice(2) : path;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function usageError(message: string): CliDiagnosticError {
  return new CliDiagnosticError(`error: ${message}\n`, EXIT_USAGE);
}

function failureError(message: string): CliDiagnosticError {
  return new CliDiagnosticError(`error: ${message}\n`, EXIT_FAILURE);
}

const defaultUpdateServices: UpdateServices = {
  fetchJson: async (url: string) => {
    const response = await fetch(url, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": `shp/${SHP_VERSION}`
      }
    });
    if (!response.ok) {
      throw failureError(`failed to fetch ${url}: ${response.status} ${response.statusText}`);
    }
    return response.json();
  },
  downloadBytes: async (url: string) => {
    const response = await fetch(url, {
      headers: {
        "User-Agent": `shp/${SHP_VERSION}`
      }
    });
    if (!response.ok) {
      throw failureError(`failed to download ${url}: ${response.status} ${response.statusText}`);
    }
    return new Uint8Array(await response.arrayBuffer());
  },
  makeTempDir: () => mkdtemp(join(tmpdir(), "shp-update-")),
  removeDir: (path: string) => rm(path, { recursive: true, force: true }),
  writeFile: (path: string, bytes: Uint8Array) => writeFile(path, bytes),
  sha256File,
  extractTarGz,
  runVersion,
  replaceBinary
};

async function sha256File(path: string): Promise<string> {
  const bytes = Buffer.from(await Bun.file(path).arrayBuffer());
  return createHash("sha256").update(bytes).digest("hex");
}

async function extractTarGz(archivePath: string, destinationDir: string): Promise<void> {
  const result = await runCommand(["tar", "-xzf", archivePath, "-C", destinationDir]);
  if (result.exitCode !== 0) {
    throw failureError(`failed to extract ${archivePath}: ${result.stderr.trim()}`);
  }
}

async function runVersion(binaryPath: string): Promise<CommandResult> {
  return runCommand([binaryPath, "--version"]);
}

async function runCommand(args: readonly string[]): Promise<CommandResult> {
  const subprocess = Bun.spawn([...args], {
    stdout: "pipe",
    stderr: "pipe"
  });
  const [exitCode, stdoutText, stderrText] = await Promise.all([
    subprocess.exited,
    new Response(subprocess.stdout).text(),
    new Response(subprocess.stderr).text()
  ]);
  return { exitCode, stdout: stdoutText, stderr: stderrText };
}

async function replaceBinary(
  sourcePath: string,
  targetPath: string,
  platform: ReleasePlatform
): Promise<ReplaceResult> {
  await mkdir(dirname(targetPath), { recursive: true });
  if (platform.releaseOs === "windows") {
    return replaceWindowsBinary(sourcePath, targetPath);
  }

  const stagedPath = join(dirname(targetPath), `.${basename(targetPath)}.update-${process.pid}`);
  try {
    await copyFile(sourcePath, stagedPath);
    await chmod(stagedPath, 0o755);
    await rename(stagedPath, targetPath);
    return { pending: false };
  } catch (error) {
    await rm(stagedPath, { force: true });
    throw error;
  }
}

async function replaceWindowsBinary(
  sourcePath: string,
  targetPath: string
): Promise<ReplaceResult> {
  const targetDir = dirname(targetPath);
  const token = `${process.pid}-${Date.now()}`;
  const stagedPath = join(targetDir, `.${basename(targetPath)}.update-${token}.exe`);
  const scriptPath = join(targetDir, `.${basename(targetPath)}.update-${token}.ps1`);
  await copyFile(sourcePath, stagedPath);
  await writeFile(scriptPath, windowsReplacementScript());

  const child = spawn(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      scriptPath,
      String(process.pid),
      stagedPath,
      targetPath
    ],
    {
      detached: true,
      stdio: "ignore",
      windowsHide: true
    }
  );
  child.unref();
  return { pending: true };
}

function windowsReplacementScript(): string {
  return [
    "param([int]$ParentProcessId, [string]$Source, [string]$Target)",
    '$ErrorActionPreference = "Stop"',
    "try {",
    "  Wait-Process -Id $ParentProcessId -ErrorAction SilentlyContinue",
    "  Move-Item -Force -LiteralPath $Source -Destination $Target",
    "} finally {",
    "  Remove-Item -LiteralPath $MyInvocation.MyCommand.Path -Force -ErrorAction SilentlyContinue",
    "}",
    ""
  ].join("\n");
}
