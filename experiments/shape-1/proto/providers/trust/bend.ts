// Bend 2 code identities and trust markers (a registry entry the core manifest builder lacks; std
// declares `hatch unsafe in bend`). Identities: bend:<path>#<name> per top-level def, law and type,
// with dotted names nesting under an existing prefix (halve.go under halve). Markers, never counted
// in comments or strings (Bend-D1 inventory):
//   unsafe     `@unsafe` before a def, or the `def f?` sugar (std hatch kind);
//   foreign    a def whose body is `import "./x.js"` / `"./x.c"` lines (host code);
//   hole       `?TODO` / `?name` terms;
//   open_law   a law no def of the same project fills (computed per directory).
// Schemes bend.file.syn1, bend.own.syn1, bend.unit.syn1 hash comment-free, right-trimmed lines.
import { type FpIdentity, codeDigest, encodePath } from "../../src/fingerprint/common.ts";
import { cmpStr } from "../../src/util.ts";

export interface BendDecl {
  kind: "def" | "law" | "type";
  name: string;
  /** line range [startLine, endLine) including leading attributes */
  start: number;
  end: number;
  markers: Record<string, number>;
}

export interface BendScan {
  path: string;
  decls: BendDecl[];
  /** top-level lines the scanner does not recognise (make the file not hatch-complete) */
  unknown: number;
  lines: string[];
}

/** Strips a `#` comment outside string and char literals ('#' is a char). */
export function stripBendComment(line: string): string {
  let inStr = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (!inStr && c === "'") {
      const m = /^'(?:\\.|[^\\'])'/.exec(line.slice(i, i + 4));
      if (m) {
        i += m[0].length - 1;
        continue;
      }
    }
    if (c === '"' && line[i - 1] !== "\\") inStr = !inStr;
    if (c === "#" && !inStr) return line.slice(0, i);
  }
  return line;
}

function stripStrings(line: string): string {
  return line.replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/'(?:\\.|[^\\'])'/g, "' '");
}

const DECL_RE = /^(def|law|type)\s+([A-Za-z_][\w.]*)(\?)?/;

export function scanBend(path: string, text: string): BendScan {
  const raw = text.split("\n");
  const lines = raw.map((l) => stripBendComment(l).replace(/\s+$/, ""));
  const decls: BendDecl[] = [];
  let unknown = 0;
  let pendingAttrStart: number | null = null;
  let pendingUnsafe = false;
  let cur: BendDecl | null = null;
  const close = (end: number): void => {
    if (cur) {
      cur.end = end;
      decls.push(cur);
      cur = null;
    }
  };
  let depth = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const l = lines[i] as string;
    if (l.trim() === "") continue;
    // a line inside open brackets, or starting with a closer, continues the previous item
    const top = !/^\s/.test(l) && depth <= 0 && !/^[)\]}]/.test(l);
    for (const ch of stripStrings(l)) {
      if (ch === "(" || ch === "[" || ch === "{") depth += 1;
      else if (ch === ")" || ch === "]" || ch === "}") depth -= 1;
    }
    if (top) {
      if (/^@unsafe\b/.test(l)) {
        close(i);
        pendingAttrStart = pendingAttrStart ?? i;
        pendingUnsafe = true;
        continue;
      }
      if (/^@\w+/.test(l)) {
        close(i);
        pendingAttrStart = pendingAttrStart ?? i;
        continue;
      }
      const m = DECL_RE.exec(l);
      if (m) {
        close(pendingAttrStart ?? i);
        const kind = m[1] as BendDecl["kind"];
        const markers: Record<string, number> = {};
        if (kind === "def" && (pendingUnsafe || m[3] === "?")) markers.unsafe = 1;
        cur = {
          kind,
          name: m[2] as string,
          start: pendingAttrStart ?? i,
          end: lines.length,
          markers
        };
        pendingAttrStart = null;
        pendingUnsafe = false;
        // holes on the header line after the name
        countHoles(stripStrings(l.slice(m[0].length)), markers);
        continue;
      }
      close(i);
      pendingAttrStart = null;
      pendingUnsafe = false;
      if (/^import\s/.test(l)) continue;
      unknown += 1;
      continue;
    }
    if (cur) {
      const body = cur as BendDecl;
      if (/^\s+import\s+"[^"]+"\s*$/.test(l)) body.markers.foreign = 1;
      countHoles(stripStrings(l), body.markers);
    }
  }
  close(lines.length);
  return { path, decls, unknown, lines };
}

