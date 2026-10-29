#!/usr/bin/env bun
// shape1: the Shape 1.0 prototype checker CLI.
//   check     verdict + obligations (exit 0 pass/owed, 1 blocked, 2 invalid)
//   manifest  build a revision's manifest statement
//   migrate   print the shape.source.v1 a model directory loads as
//   elaborate print the elaborated shape (shape.elaborated.v1)
//   sign      wrap a statement in a DSSE envelope signed with an ed25519 seed
//   keygen    print the ed25519 identity for a seed
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { derive } from "./derive.ts";
import { elaborate } from "./elaborate.ts";
import { type CheckInput, EXIT } from "./io-types.ts";
import { H } from "./jcs.ts";
import {
  type SourceFileBytes,
  buildManifest,
  filesFromDir,
  filesFromGit
} from "./manifest-build.ts";
import {
  type ManifestPredicate,
  type Statement,
  gitTreeId,
  isRecordFile,
  isShapeFile,
  manifestStatement
} from "./manifest.ts";
import {
  loadModel,
  materialiseShape,
  readEvidence,
  readPersisted,
  rewriteAgainst
} from "./loader.ts";
import { parseRecord, signStatement, signerFromSeed } from "./records.ts";
import { coreOutput, renderHuman } from "./render.ts";
import { fromSeconds } from "./util.ts";

interface Args {
  cmd: string;
  flags: Map<string, string[]>;
  bools: Set<string>;
  rest: string[];
}

const BOOLS = new Set([
  "json",
  "core",
  "no-typescript",
  "teeth",
  "help",
  "bot",
  "synthesize",
  "include-generated",
  "no-rewrite"
]);

function parseArgs(argv: string[]): Args {
  const [cmd = "help", ...rest] = argv;
  const flags = new Map<string, string[]>();
  const bools = new Set<string>();
  const pos: string[] = [];
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i] as string;
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      const name = eq > 0 ? a.slice(2, eq) : a.slice(2);
      if (BOOLS.has(name)) bools.add(name);
      else {
        const v = eq > 0 ? a.slice(eq + 1) : (rest[++i] ?? "");
        flags.set(name, [...(flags.get(name) ?? []), v]);
      }
    } else pos.push(a);
  }
  return { cmd, flags, bools, rest: pos };
}

const one = (a: Args, k: string): string | undefined => a.flags.get(k)?.[0];
const many = (a: Args, k: string): string[] => a.flags.get(k) ?? [];

function gitRoot(dir: string): string | null {
  const r = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: dir });
  return r.status === 0 ? r.stdout.toString().trim() : null;
}

function revParse(dir: string, ref: string): string | null {
  const r = spawnSync("git", ["rev-parse", ref], { cwd: dir });
  return r.status === 0 ? r.stdout.toString().trim() : null;
}

/** --synthesize: adds a small TS file per unit binding `ts("path#symbol")` (and per literal
 *  component path) so shape-only fixtures have code identities to attribute. */
function synthesizeFiles(
  files: SourceFileBytes[],
  source: CheckInput["head"]["source"]
): SourceFileBytes[] {
  if (!source) return files;
  const byPath = new Map<string, Set<string>>();
  for (const m of source.modules) {
    for (const d of m.decls) {
      if (d.decl !== "component") continue;
      for (const u of d.units ?? []) {
        const id = u.bind ? /^\s*ts\("([^"#]+)(?:#([^"]+))?"\)\s*$/.exec(u.bind) : null;
        if (!id || !id[1]) continue;
        const syms = byPath.get(id[1]) ?? new Set<string>();
        if (id[2]) syms.add(id[2]);
        byPath.set(id[1], syms);
      }
      for (const p of d.paths ?? [])
        if (!/[*?]/.test(p) && /\.(ts|tsx|js|mjs|cjs)$/.test(p) && !byPath.has(p))
          byPath.set(p, new Set());
    }
  }
  const out = [...files];
  const have = new Set(files.map((f) => f.path));
  for (const [path, syms] of [...byPath.entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1))) {
    if (have.has(path)) continue;
    const text = [...syms]
      .sort()
      .map(
        (s) => `export function ${s.split(".").pop() ?? s}() {\n  return ${JSON.stringify(s)};\n}\n`
      )
      .join("\n");
    out.push({ path, mode: "100644", bytes: new Uint8Array(Buffer.from(text || "export {};\n")) });
  }
  return out;
}

