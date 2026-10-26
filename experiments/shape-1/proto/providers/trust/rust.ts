// Rust/Verus trust markers with the semantics of experiments/verus-probes/vprobe (tcb_scan over the
// proc_macro2 token tree of the whole file: comments never count, string literals are single
// tokens), ported to TypeScript, and an audit of the manifest's per-identity markers against it.
import type { ManifestIndex } from "../../src/manifest.ts";
import { cmpStr } from "../../src/util.ts";

export type TT =
  | { kind: "ident" | "punct" | "lit"; text: string }
  | { kind: "group"; delim: "(" | "[" | "{"; items: TT[] };

const CLOSE: Record<string, "(" | "[" | "{"> = { ")": "(", "]": "[", "}": "{" };

/** proc_macro2-like token trees: groups nest, punctuation is one char, comments are dropped
 *  (doc comments become string content, so they never count either). */
export function lexRustTree(src: string): TT[] {
  const root: TT[] = [];
  const stack: { delim: "(" | "[" | "{"; items: TT[] }[] = [];
  const cur = (): TT[] => (stack.length > 0 ? (stack[stack.length - 1] as { items: TT[] }).items : root);
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i] as string;
    if (/\s/.test(c)) {
      i += 1;
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      while (i < n && src[i] !== "\n") i += 1;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      let depth = 0;
      while (i < n) {
        if (src[i] === "/" && src[i + 1] === "*") {
          depth += 1;
          i += 2;
        } else if (src[i] === "*" && src[i + 1] === "/") {
          depth -= 1;
          i += 2;
          if (depth === 0) break;
        } else i += 1;
      }
      continue;
    }
    if (c === "(" || c === "[" || c === "{") {
      stack.push({ delim: c, items: [] });
      i += 1;
      continue;
    }
    if (c === ")" || c === "]" || c === "}") {
      const open = CLOSE[c];
      const top = stack.pop();
      if (top) cur().push({ kind: "group", delim: top.delim, items: top.items });
      void open;
      i += 1;
      continue;
    }
    const start = i;
    // raw strings r"…", r#"…"#, br"…"
    const raw = /^(?:b?r)(#*)"/.exec(src.slice(i, i + 40));
    if (raw && (i === 0 || !/[\w]/.test(src[i - 1] as string))) {
      const hashes = raw[1] ?? "";
      i += raw[0].length;
      const close = `"${hashes}`;
      const e = src.indexOf(close, i);
      i = e < 0 ? n : e + close.length;
      cur().push({ kind: "lit", text: src.slice(start, i) });
      continue;
    }
    if (c === '"' || (c === "b" && src[i + 1] === '"')) {
      i += c === "b" ? 2 : 1;
      while (i < n && src[i] !== '"') i += src[i] === "\\" ? 2 : 1;
      i += 1;
      cur().push({ kind: "lit", text: src.slice(start, i) });
      continue;
    }
    if (c === "'") {
      // char literal, else a lifetime (punct ' then ident)
      const m = /^'(?:\\(?:x[0-9a-fA-F]{2}|u\{[0-9a-fA-F]+\}|.)|[^\\'\n])'/.exec(src.slice(i, i + 16));
      if (m) {
        i += m[0].length;
        cur().push({ kind: "lit", text: m[0] });
        continue;
      }
      i += 1;
      cur().push({ kind: "punct", text: "'" });
      continue;
    }
    if (/[A-Za-z_]/.test(c) || c.charCodeAt(0) > 127) {
      while (i < n && (/[\w]/.test(src[i] as string) || (src[i] as string).charCodeAt(0) > 127)) i += 1;
      cur().push({ kind: "ident", text: src.slice(start, i) });
      continue;
    }
    if (/[0-9]/.test(c)) {
      while (i < n && (/[\w]/.test(src[i] as string) || (src[i] === "." && /[0-9]/.test(src[i + 1] ?? "")))) i += 1;
      cur().push({ kind: "lit", text: src.slice(start, i) });
      continue;
    }
    i += 1;
    cur().push({ kind: "punct", text: c });
  }
  // unbalanced input: flush open groups in order
  while (stack.length > 0) {
    const top = stack.pop() as { delim: "(" | "[" | "{"; items: TT[] };
    cur().push({ kind: "group", delim: top.delim, items: top.items });
  }
  return root;
}

