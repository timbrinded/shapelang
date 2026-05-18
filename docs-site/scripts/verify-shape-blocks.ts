import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parseShapeModule } from "@shape/shp-checker";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const docsRoot = join(scriptDir, "..", "src", "content", "docs");
const fencePattern = /^```([^\n\r`]*)\r?\n([\s\S]*?)^```[ \t]*$/gm;
const supportedExtensions = new Set([".md", ".mdx", ".mdoc"]);

type Failure = {
  filePath: string;
  line: number;
  messages: string[];
};

const files = await collectDocsFiles(docsRoot);
const failures: Failure[] = [];
let checked = 0;
let skipped = 0;

for (const filePath of files) {
  const source = await readFile(filePath, "utf8");
  for (const match of source.matchAll(fencePattern)) {
    const info = (match[1] ?? "").trim();
    const [language] = info.split(/\s+/, 1);
    if (language !== "shape") {
      continue;
    }

    if (/\bno-verify\b/.test(info)) {
      skipped += 1;
      continue;
    }

    checked += 1;
    const line = lineNumberAt(source, match.index ?? 0);
    const parsed = parseShapeModule(match[2] ?? "", `${relative(process.cwd(), filePath)}:${line}.shape`);
    if (!parsed.ok) {
      failures.push({
        filePath,
        line,
        messages: parsed.diagnostics.map((diagnostic) => {
          const location = diagnostic.line ? `${diagnostic.line}:${diagnostic.column ?? 1}` : "unknown";
          return `${location} ${diagnostic.message}`;
        })
      });
    }
  }
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`${relative(process.cwd(), failure.filePath)}:${failure.line}: invalid shape code block`);
    for (const message of failure.messages) {
      console.error(`  ${message}`);
    }
  }
  process.exit(1);
}

console.log(`Verified ${checked} shape code blocks${skipped > 0 ? `; skipped ${skipped} marked no-verify` : ""}.`);

async function collectDocsFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectDocsFiles(entryPath));
    } else if (supportedExtensions.has(extensionOf(entry.name))) {
      files.push(entryPath);
    }
  }

  return files.sort();
}

function extensionOf(fileName: string): string {
  const index = fileName.lastIndexOf(".");
  return index >= 0 ? fileName.slice(index) : "";
}

function lineNumberAt(source: string, index: number): number {
  let line = 1;
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (source.charCodeAt(cursor) === 10) {
      line += 1;
    }
  }
  return line;
}
