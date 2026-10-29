// Resource code `tag.kind("value")` and the registry's canon (A.3.3.7, A.12.4).
import { nfc } from "./util.ts";

export interface ResourceCode {
  tag: string;
  kind: string;
  value: string;
}

const RC = /^([A-Za-z_][\w-]*)\.([A-Za-z_][\w-]*)\("((?:[^"\\]|\\.)*)"\)$/;

export function parseResourceCode(s: string): ResourceCode | null {
  const m = RC.exec(s.trim());
  if (!m) return null;
  const [, tag, kind, raw] = m;
  if (tag === undefined || kind === undefined || raw === undefined) return null;
  let value: string;
  try {
    value = JSON.parse(`"${raw}"`) as string;
  } catch {
    return null;
  }
  return { tag, kind, value: nfc(value) };
}

export function printResourceCode(r: ResourceCode): string {
  return `${r.tag}.${r.kind}(${JSON.stringify(r.value)})`;
}

function sqlIdentParts(value: string): { text: string; quoted: boolean }[] {
  const parts: { text: string; quoted: boolean }[] = [];
  let i = 0;
  while (i < value.length) {
    if (value[i] === '"') {
      let j = i + 1;
      let text = "";
      while (j < value.length) {
        if (value[j] === '"' && value[j + 1] === '"') {
          text += '"';
          j += 2;
        } else if (value[j] === '"') break;
        else {
          text += value[j];
          j += 1;
        }
      }
      parts.push({ text, quoted: true });
      i = j + 1;
      if (value[i] === ".") i += 1;
    } else {
      let j = i;
      while (j < value.length && value[j] !== ".") j += 1;
      parts.push({ text: value.slice(i, j).trim(), quoted: false });
      i = j + 1;
    }
  }
  return parts;
}

function canonSqlTable(value: string, stripPublic: boolean): string {
  const parts = sqlIdentParts(value).map((p) => (p.quoted ? p.text : p.text.toLowerCase()));
  if (stripPublic && parts.length === 2 && parts[0] === "public") parts.shift();
  return parts.join(".");
}

function canonRoute(value: string): string {
  const m = /^\s*([A-Za-z]+)\s+(\S.*?)\s*$/.exec(value);
  if (!m) return value;
  const method = (m[1] ?? "").toUpperCase();
  const path = (m[2] ?? "").replace(/\{[^}]*\}/g, "{}").replace(/:[A-Za-z_]\w*/g, "{}");
  return `${method} ${path}`;
}

/** canon: a pure string function per registry entry; `*` (channel wildcard) is kept. */
export function canonResourceCode(s: string): string | null {
  const r = parseResourceCode(s);
  if (!r) return null;
  if (r.value === "*") return printResourceCode(r);
  const key = `${r.tag}.${r.kind}`;
  let value = r.value;
  if (key === "pg.table") value = canonSqlTable(value, true);
  else if (key === "mysql.table" || key === "sqlite.table") value = canonSqlTable(value, false);
  else if (key === "ts.call") value = value.replace(/^globalThis\./, "");
  else if (key === "http.route") value = canonRoute(value);
  return printResourceCode({ ...r, value });
}

/** effect(p) matches t iff tag and kind are equal and p's value is `*` or equal (A.5.2.3). */
export function channelMatches(pattern: string, t: string): boolean {
  const p = parseResourceCode(pattern);
  const r = parseResourceCode(t);
  if (!p || !r) return false;
  if (p.tag !== r.tag || p.kind !== r.kind) return false;
  if (p.value === "*") return true;
  return canonResourceCode(pattern) === canonResourceCode(t);
}

/** Languages carrying a resource-code kind, and whether raw executables and command code carry it. */
export function carriers(t: string): {
  langs: Set<string> | "all";
  rawCarrier: boolean;
  rawExts: string[];
} {
  const r = parseResourceCode(t);
  const key = r ? `${r.tag}.${r.kind}` : "";
  switch (key) {
    case "pg.table":
    case "mysql.table":
    case "sqlite.table":
      // embedded-SQL languages (A.12.4); .sql files are raw executables (script list).
      return { langs: new Set(["ts", "rust", "verus"]), rawCarrier: true, rawExts: [] };
    case "ts.call":
      return {
        langs: new Set(["ts"]),
        rawCarrier: false,
        rawExts: ["html", "htm", "astro", "vue", "svelte"]
      };
    case "http.route":
      return { langs: "all", rawCarrier: true, rawExts: [] };
    default:
      return { langs: "all", rawCarrier: true, rawExts: [] };
  }
}

export function tagKind(t: string): string {
  const r = parseResourceCode(t);
  return r ? `${r.tag}.${r.kind}` : t;
}
