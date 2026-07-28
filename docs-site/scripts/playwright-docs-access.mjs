/**
 * Load every published Shape docs page from a hosted docs server.
 *
 * Usage:
 *   DOCS_BASE=http://127.0.0.1:4321/shapelang node docs-site/scripts/playwright-docs-access.mjs
 *
 * Optional:
 *   SCRATCH=/path/to/output  (default: cwd/docs-access-out)
 *   PLAYWRIGHT_MODULE=/path/to/playwright  (if not resolvable from node_modules)
 *
 * Requires playwright + chromium installed for the runner environment.
 * Exit 0 only when every listed page returns HTTP 200 and non-empty main text.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const BASE = (process.env.DOCS_BASE || "http://127.0.0.1:4321/shapelang").replace(/\/$/, "");
const OUT = process.env.SCRATCH || path.join(process.cwd(), "docs-access-out");

/** All 41 content pages under docs-site/src/content/docs. */
const PAGES = [
  { id: "index", path: "/" },
  { id: "learn-what-is-shape", path: "/learn/what-is-shape/" },
  { id: "learn-quickstart", path: "/learn/quickstart/" },
  { id: "learn-first-shape-file", path: "/learn/first-shape-file/" },
  { id: "learn-append-only-walkthrough", path: "/learn/append-only-walkthrough/" },
  { id: "learn-global-model-updates", path: "/learn/global-model-updates/" },
  { id: "learn-ci-workflow", path: "/learn/ci-workflow/" },
  { id: "concepts-resources-traits-effects", path: "/concepts/resources-traits-effects/" },
  { id: "concepts-components-ownership-grants", path: "/concepts/components-ownership-grants/" },
  { id: "concepts-evidence-source-refs", path: "/concepts/evidence-source-refs/" },
  { id: "concepts-model-updates-attestations", path: "/concepts/model-updates-attestations/" },
  { id: "concepts-implementations-coverage", path: "/concepts/implementations-coverage/" },
  { id: "concepts-relations-hypergraphs", path: "/concepts/relations-hypergraphs/" },
  { id: "concepts-rules-hypercycles", path: "/concepts/rules-hypercycles/" },
  { id: "concepts-refactor-constraints", path: "/concepts/refactor-constraints/" },
  { id: "concepts-analyzer-hints", path: "/concepts/analyzer-hints/" },
  { id: "concepts-diagnostics-provenance", path: "/concepts/diagnostics-provenance/" },
  { id: "concepts-domain-packs", path: "/concepts/domain-packs/" },
  { id: "concepts-unknowns-safety", path: "/concepts/unknowns-safety/" },
  { id: "concepts-ast-generation", path: "/concepts/ast-generation/" },
  { id: "examples-append-only-pass", path: "/examples/append-only-pass/" },
  { id: "examples-append-only-hard-delete-failure", path: "/examples/append-only-hard-delete-failure/" },
  { id: "examples-missing-shape-update", path: "/examples/missing-shape-update/" },
  { id: "examples-forbid-provides-boundary", path: "/examples/forbid-provides-boundary/" },
  { id: "examples-global-model-update", path: "/examples/global-model-update/" },
  { id: "examples-guarded-change-reevaluation", path: "/examples/guarded-change-reevaluation/" },
  { id: "examples-refactor-sensitive-function", path: "/examples/refactor-sensitive-function/" },
  { id: "examples-analyzer-warning", path: "/examples/analyzer-warning/" },
  { id: "reference-language-syntax", path: "/reference/language-syntax/" },
  { id: "reference-cli", path: "/reference/cli/" },
  { id: "reference-diagnostics", path: "/reference/diagnostics/" },
  { id: "reference-glossary", path: "/reference/glossary/" },
  { id: "reference-local-development", path: "/reference/local-development/" },
  { id: "inside-checker-pipeline", path: "/inside-shape/checker-pipeline/" },
  { id: "inside-design-rationale", path: "/inside-shape/design-rationale/" },
  { id: "inside-fact-lowering", path: "/inside-shape/fact-lowering/" },
  { id: "inside-formatter-editor-authoring", path: "/inside-shape/formatter-editor-authoring/" },
  { id: "inside-langium-grammar", path: "/inside-shape/langium-grammar/" },
  { id: "inside-rule-evaluation", path: "/inside-shape/rule-evaluation/" },
  { id: "inside-rule-engine-strategy", path: "/inside-shape/rule-engine-strategy/" },
  { id: "inside-experimental-semantic-kernel", path: "/inside-shape/experimental-semantic-kernel/" },
];

