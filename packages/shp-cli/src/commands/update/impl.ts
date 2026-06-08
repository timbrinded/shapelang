import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { chmod, copyFile, cp, mkdir, mkdtemp, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { TREE_SITTER_NATIVE_BINDING_TARGETS } from "@shape/shp-checker";
import type { CliContext } from "../../context";
import { CliDiagnosticError, EXIT_FAILURE, EXIT_USAGE, errorMessage } from "../../errors";
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
  readonly pathExists: (path: string) => Promise<boolean>;
  readonly writeFile: (path: string, bytes: Uint8Array) => Promise<void>;
  readonly sha256File: (path: string) => Promise<string>;
  readonly extractTarGz: (archivePath: string, destinationDir: string) => Promise<void>;
  readonly runVersion: (binaryPath: string) => Promise<CommandResult>;
  readonly runHelp: (binaryPath: string) => Promise<CommandResult>;
  readonly replaceBinary: (
    sourcePath: string,
    targetPath: string,
    platform: ReleasePlatform,
    parserAssetsPath: string
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

export type RequestedVersionDecision =
  | { readonly kind: "continue" }
  | { readonly kind: "skip"; readonly message: string }
  | { readonly kind: "reject"; readonly message: string };

export type ReleaseUpdateDecision =
  | { readonly kind: "skip"; readonly message: string }
  | { readonly kind: "update"; readonly versionBeforeUpdate: string };

type RequestedVersionDecisionInput = {
  readonly installedVersion?: string;
  readonly requestedVersion?: string;
};

type ReleaseUpdateDecisionInput = {
  readonly currentVersion: string;
  readonly installedVersion?: string;
  readonly requestedVersion?: string;
  readonly targetVersion: string;
  readonly releaseTagName: string;
};

type ReleaseInfoResponse = {
  readonly tag_name: string;
  readonly assets: readonly unknown[];
};

type ReleaseAssetResponse = {
  readonly name: string;
  readonly browser_download_url: string;
  readonly digest?: unknown;
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
  const installedVersion = await resolveInstalledVersion(
    options.targetPath !== undefined,
    targetPath,
    currentVersion,
    services
  );
  const repository = options.repository ?? DEFAULT_REPOSITORY;

  const requestedVersion =
    options.requestedVersion === undefined
      ? undefined
      : normalizeReleaseVersion(options.requestedVersion);
  const requestedDecision = decideRequestedVersion({ installedVersion, requestedVersion });
  if (requestedDecision.kind === "skip") {
    return requestedDecision.message;
  }
  if (requestedDecision.kind === "reject") {
    throw usageError(requestedDecision.message);
  }

  const release = parseReleaseInfo(
    await services.fetchJson(releaseApiUrl(repository, requestedVersion))
  );
  const targetVersion = normalizeReleaseVersion(release.tagName);
  const releaseDecision = decideReleaseUpdate({
    currentVersion,
    installedVersion,
    requestedVersion,
    targetVersion,
    releaseTagName: release.tagName
  });
  if (releaseDecision.kind === "skip") {
    return releaseDecision.message;
  }
  const versionBeforeUpdate = releaseDecision.versionBeforeUpdate;

  const archiveAsset = selectReleaseAsset(release, platform.assetName);
  const checksumAsset = selectReleaseAsset(release, "checksums.txt");

  if (options.dryRun) {
    return [
      `would update shp ${versionBeforeUpdate} -> ${targetVersion}`,
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
    const extractedParserAssetsPath = join(tempDir, "tree-sitter-language-pack");
    if (!(await services.pathExists(extractedParserAssetsPath))) {
      throw failureError(`${archiveAsset.name} is missing tree-sitter-language-pack parser assets`);
    }
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

    const replaceResult = await services.replaceBinary(
      extractedBinaryPath,
      targetPath,
      platform,
      extractedParserAssetsPath
    );
    if (replaceResult.pending) {
      return `staged shp ${targetVersion}; it will replace ${targetPath} after this process exits\n`;
    }
    return `updated shp ${versionBeforeUpdate} -> ${targetVersion} at ${targetPath}\n`;
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

  const nativeTarget = TREE_SITTER_NATIVE_BINDING_TARGETS.find(
    (target) => target.platform === platform && target.arch === releaseArch
  );
  if (!nativeTarget) {
    throw usageError(`no shp release asset is published for ${releaseOs} ${releaseArch}`);
  }

  return {
    releaseOs,
    releaseArch,
    executableName: releaseOs === "windows" ? "shp.exe" : "shp",
    assetName: `${nativeTarget.releaseName}.tar.gz`
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

export function decideRequestedVersion(
  input: RequestedVersionDecisionInput
): RequestedVersionDecision {
  if (!input.requestedVersion || input.installedVersion === undefined) {
    return { kind: "continue" };
  }

  const requestedComparison = compareReleaseVersions(
    input.requestedVersion,
    input.installedVersion
  );
  if (requestedComparison === 0) {
    return { kind: "skip", message: `shp ${input.installedVersion} is already installed\n` };
  }
  if (requestedComparison < 0) {
    return {
      kind: "reject",
      message: `target release v${input.requestedVersion} is older than installed version ${input.installedVersion}`
    };
  }
  return { kind: "continue" };
}

export function decideReleaseUpdate(input: ReleaseUpdateDecisionInput): ReleaseUpdateDecision {
  if (input.installedVersion !== undefined && !input.requestedVersion) {
    const latestComparison = compareReleaseVersions(input.targetVersion, input.installedVersion);
    if (latestComparison === 0) {
      return { kind: "skip", message: `shp ${input.installedVersion} is already up to date\n` };
    }
    if (latestComparison < 0) {
      return {
        kind: "skip",
        message: `shp ${input.installedVersion} is newer than latest release ${input.releaseTagName}\n`
      };
    }
  }

  return {
    kind: "update",
    versionBeforeUpdate: input.installedVersion ?? input.currentVersion
  };
}

export function parseReleaseInfo(value: unknown): ReleaseInfo {
  if (!isReleaseInfoResponse(value)) {
    throw failureError("GitHub release response is missing tag_name or assets");
  }

  return {
    tagName: value.tag_name,
    assets: value.assets.map(parseReleaseAsset)
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

async function resolveInstalledVersion(
  hasExplicitTargetPath: boolean,
  targetPath: string,
  currentVersion: string,
  services: UpdateServices
): Promise<string | undefined> {
  if (!hasExplicitTargetPath) {
    return currentVersion;
  }

  if (!(await services.pathExists(targetPath))) {
    return undefined;
  }

  let versionResult: CommandResult;
  try {
    versionResult = await services.runVersion(targetPath);
  } catch (error) {
    throw usageError(
      `existing --path target ${targetPath} is not a runnable shp binary: ${errorMessage(error)}`
    );
  }

  if (versionResult.exitCode !== 0) {
    throw usageError(
      `existing --path target ${targetPath} failed --version${formatCommandFailure(versionResult)}`
    );
  }

  const helpResult = await services.runHelp(targetPath);
  if (helpResult.exitCode !== 0 || !hasShpHelpIdentity(helpResult.stdout)) {
    throw usageError(`existing --path target ${targetPath} did not identify as shp`);
  }

  try {
    return normalizeReleaseVersion(versionResult.stdout.trim());
  } catch {
    throw usageError(
      `existing --path target ${targetPath} did not report a valid shp version: ${versionResult.stdout.trim()}`
    );
  }
}

function releaseApiUrl(repository: string, requestedVersion: string | undefined): string {
  if (!requestedVersion) {
    return `${GITHUB_API}/repos/${repository}/releases/latest`;
  }
  return `${GITHUB_API}/repos/${repository}/releases/tags/v${normalizeReleaseVersion(requestedVersion)}`;
}

function parseReleaseAsset(value: unknown): ReleaseAsset {
  if (!isReleaseAssetResponse(value)) {
    throw failureError("GitHub release asset is missing name or browser_download_url");
  }

  return {
    name: value.name,
    browserDownloadUrl: value.browser_download_url,
    digest: typeof value.digest === "string" ? value.digest : undefined
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

function formatCommandFailure(result: CommandResult): string {
  const detail = result.stderr.trim() || result.stdout.trim();
  return detail ? `: ${detail}` : "";
}

function hasShpHelpIdentity(output: string): boolean {
  const normalizedLines = output
    .toLowerCase()
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/\s+/g, " "));
  const hasCommand = (command: string): boolean =>
    normalizedLines.some((line) => line.startsWith(command) || line.includes(` ${command} `));

  return (
    hasCommand("shp check") &&
    hasCommand("shp coverage") &&
    hasCommand("shp fmt") &&
    normalizedLines.some((line) => line.includes("shape"))
  );
}

function isReleaseInfoResponse(value: unknown): value is ReleaseInfoResponse {
  return isRecord(value) && typeof value["tag_name"] === "string" && Array.isArray(value["assets"]);
}

function isReleaseAssetResponse(value: unknown): value is ReleaseAssetResponse {
  return (
    isRecord(value) &&
    typeof value["name"] === "string" &&
    typeof value["browser_download_url"] === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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
  pathExists,
  writeFile: (path: string, bytes: Uint8Array) => writeFile(path, bytes),
  sha256File,
  extractTarGz,
  runVersion,
  runHelp,
  replaceBinary
};

async function sha256File(path: string): Promise<string> {
  const bytes = Buffer.from(await Bun.file(path).arrayBuffer());
  return createHash("sha256").update(bytes).digest("hex");
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function extractTarGz(archivePath: string, destinationDir: string): Promise<void> {
  const result = await runCommand(["tar", "-xzf", archivePath, "-C", destinationDir]);
  if (result.exitCode === 127) {
    throw failureError(
      `failed to run tar while extracting ${archivePath}; install tar or ensure it is on PATH${formatCommandFailure(result)}`
    );
  }
  if (result.exitCode !== 0) {
    throw failureError(`failed to extract ${archivePath}${formatCommandFailure(result)}`);
  }
}

async function runVersion(binaryPath: string): Promise<CommandResult> {
  return runCommand([binaryPath, "--version"]);
}

async function runHelp(binaryPath: string): Promise<CommandResult> {
  return runCommand([binaryPath, "--help"]);
}

async function runCommand(args: readonly string[]): Promise<CommandResult> {
  try {
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
  } catch (error) {
    return { exitCode: 127, stdout: "", stderr: errorMessage(error) };
  }
}

async function replaceBinary(
  sourcePath: string,
  targetPath: string,
  platform: ReleasePlatform,
  parserAssetsPath: string
): Promise<ReplaceResult> {
  await mkdir(dirname(targetPath), { recursive: true });
  if (platform.releaseOs === "windows") {
    return replaceWindowsBinary(sourcePath, targetPath, parserAssetsPath);
  }

  const stagedPath = join(dirname(targetPath), `.${basename(targetPath)}.update-${process.pid}`);
  const targetAssetsPath = join(dirname(targetPath), "tree-sitter-language-pack");
  const stagedAssetsPath = join(
    dirname(targetPath),
    `.tree-sitter-language-pack.update-${process.pid}`
  );
  const backupAssetsPath = join(
    dirname(targetPath),
    `.tree-sitter-language-pack.previous-${process.pid}`
  );
  try {
    await rm(stagedAssetsPath, { recursive: true, force: true });
    await rm(backupAssetsPath, { recursive: true, force: true });
    await cp(parserAssetsPath, stagedAssetsPath, { recursive: true });
    await copyFile(sourcePath, stagedPath);
    await chmod(stagedPath, 0o755);
    if (await pathExists(targetAssetsPath)) {
      await rename(targetAssetsPath, backupAssetsPath);
    }
    await rename(stagedAssetsPath, targetAssetsPath);
    try {
      await rename(stagedPath, targetPath);
    } catch (error) {
      await rm(targetAssetsPath, { recursive: true, force: true });
      if (await pathExists(backupAssetsPath)) {
        await rename(backupAssetsPath, targetAssetsPath);
      }
      throw error;
    }
    await rm(backupAssetsPath, { recursive: true, force: true });
    return { pending: false };
  } catch (error) {
    await rm(stagedPath, { force: true });
    await rm(stagedAssetsPath, { recursive: true, force: true });
    if ((await pathExists(backupAssetsPath)) && !(await pathExists(targetAssetsPath))) {
      await rename(backupAssetsPath, targetAssetsPath);
    }
    throw error;
  }
}

async function replaceWindowsBinary(
  sourcePath: string,
  targetPath: string,
  parserAssetsPath: string
): Promise<ReplaceResult> {
  const targetDir = dirname(targetPath);
  const token = `${process.pid}-${Date.now()}`;
  const stagedPath = join(targetDir, `.${basename(targetPath)}.update-${token}.exe`);
  const stagedAssetsPath = join(targetDir, `.tree-sitter-language-pack.update-${token}`);
  const targetAssetsPath = join(targetDir, "tree-sitter-language-pack");
  const scriptPath = join(targetDir, `.${basename(targetPath)}.update-${token}.ps1`);
  await copyFile(sourcePath, stagedPath);
  await rm(stagedAssetsPath, { recursive: true, force: true });
  await cp(parserAssetsPath, stagedAssetsPath, { recursive: true });
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
      targetPath,
      stagedAssetsPath,
      targetAssetsPath
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

export function windowsReplacementScript(): string {
  return [
    "param([int]$ParentProcessId, [string]$Source, [string]$Target, [string]$SourceAssets, [string]$TargetAssets)",
    '$ErrorActionPreference = "Stop"',
    '$BackupAssets = "$TargetAssets.previous-$ParentProcessId"',
    "try {",
    "  Wait-Process -Id $ParentProcessId -ErrorAction SilentlyContinue",
    "  Remove-Item -Recurse -Force -LiteralPath $BackupAssets -ErrorAction SilentlyContinue",
    "  if (Test-Path -LiteralPath $TargetAssets) {",
    "    Move-Item -Force -LiteralPath $TargetAssets -Destination $BackupAssets",
    "  }",
    "  Move-Item -Force -LiteralPath $SourceAssets -Destination $TargetAssets",
    "  try {",
    "    Move-Item -Force -LiteralPath $Source -Destination $Target",
    "  } catch {",
    "    Remove-Item -Recurse -Force -LiteralPath $TargetAssets -ErrorAction SilentlyContinue",
    "    if (Test-Path -LiteralPath $BackupAssets) {",
    "      Move-Item -Force -LiteralPath $BackupAssets -Destination $TargetAssets",
    "    }",
    "    throw",
    "  }",
    "  Remove-Item -Recurse -Force -LiteralPath $BackupAssets -ErrorAction SilentlyContinue",
    "} catch {",
    "  Remove-Item -LiteralPath $Source -Force -ErrorAction SilentlyContinue",
    "  Remove-Item -Recurse -Force -LiteralPath $SourceAssets -ErrorAction SilentlyContinue",
    "  if ((Test-Path -LiteralPath $BackupAssets) -and -not (Test-Path -LiteralPath $TargetAssets)) {",
    "    Move-Item -Force -LiteralPath $BackupAssets -Destination $TargetAssets",
    "  }",
    "  throw",
    "} finally {",
    "  Remove-Item -LiteralPath $MyInvocation.MyCommand.Path -Force -ErrorAction SilentlyContinue",
    "}",
    ""
  ].join("\n");
}

function errorCode(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = error.code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}
