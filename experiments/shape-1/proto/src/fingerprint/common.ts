// Shared manifest-building types for the fingerprinters (impure tooling; never used by derive).
import { sha256Hex } from "../jcs.ts";
import type { ManifestEntry } from "../manifest.ts";

export interface FpIdentity {
  id: string;
  kind: string;
  parent: string | null;
  digests: { projection: ManifestEntry["projection"]; scheme: string; digest: string }[];
  markers: Record<string, number>;
  hatchComplete: boolean;
  executable: boolean;
  merged?: number;
}

/** SHA-256(σ ‖ LF ‖ canon) (A.5.7.2) */
export function codeDigest(scheme: string, canon: string | Uint8Array): string {
  const head = Buffer.from(`${scheme}\n`);
  const body = typeof canon === "string" ? Buffer.from(canon) : Buffer.from(canon);
  return `sha256:${sha256Hex(Buffer.concat([head, body]))}`;
}

export function encodeSegment(s: string, sep: "." | "::"): string {
  let out = s.replace(/%/g, "%25").replace(/#/g, "%23");
  if (sep === ".") out = out.replace(/\./g, "%2E");
  return out;
}

export function encodePath(p: string): string {
  return p.normalize("NFC").replace(/%/g, "%25").replace(/#/g, "%23");
}

/** Inert TS comments (A.12.2.9): not /** *\/ or ///, no @ or #__, none of the tool words. */
export function isInertComment(text: string): boolean {
  if (text.startsWith("/**") || text.startsWith("///")) return false;
  if (text.includes("@") || text.includes("#__")) return false;
  if (/\b(eslint|istanbul|c8|prettier|biome|webpack|vite|jsx)\b/.test(text)) return false;
  return true;
}
