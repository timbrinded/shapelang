// @ts-nocheck
// H6: realises teeth's one observable uncaught W1 class (Read<SystemClock> at ungoverned code) as a
// change on Shape's own tree. ShpCli binds `isoToday` in packages/shp-cli/src/freshness.ts by an
// explicit unit binding, but no component glob covers the file, so its other functions are
// ungoverned. The change seeds `Date.now()` into one of them and, as a control, into a governed
// ShpCli function (commands/update/impl.ts is under ShpCli's globs). Each head is scanned by the real
// tsClockScan provider and derived in change mode against the unedited tree.
//   bun experiments/shape-1/trials/H6/ungoverned-clock.ts --work <dir>   (uses <work>/tree)
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { clockScan } from "../../dogfood/providers/ts-clock-scan.ts";
import { manifestFor, readModel, treeFiles } from "../../dogfood/tools/lib.ts";
import { derive } from "../../proto/src/derive.ts";

const argv = process.argv.slice(2);
const i = argv.indexOf("--work");
const WORK = resolve(i >= 0 ? argv[i + 1] : "h6-work");
const tree = join(WORK, "tree");
const NOW = "2026-10-26T00:00:00Z";
const source = readModel();
const base = await manifestFor(treeFiles(tree));
const baseScan = await clockScan({ root: tree, manifest: base.statement, now: NOW });
const SEEDS = [
  {
    name: "ungoverned: freshness.ts#resolveFreshnessDate",
    path: "packages/shp-cli/src/freshness.ts",
    anchor: "}): IsoDateString | undefined {\n",
    insert: "  void Date.now();\n"
  },
  {
    name: "governed control: freshness.ts#isoToday's sibling in ShpCli globs (git.ts)",
    path: "packages/shp-cli/src/git.ts",
    anchor: null,
    insert: null
  }
];
const rows = [];
for (const s of SEEDS) {
  const p = join(tree, s.path);
  const text = readFileSync(p, "utf8");
  let edited: string;
  if (s.anchor) {
    if (text.split(s.anchor).length !== 2) throw new Error(`anchor not unique in ${s.path}`);
    edited = text.replace(s.anchor, s.anchor + s.insert);
  } else {
    // first exported function body in the file
    const m = /export (?:async )?function \w+\([^)]*\)[^{]*\{\n/.exec(text);
    if (!m) throw new Error(`no exported function in ${s.path}`);
    edited =
      text.slice(0, m.index + m[0].length) +
      "  void Date.now();\n" +
      text.slice(m.index + m[0].length);
    s.name = `governed control: ${s.path}#${/function (\w+)/.exec(m[0])[1]}`;
  }
  writeFileSync(p, edited);
  try {
    const head = await manifestFor(treeFiles(tree));
    const scan = await clockScan({ root: tree, manifest: head.statement, now: NOW });
    const out = derive({
      contract: "shape.check.input/v1",
      mode: "change",
      now: NOW,
      head: { revision: head.revision, source, manifest: head.statement },
      base: { revision: base.revision, source, manifest: base.statement },
      change: { ids: ["github:timbrinded/shapelang#h6-clock"] },
      authors: [{ identity: 'github("claude[bot]")', verified: true, bot: true }],
      reviews: [],
      records: [scan.envelope],
      baseRecords: [baseScan.envelope],
      persisted: { base: [], head: [] },
      options: { health: false, teeth: false }
    });
    const intro = out.obligations.filter((o) => o.introduced);
    rows.push({
      seed: s.name,
      clockFactsBase: baseScan.facts,
      clockFactsHead: scan.facts,
      newSites: scan.sites.filter(
        (x) => !baseScan.sites.some((y) => y.at === x.at && y.resource === x.resource)
      ),
      verdict: out.verdict,
      errors: [...new Set(out.errors.map((e) => e.code))],
      introduced: intro.map((o) => ({
        kind: o.kind,
        severity: o.severity,
        force: o.force,
        claim: o.claim?.ids?.[0] ?? null,
        subject: o.subject
      }))
    });
  } finally {
    writeFileSync(p, text);
  }
}
writeFileSync(join(WORK, "ungoverned-clock.json"), JSON.stringify(rows, null, 1));
process.stdout.write(`${JSON.stringify(rows, null, 1)}\n`);
