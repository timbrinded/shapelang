/**
 * Shape docs art — kiln ui-refactor informed, billboard-readable.
 *   bun docs-site/scripts/art/build-all.mjs
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outHtml = __dirname;
const outPng = join(__dirname, "../../src/assets/infographics");
const tmp = join(__dirname, ".render-tmp");
mkdirSync(tmp, { recursive: true });
mkdirSync(outPng, { recursive: true });

const icons = {
  doc: `<svg viewBox="0 0 24 24"><path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v5h5M9 13h6M9 17h4"/></svg>`,
  term: `<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="M7 10l3 3 3-4"/><path d="M14 15h4"/></svg>`,
  user: `<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.2"/><path d="M5.5 19c1.4-3.2 3.8-4.6 6.5-4.6s5.1 1.4 6.5 4.6"/></svg>`,
  shield: `<svg viewBox="0 0 24 24"><path d="M12 3.5l7.5 3v5.2c0 4.4-3 7.5-7.5 8.3-4.5-.8-7.5-3.9-7.5-8.3V6.5l7.5-3z"/><path d="M9 12l2 2 4-4"/></svg>`,
  warn: `<svg viewBox="0 0 24 24"><path d="M12 4l9 16H3L12 4z"/><path d="M12 10v4M12 16.5v.5"/></svg>`,
  fail: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7.5"/><path d="M9 9l6 6M15 9l-6 6"/></svg>`,
  search: `<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6"/><path d="M16 16l4 4"/></svg>`,
  download: `<svg viewBox="0 0 24 24"><path d="M12 4v11M8 11l4 4 4-4"/><path d="M5 19h14"/></svg>`,
  pencil: `<svg viewBox="0 0 24 24"><path d="M4 20l4.2-1.1L19 8.1 15.9 5 5.1 15.8 4 20z"/><path d="M13.8 7.1l3.1 3.1"/></svg>`,
  cube: `<svg viewBox="0 0 24 24"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5"/></svg>`,
  graph: `<svg viewBox="0 0 24 24"><circle cx="6" cy="7" r="2.2"/><circle cx="18" cy="7" r="2.2"/><circle cx="12" cy="17" r="2.2"/><path d="M8 8l3 7M16 8l-3 7M8.2 7h7.6"/></svg>`,
  layers: `<svg viewBox="0 0 24 24"><path d="M12 4l8 4-8 4-8-4 8-4z"/><path d="M4 12l8 4 8-4"/><path d="M4 16l8 4 8-4"/></svg>`,
  lock: `<svg viewBox="0 0 24 24"><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>`,
  ban: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M7 7l10 10"/></svg>`,
  bolt: `<svg viewBox="0 0 24 24"><path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z"/></svg>`,
  cycle: `<svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 0 1 13.5-5.8L20 4v6h-6"/><path d="M20 12a8 8 0 0 1-13.5 5.8L4 20v-6h6"/></svg>`,
  db: `<svg viewBox="0 0 24 24"><ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6"/><path d="M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3"/></svg>`,
  link: `<svg viewBox="0 0 24 24"><path d="M10 13a4 4 0 0 0 6 0l2-2a4 4 0 0 0-5.7-5.6l-1 1"/><path d="M14 11a4 4 0 0 0-6 0l-2 2a4 4 0 0 0 5.7 5.6l1-1"/></svg>`,
  mem: `<svg viewBox="0 0 24 24"><rect x="4" y="6" width="16" height="12" rx="2"/><path d="M8 6V4M12 6V4M16 6V4M8 18v2M12 18v2M16 18v2M8 10h8M8 14h5"/></svg>`,
  list: `<svg viewBox="0 0 24 24"><path d="M9 7h11M9 12h11M9 17h11"/><circle cx="5" cy="7" r="1.2" fill="currentColor" stroke="none"/><circle cx="5" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="5" cy="17" r="1.2" fill="currentColor" stroke="none"/></svg>`,
};

function shell({ kicker, kickerTone = "", title, lede, body, footerRight = "" }) {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"/>
<title>${title}</title>
<link rel="stylesheet" href="${pathToFileURL(join(__dirname, "theme.css")).href}"/>
</head><body>
<div class="stage">
  <header>
    <div class="kicker ${kickerTone}">${kicker}</div>
    <h1>${title}</h1>
    ${lede ? `<p class="lede">${lede}</p>` : ""}
  </header>
  <div class="board">${body}</div>
  <div class="footer"><span>shape</span><span>${footerRight}</span></div>
</div>
</body></html>`;
}

/** Card: title primary, optional meta tertiary, 1–3 body lines secondary */
function card(title, lines, { tone = "", meta = "", extra = "" } = {}) {
  const body = lines
    .map((l) => {
      if (typeof l === "string") return `<div class="line"><span class="mark"></span><span>${l}</span></div>`;
      return `<div class="line ${l.tone || ""}"><span class="mark"></span><span>${l.t}</span></div>`;
    })
    .join("");
  return `<div class="card ${tone}">
    <div class="card-head">
      <div class="card-title">${title}</div>
      ${meta ? `<div class="card-meta">${meta}</div>` : ""}
    </div>
    <div class="card-body">${body}${extra}</div>
  </div>`;
}

