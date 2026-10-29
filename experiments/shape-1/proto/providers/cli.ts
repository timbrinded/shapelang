#!/usr/bin/env bun
// shape1-providers: evidence providers for the Shape 1.0 prototype.
//   laws        (tested)    bun:test law files → Test Result records
//   observe-ts  (observed)  TypeScript effect scan and call graph → observation records
//   trust       (observed)  hatch markers for Rust/Verus, Lean, Bend → manifest overlay; Lean
//                           #print axioms → proof-record assumptions; H5 replay
//   teeth       (meta)      model mutation → vacuous claims and uncovered change classes
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { CheckInput } from "../src/io-types.ts";
import { readEvidence, rewriteAgainst } from "../src/loader.ts";
import { indexManifest } from "../src/manifest.ts";
import type { SourceDoc } from "../src/source.ts";
import {
  type Args,
  type Manifested,
  REPO_ROOT,
  flushStdout,
  loadSource,
  manifestFor,
  many,
  one,
  parseArgs,
  pct,
  recordTime,
  signerOf,
  writeJson,
  writeRecords
} from "./common.ts";
import { lawsProvider, runLaws } from "./laws/provider.ts";
import {
  callsProvider,
  channelsFromShape,
  effectsProvider,
  runObserveTs
} from "./observe-ts/provider.ts";
import { runTeeth, teethStatement } from "./teeth/provider.ts";
import {
  leanProofProvider,
  leanProofRecords,
  overlayInput,
  overlayManifest,
  trustReport
} from "./trust/provider.ts";
import { replayAll } from "./trust/replay.ts";
import { auditRust } from "./trust/rust.ts";

const BOOLS = [
  "help",
  "no-typescript",
  "no-rewrite",
  "deps-complete",
  "channels-from-shape",
  "built",
  "statement",
  "sound-presence"
];

const HELP = `shape1-providers <provider> <command> [flags]

Common flags: --root <dir> | --git <repo> --rev <ref> | --manifest <statement.json>; --revision <hex>;
  --source <shape1.json> | --model <dir> [--sidecar <file>] [--maintainer <login>]... [--no-rewrite];
  --time <rfc3339>; --out <file | dir/ | ->; --report <file>; --no-typescript

laws run        --provider <Q> [--decides "template T"]... [--law <file>]... [--bind <claim>=<file>]...
                [--seed <hex>] [--mutants <n>] [--deps-complete] [--impl <glob>]...
laws declare    --provider <Q> [--decides ...]... [--seed <hex>] [--impl <glob>]... [--deps-complete]
observe-ts run  [--effects-provider <Q>] [--calls-provider <Q>] [--channel <resource code>]...
                [--channels-from-shape] [--paths <glob>]... [--effects-seed <hex>] [--calls-seed <hex>]
                [--sound-presence]   (declare presence for the call graph; default sound none)
observe-ts declare  same provider flags; prints the declarations
trust report    [--print-axioms <file>] [--lean-version <v>]
trust manifest  prints the overlaid manifest statement (Bend and Lean identities and markers)
trust overlay   --input <check-input.json> [--base-root <dir>]   prints the input with overlaid manifests
trust lean-proofs --provider <Q> --print-axioms <file> [--built] [--seed <hex>]
trust rust-audit   vprobe-semantics markers against the manifest, per .rs file
trust replay    [--per-commit <file.json.gz>]...   H5 replay over the Verus probes' per-commit data
teeth run       [--evidence <file|dir>]... [--validate <n per operator>] [--statement] [--seed <hex>]`;

async function manifestOf(a: Args): Promise<Manifested> {
  return manifestFor({
    root: one(a, "root"),
    git: one(a, "git"),
    rev: one(a, "rev"),
    revision: one(a, "revision"),
    manifest: one(a, "manifest"),
    noTypeScript: a.bools.has("no-typescript")
  });
}

function sourceOf(a: Args, man: Manifested | null): SourceDoc {
  const src = loadSource({
    source: one(a, "source"),
    model: one(a, "model"),
    sidecar: one(a, "sidecar"),
    maintainers: many(a, "maintainer")
  });
  if (!man || a.bools.has("no-rewrite") || one(a, "source")) return src;
  return rewriteAgainst(src, man.statement).source ?? src;
}

