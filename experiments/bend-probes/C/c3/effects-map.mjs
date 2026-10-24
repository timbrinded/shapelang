// Mapping from declared Shape effects to the physical channels the scanner
// observes. Shape's own model declares effects on logical resources, so this
// table records which resources can plausibly be backed by which channel. It
// was written from resource names before looking at scan results, and it is
// deliberately permissive: a declared effect justifies every channel its
// resource could use. Effects on resources not listed justify nothing physical.
//
// Read<R> justifies the "read" channels of R; any other verb (Append, Update,
// Redact, HardDelete, ...) justifies the "write" channels.
const FILE = { read: ["fs-read", "module-load"], write: ["fs-read", "fs-write"] };
const GIT = { read: ["subprocess", "fs-read"], write: ["subprocess", "fs-read", "fs-write"] };
const STDOUT = { read: ["stdio"], write: ["stdio"] };
const CLI = { read: ["env", "process", "stdio"], write: ["stdio", "process"] };
const NET = { read: ["network"], write: ["network"] };
const CLOCK = { read: ["clock"], write: [] };
const FILE_AND_STDOUT = { read: [...FILE.read, "stdio"], write: [...FILE.write, "stdio"] };

export const RESOURCE_CHANNELS = {
  SystemClock: CLOCK,
  // Files in the repository or on the installing machine.
  ShapeSource: FILE,
  LanguageSource: FILE,
  DocsContent: FILE,
  DocsShapeBlock: FILE,
  CiWorkflow: FILE,
  ShapeAgentSkill: FILE,
  InstallScript: FILE,
  NativeParserAsset: FILE,
  CliPackageManifest: FILE,
  PluginPackageManifest: FILE,
  SkillBehaviorFixture: FILE,
  SkillReleaseApproval: FILE,
  SkillReleaseReport: FILE,
  GeneratedAst: FILE,
  GeneratedAstManifest: FILE,
  GeneratedAstContract: FILE,
  LangiumGrammar: FILE,
  ShapeLanguageDefinition: FILE,
  SyntaxHighlighting: FILE,
  ReleaseArtifact: FILE,
  ReleaseArchive: FILE,
  ReleaseChecksumManifest: FILE,
  ReleaseMetadata: FILE,
  InstalledShpBinary: FILE,
  InstalledShpRuntimeAssets: FILE,
  ExperimentalKernelBuildConfiguration: FILE,
  ExperimentalKernelWasmArtifact: FILE,
  ExperimentalKernelBenchmarkResult: FILE,
  ClaudeReviewPrompt: FILE,
  // Written to a file or printed.
  FormattedShape: FILE_AND_STDOUT,
  ShapeModelDraft: FILE_AND_STDOUT,
  // Produced by git (or a changed-files list on disk).
  ChangedFileList: GIT,
  RepositoryFileList: GIT,
  BaseShapeModel: GIT,
  UnifiedDiff: GIT,
  ChangeBaseRevision: GIT,
  ReleaseVersionTag: GIT,
  // Terminal and editor channels.
  DiagnosticText: STDOUT,
  EditorOutput: STDOUT,
  HumanReadableDiagnostics: STDOUT,
  MachineReadableShapeModel: STDOUT,
  LanguageServerProtocol: STDOUT,
  CommandLineInterface: CLI,
  // Network services.
  ClaudeReviewResult: NET,
  PullRequestStatusComment: NET,
  PullRequestDescription: NET
};

// Channels whose absence makes a declared effect suspicious (declared but not
// observed). Only resources that are nothing but a physical channel qualify.
export const PHYSICAL_ONLY = { SystemClock: "clock" };

export function justifiedChannels(effects) {
  const out = new Set();
  for (const e of effects) {
    const name = e.target?.split("::").pop();
    const entry = RESOURCE_CHANNELS[name];
    if (!entry) continue;
    for (const c of e.name === "Read" ? entry.read : entry.write) out.add(c);
  }
  return out;
}
