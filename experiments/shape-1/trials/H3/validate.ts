// @ts-nocheck
// Validates every refactor and feature control as law-preserving: the agent-written law suite
// (g8), the harness's own C1 law suite and the hidden tests (feature + law) must all pass.
// Also records, for every mutant and trap, which suites fail (the tested scope's miss rate).
//   bun experiments/shape-1/trials/H3/validate.ts [T1 T3 T4] > <out.json>
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BENDEXP, TASKS, WORK, parseJunit, runSuite } from "./lib.ts";
import { variantsOf } from "./variants.ts";

function hidden(T, code) {
  const dir = join(WORK, "hidden-impl", `${T.id}-${process.pid}`);
  rmSync(dir, { recursive: true, force: true });
  for (const [p, text] of Object.entries(code)) {
    mkdirSync(join(dir, p, ".."), { recursive: true });
    writeFileSync(join(dir, p), text);
  }
  const xml = join(dir, "junit.xml");
  const r = spawnSync(
    "bun",
    [
      "test",
      join(BENDEXP, "hidden", T.id, "hidden.test.ts"),
      "--reporter=junit",
      `--reporter-outfile=${xml}`
    ],
    {
      cwd: join(BENDEXP, "hidden", T.id),
      env: { ...process.env, IMPL: join(dir, T.module) },
      timeout: 900_000,
      maxBuffer: 1 << 26
    }
  );
  let cases = [];
  try {
    cases = parseJunit(readFileSync(xml, "utf8"));
  } catch {
    cases = [];
  }
  rmSync(dir, { recursive: true, force: true });
  const feat = cases.filter((c) => /\[feature\]/.test(c.name) || /\[feature\]/.test(c.classname));
  const law = cases.filter((c) => /\[law/.test(c.name) || /\[law/.test(c.classname));
  return {
    exit: r.status,
    total: cases.length,
    featureFail: feat.filter((c) => !c.pass).length,
    featureTotal: feat.length,
    lawFail: law.filter((c) => !c.pass).length,
    lawTotal: law.length
  };
}

const tasks = process.argv.slice(2).length ? process.argv.slice(2) : ["T1", "T3", "T4"];
const rows = [];
for (const tid of tasks) {
  const T = TASKS[tid];
  for (const v of variantsOf(tid)) {
    const g8 = runSuite(T, v.head);
    const c1 = runSuite(T, v.head, { suiteDir: join(BENDEXP, "tasks", tid, "C1") });
    const h = hidden(T, v.head);
    const g8Fail = Object.entries(g8.perLaw)
      .filter(([, x]) => !x.pass)
      .map(([k]) => k);
    const c1Fail = c1.cases.filter((c) => !c.pass).length;
    const row = {
      task: tid,
      id: v.id,
      kind: v.kind,
      breaks: v.breaks,
      breaksFeature: v.breaksFeature,
      g8Fail,
      g8SelfCheckFailed: g8.selfCheckFailed,
      g8Exit: g8.exit,
      g8Ms: g8.ms,
      c1Fail,
      c1Cases: c1.cases.length,
      c1Exit: c1.exit,
      hidden: h
    };
    rows.push(row);
    process.stderr.write(
      `${tid} ${v.kind.padEnd(8)} ${v.id.padEnd(36)} breaks=[${v.breaks.join(",")}] g8Fail=[${g8Fail.join(",")}] c1Fail=${c1Fail}/${c1.cases.length} hidden feat ${h.featureFail}/${h.featureTotal} law ${h.lawFail}/${h.lawTotal} (${g8.ms} ms)\n`
    );
  }
}
process.stdout.write(`${JSON.stringify(rows, null, 1)}\n`);
