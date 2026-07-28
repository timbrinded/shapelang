/**
 * Validate and render every production infographic with system Chromium.
 *
 * Nothing is published until all frames pass geometry, typography, icon, and
 * semantic-label checks.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import puppeteer from "puppeteer-core";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "../../..");
const framesDir = join(here, "frames");
const outInfographics = join(here, "../../src/assets/infographics");
const outAssets = join(here, "../../src/assets");
const outDocs = join(here, "../../../../docs");
const tmpDir = join(here, ".render-tmp");
const manifest = JSON.parse(readFileSync(join(here, "manifest.json"), "utf8"));

const width = 1680;
const height = 944;
const chromiumCandidates = [
  process.env.CHROMIUM_PATH,
  "chromium",
  "chromium-browser",
  "google-chrome",
  "google-chrome-stable"
].filter(Boolean);

function findBinary(candidates, errorMessage) {
  for (const binary of candidates) {
    const result = spawnSync("which", [binary], { encoding: "utf8" });
    if (result.status === 0) return result.stdout.trim();
  }
  throw new Error(errorMessage);
}

function normalizeText(value) {
  return value.toLocaleLowerCase().replaceAll(/\s+/g, " ").trim();
}

function validateSemanticLabels(concept, report) {
  const visibleText = normalizeText(report.diagrams[0]?.visibleText ?? "");
  const missingTerms = concept.reviewTerms.filter(
    (term) => !visibleText.includes(normalizeText(term))
  );
  if (missingTerms.length > 0) {
    throw new Error(
      `${concept.name}: missing review terms in rendered text: ${missingTerms.join(", ")}`
    );
  }
}

function validateSourceMapping(concept) {
  const assetName =
    concept.name === "shape-workflow" ? "shape-workflow.png" : `${concept.name}.png`;
  const sources = concept.sources.map((source) => {
    const path = join(repoRoot, source);
    if (!existsSync(path))
      throw new Error(`${concept.name}: source page does not exist: ${source}`);
    return { path, source };
  });
  if (!sources.some(({ path }) => readFileSync(path, "utf8").includes(assetName))) {
    throw new Error(`${concept.name}: no source page references ${assetName}`);
  }
}

function validatePngDimensions(path, frameName) {
  const identify = spawnSync("identify", ["-format", "%wx%h", path], { encoding: "utf8" });
  if (identify.status !== 0) {
    throw new Error(`${frameName}: ImageMagick identify failed: ${identify.stderr}`);
  }
  const dimensions = identify.stdout.trim();
  if (dimensions !== `${width}x${height}`) {
    throw new Error(`${frameName}: expected ${width}x${height}, received ${dimensions}`);
  }
}

const chromium = findBinary(
  chromiumCandidates,
  "Chromium or Chrome is required. Set CHROMIUM_PATH when it is not on PATH."
);
findBinary(["identify"], "ImageMagick identify is required for dimension validation.");

rmSync(tmpDir, { force: true, recursive: true });
mkdirSync(tmpDir, { recursive: true });
mkdirSync(outInfographics, { recursive: true });

const reports = [];
console.log(`Validating ${manifest.length} frames at ${width}×${height} with ${chromium}\n`);

const browser = await puppeteer.launch({
  args: ["--allow-file-access-from-files", "--disable-dev-shm-usage", "--no-sandbox"],
  defaultViewport: { deviceScaleFactor: 1, height, width },
  executablePath: chromium,
  headless: true
});

try {
  const page = await browser.newPage();
  let activeFrame = "";
  const pageErrors = [];
  page.on("pageerror", (error) => {
    pageErrors.push(`${activeFrame}: ${error.message}`);
  });

  for (const concept of manifest) {
    activeFrame = concept.name;
    pageErrors.length = 0;
    validateSourceMapping(concept);

    const htmlPath = join(framesDir, `${concept.name}.html`);
    if (!existsSync(htmlPath)) throw new Error(`${concept.name}: generated HTML frame is missing.`);
    const url = pathToFileURL(htmlPath).href;

    await page.goto(url, { waitUntil: "load" });
    await page.waitForFunction(() => document.documentElement.dataset.diagramStatus !== "pending", {
      timeout: 30_000
    });
    if (pageErrors.length > 0) throw new Error(pageErrors.join("\n"));

    const report = await page.$eval("#diagram-report", (element) =>
      JSON.parse(element.textContent ?? "{}")
    );
    if (report.status !== "ok") {
      throw new Error(
        `${concept.name}: diagram validation failed:\n${JSON.stringify(report.errors, null, 2)}`
      );
    }
    validateSemanticLabels(concept, report);

    const tmpPng = join(tmpDir, `${concept.name}.png`);
    await page.screenshot({ captureBeyondViewport: false, path: tmpPng, type: "png" });
    validatePngDimensions(tmpPng, concept.name);

    const diagram = report.diagrams[0];
    reports.push({
      edgeCount: diagram.edgeCount,
      endpointDrift: diagram.maximumEndpointError,
      layout: concept.layout,
      name: concept.name,
      nodeCount: diagram.nodeCount,
      reviewTerms: concept.reviewTerms,
      sources: concept.sources,
      status: "ok"
    });
    console.log(
      `checked ${concept.name} · ${diagram.nodeCount} nodes · ${diagram.edgeCount} edges · ` +
        `${diagram.maximumEndpointError.toFixed(3)}px endpoint drift`
    );
  }
} finally {
  await browser.close();
}

console.log("\nAll frames passed. Publishing assets…\n");

for (const concept of manifest) {
  const source = join(tmpDir, `${concept.name}.png`);
  if (concept.name === "shape-workflow") {
    copyFileSync(source, join(outAssets, "shape-workflow.png"));
    mkdirSync(outDocs, { recursive: true });
    copyFileSync(source, join(outDocs, "shape-workflow.png"));
  } else {
    copyFileSync(source, join(outInfographics, `${concept.name}.png`));
  }
  console.log(`published ${concept.name}`);
}

writeFileSync(
  join(here, "review-report.json"),
  `${JSON.stringify(
    {
      height,
      reports,
      status: "ok",
      width
    },
    null,
    2
  )}\n`,
  "utf8"
);

console.log("\nAll infographic assets were validated and published.");