/** vprobe's tcb_scan: file-level trust-marker counts keyed as vprobe keys them. */
export function vprobeTcb(src: string): Record<string, number> {
  const out: Record<string, number> = {};
  const add = (k: string): void => {
    out[k] = (out[k] ?? 0) + 1;
  };
  const scan = (toks: TT[]): void => {
    toks.forEach((t, i) => {
      if (t.kind === "group") {
        scan(t.items);
        return;
      }
      if (t.kind !== "ident") return;
      const next = toks[i + 1];
      const nextParen = next?.kind === "group" && next.delim === "(";
      const nextIsFn = next?.kind === "ident" && next.text === "fn";
      const p1 = toks[i - 1];
      const p3 = toks[i - 3];
      const prevVerifierPath = i >= 3 && p1?.kind === "punct" && p1.text === ":" && p3?.kind === "ident" && p3.text === "verifier";
      switch (t.text) {
        case "external_body":
        case "external_fn_specification":
        case "external_type_specification":
        case "assume_specification":
        case "uninterp":
          add(t.text);
          break;
        case "external":
          if (prevVerifierPath || toks.length === 1) add("external");
          break;
        case "assume":
          if (nextParen) add("assume");
          break;
        case "admit":
          if (nextParen) add("admit");
          break;
        case "axiom":
          if (nextIsFn) add("axiom_fn");
          break;
        default:
          break;
      }
    });
  };
  scan(lexRustTree(src));
  return Object.fromEntries(Object.entries(out).sort((a, b) => cmpStr(a[0], b[0])));
}

/** vprobe keys → std hatch kinds (std: external_body, external, assume, admit,
 *  assume_specification, uninterp, axiom); external_type_specification has no std kind. */
export const VPROBE_TO_HATCH: Record<string, string> = {
  external_body: "external_body",
  external: "external",
  external_fn_specification: "external",
  external_type_specification: "external_type_specification",
  assume_specification: "assume_specification",
  uninterp: "uninterp",
  assume: "assume",
  admit: "admit",
  axiom_fn: "axiom"
};

export function asHatchKinds(tcb: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, n] of Object.entries(tcb)) {
    const h = VPROBE_TO_HATCH[k] ?? k;
    out[h] = (out[h] ?? 0) + n;
  }
  return Object.fromEntries(Object.entries(out).sort((a, b) => cmpStr(a[0], b[0])));
}

/** The manifest's markers for a file: its file identity's own markers plus every symbol's. */
export function manifestFileMarkers(index: ManifestIndex, path: string): { lang: string; markers: Record<string, number>; hatchComplete: boolean } | null {
  let lang = "";
  const out: Record<string, number> = {};
  let found = false;
  let complete = true;
  for (const info of index.ids.values()) {
    if (info.path !== path) continue;
    found = true;
    if (info.symbol === null) lang = info.lang;
    if (!info.hatchComplete) complete = false;
    for (const [k, n] of Object.entries(info.markers)) out[k] = (out[k] ?? 0) + n;
  }
  if (!found) return null;
  return { lang, markers: Object.fromEntries(Object.entries(out).sort((a, b) => cmpStr(a[0], b[0]))), hatchComplete: complete };
}

export interface RustAuditRow {
  path: string;
  lang: string;
  vprobe: Record<string, number>;
  manifest: Record<string, number>;
  /** hatch kind → manifest − vprobe (non-zero only) */
  delta: Record<string, number>;
  hatchComplete: boolean;
}

/** Per .rs file: vprobe-semantics counts (as std hatch kinds) against the manifest's markers. */
export function auditRust(index: ManifestIndex, read: (p: string) => string | null, paths?: string[]): RustAuditRow[] {
  const rows: RustAuditRow[] = [];
  const files = paths ?? [...index.paths].filter((p) => p.endsWith(".rs")).sort(cmpStr);
  for (const p of files) {
    const text = read(p);
    if (text === null) continue;
    const m = manifestFileMarkers(index, p);
    const v = asHatchKinds(vprobeTcb(text));
    const man = m?.markers ?? {};
    const delta: Record<string, number> = {};
    for (const k of new Set([...Object.keys(v), ...Object.keys(man)])) {
      const d = (man[k] ?? 0) - (v[k] ?? 0);
      if (d !== 0) delta[k] = d;
    }
    rows.push({ path: p, lang: m?.lang ?? "", vprobe: v, manifest: man, delta: Object.fromEntries(Object.entries(delta).sort((a, b) => cmpStr(a[0], b[0]))), hatchComplete: m?.hatchComplete ?? false });
  }
  return rows;
}