function countHoles(s: string, markers: Record<string, number>): void {
  const n = (s.match(/(?:^|[^\w?])\?[A-Za-z_]\w*/g) ?? []).length;
  if (n > 0) markers.hole = (markers.hole ?? 0) + n;
}

/** Marks laws that no def in the same directory fills (by bare or module-qualified name). */
export function markOpenLaws(scans: BendScan[]): void {
  const byDir = new Map<string, BendScan[]>();
  for (const s of scans) {
    const dir = s.path.includes("/") ? s.path.slice(0, s.path.lastIndexOf("/")) : "";
    byDir.set(dir, [...(byDir.get(dir) ?? []), s]);
  }
  for (const group of byDir.values()) {
    const defs = new Set<string>();
    for (const s of group)
      for (const d of s.decls) if (d.kind === "def") defs.add(d.name.split(".").pop() ?? d.name);
    for (const s of group)
      for (const d of s.decls)
        if (d.kind === "law" && !defs.has(d.name.split(".").pop() ?? d.name))
          d.markers.open_law = 1;
  }
}

function canon(lines: string[]): string {
  return lines.filter((l) => l.trim() !== "").join("\n");
}

function encodeBendSymbol(name: string): string {
  return name
    .split(".")
    .map((s) => s.replace(/%/g, "%25").replace(/#/g, "%23"))
    .join(".");
}

/** FpIdentities (as the core fingerprinters return) for one scanned Bend file. */
export function bendIdentities(scan: BendScan): FpIdentity[] {
  const fileId = `bend:${encodePath(scan.path)}`;
  const covered = new Set<number>();
  for (const d of scan.decls) for (let i = d.start; i < d.end; i += 1) covered.add(i);
  const ownLines = scan.lines.filter((_, i) => !covered.has(i));
  const ownText = `${canon(ownLines)}\n${scan.decls.map((d) => `⟨${d.kind} ${d.name}⟩`).join("\n")}`;
  const complete = scan.unknown === 0;
  const out: FpIdentity[] = [
    {
      id: fileId,
      kind: "file",
      parent: null,
      digests: [
        {
          projection: "file",
          scheme: "bend.file.syn1",
          digest: codeDigest("bend.file.syn1", canon(scan.lines))
        },
        { projection: "own", scheme: "bend.own.syn1", digest: codeDigest("bend.own.syn1", ownText) }
      ],
      markers: {},
      hatchComplete: complete,
      executable: true
    }
  ];
  const bySym = new Map<string, BendDecl[]>();
  for (const d of scan.decls) bySym.set(d.name, [...(bySym.get(d.name) ?? []), d]);
  const names = new Set(bySym.keys());
  for (const [name, list] of [...bySym.entries()].sort((a, b) => cmpStr(a[0], b[0]))) {
    const segs = name.split(".");
    let parent = fileId;
    for (let k = segs.length - 1; k > 0; k -= 1) {
      const pre = segs.slice(0, k).join(".");
      if (names.has(pre)) {
        parent = `${fileId}#${encodeBendSymbol(pre)}`;
        break;
      }
    }
    const text = list.map((d) => canon(scan.lines.slice(d.start, d.end))).join("\n");
    const markers: Record<string, number> = {};
    for (const d of list)
      for (const [k, n] of Object.entries(d.markers)) markers[k] = (markers[k] ?? 0) + n;
    out.push({
      id: `${fileId}#${encodeBendSymbol(name)}`,
      kind: list[0]?.kind ?? "def",
      parent,
      digests: [
        { projection: "own", scheme: "bend.own.syn1", digest: codeDigest("bend.own.syn1", text) },
        { projection: "unit", scheme: "bend.unit.syn1", digest: codeDigest("bend.unit.syn1", text) }
      ],
      markers: Object.fromEntries(Object.entries(markers).sort((a, b) => cmpStr(a[0], b[0]))),
      hatchComplete: complete,
      executable: true,
      ...(list.length > 1 ? { merged: list.length } : {})
    });
  }
  return out.sort((a, b) => cmpStr(a.id, b.id));
}
