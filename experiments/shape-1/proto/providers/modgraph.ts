// Relative-import module graphs over a tracked tree (A.12.2.10's tree-only resolver, relative
// specifiers only): used for law harnesses, record deps and mutant sandboxes.
import { readFileSync, statSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { makeResolver } from "../src/manifest-build.ts";
import { cmpStr } from "../src/util.ts";

const IMPORT_RE = [
  /\bimport\s+(?:type\s+)?(?:[\w*{}\s,$]+\s+from\s+)?["']([^"']+)["']/g,
  /\bexport\s+(?:type\s+)?(?:\*|\{[^}]*\})\s*(?:as\s+\w+\s+)?from\s+["']([^"']+)["']/g,
  /\bimport\(\s*["']([^"']+)["']\s*\)/g,
  /\brequire\(\s*["']([^"']+)["']\s*\)/g
];

/** Import specifiers of a JS/TS text (static, re-exports, literal dynamic imports, require). */
export function importSpecifiers(text: string): string[] {
  const out = new Set<string>();
  for (const re of IMPORT_RE) {
    re.lastIndex = 0;
    for (let m = re.exec(text); m; m = re.exec(text)) if (m[1]) out.add(m[1]);
  }
  return [...out].sort(cmpStr);
}

/** Repo-relative paths reachable from `start` through relative imports that resolve in `paths`. */
export function moduleClosure(
  start: string[],
  paths: Set<string>,
  read: (p: string) => string | null
): string[] {
  const resolve = makeResolver(paths);
  const seen = new Set<string>();
  const stack = [...start];
  while (stack.length > 0) {
    const p = stack.pop() as string;
    if (seen.has(p) || !paths.has(p)) continue;
    seen.add(p);
    const text = read(p);
    if (text === null || !/\.(?:[cm]?[jt]sx?)$/.test(p)) continue;
    for (const spec of importSpecifiers(text)) {
      const r = resolve(spec, p);
      if (r && !seen.has(r)) stack.push(r);
    }
  }
  return [...seen].sort(cmpStr);
}

/** Like moduleClosure, over the files on disk under root (tracked or not): used for sandboxes,
 *  where untracked law files and helpers must come along. */
export function diskClosure(root: string, start: string[]): string[] {
  const exists = (p: string): boolean => {
    try {
      return statSync(join(root, p)).isFile();
    } catch {
      return false;
    }
  };
  const seen = new Set<string>();
  const stack = [...start];
  while (stack.length > 0) {
    const p = stack.pop() as string;
    if (seen.has(p) || !exists(p)) continue;
    seen.add(p);
    if (!/\.(?:[cm]?[jt]sx?)$/.test(p)) continue;
    let text = "";
    try {
      text = readFileSync(join(root, p), "utf8");
    } catch {
      continue;
    }
    for (const spec of importSpecifiers(text)) {
      if (!spec.startsWith(".")) continue;
      const base = normalize(join(dirname(p), spec)).replace(/\\/g, "/");
      if (base.startsWith("..")) continue;
      const cands = [
        base,
        ...TS_EXTS.map((e) => base + e),
        ...TS_EXTS.map((e) => `${base}/index${e}`)
      ];
      const hit = cands.find(exists);
      if (hit && !seen.has(hit)) stack.push(hit);
    }
  }
  return [...seen].sort(cmpStr);
}

const TS_EXTS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];