async function manifestFor(
  files: SourceFileBytes[],
  revision: string | undefined,
  noTs: boolean
): Promise<{ statement: Statement; revision: string; backend: string }> {
  const tmpPred: ManifestPredicate = {
    v: "shape.manifest.v1",
    revision: "",
    tree: [],
    entries: []
  };
  void tmpPred;
  const draft = await buildManifest({
    repoRoot: resolve(import.meta.dir, "../../../.."),
    revision: revision ?? "pending",
    files,
    noTypeScript: noTs
  });
  const pred = draft.statement.predicate.shape as ManifestPredicate;
  const rev = revision ?? gitTreeId(pred.tree);
  return {
    statement: manifestStatement({ ...pred, revision: rev }),
    revision: rev,
    backend: draft.backend
  };
}

const HELP = `shape1 — Shape 1.0 prototype checker

  shape1 check --model <dir> [--base <dir|git-ref>] [--evidence <file|dir>]... [--base-evidence <file|dir>]...
               [--changed <changed.txt>] [--mode change|audit|preview] [--now <RFC3339>] [--change-id <id>]...
               [--author <identity>]... [--authors <json>] [--reviews <json>] [--sidecar <file>] [--base-sidecar <file>]
               [--head-rev <git-ref>] [--head-revision <hex>] [--tmp <dir>] [--no-typescript] [--teeth]
               [--maintainer <github-login>]... [--synthesize]
               [--write-input <file>] [--input <input.json|->] [--json | --core]
  shape1 manifest (--root <dir> | --git <repo> --rev <ref>) [--revision <hex>] [--no-typescript]
  shape1 migrate --model <dir> [--sidecar <file>]
  shape1 elaborate --model <dir> [--sidecar <file>]
  shape1 sign --seed <hex> <statement.json>      prints a DSSE envelope; record id on stderr
  shape1 keygen --seed <hex>                     prints ed25519("<public hex>")

exit: 0 pass/owed, 1 blocked, 2 invalid (and 2 on usage errors)`;

