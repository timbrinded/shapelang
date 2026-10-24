// @ts-nocheck
// E2 extension: the 8 calibration cases of
// plugins/shapelang/skills/shape-contract-guard/references/examples.md, encoded
// as base/candidate Shape repos. For each: run `shp check --check-loosening`
// (base-ref) and the semantic diff of e2-semantic-diff.ts, and compare with the
// expected guard classification in examples.md.
// Usage: bun e2-calibration.ts  (writes repos under $WORK/e2cal)
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { classify, contextEntries, inspect } from "./e2-semantic-diff.ts";

const WORK =
  (process.env.WORK ??
    "/tmp/claude-0/-home-user-shapelang/83ff80bc-0161-572f-9e5a-9075cccad6d0/scratchpad/bendexp/work/E") +
  "/e2cal";
const SHP = ["bun", "/home/user/shapelang/packages/shp-cli/src/index.ts"];

type Files = Record<string, string>;
type Case = {
  id: string;
  base: Files;
  cand: Files;
  changed?: string[];
  expected: string;
  expectFinding: boolean;
};

const audit = (traits: string, body = "") =>
  `module audit\n\nresource AuditEvent${traits}\n${body}`;
const store = `
component AuditStore {
  owns AuditEvent
  grants Append<AuditEvent>
  fn appendEvent
    effects complete {
      Append<AuditEvent>
    }
}
`;
const storeHd = `
component AuditStore {
  owns AuditEvent
  grants Append<AuditEvent>
  grants HardDelete<AuditEvent>
  fn appendEvent
    effects complete {
      Append<AuditEvent>
    }
  fn deleteEvent
    effects complete {
      HardDelete<AuditEvent>
    }
}
`;

const cases: Case[] = [
  {
    id: "1 constraint-removal+destructive-effect",
    base: { "shape/audit.shape": audit(" : AppendOnly", store) },
    cand: { "shape/audit.shape": audit("", storeHd) },
    expected: "high/none/suspicious",
    expectFinding: true
  },
  {
    id: "2 supported high-impact loosening",
    base: { "shape/export.shape": "module exp\n\nresource ExportBundle : AppendOnly\n" },
    cand: {
      "shape/export.shape": `module exp\n\nresource ExportBundle\n\nrationale ExportBundleLifecycle : DesignRationale<resource ExportBundle> {\n  summary "ExportBundle is ephemeral; retention remains on AuditEvent."\n  evidence issue("123")\n}\n`
    },
    expected: "high/specific/supported",
    expectFinding: true
  },
  {
    id: "3 equivalent relocation (rule)",
    base: {
      "shape/audit.shape": audit(" : Persistent", store),
      "shape/rules.shape":
        "module audit\n\nrule audit_no_delete {\n  forbid final HardDelete<T>\n  when T has Persistent\n}\n"
    },
    cand: {
      "shape/audit.shape": audit(" : Persistent", store),
      "shape/retention.shape":
        "module audit\n\nrule audit_no_delete {\n  forbid final HardDelete<T>\n  when T has Persistent\n}\n"
    },
    expected: "pass (no finding)",
    expectFinding: false
  },
  {
    id: "4 equal replacement (Protected -> AppendOnly)",
    base: {
      "shape/audit.shape":
        "module audit\n\ntrait Protected<T: Resource> {\n  forbid final HardDelete<T>\n}\n\nresource AuditEvent : Protected\n" +
        store
    },
    cand: {
      "shape/audit.shape":
        "module audit\n\ntrait Protected<T: Resource> {\n  forbid final HardDelete<T>\n}\n\nresource AuditEvent : AppendOnly\n" +
        store
    },
    expected: "no unsupported-removal finding (replacement recorded)",
    expectFinding: false
  },
  {
    id: "5 forbidden path weakened (provides route added)",
    base: {
      "shape/deploy.shape":
        "module deploy\n\nresource ProductionStore\n\ncomponent BuildOrchestrator {\n}\n\nrule no_build_to_production_store {\n  forbid path BuildOrchestrator -> ProductionStore over calls or provides\n}\n"
    },
    cand: {
      "shape/deploy.shape":
        "module deploy\n\nresource ProductionStore\n\ncomponent BuildOrchestrator {\n}\n\nrelation BuildProvidesStore {\n  kind provides\n  connects BuildOrchestrator -> ProductionStore\n}\n\nrule no_build_to_production_store {\n  forbid path BuildOrchestrator -> ProductionStore over calls\n}\n"
    },
    expected: "high/none/suspicious",
    expectFinding: true
  },
  {
    id: "6 vendored pack final forbid removal",
    base: {
      "shape/vendor/durable/pack.shape":
        "module durable\n\ntrait DurableAudit<T: Resource> {\n  allow Append<T>\n  forbid final HardDelete<T>\n}\n",
      "shape/audit.shape":
        "module audit\n\nimport durable\n\nresource AuditEvent : DurableAudit\n" + store
    },
    cand: {
      "shape/vendor/durable/pack.shape":
        "module durable\n\ntrait DurableAudit<T: Resource> {\n  allow Append<T>\n}\n",
      "shape/audit.shape":
        "module audit\n\nimport durable\n\nresource AuditEvent : DurableAudit\n" + store
    },
    expected: "high/none/suspicious",
    expectFinding: true
  },
  {
    id: "7 generic attestation",
    base: {
      "shape/audit.shape":
        audit("", store) +
        '\nimplementation AuditStoreImpl {\n  paths {\n    "src/audit/store.ts"\n  }\n  conforms_to AuditStore\n  on_change require shape_update\n}\n',
      "src/audit/store.ts": "export function appendEvent() {}\n"
    },
    cand: {
      "shape/audit.shape":
        audit("", store) +
        '\nimplementation AuditStoreImpl {\n  paths {\n    "src/audit/store.ts"\n  }\n  conforms_to AuditStore\n  on_change require shape_update\n}\n\nattest no_shape_change {\n  source ts("src/audit/store.ts")\n  reason "No changes."\n}\n',
      "src/audit/store.ts": "export function appendEvent() { /* edited */ }\n"
    },
    expected: "medium/generic/suspicious (attestation-credibility)",
    expectFinding: true
  },
  {
    id: "8 false completeness",
    base: {
      "shape/exp.shape":
        "module exp\n\ncomponent Exporter {\n  fn exportSnapshot\n    effects unknown\n}\n"
    },
    cand: {
      "shape/exp.shape":
        "module exp\n\ncomponent Exporter {\n  fn exportSnapshot\n    effects complete {\n    }\n}\n"
    },
    expected: "high/none/suspicious",
    expectFinding: true
  }
];