function perCommitDefaults(): string[] {
  const dir = join(REPO_ROOT, "experiments/verus-probes/results/per-commit");
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith(".json.gz") || f.endsWith(".json"))
      .sort()
      .map((f) => join(dir, f));
  } catch {
    return [];
  }
}

function lawsInfo(a: Args): ReturnType<typeof lawsProvider> {
  const q = one(a, "provider");
  if (!q) throw new Error("--provider <Q> is required");
  const signer = signerOf(one(a, "seed"));
  return lawsProvider({
    q,
    decides: many(a, "decides"),
    identity: signer?.identity,
    implementation: many(a, "impl").length > 0 ? many(a, "impl") : undefined,
    depsComplete: a.bools.has("deps-complete")
  });
}

function observeInfos(
  a: Args,
  channels: string[]
): {
  effects: ReturnType<typeof effectsProvider> | null;
  calls: ReturnType<typeof callsProvider> | null;
} {
  const es = signerOf(one(a, "effects-seed"));
  const cs = signerOf(one(a, "calls-seed"));
  const eq = one(a, "effects-provider");
  const cq = one(a, "calls-provider");
  return {
    effects: eq ? effectsProvider({ q: eq, channels, identity: es?.identity }) : null,
    calls: cq
      ? callsProvider({
          q: cq,
          identity: cs?.identity,
          sound: a.bools.has("sound-presence") ? ["presence"] : undefined
        })
      : null
  };
}

/** the provider's subcommand (`laws run`, `trust replay`): the default when none is given, an
 *  error naming the choices for an unknown one */
function subcommand(a: Args, provider: string, allowed: string[], dflt: string): string {
  const c = a.rest[0];
  if (c === undefined || c === "help") return dflt;
  if (!allowed.includes(c))
    throw new Error(`unknown ${provider} command "${c}" (expected ${allowed.join(", ")})`);
  return c;
}

async function laws(a: Args): Promise<number> {
  if (subcommand(a, "laws", ["run", "declare"], "run") === "declare") {
    writeJson(one(a, "out"), lawsInfo(a).decl);
    return 0;
  }
  const root = one(a, "root");
  if (!root) throw new Error("laws run needs --root <dir> (law files run there)");
  const man = await manifestOf(a);
  const source = sourceOf(a, man);
  let files = many(a, "law");
  if (files.length === 0) files = [...man.index.paths].filter((p) => p.endsWith(".law.ts")).sort();
  const binds = many(a, "bind").map((b) => {
    const i = b.lastIndexOf("=");
    return { claim: b.slice(0, i), file: b.slice(i + 1) };
  });
  const time = recordTime(one(a, "time"));
  const { records, report } = await runLaws({
    info: lawsInfo(a),
    source,
    man,
    root: resolve(root),
    lawFiles: files,
    binds,
    signer: signerOf(one(a, "seed")),
    time,
    mutants: Number(one(a, "mutants") ?? "0")
  });
  writeRecords(one(a, "out"), records);
  if (one(a, "report")) writeJson(one(a, "report"), report);
  process.stderr.write(
    `laws: ${report.claims.length} claims, ${records.length} records (revision ${man.revision})\n`
  );
  for (const c of report.claims)
    process.stderr.write(
      `  ${c.result.padEnd(12)} ${c.id}${c.mutants && !("error" in c.mutants) ? ` mutants ${c.mutants.killed}/${c.mutants.total}` : ""}${c.error ? ` (${c.error})` : ""}\n`
    );
  for (const u of report.unknown) process.stderr.write(`  unknown claim ${u.claim} in ${u.file}\n`);
  return report.rejected.length > 0 ? 1 : 0;
}

