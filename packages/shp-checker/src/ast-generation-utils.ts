import { createHash } from "node:crypto";

import type { SourceSpan } from "./ast-generation-types.ts";
import { compareCodepointStrings } from "./shape-strings.ts";
export { compareCodepointStrings } from "./shape-strings.ts";

// Every ID-shaped keyword in shape.langium. A generated identifier that
// matches a keyword would produce unparsable Shape, so the AST generator
// escapes any source segment, function, or type name in this set. Keep it
// exhaustive over the grammar; the "reserved words cover all grammar keywords"
// test guards against drift when a new keyword is added.
const SHAPE_RESERVED_WORDS = new Set([
  "add",
  "allow",
  "applies_to",
  "approver",
  "as",
  "attest",
  "binding",
  "callbacks",
  "calls",
  "candidate",
  "change",
  "complete",
  "component",
  "confidence",
  "conforms_to",
  "connects",
  "coordinated_call",
  "decided_on",
  "description",
  "effect",
  "effects",
  "evidence",
  "except",
  "expects",
  "expires",
  "final",
  "fingerprint",
  "fn",
  "forbid",
  "grants",
  "guards",
  "has",
  "hypercycle",
  "implementation",
  "import",
  "kind",
  "memory",
  "modify",
  "module",
  "observed",
  "on_change",
  "or",
  "outcome",
  "over",
  "owner",
  "owns",
  "paths",
  "pin",
  "policy",
  "protects",
  "provides",
  "rationale",
  "reason",
  "reevaluation",
  "relation",
  "remove",
  "require",
  "require_changed",
  "require_context",
  "required",
  "requires",
  "resource",
  "review_by",
  "reviewer",
  "role",
  "roles",
  "rule",
  "satisfied_by",
  "satisfies",
  "sensitive",
  "source",
  "status",
  "storage",
  "summary",
  "trait",
  "transform",
  "unknown",
  "unsafe",
  "when",
  "when_changed",
  "who",
  "why"
]);

/** The reserved Shape keywords the AST generator escapes. Exposed for the
 * grammar-coverage regression test. */
