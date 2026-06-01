// Path and glob helpers used by coverage and binding checks. Stateless string
// work over repo-relative paths; depends only on the parse-side path
// normalization in shape-strings.ts.
import { isAbsolute, relative } from "node:path";
import { normalizeShapePath } from "../shape-strings.ts";

export function normalizeRepoPath(path: string): string {
  const normalized = normalizeShapePath(path);
  if (!isAbsolute(normalized)) {
    return normalized;
  }

  return normalizeShapePath(relative(process.cwd(), normalized));
}

export function globMatches(glob: string, path: string): boolean {
  const normalizedGlob = normalizeShapePath(glob);
  const normalizedPath = normalizeShapePath(path);
  const regex = new RegExp(`^${globToRegex(normalizedGlob)}$`);
  return regex.test(normalizedPath);
}

export function globToRegex(glob: string): string {
  let regex = "";
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    const next = glob[index + 1];
    const afterNext = glob[index + 2];
    if (char === "*" && next === "*" && afterNext === "/") {
      regex += "(?:.*/)?";
      index += 2;
    } else if (char === "*" && next === "*") {
      regex += ".*";
      index += 1;
    } else if (char === "*") {
      regex += "[^/]*";
    } else if (char === "?") {
      regex += ".";
    } else if (char) {
      regex += escapeRegex(char);
    }
  }
  return regex;
}

export function escapeRegex(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}
