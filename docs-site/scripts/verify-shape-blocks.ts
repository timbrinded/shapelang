import { readdir, readFile } from "node:fs/promises";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parseShapeModule } from "@shape/shp-checker";

const fencePattern = /^```([^\n\r`]*)\r?\n([\s\S]*?)^```[ \t]*$/gm;
const supportedExtensions = new Set([".md", ".mdx", ".mdoc"]);

export type Failure = {
  filePath: string;
  line: number;
  messages: string[];
};

/** A fenced code block lifted from a markdown source, with its 1-based start line. */
export type ShapeFence = {
  /** The fence info string after the opening backticks, trimmed (e.g. `shape no-verify`). */
  info: string;
  /** The fence body between the opening and closing backticks. */
  code: string;
  /** 1-based line number of the opening fence in the source. */
  line: number;
};

/** An in-memory markdown document: a logical path plus its raw text. */
export type CorpusFile = {
  filePath: string;
  source: string;
};

/** The verdict for a single `shape` fence. */
export type FenceVerdict =
  | { kind: "skip" }
  | { kind: "pass" }
  | { kind: "fail"; messages: string[] };

/** Tallies returned when verifying a whole corpus. */
export type VerifyReport = {
  failures: Failure[];
  checked: number;
  skipped: number;
};

/**
 * Extract every fenced code block from a markdown source. Each entry carries the
 * trimmed info string, the fence body, and the 1-based line of the opening
 * fence. The verifier inspects the info string itself to decide which fences are
 * `shape` fences; this function does not filter by language, so callers can test
 * fence detection independently of the shape verdict.
 */
export function extractShapeFences(source: string): ShapeFence[] {
  const fences: ShapeFence[] = [];
  for (const match of source.matchAll(fencePattern)) {
    fences.push({
      info: (match[1] ?? "").trim(),
      code: match[2] ?? "",
      line: lineNumberAt(source, match.index ?? 0)
    });
  }
  return fences;
}

/** True when the fence is a `shape` fence (first info token is exactly `shape`). */
export function isShapeFence(info: string): boolean {
  const [language] = info.split(/\s+/, 1);
  return language === "shape";
}

/** True when a `shape` fence opts out of verification via a `no-verify` marker. */
export function isNoVerify(info: string): boolean {
  return /\bno-verify\b/.test(info);
}

/**
 * Decide the verdict for one fence. The contract this whole gate exists to
 * enforce (see shape/language.shape DocsShapeBlockParsingContract): a `shape`
 * fence is valid iff the repo parser accepts it, and a fence is skipped iff its
 * info string carries `no-verify`. The accept/reject decision delegates entirely
 * to `parseShapeModule` so the verifier embeds no divergent grammar.
 */
export function verifyOneFence(fence: ShapeFence, filePath: string): FenceVerdict {
  if (isNoVerify(fence.info)) {
    return { kind: "skip" };
  }

  const parsed = parseShapeModule(fence.code, `${filePath}:${fence.line}.shape`);
  if (parsed.ok) {
    return { kind: "pass" };
  }

  return {
    kind: "fail",
    messages: parsed.diagnostics.map((diagnostic) => {
      const location = diagnostic.line ? `${diagnostic.line}:${diagnostic.column ?? 1}` : "unknown";
      return `${location} ${diagnostic.message}`;
    })
  };
}

/**
 * Verify every `shape` fence across an in-memory corpus, returning the failures
 * (each naming the file and the opening-fence line), the number of fences
 * checked, and the number skipped. Non-`shape` fences are ignored entirely.
 */
export function verifyShapeCorpus(corpus: CorpusFile[]): VerifyReport {
  const failures: Failure[] = [];
  let checked = 0;
  let skipped = 0;

  for (const { filePath, source } of corpus) {
    for (const fence of extractShapeFences(source)) {
      if (!isShapeFence(fence.info)) {
        continue;
      }

      const verdict = verifyOneFence(fence, filePath);
      if (verdict.kind === "skip") {
        skipped += 1;
      } else if (verdict.kind === "pass") {
        checked += 1;
      } else {
        checked += 1;
        failures.push({ filePath, line: fence.line, messages: verdict.messages });
      }
    }
  }

  return { failures, checked, skipped };
}

/** Compute the 1-based line number of a byte offset in `source`. */
export function lineNumberAt(source: string, index: number): number {
  let line = 1;
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (source.charCodeAt(cursor) === 10) {
      line += 1;
    }
  }
  return line;
}

/** Recursively collect markdown documents under a directory, path-sorted. */
export async function collectDocsFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectDocsFiles(entryPath)));
    } else if (supportedExtensions.has(extname(entry.name))) {
      files.push(entryPath);
    }
  }

  return files.sort();
}

/**
 * The CLI entry point: read every docs markdown file, verify its `shape` fences,
 * print a one-line summary, and exit non-zero if any fence is invalid. Output and
 * exit behaviour are unchanged from the original script.
 */
async function runCli(): Promise<void> {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const docsRoot = join(scriptDir, "..", "src", "content", "docs");
  const files = await collectDocsFiles(docsRoot);

  const corpus: CorpusFile[] = await Promise.all(
    files.map(async (filePath) => ({
      filePath,
      source: await readFile(filePath, "utf8")
    }))
  );

  const { failures, checked, skipped } = verifyShapeCorpus(corpus);

  if (failures.length > 0) {
    for (const failure of failures) {
      console.error(
        `${relative(process.cwd(), failure.filePath)}:${failure.line}: invalid shape code block`
      );
      for (const message of failure.messages) {
        console.error(`  ${message}`);
      }
    }
    process.exit(1);
  }

  console.log(
    `Verified ${checked} shape code blocks${skipped > 0 ? `; skipped ${skipped} marked no-verify` : ""}.`
  );
}

if (import.meta.main) {
  await runCli();
}