async function observe(a: Args): Promise<number> {
  const declareOnly = subcommand(a, "observe-ts", ["run", "declare"], "run") === "declare";
  const man = declareOnly ? null : await manifestOf(a);
  let channels = many(a, "channel");
  if (a.bools.has("channels-from-shape"))
    channels = [...new Set([...channels, ...channelsFromShape(sourceOf(a, man))])];
  const infos = observeInfos(a, channels);
  if (declareOnly) {
    writeJson(one(a, "out"), [infos.effects?.decl, infos.calls?.decl].filter(Boolean));
    return 0;
  }
  if (!man) return 2;
  if (!infos.effects && !infos.calls)
    throw new Error("need --effects-provider <Q> and/or --calls-provider <Q>");
  if (infos.effects && channels.length === 0)
    throw new Error("--effects-provider needs --channel <resource code> or --channels-from-shape");
  const root = one(a, "root");
  if (!root) throw new Error("observe-ts needs --root <dir>");
  const { records, report } = await runObserveTs({
    man,
    root: resolve(root),
    paths: many(a, "paths"),
    effects: infos.effects
      ? { info: infos.effects, channels, signer: signerOf(one(a, "effects-seed")) }
      : undefined,
    calls: infos.calls ? { info: infos.calls, signer: signerOf(one(a, "calls-seed")) } : undefined,
    time: recordTime(one(a, "time"))
  });
  writeRecords(one(a, "out"), records);
  if (one(a, "report")) writeJson(one(a, "report"), report);
  process.stderr.write(
    `observe-ts: ${report.stats.files} files, ${report.entries} entries (effects complete ${report.effectsComplete}, calls complete ${report.callsComplete}), ${report.effectFacts} effect facts, ${report.callFacts} call facts, ${report.stats.ms} ms\n`
  );
  return report.rejected.length > 0 ? 1 : 0;
}

async function trust(a: Args): Promise<number> {
  const cmd = subcommand(
    a,
    "trust",
    ["report", "manifest", "overlay", "lean-proofs", "rust-audit", "replay"],
    "report"
  );
  if (cmd === "replay") {
    const files = many(a, "per-commit").length > 0 ? many(a, "per-commit") : perCommitDefaults();
    const r = replayAll(files);
    writeJson(one(a, "out"), r);
    const t = r.total;
    process.stderr.write(
      `replay: ${t.commits} commits, ${t.withEvent} with a trust event; B3 ${t.b3} (${pct(t.b3, t.withEvent)}), S0 ${t.s0} (${pct(t.s0, t.withEvent)}), S1 ${t.s1} (${pct(t.s1, t.withEvent)}), S2 ${t.s2} (${pct(t.s2, t.withEvent)}); growth ${t.grow}: B3 ${t.growB3}, S0 ${t.growS0}, S1 ${t.growS1}\n`
    );
    return 0;
  }
  if (cmd === "overlay") {
    const inputPath = one(a, "input");
    const root = one(a, "root");
    if (!inputPath || !root) throw new Error("trust overlay needs --input <file> --root <dir>");
    const input = JSON.parse(readFileSync(inputPath, "utf8")) as CheckInput;
    const read =
      (base: string) =>
      (p: string): string | null => {
        try {
          return readFileSync(join(base, p), "utf8");
        } catch {
          return null;
        }
      };
    const baseRoot = one(a, "base-root");
    writeJson(
      one(a, "out"),
      overlayInput(input, read(resolve(root)), baseRoot ? read(resolve(baseRoot)) : undefined)
    );
    return 0;
  }
  const man = await manifestOf(a);
  if (cmd === "manifest") {
    writeJson(one(a, "out"), overlayManifest(man.statement, man.read).statement);
    return 0;
  }
  if (cmd === "rust-audit") {
    const rows = auditRust(man.index, man.read);
    writeJson(one(a, "out"), rows);
    process.stderr.write(
      `rust-audit: ${rows.length} files, ${rows.filter((r) => Object.keys(r.delta).length === 0).length} agree with vprobe semantics\n`
    );
    return 0;
  }
  if (cmd === "lean-proofs") {
    const q = one(a, "provider");
    const axPath = one(a, "print-axioms");
    if (!q || !axPath)
      throw new Error("trust lean-proofs needs --provider <Q> --print-axioms <file>");
    const overlay = overlayManifest(man.statement, man.read);
    const oindex = indexManifest(overlay.statement).index;
    if (!oindex) throw new Error("overlay manifest does not index");
    const om: Manifested = { ...man, statement: overlay.statement, index: oindex };
    const signer = signerOf(one(a, "seed"));
    const info = leanProofProvider({
      q,
      leanVersion: one(a, "lean-version"),
      identity: signer?.identity
    });
    const out = leanProofRecords({
      info,
      source: sourceOf(a, om),
      man: om,
      project: overlay.project,
      printAxioms: readFileSync(axPath, "utf8"),
      built: a.bools.has("built"),
      signer,
      time: recordTime(one(a, "time"))
    });
    writeRecords(one(a, "out"), out.records);
    for (const s of out.skipped) process.stderr.write(`  skipped ${s.claim}: ${s.why}\n`);
    return out.rejected.length > 0 ? 1 : 0;
  }
  const axPath = one(a, "print-axioms");
  const { report } = trustReport(man, {
    printAxioms: axPath ? readFileSync(axPath, "utf8") : undefined,
    leanVersion: one(a, "lean-version")
  });
  writeJson(one(a, "out"), report);
  process.stderr.write(
    `trust: rust ${report.rust.files} files (${report.rust.agree} agree with vprobe), bend ${report.bend.files} files / ${report.bend.identities} identities, lean ${report.lean.files} files / ${report.lean.identities} identities, ${report.lean.theorems.length} theorems with axioms, ${report.markedIdentities.length} marked identities\n`
  );
  return 0;
}

