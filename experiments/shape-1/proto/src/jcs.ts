// RFC 8785 (JCS) canonical JSON for the float-free values Shape hashes, plus H().
import { createHash } from "node:crypto";

/** Canonical JSON. Throws on floats, unsafe integers and non-JSON values (A.0.4). */
export function jcs(value: unknown): string {
  return serialise(value);
}

function serialise(v: unknown): string {
  if (v === null) return "null";
  switch (typeof v) {
    case "boolean":
      return v ? "true" : "false";
    case "number":
      if (!Number.isSafeInteger(v)) throw new Error(`JCS: non-integer or unsafe number ${v}`);
      return String(v);
    case "string":
      return JSON.stringify(v);
    case "object": {
      if (Array.isArray(v)) return `[${v.map((x) => serialise(x === undefined ? null : x)).join(",")}]`;
      const obj = v as Record<string, unknown>;
      // RFC 8785 sorts keys by UTF-16 code units, which is JavaScript's default sort.
      const keys = Object.keys(obj)
        .filter((k) => obj[k] !== undefined)
        .sort();
      return `{${keys.map((k) => `${JSON.stringify(k)}:${serialise(obj[k])}`).join(",")}}`;
    }
    default:
      throw new Error(`JCS: unsupported value of type ${typeof v}`);
  }
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** hex(SHA-256(JCS(v))) */
export function hexh(v: unknown): string {
  return sha256Hex(jcs(v));
}

/** H(x) = "sha256:" + hex(SHA-256(JCS(x))) */
export function H(v: unknown): string {
  return `sha256:${hexh(v)}`;
}

/** Illustrative label digest used by the worked examples (vectors.py `label`). */
export function label(s: string): string {
  return `sha256:${sha256Hex(s)}`;
}

/** Parses JSON and asserts it is float-free (core inputs never carry floats). */
export function parseJson(text: string): unknown {
  return JSON.parse(text) as unknown;
}