async function cmdCheck(a: Args): Promise<number> {
  let input: CheckInput;
  if (one(a, "input")) {
    const src = one(a, "input") as string;
    input = JSON.parse(
      src === "-" ? readFileSync(0, "utf8") : readFileSync(src, "utf8")
    ) as CheckInput;
  } else {
    const model = resolve(one(a, "model") ?? ".");
    const noTs = a.bools.has("no-typescript");
    const mode = (one(a, "mode") ?? "change") as CheckInput["mode"];
    const maintainers = many(a, "maintainer");
    const lopts = { maintainers, includeGenerated: a.bools.has("include-generated") };
    const head = loadModel(model, { sidecar: one(a, "sidecar"), ...lopts });
    const repo = gitRoot(model);
    let headFiles: SourceFileBytes[];
    let headRevision = one(a, "head-revision");
    if (one(a, "head-rev") && repo) {
      headFiles = filesFromGit(repo, one(a, "head-rev") as string);
      headRevision = headRevision ?? revParse(repo, one(a, "head-rev") as string) ?? undefined;
    } else headFiles = filesFromDir(model);
    if (a.bools.has("synthesize")) headFiles = synthesizeFiles(headFiles, head.source);
    const hm = await manifestFor(headFiles, headRevision, noTs);
    const baseArg = one(a, "base");
    let base: CheckInput["base"] = null;
    let basePersisted: { path: string; record: unknown }[] = [];
    if (mode !== "audit") {
      if (baseArg && existsSync(baseArg) && statSync(baseArg).isDirectory()) {
        const bdir = resolve(baseArg);
        let src: CheckInput["head"]["source"] = null;
        try {
          src = loadModel(bdir, { sidecar: one(a, "base-sidecar"), ...lopts }).source;
        } catch {
          src = null;
        }
        let bfiles = filesFromDir(bdir);
        if (a.bools.has("synthesize")) bfiles = synthesizeFiles(bfiles, src);
        const bm = await manifestFor(bfiles, undefined, noTs);
        base = { revision: bm.revision, source: src, manifest: bm.statement };
        basePersisted = readPersisted(bdir);
      } else if (baseArg && repo) {
        const rev = revParse(repo, baseArg);
        if (!rev) throw new Error(`--base ${baseArg} is neither a directory nor a git ref`);
        const dir = materialiseShape(repo, rev, one(a, "tmp"));
        let src: CheckInput["head"]["source"] = null;
        try {
          src = loadModel(dir, { sidecar: one(a, "base-sidecar"), ...lopts }).source;
        } catch {
          src = null;
        }
        const bm = await manifestFor(filesFromGit(repo, rev), rev, noTs);
        const ct = spawnSync("git", ["show", "-s", "--format=%ct", rev], { cwd: repo });
        base = {
          revision: rev,
          source: src,
          manifest: bm.statement,
          ...(ct.status === 0
            ? { committerTime: fromSeconds(Number(ct.stdout.toString().trim())) }
            : {})
        };
        basePersisted = readPersisted(dir);
      } else if (one(a, "changed")) {
        // synthetic base: the head shape over the head manifest without the changed paths
        const changed = new Set(
          readFileSync(one(a, "changed") as string, "utf8")
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean)
        );
        const files = headFiles.filter(
          (f) => !changed.has(f.path) || isShapeFile(f.path) || isRecordFile(f.path)
        );
        const bm = await manifestFor(files, undefined, noTs);
        base = { revision: bm.revision, source: head.source, manifest: bm.statement };
      } else {
        base = { revision: hm.revision, source: head.source, manifest: hm.statement };
      }
    }
    const authors: CheckInput["authors"] = [
      ...(one(a, "authors")
        ? (JSON.parse(readFileSync(one(a, "authors") as string, "utf8")) as CheckInput["authors"])
        : []),
      ...many(a, "author").map((identity) => ({
        identity,
        verified: true,
        bot: /\[bot\]/.test(identity) || a.bools.has("bot")
      }))
    ];
    let headSource = head.source;
    if (!a.bools.has("no-rewrite")) {
      const rw = rewriteAgainst(head.source, hm.statement);
      headSource = rw.source ?? head.source;
      if (base?.source)
        base = { ...base, source: rewriteAgainst(base.source, base.manifest).source };
      if (rw.renames.length > 0)
        process.stderr.write(
          `migrate: rewrote ${rw.renames.length} unit sources against the head manifest\n`
        );
    }
    input = {
      contract: "shape.check.input/v1",
      mode,
      now: one(a, "now") ?? fromSeconds(Math.floor(Date.now() / 1000)),
      head: { revision: hm.revision, source: headSource, manifest: hm.statement },
      base,
      change: { ids: many(a, "change-id").length > 0 ? many(a, "change-id") : ["local"] },
      authors,
      reviews: one(a, "reviews")
        ? (JSON.parse(readFileSync(one(a, "reviews") as string, "utf8")) as CheckInput["reviews"])
        : [],
      records: readEvidence(many(a, "evidence")),
      baseRecords: readEvidence(many(a, "base-evidence")),
      persisted: { base: basePersisted, head: readPersisted(model) },
      options: { health: true, teeth: a.bools.has("teeth") }
    };
    if (head.notes.length > 0 && !a.bools.has("json") && !a.bools.has("core"))
      for (const n of head.notes.slice(0, 20)) process.stderr.write(`migrate: ${n}\n`);
    process.stderr.write(
      `manifest: ${hm.backend}; head ${hm.revision}${base ? `; base ${base.revision}` : ""}\n`
    );
  }
  if (one(a, "write-input"))
    writeFileSync(one(a, "write-input") as string, `${JSON.stringify(input, null, 1)}\n`);
  const out = derive(input);
  if (a.bools.has("core")) process.stdout.write(`${JSON.stringify(coreOutput(out), null, 1)}\n`);
  else if (a.bools.has("json")) process.stdout.write(`${JSON.stringify(out, null, 1)}\n`);
  else process.stdout.write(renderHuman(out));
  return EXIT[out.verdict];
}

