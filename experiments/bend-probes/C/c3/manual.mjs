// Manual classification of every C3 flag (function, undeclared channel) at full
// depth, after reading the code on the reported call path. Classes:
//   true  - the I/O happens on a reachable path and no declared effect of the
//           function denotes it
//   map   - the I/O happens, but a declared effect does denote it (its own
//           evidence points at that code); the a-priori channel table missed it
//   fp    - the flagged I/O does not happen (scanner over-approximation or
//           misclassified API)
// Usage: bun manual.mjs  (checks coverage against $CWORK/c3/effects.json)
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { WORK } from "../lib/work.mjs";

const CWD_DEFAULT = "process.cwd() fallback when no repoRoot/files are supplied (checker result depends on the working directory)";
export const MANUAL = {
  "ShapeIncrementalChecker.check env": ["true", `${CWD_DEFAULT}: incremental.ts checkOptionsKey and api.ts normalizeCheckOptions`],
  "ShapeChecker.checkShapeFiles env": ["true", `${CWD_DEFAULT}: api.ts normalizeCheckOptions`],
  "ShapeChecker.checkShapeModules env": ["true", `${CWD_DEFAULT}: api.ts normalizeCheckOptions`],
  "ShapeChecker.inspectShapeModules env": ["true", `${CWD_DEFAULT}: inspection.ts:173`],
  "CiPipeline.runReleaseCanaries env": ["true", "copies process.env into every canary subprocess"],
  "CiPipeline.runReleaseCanaries subprocess": ["map", "spawnSync('bash') runs the release binary; declared Read<ReleaseArtifact> cites rewriteCanaryCommand"],
  "CiPipeline.validateShippedSkills bun-other": ["fp", "Bun.YAML.parse is a pure parser; unknown Bun API conservatively flagged"],
  "CiPipeline.validateShippedSkills subprocess": ["map", "spawns node --check and bun shp --help; declared Read<CommandLineInterface> cites validateCurrentCliExamples"],
  "ShapeAstGenerator.generateShapeFromSourceFiles env": ["true", "process.platform/arch select the tree-sitter native binding; NativeParserAsset not declared"],
  "ShapeAstGenerator.generateShapeFromSourceFiles process": ["true", "process.report.getReport() for musl detection (system read; channel label should be env)"],
  "ShapeAstGenerator.parseSourceFilesToCodeSemanticGraph env": ["true", "same native-binding platform detection"],
  "ShapeAstGenerator.parseSourceFilesToCodeSemanticGraph process": ["true", "same process.report read"],
  "ShapeEditorServices.getCompletions fs-read": ["fp", "langium NodeFileSystem is wired into services but parseShapeModule parses a string"],
  "ShapeEditorServices.getEditorDiagnostics env": ["true", `${CWD_DEFAULT}: calls checkShapeModules without options`],
  "ShapeEditorServices.getEditorDiagnostics fs-read": ["fp", "NodeFileSystem reference, never used to read"],
  "ShapeEditorServices.getEditorDiagnosticsForDocuments env": ["true", `${CWD_DEFAULT}: calls checkShapeModules without options`],
  "ShapeEditorServices.getHoverText fs-read": ["fp", "NodeFileSystem reference, never used to read"],
  "ShapeLanguageServer.serve env": ["true", "server.ts:48 uses process.cwd() as the fallback workspace root"],
  "ShpCli.attestPrune env": ["true", "base-model.ts and shape-files.ts read process.cwd()"],
  "ShpCli.attestPrune subprocess": ["map", "git merge-base/ls-tree/show read base Shape sources; declared Read<ShapeSource>"],
  "ShpCli.defaultShapeFiles env": ["true", "globs shape/**/*.shape under process.cwd()"],
  "ShpCli.inspectShapeModel env": ["true", "projectRelativePath and inspectShapeModules read process.cwd()"],
  "ShpCli.loadBaseModules env": ["true", "relative(process.cwd(), ...) for the selection"],
  "ShpCli.loadBaseModules subprocess": ["map", "git reads of base Shape sources; declared Read<ShapeSource>"],
  "ShpCli.main env": ["true", "Bun.argv; main declares no CommandLineInterface effect"],
  "ShpCli.main network": ["map", "update command downloads release metadata/archives (declared Read<ReleaseMetadata>/<ReleaseArchive> via update)"],
  "ShpCli.main process": ["true", "sets process.exitCode"],
  "ShpCli.runShapeFileCheck env": ["true", `${CWD_DEFAULT}: defaultShapeFiles and normalizeCheckOptions`],
  "ShpCli.updateInstalledBinary clock": ["true", "Date.now() token in replaceWindowsBinary (Windows path)"],
  "ShpCli.updateInstalledBinary env": ["true", "process.execPath/platform/arch choose target path and release asset"],
  "ShpCli.updateInstalledBinary network": ["map", "fetch of release metadata, checksum and archive; declared Read<ReleaseMetadata>, Read<ReleaseArchive>, Read<ReleaseChecksumManifest>"],
  "ShpCli.updateInstalledBinary subprocess": ["map", "tar extraction and Windows replacement script; declared Read<ReleaseArchive>, Update<InstalledShpBinary>"]
};

const rows = JSON.parse(readFileSync(join(WORK, "c3/effects.json"), "utf8"));
const flags = [];
for (const r of rows.filter((r) => r.status === "resolved")) {
  for (const c of r.byDepth.inf.undeclared) flags.push(`${r.id.split("::").pop()} ${c}`);
}
const missing = flags.filter((f) => !MANUAL[f]);
const stale = Object.keys(MANUAL).filter((k) => !flags.includes(k));
if (missing.length || stale.length) throw new Error(`unclassified: ${missing.join("; ")} | stale: ${stale.join("; ")}`);
const n = (cls) => flags.filter((f) => MANUAL[f][0] === cls).length;
console.log(`flags ${flags.length}: true ${n("true")}, map ${n("map")}, fp ${n("fp")}`);
console.log(`precision (true discrepancies / flags): ${(100 * n("true") / flags.length).toFixed(1)}%`);
console.log(`precision (real I/O, true+map / flags): ${(100 * (n("true") + n("map")) / flags.length).toFixed(1)}%`);
const fns = [...new Set(flags.map((f) => f.split(" ")[0]))];
const fnTrue = fns.filter((fn) => flags.some((f) => f.startsWith(`${fn} `) && MANUAL[f][0] === "true"));
console.log(`functions flagged ${fns.length}, with at least one true discrepancy ${fnTrue.length} (${(100 * fnTrue.length / fns.length).toFixed(1)}%)`);
const byChannel = {};
for (const f of flags) {
  const c = f.split(" ")[1];
  byChannel[c] ??= { true: 0, map: 0, fp: 0 };
  byChannel[c][MANUAL[f][0]]++;
}
console.log(byChannel);