function focus(title, meta, icon, { tone = "", chip = "" } = {}) {
  return `<div class="card ${tone}">
    <div class="card-head">
      <div class="card-title">${title}</div>
      ${meta ? `<div class="card-meta">${meta}</div>` : ""}
    </div>
    <div class="card-body" style="align-items:center;text-align:center;gap:20px">
      <div class="orb ${tone}">${icons[icon] || icons.doc}</div>
      ${chip ? `<div class="chip ${tone}">${chip}</div>` : ""}
    </div>
  </div>`;
}

const a = `<div class="arrow" aria-hidden="true">→</div>`;

const frames = {
  "quickstart-loop": () =>
    shell({
      kicker: "Get started",
      title: "Quickstart",
      lede: "Install the tool, write rules, run the check, fix what fails.",
      footerRight: "same gate in CI",
      body: `<div class="stack-v">
        <div class="flow">
          ${focus("Install", "get shp on PATH", "download", { chip: "curl | install.sh" })}
          ${a}
          ${card("Write", ["Rules under shape/", "Resources + components"], { meta: "shape/**/*.shape" })}
          ${a}
          ${card("Check", [
            { t: "Pass when coherent", tone: "pass" },
            { t: "Fail with a named reason", tone: "fail" },
          ], { meta: "shp check" })}
          ${a}
          ${card("Fix", [
            { t: "Read the diagnostic", tone: "warn" },
            { t: "Update the model", tone: "" },
          ], { tone: "amber", meta: "edit · re-check" })}
        </div>
        <div class="banner"><span class="primary">CI runs the same command</span><span class="secondary">shp check → pass or block</span></div>
      </div>`,
    }),

  "first-shape-file-map": () =>
    shell({
      kicker: "Authoring",
      title: "First Shape File",
      lede: "One protected store, one owner, the functions that touch it.",
      footerRight: "start small",
      body: `<div class="flow">
        ${card("Resource", ["The thing you protect", "e.g. AuditEvent"], { meta: "target" })}
        ${a}
        ${card("Component", ["Who owns it", "What effects it may emit"], { meta: "boundary" })}
        ${a}
        ${card("Function", ["Effect summary only", "Not the implementation"], { meta: "claim" })}
      </div>`,
    }),

  "core-vocabulary-map": () =>
    shell({
      kicker: "Concepts",
      title: "Core Vocabulary",
      lede: "Protected thing · policy on it · claimed operations.",
      footerRight: "resource · trait · effect",
      body: `<div class="flow">
        ${focus("Resource", "what is protected", "db", { chip: "AuditEvent" })}
        ${a}
        ${card("Trait", [
          { t: "Allow Append / Read", tone: "pass" },
          { t: "Forbid final HardDelete", tone: "fail" },
        ], { tone: "red", meta: "policy" })}
        ${a}
        ${card("Effect", [
          { t: "Append&lt;AuditEvent&gt;", tone: "pass" },
          { t: "HardDelete can fail the check", tone: "fail" },
        ], { meta: "operation" })}
      </div>`,
    }),

  "component-boundary-grants": () =>
    shell({
      kicker: "Ownership",
      title: "Components & Grants",
      lede: "Own stores and grant effects. Put structural links in top-level relations.",
      footerRight: "owns · grants",
      body: `<div class="flow">
        ${card("Component", ["Owns resources", "Grants allowed effects", "Holds function claims"], { meta: "AuditStore" })}
        ${a}
        ${focus("Resource", "protected target", "db", { chip: "AuditEvent" })}
        ${a}
        ${card("Relations", [
          { t: "calls / provides live outside", tone: "warn" },
          { t: "Not nested in the component", tone: "warn" },
        ], { tone: "amber", meta: "structure" })}
      </div>`,
    }),

  "evidence-review-path": () =>
    shell({
      kicker: "Provenance",
      title: "Evidence Path",
      lede: "Point each claim at source so a reviewer can open the right place.",
      footerRight: "claim · evidence · human",
      body: `<div class="flow">
        ${card("Claim", ["Function declares an effect", "e.g. HardDelete"], { meta: "what we assert" })}
        ${a}
        ${card("Evidence", [
          'ts("src/…#purgeOldEvents")',
          "Checker does not run this code",
        ], { meta: "where to look" })}
        ${a}
        ${focus("Reviewer", "human path", "user", { tone: "green", chip: "open · compare · decide" })}
      </div>`,
    }),

  "append-only-rejection": () =>
    shell({
      kicker: "Failure",
      kickerTone: "red",
      title: "Append-Only Rejection",
      lede: "A final ban beats a component grant. The diagnostic names both.",
      footerRight: "forbid final",
      body: `<div class="flow">
        ${card("Rule", [
          { t: "Allow Append / Read", tone: "pass" },
          { t: "Forbid final HardDelete", tone: "fail" },
        ], { tone: "red", meta: "AppendOnly" })}
        ${a}
        ${card("Claim", [
          { t: "purgeOldEvents emits HardDelete", tone: "fail" },
          { t: "Grant does not override the ban", tone: "fail" },
        ], { tone: "red", meta: "function" })}
        ${a}
        ${card("Result", [
          { t: "error: forbidden effect", tone: "fail" },
          { t: "Trail: function → trait → ban", tone: "fail" },
        ], { tone: "red", meta: "exit 1" })}
      </div>`,
    }),

  "global-model-review": () =>
    shell({
      kicker: "CI",
      kickerTone: "green",
      title: "Global Model Review",
      lede: "Architecture lives in shape/. Coverage watches changed files. CI is the gate.",
      footerRight: "model · coverage · check",
      body: `<div class="flow">
        ${card("Model", ["shape/**/*.shape", "Committed with the PR"], { meta: "source of truth" })}
        ${a}
        ${card("Coverage", [
          { t: "Governed path changed", tone: "warn" },
          { t: "Need shape update or attestation", tone: "" },
        ], { tone: "amber", meta: "changed files" })}
        ${a}
        ${card("Gate", [
          { t: "pass", tone: "pass" },
          { t: "reject", tone: "fail" },
        ], { tone: "green", meta: "shp check" })}
      </div>`,
    }),

  "implementation-coverage-map": () =>
    shell({
      kicker: "Coverage",
      title: "Implementations",
      lede: "Map source globs to a component. Changes need a shape update—or a current attestation.",
      footerRight: "paths · on_change",
      body: `<div class="flow">
        ${card("Source", ["src/ledger/**/*.ts", "Governed by the model"], { meta: "tree" })}
        ${a}
        ${card("Implementation", ["paths → component", "on_change require shape_update"], { meta: "mapping" })}
        ${a}
        ${card("Outcome", [
          { t: "Documented → pass", tone: "pass" },
          { t: "Missing update → fail", tone: "fail" },
        ], { tone: "green", meta: "coverage" })}
      </div>`,
    }),

  "design-memory-reevaluation": () =>
    shell({
      kicker: "Guards",
      title: "Design Memory",
      lede: "Fragile shapes can require a recorded reevaluation before they change.",
      footerRight: "memory · reevaluation",
      body: `<div class="flow">
        ${card("Protected function", ["RefactorSensitive", "Shape is intentional"], { meta: "target" })}
        ${a}
        ${card("Without reevaluation", [
          { t: "modify fn → fail", tone: "fail" },
          { t: "guarded shape changed", tone: "fail" },
        ], { tone: "red", meta: "change" })}
        ${a}
        ${card("With reevaluation", [
          { t: "outcome + evidence", tone: "pass" },
          { t: "check can pass", tone: "pass" },
        ], { tone: "green", meta: "review record" })}
      </div>`,
    }),

  "unknowns-safety-states": () =>
    shell({
      kicker: "Epistemics",
      kickerTone: "amber",
      title: "Unknowns & Safety",
      lede: "An honest unknown beats a fake empty complete list.",
      footerRight: "complete · unknown · draft",
      body: `<div class="flow">
        ${card("Complete", [
          { t: "List every material effect", tone: "pass" },
          { t: "Empty list still claims “none”", tone: "fail" },
        ], { tone: "green", meta: "I know" })}
        ${a}
        ${card("Unknown", [
          { t: "effects unknown", tone: "warn" },
          { t: "Strict check fails", tone: "fail" },
        ], { tone: "amber", meta: "I do not know yet" })}
        ${a}
        ${card("Draft only", [
          { t: "--allow-unknown-effects", tone: "warn" },
          { t: "Not for CI green", tone: "fail" },
        ], { meta: "local iteration" })}
      </div>`,
    }),

  "hypercycle-witness-path": () =>
    shell({
      kicker: "Rules",
      title: "Hypercycle Witness",
      lede: "Forbidden cycles ship a clear vertex path.",
      footerRight: "graph · cycle · witness",
      body: `<div class="flow">
        ${card("Graph", ["Api → Worker", "Worker → Queue", "Queue → Api"], { meta: "calls" })}
        ${a}
        ${card("Rule", [
          { t: "forbid hypercycle over calls", tone: "fail" },
        ], { tone: "red", meta: "constraint" })}
        ${a}
        ${card("Witness", [
          { t: "Api → Worker → Queue → Api", tone: "fail" },
          { t: "Relations named in the diagnostic", tone: "" },
        ], { tone: "red", meta: "closed walk" })}
      </div>`,
    }),

  "diagnostics-causal-trail": () =>
    shell({
      kicker: "Diagnostics",
      kickerTone: "red",
      title: "Causal Trail",
      lede: "What failed. Why. Which declaration caused it.",
      footerRight: "claim · constraint · cause",
      body: `<div class="flow">
        ${card("Claim", [
          { t: "purgeOldEvents emits HardDelete", tone: "fail" },
        ], { tone: "red", meta: "effect" })}
        ${a}
        ${card("Constraint", [
          { t: "AuditEvent : AppendOnly", tone: "fail" },
          { t: "forbids final HardDelete", tone: "fail" },
        ], { tone: "red", meta: "trait" })}
        ${a}
        ${card("Caused by", [
          { t: "Effect declaration", tone: "fail" },
          { t: "Resource + trait lines", tone: "fail" },
        ], { tone: "red", meta: "declarations" })}
      </div>`,
    }),

  "checker-pipeline": () =>
    shell({
      kicker: "Internals",
      title: "Checker Pipeline",
      lede: "Parse · lower · rules · diagnostics. No application execution.",
      footerRight: "four stages",
      body: `<div class="stack-v">
        <div class="flow">
          ${focus("Parse", "modules", "doc", { chip: "Langium" })}
          ${a}
          ${focus("Lower", "facts", "layers", { chip: "provenance" })}
          ${a}
          ${focus("Rules", "semantics", "shield", { chip: "indexes" })}
          ${a}
          ${focus("Diagnose", "output", "fail", { tone: "red", chip: "stable text" })}
        </div>
        <div class="banner"><span class="primary">Declared model only</span><span class="secondary">not runtime proof</span></div>
      </div>`,
    }),

  "fact-lowering-map": () =>
    shell({
      kicker: "Internals",
      title: "Fact Lowering",
      lede: "Declarations become facts with provenance so rules can explain themselves.",
      footerRight: "write → lower → evaluate",
      body: `<div class="flow">
        ${card("Write", ["Resources · traits", "Components · relations"], { meta: ".shape text" })}
        ${a}
        ${card("Lower", ["Effects + grants", "Graph + guards", "Provenance kept"], { meta: "facts" })}
        ${a}
        ${card("Evaluate", [
          { t: "Forbids · grants · cycles", tone: "" },
          { t: "Diagnostics with a trail", tone: "fail" },
        ], { meta: "rules" })}
      </div>`,
    }),

  "rule-evaluation-board": () =>
    shell({
      kicker: "Internals",
      title: "Rule Evaluation",
      lede: "Rules reject incoherent claims—not taste.",
      footerRight: "facts in · diagnostics out",
      body: `<div class="flow">
        ${card("Inputs", ["Effects · grants", "Relation graph", "Memory · changes"], { meta: "indexes" })}
        ${a}
        ${card("Checks", [
          { t: "Forbidden effects", tone: "fail" },
          { t: "Missing grants", tone: "fail" },
          { t: "Cycles · guards", tone: "warn" },
        ], { meta: "semantics" })}
        ${a}
        ${card("Output", [
          { t: "pass", tone: "pass" },
          { t: "reject + witness", tone: "fail" },
        ], { meta: "result" })}
      </div>`,
    }),

  "review-helpers": () =>
    shell({
      kicker: "Tooling",
      title: "Review Helpers",
      lede: "Helpers support the loop. Only shp check is the gate.",
      footerRight: "fmt · author · explain · graph",
      body: `<div class="flow">
        ${card("fmt", ["Canonical layout", "fmt --check in CI"], { meta: "format" })}
        ${a}
        ${card("author", ["Draft scaffold", "Unknowns ok while drafting"], { meta: "scaffold" })}
        ${a}
        ${card("explain", ["Facts for a symbol", "Incident relations"], { meta: "inspect" })}
        ${a}
        ${card("graph", ["all · show · stats", "Filter by kind"], { tone: "green", meta: "structure" })}
      </div>`,
    }),

  "shape-boundary": () =>
    shell({
      kicker: "Boundary",
      title: "What Shape Is Not",
      lede: "Claims, review, and check—not a proof of production code.",
      footerRight: "in · out",
      body: `<div class="flow">
        ${card("In scope", [
          { t: "Model coherence", tone: "pass" },
          { t: "Review obligations", tone: "pass" },
          { t: "CI-stable failures", tone: "pass" },
        ], { tone: "green", meta: "this tool" })}
        ${a}
        ${card("Out of scope", [
          { t: "Runtime correctness proof", tone: "fail" },
          { t: "Replacing tests or review", tone: "fail" },
          { t: "Waiving final bans", tone: "fail" },
        ], { tone: "red", meta: "not this tool" })}
        ${a}
        ${card("Still required", ["Tests", "Typechecker", "Human code review"], { meta: "your stack" })}
      </div>`,
    }),

  "shape-model-loop": () =>
    shell({
      kicker: "Product model",
      title: "Shape Review Loop",
      lede: "Write rules as text. Review them. Check them. Gate the merge.",
      footerRight: "write · review · check · gate",
      body: `<div class="stack-v">
        <div class="flow">
          ${focus("Write", ".shape rules", "doc", { chip: "architecture text" })}
          ${a}
          ${focus("Review", "humans", "user", { chip: "read claims" })}
          ${a}
          ${focus("Check", "shp check", "term", { chip: "accept / reject" })}
          ${a}
          ${focus("Gate", "CI", "shield", { tone: "green", chip: "pass / fail" })}
        </div>
        <div class="banner"><span class="primary">Failures return to review</span><span class="secondary">claims stay the contract</span></div>
      </div>`,
    }),

  "analyzer-advisory-scan": () =>
    shell({
      kicker: "Analyzer",
      kickerTone: "amber",
      title: "Analyzer Hints",
      lede: "Source scanners can warn. They never replace the declared model.",
      footerRight: "advisory · not authority",
      body: `<div class="stack-v">
        <div class="flow">
          ${card("Source scan", [
            { t: "DELETE / TRUNCATE / DROP", tone: "fail" },
            { t: "Incomplete by design", tone: "warn" },
          ], { tone: "amber", meta: "lexical" })}
          ${a}
          ${card("Warning", [
            { t: "Possible missing effect", tone: "warn" },
            { t: "Does not rewrite the model", tone: "" },
          ], { tone: "amber", meta: "advisory only" })}
          ${a}
          ${card(".shape model", [
            { t: "Declared claims win", tone: "pass" },
            { t: "Checker enforces this only", tone: "pass" },
          ], { tone: "green", meta: "source of truth" })}
        </div>
        <div class="banner"><span class="primary">Declared architecture wins</span><span class="secondary">shp analyze · never authoritative</span></div>
      </div>`,
    }),
};

