import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureProcess } from "./process.ts";

test.skipIf(process.platform === "win32")(
  "[locked-intended] compiler timeout stops its POSIX descendant processes — anchor: docs-site/src/content/docs/reference/typescript-content-mapping.md#selected-source-gate",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "shape-process-tree-"));
    const node = Bun.which("node");
    if (!node) throw new Error("Process cancellation test requires Node on PATH.");
    try {
      const worker = join(root, "worker.cjs");
      await writeFile(
        worker,
        `
const { spawn } = require('node:child_process');
const { appendFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const depth = Number(process.argv[3]);
const root = process.argv[2];
writeFileSync(join(root, 'pid-' + depth), String(process.pid));
process.stdout.write('ready ' + depth + '\\n');
if (depth < 2) spawn(process.execPath, [__filename, root, String(depth + 1)], { stdio: 'inherit' });
setInterval(() => appendFileSync(join(root, 'heartbeat-' + depth), '.'), 10);
`
      );
      const result = await captureProcess(node, [worker, root, "0"], root, { timeoutMs: 1000 });
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("exceeded 1 seconds");
      expect(result.stdout).toContain("ready 2");
      const paths = [0, 1, 2].map((depth) => join(root, `heartbeat-${depth}`));
      const before = await Promise.all(paths.map((path) => readFile(path, "utf8")));
      expect(before.every((value) => value.length > 0)).toBe(true);
      await new Promise((accept) => setTimeout(accept, 100));
      const after = await Promise.all(paths.map((path) => readFile(path, "utf8")));
      expect(after).toEqual(before);
    } finally {
      // A regression must not leave the deliberately persistent test processes running.
      for (const depth of [2, 1, 0]) {
        try {
          const pid = Number(await readFile(join(root, `pid-${depth}`), "utf8"));
          process.kill(pid, "SIGKILL");
        } catch {
          // A killed descendant may already have been reaped.
        }
      }
      await rm(root, { recursive: true, force: true });
    }
  },
  5000
);