async function teethCmd(a: Args): Promise<number> {
  subcommand(a, "teeth", ["run"], "run");
  const man = await manifestOf(a);
  const source = sourceOf(a, man);
  const evidence = many(a, "evidence").flatMap((p) =>
    statSync(p).isDirectory() || p.endsWith(".json") || p.endsWith(".jsonl")
      ? readEvidence([p])
      : []
  );
  const run = runTeeth({
    source,
    man,
    records: evidence,
    time: recordTime(one(a, "time")),
    validate: Number(one(a, "validate") ?? "0")
  });
  const out = a.bools.has("statement")
    ? teethStatement(run.report, man, signerOf(one(a, "seed")))
    : { ...run.report, validation: run.validation, errors: run.errors };
  writeJson(one(a, "out"), out);
  const r = run.report;
  process.stderr.write(
    `teeth: ${r.operators.map((o) => `${o.op} ${o.killed}/${o.mutants}`).join(", ")}; vacuous ${r.vacuous.length}, redundant ${r.redundant.length}, unused grants ${r.unusedGrants.length}, P1 uncaught ${r.gaps.P1.uncaught.length}/${r.gaps.P1.resources}${run.validation ? `; derive agrees on ${run.validation.agree}/${run.validation.sampled}` : ""} (${run.ms} ms)\n`
  );
  return 0;
}

export async function main(argv: string[]): Promise<number> {
  const [provider = "help", ...rest] = argv;
  const a = parseArgs(rest, BOOLS);
  // parseArgs takes the first token as the command; keep it positional
  a.rest = [a.cmd, ...a.rest];
  if (provider === "help" || a.bools.has("help")) {
    process.stdout.write(`${HELP}\n`);
    return 0;
  }
  switch (provider) {
    case "laws":
      return laws(a);
    case "observe-ts":
      return observe(a);
    case "trust":
      return trust(a);
    case "teeth":
      return teethCmd(a);
    default:
      process.stderr.write(
        `shape1-providers: unknown provider "${provider}" (expected laws, observe-ts, trust, teeth)\n${HELP}\n`
      );
      return 2;
  }
}

if (import.meta.main) {
  main(process.argv.slice(2)).then(
    // exit only once stdout has drained: a piped multi-megabyte report must not be truncated
    (code) => flushStdout().then(() => process.exit(code)),
    (e: unknown) => {
      process.stderr.write(`shape1-providers: ${e instanceof Error ? e.message : String(e)}\n`);
      process.exit(2);
    }
  );
}