function focus(title, meta, icon, opts) {
  return focusCard(title, meta, icon, opts);
}
function focusCard(title, meta, icon, { tone = "", chip = "" } = {}) {
  return focusImpl(title, meta, icon, tone, chip);
}
function focusImpl(title, meta, icon, tone, chip) {
  return `<div class="card ${tone}">
    <div class="card-head">
      <div class="card-title">${title}</div>
      ${meta ? `<div class="card-meta">${meta}</div>` : ""}
    </div>
    <div class="card-body" style="align-items:center;text-align:center;gap:20px">
      <div class="orb ${tone}">${icons[icon] || icons.doc}</div>
      ${chip ? `<div class="chip ${tone}">${chip}</div>` : ""}
    </div>
  </div>`;
}

function findChromium() {
  for (const bin of ["chromium", "chromium-browser", "google-chrome", "google-chrome-stable"]) {
    const r = spawnSync("which", [bin], { encoding: "utf8" });
    if (r.status === 0) return r.stdout.trim();
  }
  throw new Error("Chromium not found");
}

const chromium = findChromium();
let ok = 0;
let fail = 0;

for (const [name, build] of Object.entries(frames)) {
  const html = build();
  const htmlPath = join(outHtml, `${name}.html`);
  writeFileSync(htmlPath, html);
  const pngTmp = join(tmp, `${name}.png`);
  const r = spawnSync(
    chromium,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--hide-scrollbars",
      "--force-device-scale-factor=1",
      "--virtual-time-budget=10000",
      "--run-all-compositor-stages-before-draw",
      `--window-size=1680,944`,
      `--screenshot=${pngTmp}`,
      pathToFileURL(htmlPath).href,
    ],
    { encoding: "utf8", timeout: 60000 },
  );
  if (r.status !== 0 || !existsSync(pngTmp)) {
    console.error(`FAIL ${name}`, (r.stderr || "").slice(0, 120));
    fail += 1;
    continue;
  }
  copyFileSync(pngTmp, join(outPng, `${name}.png`));
  console.log(`OK   ${name}`);
  ok += 1;
}

console.log(`\nDone: ${ok} rendered, ${fail} failed`);
if (fail) process.exit(1);