async function main(argv: string[]): Promise<number> {
  const a = parseArgs(argv);
  switch (a.cmd) {
    case "check":
      return cmdCheck(a);
    case "manifest": {
      const noTs = a.bools.has("no-typescript");
      let files: SourceFileBytes[];
      let rev = one(a, "revision");
      if (one(a, "git")) {
        const repo = resolve(one(a, "git") as string);
        const ref = one(a, "rev") ?? "HEAD";
        files = filesFromGit(repo, ref);
        rev = rev ?? revParse(repo, ref) ?? undefined;
      } else files = filesFromDir(resolve(one(a, "root") ?? "."));
      const m = await manifestFor(files, rev, noTs);
      process.stderr.write(`manifest: ${m.backend}; revision ${m.revision}\n`);
      process.stdout.write(`${JSON.stringify(m.statement, null, 1)}\n`);
      return 0;
    }
    case "migrate": {
      const m = loadModel(resolve(one(a, "model") ?? "."), { sidecar: one(a, "sidecar") });
      for (const n of m.notes) process.stderr.write(`migrate: ${n}\n`);
      process.stdout.write(`${JSON.stringify(m.source, null, 1)}\n`);
      return 0;
    }
    case "elaborate": {
      const m = loadModel(resolve(one(a, "model") ?? "."), { sidecar: one(a, "sidecar") });
      const esf = elaborate(m.source, { now: Math.floor(Date.now() / 1000) });
      process.stdout.write(`${JSON.stringify(esf, null, 1)}\n`);
      return esf.errors.length > 0 ? 1 : 0;
    }
    case "sign": {
      const seed = one(a, "seed");
      const file = a.rest[0];
      if (!seed || !file) {
        process.stderr.write(`${HELP}\n`);
        return 2;
      }
      const stmt = JSON.parse(readFileSync(file, "utf8")) as Statement;
      const env = signStatement(stmt, [signerFromSeed(seed)]);
      const p = parseRecord(env);
      process.stderr.write(`record ${"error" in p ? p.error : p.id}\n`);
      process.stdout.write(`${JSON.stringify(env)}\n`);
      return 0;
    }
    case "keygen": {
      const s = signerFromSeed(one(a, "seed") ?? "00");
      process.stdout.write(`${s.identity}\n`);
      return 0;
    }
    case "record-id": {
      const file = a.rest[0];
      if (!file) return 2;
      const p = parseRecord(JSON.parse(readFileSync(file, "utf8")));
      process.stdout.write(`${"error" in p ? p.error : p.id}\n`);
      return 0;
    }
    case "hash": {
      const file = a.rest[0];
      if (!file) return 2;
      process.stdout.write(`${H(JSON.parse(readFileSync(file, "utf8")))}\n`);
      return 0;
    }
    default:
      process.stdout.write(`${HELP}\n`);
      return a.cmd === "help" || a.bools.has("help") ? 0 : 2;
  }
}

if (import.meta.main) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e: unknown) => {
      process.stderr.write(`shape1: ${e instanceof Error ? e.message : String(e)}\n`);
      process.exit(2);
    }
  );
}

export { main };