export function shapeReservedWords(): ReadonlySet<string> {
  return SHAPE_RESERVED_WORDS;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function stringProperty(value: Record<string, unknown>, key: string): string | undefined {
  const propertyValue = value[key];
  return typeof propertyValue === "string" ? propertyValue : undefined;
}

export function stringPropertyFromUnknown(value: unknown, key: string): string | undefined {
  return isRecord(value) ? stringProperty(value, key) : undefined;
}

export function booleanProperty(value: Record<string, unknown>, key: string): boolean | undefined {
  const propertyValue = value[key];
  return typeof propertyValue === "boolean" ? propertyValue : undefined;
}

export function booleanPropertyFromUnknown(value: unknown, key: string): boolean | undefined {
  return isRecord(value) ? booleanProperty(value, key) : undefined;
}

export function numberProperty(value: Record<string, unknown>, key: string): number | undefined {
  const propertyValue = value[key];
  return typeof propertyValue === "number" ? propertyValue : undefined;
}

export function numberPropertyFromUnknown(value: unknown, key: string): number | undefined {
  return isRecord(value) ? numberProperty(value, key) : undefined;
}

export function spanProperty(value: Record<string, unknown>, key: string): SourceSpan | undefined {
  const propertyValue = value[key];
  if (!isRecord(propertyValue)) {
    return undefined;
  }
  const startLine = numberProperty(propertyValue, "startLine");
  const startColumn = numberProperty(propertyValue, "startColumn");
  const endLine = numberProperty(propertyValue, "endLine");
  const endColumn = numberProperty(propertyValue, "endColumn");
  if (
    startLine === undefined ||
    startColumn === undefined ||
    endLine === undefined ||
    endColumn === undefined
  ) {
    return undefined;
  }
  return {
    startLine,
    startColumn,
    endLine,
    endColumn,
    startByte: numberProperty(propertyValue, "startByte"),
    endByte: numberProperty(propertyValue, "endByte")
  };
}

export function scalarRecordProperty(
  value: Record<string, unknown>,
  key: string
): Record<string, string | number | boolean | null> | undefined {
  const propertyValue = value[key];
  if (!isRecord(propertyValue)) {
    return undefined;
  }
  const result: Record<string, string | number | boolean | null> = {};
  for (const [entryKey, entryValue] of Object.entries(propertyValue)) {
    if (
      typeof entryValue === "string" ||
      typeof entryValue === "number" ||
      typeof entryValue === "boolean" ||
      entryValue === null
    ) {
      result[entryKey] = entryValue;
    } else {
      result[entryKey] = null;
    }
  }
  return result;
}

export function hasNonScalarRecordEntry(value: Record<string, unknown>, key: string): boolean {
  const propertyValue = value[key];
  if (!isRecord(propertyValue)) {
    return false;
  }
  return Object.values(propertyValue).some(
    (entryValue) =>
      typeof entryValue !== "string" &&
      typeof entryValue !== "number" &&
      typeof entryValue !== "boolean" &&
      entryValue !== null
  );
}

export function stableJson(value: unknown): string {
  type StableJsonFrame =
    | { kind: "value"; value: unknown }
    | { kind: "array"; values: unknown[]; index: number; started: boolean }
    | {
        kind: "object";
        entries: [string, unknown][];
        index: number;
        started: boolean;
      };

  let output = "";
  const stack: StableJsonFrame[] = [{ kind: "value", value }];
  while (stack.length > 0) {
    const frame = stack.pop();
    if (!frame) {
      continue;
    }
    if (frame.kind === "value") {
      if (Array.isArray(frame.value)) {
        stack.push({ kind: "array", values: frame.value, index: 0, started: false });
      } else if (frame.value && typeof frame.value === "object") {
        stack.push({
          kind: "object",
          entries: Object.entries(frame.value as Record<string, unknown>)
            .filter(([, item]) => item !== undefined)
            .sort(([left], [right]) => compareCodepointStrings(left, right)),
          index: 0,
          started: false
        });
      } else {
        output += JSON.stringify(frame.value) ?? "null";
      }
      continue;
    }
    if (frame.kind === "array") {
      if (!frame.started) {
        output += "[";
        frame.started = true;
      }
      if (frame.index >= frame.values.length) {
        output += "]";
        continue;
      }
      if (frame.index > 0) {
        output += ",";
      }
      const item = frame.values[frame.index];
      frame.index += 1;
      stack.push(frame);
      stack.push({ kind: "value", value: item });
      continue;
    }
    if (!frame.started) {
      output += "{";
      frame.started = true;
    }
    if (frame.index >= frame.entries.length) {
      output += "}";
      continue;
    }
    if (frame.index > 0) {
      output += ",";
    }
    const [key, item] = frame.entries[frame.index] ?? ["", undefined];
    output += `${JSON.stringify(key)}:`;
    frame.index += 1;
    stack.push(frame);
    stack.push({ kind: "value", value: item });
  }
  return output;
}

export function sha256Fingerprint(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function sourceLanguage(language: string): string {
  if (language === "typescript" || language === "tsx") {
    return "ts";
  }
  if (language === "javascript" || language === "jsx") {
    return "js";
  }
  if (language === "python") {
    return "python";
  }
  if (language === "rust") {
    return "rust";
  }
  if (language === "go") {
    return "go";
  }
  return "file";
}

export function normalizeLanguageName(language: string | undefined): string | undefined {
  if (!language) {
    return undefined;
  }
  const lower = language.toLowerCase();
  if (lower === "ts") {
    return "typescript";
  }
  if (lower === "js" || lower === "jsx") {
    return "javascript";
  }
  if (lower === "tsx") {
    return "tsx";
  }
  if (lower === "rs") {
    return "rust";
  }
  if (lower === "py") {
    return "python";
  }
  return lower;
}

export function normalizeModuleName(moduleName: string): string {
  return moduleName
    .split(".")
    .map((part) => stableShapeId(part, "generated").replace(/_[0-9a-f]{16}$/, ""))
    .join(".");
}

export function shapeTypeName(value: string): string {
  const raw = toPascal(value);
  const clean = raw.replace(/[^A-Za-z0-9_]/g, "_");
  const prefixed = /^[A-Za-z_]/.test(clean) ? clean : `Generated_${clean}`;
  return avoidReservedShapeWord(prefixed || "Generated", "Generated");
}

export function shapeFunctionName(value: string): string {
  const clean = value.replace(/[^A-Za-z0-9_]/g, "_");
  const prefixed = /^[A-Za-z_]/.test(clean) ? clean : `fn_${clean}`;
  return avoidReservedShapeWord(prefixed || "generatedFunction", "generatedFunction");
}

export function stableShapeId(value: string, fallback: string): string {
  const base = value
    .replace(/[^A-Za-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 72);
  const clean = base.length > 0 ? base : fallback;
  const prefixed = avoidReservedShapeWord(
    /^[A-Za-z_]/.test(clean) ? clean : `${fallback}_${clean}`,
    fallback
  );
  return `${prefixed}_${stableIdentityHash(value).slice(0, 16)}`;
}

function avoidReservedShapeWord(value: string, fallback: string): string {
  return SHAPE_RESERVED_WORDS.has(value.toLowerCase()) ? `${fallback}_${value}` : value;
}

export function uniqueSemanticName(value: string, existing: string[], salt: string): string {
  if (!existing.includes(value)) {
    return value;
  }
  return stableShapeId(`${value}_${salt}`, value);
}

export function uniqueShapeName(value: string, seen: Set<string>): string {
  let name = stableShapeId(value, "Generated");
  let suffix = 2;
  while (seen.has(name)) {
    name = stableShapeId(`${value}_${suffix}`, "Generated");
    suffix += 1;
  }
  seen.add(name);
  return name;
}

export function uniqueReadableShapeName(value: string, seen: Set<string>): string {
  const base = shapeTypeName(value);
  if (!seen.has(base)) {
    seen.add(base);
    return base;
  }

  let suffix = stableHash(value).slice(0, 8);
  let name = `${base}_${suffix}`;
  let counter = 2;
  while (seen.has(name)) {
    suffix = stableHash(`${value}_${counter}`).slice(0, 8);
    name = `${base}_${suffix}`;
    counter += 1;
  }
  seen.add(name);
  return name;
}

export function shapeRelationName(value: string): string {
  return shapeTypeName(value.replace(/\bcandidate_call\b/g, "candidate call"));
}

export function originalName(name: string): string {
  return name.replace(/_[0-9a-f]{16}$/, "").replace(/_[0-9a-f]{8}$/, "");
}

function toPascal(value: string): string {
  const words = value.split(/[^A-Za-z0-9]+/).filter((word) => word.length > 0);
  const pascal = words.map((word) => `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`).join("");
  return pascal || value;
}

export function baseNameWithoutExtension(path: string): string {
  return (
    path
      .split("/")
      .at(-1)
      ?.replace(/\.[^.]+$/, "") ?? "file"
  );
}

export function quoteShapeString(value: string): string {
  return JSON.stringify(value);
}

export function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function stableIdentityHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function makeByteToStringIndexMap(source: string): number[] {
  const encoder = new TextEncoder();
  const map: number[] = [];
  let byteOffset = 0;
  for (let index = 0; index < source.length; ) {
    const codePoint = source.codePointAt(index);
    const text = String.fromCodePoint(codePoint ?? 0);
    const width = encoder.encode(text).length;
    for (let byte = 0; byte < width; byte += 1) {
      map[byteOffset + byte] = index;
    }
    byteOffset += width;
    index += text.length;
  }
  map[byteOffset] = source.length;
  return map;
}

export function sliceByByteRange(
  source: string,
  startByte: number,
  endByte: number,
  map: number[]
): string {
  const start = map[startByte] ?? source.length;
  const end = map[endByte] ?? source.length;
  return source.slice(start, end);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