async function loadPlaywright() {
  if (process.env.PLAYWRIGHT_MODULE) {
    return import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
  }
  try {
    return await import("playwright");
  } catch {
    const require = createRequire(import.meta.url);
    try {
      const resolved = require.resolve("playwright");
      return import(pathToFileURL(resolved).href);
    } catch {
      console.error(
        "playwright is not installed. Install it for the runner, or set PLAYWRIGHT_MODULE to playwright's entry."
      );
      process.exit(2);
    }
  }
}

const { chromium } = await loadPlaywright();
const results = [];
const consoleByPage = {};

fs.mkdirSync(path.join(OUT, "page-text"), { recursive: true });
fs.mkdirSync(path.join(OUT, "screenshots"), { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.on("console", (msg) => {
  if (msg.type() === "error" || msg.type() === "warning") {
    const url = page.url();
    consoleByPage[url] ??= [];
    consoleByPage[url].push({ type: msg.type(), text: msg.text() });
  }
});
page.on("pageerror", (err) => {
  const url = page.url();
  consoleByPage[url] ??= [];
  consoleByPage[url].push({ type: "pageerror", text: String(err) });
});

for (const entry of PAGES) {
  const url = `${BASE}${entry.path}`;
  const record = {
    id: entry.id,
    url,
    ok: false,
    status: null,
    mainTextLen: 0,
    title: "",
    errors: [],
  };
  try {
    const response = await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    record.status = response?.status() ?? null;
    record.title = await page.title();
    const main = page.locator("main, article, .sl-markdown-content, [data-pagefind-body]").first();
    const text = (
      await main.innerText({ timeout: 10000 }).catch(async () => page.innerText("body"))
    ).trim();
    record.mainTextLen = text.length;
    record.ok = record.status === 200 && record.mainTextLen > 200;
    fs.writeFileSync(path.join(OUT, "page-text", `${entry.id}.txt`), text, "utf8");
    await page.screenshot({
      path: path.join(OUT, "screenshots", `${entry.id}.png`),
      fullPage: false,
    });
    record.errors = consoleByPage[url] ?? consoleByPage[page.url()] ?? [];
  } catch (e) {
    record.error = String(e);
  }
  results.push(record);
  console.log(
    JSON.stringify({
      id: record.id,
      status: record.status,
      mainTextLen: record.mainTextLen,
      ok: record.ok,
      errors: record.errors.length,
    })
  );
}

await browser.close();

const summary = {
  base: BASE,
  at: new Date().toISOString(),
  pages: results,
  allOk: results.every((r) => r.ok),
};
fs.writeFileSync(path.join(OUT, "playwright-docs-access.json"), JSON.stringify(summary, null, 2));
fs.writeFileSync(
  path.join(OUT, "playwright-docs-access.log"),
  [
    `# Playwright docs access`,
    `base: ${BASE}`,
    `at: ${summary.at}`,
    `allOk: ${summary.allOk}`,
    "",
    ...results.map(
      (r) =>
        `- ${r.id}: status=${r.status} textLen=${r.mainTextLen} ok=${r.ok} console=${r.errors?.length || 0}` +
        (r.error ? ` error=${r.error}` : "")
    ),
    "",
  ].join("\n")
);

if (!summary.allOk) process.exit(1);
console.log("ALL_OK");