function git(dir: string, ...args: string[]) {
  const r = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
}
function writeAll(dir: string, files: Files) {
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), c);
  }
}

rmSync(WORK, { recursive: true, force: true });
const rows: string[] = [];
for (const [i, c] of cases.entries()) {
  const d = join(WORK, `case${i + 1}`);
  const bdir = join(WORK, `case${i + 1}.base`);
  mkdirSync(d, { recursive: true });
  writeAll(bdir, c.base);
  git(d, "init", "-q", "-b", "main");
  git(d, "config", "user.email", "e2@example.invalid");
  git(d, "config", "user.name", "e2");
  writeAll(d, c.base);
  git(d, "add", "-A");
  git(d, "commit", "-qm", "base");
  git(d, "tag", "base");
  git(d, "rm", "-q", "-r", ".");
  writeAll(d, c.cand);
  git(d, "add", "-A");
  git(d, "commit", "-qm", "cand");
  writeFileSync(join(d, "changed.txt"), git(d, "diff", "--name-only", "base", "HEAD"));
  const r = spawnSync(
    SHP[0],
    [
      ...SHP.slice(1),
      "check",
      "--allow-unknown-effects",
      "--changed-files",
      "changed.txt",
      "--base-ref",
      "base",
      "--check-loosening"
    ],
    { cwd: d, encoding: "utf8" }
  );
  const out = (r.stdout + r.stderr).trim();
  const firstErr = (out.match(/^error: .*$/m) ?? [out.split("\n").at(-1)])[0];
  const sem = classify(inspect(bdir), inspect(d), {
    base: contextEntries(bdir),
    cand: contextEntries(d)
  });
  const semTxt = sem.findings.length
    ? sem.findings.map((f) => `${f.impact}/${f.support}/${f.disposition} ${f.signal}`).join("; ")
    : "pass";
  const loosenOk = (r.status !== 0 && /rule loosening/.test(out)) === c.expectFinding;
  const semOk = sem.findings.length > 0 === c.expectFinding;
  rows.push(
    `| ${c.id} | ${c.expected} | exit ${r.status}: ${firstErr} | ${loosenOk ? "match" : "MISS"} | ${semTxt} | ${semOk ? "match" : "MISS"} |`
  );
  writeFileSync(join(WORK, `case${i + 1}.check.txt`), out + `\nexit=${r.status}\n`);
}
console.log(
  "| case | examples.md expected | check --check-loosening | finding/no-finding agrees | semantic diff | agrees |"
);
console.log("|---|---|---|---|---|---|");
for (const r of rows) console.log(r);
