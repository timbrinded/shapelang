// Rust/Verus identities, digests and hatch markers by a token scanner (prototype approximation of
// the pinned-parser and VIR schemes; schemes are named *.syn1 to say so). A.12.2.2-3, A.12.2.8.
import { cmpStr } from "../util.ts";
import { type FpIdentity, codeDigest, encodePath, encodeSegment } from "./common.ts";

interface Tok {
  t: string;
  start: number;
  end: number;
  comment: boolean;
}

function lexRust(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  const push = (start: number, comment = false): void => {
    toks.push({ t: src.slice(start, i), start, end: i, comment });
  };
  while (i < src.length) {
    const c = src[i] as string;
    if (/\s/.test(c)) {
      i += 1;
      continue;
    }
    const start = i;
    if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i += 1;
      push(start, true);
    } else if (c === "/" && src[i + 1] === "*") {
      let depth = 0;
      while (i < src.length) {
        if (src[i] === "/" && src[i + 1] === "*") {
          depth += 1;
          i += 2;
        } else if (src[i] === "*" && src[i + 1] === "/") {
          depth -= 1;
          i += 2;
          if (depth === 0) break;
        } else i += 1;
      }
      push(start, true);
    } else if (
      c === "r" &&
      (src[i + 1] === '"' || (src[i + 1] === "#" && /^#+"/.test(src.slice(i + 1))))
    ) {
      let hashes = 0;
      i += 1;
      while (src[i] === "#") {
        hashes += 1;
        i += 1;
      }
      i += 1;
      const close = `"${"#".repeat(hashes)}`;
      const e = src.indexOf(close, i);
      i = e < 0 ? src.length : e + close.length;
      push(start);
    } else if (c === '"') {
      i += 1;
      while (i < src.length && src[i] !== '"') i += src[i] === "\\" ? 2 : 1;
      i += 1;
      push(start);
    } else if (c === "'") {
      // char literal or lifetime
      if (
        src[i + 2] === "'" ||
        (src[i + 1] === "\\" && src.indexOf("'", i + 2) > 0 && src.indexOf("'", i + 2) - i <= 10)
      ) {
        i = src.indexOf("'", src[i + 1] === "\\" ? i + 3 : i + 2) + 1;
        push(start);
      } else {
        i += 1;
        while (i < src.length && /\w/.test(src[i] as string)) i += 1;
        push(start);
      }
    } else if (/[A-Za-z_]/.test(c)) {
      while (i < src.length && /\w/.test(src[i] as string)) i += 1;
      push(start);
    } else if (/[0-9]/.test(c)) {
      while (
        i < src.length &&
        /[\w.]/.test(src[i] as string) &&
        !(src[i] === "." && src[i + 1] === ".")
      )
        i += 1;
      push(start);
    } else {
      const two = src.slice(i, i + 2);
      i += ["::", "->", "=>", "==", "!=", "<=", ">=", "&&", "||", ".."].includes(two) ? 2 : 1;
      push(start);
    }
  }
  return toks;
}

function isInertRust(t: string): boolean {
  if (t.startsWith("///") || t.startsWith("//!") || t.startsWith("/**") || t.startsWith("/*!"))
    return false;
  return !t.includes("@");
}

function canonToks(toks: Tok[]): string {
  return toks
    .filter((t) => !t.comment || !isInertRust(t.t))
    .map((t) => t.t)
    .join(" ");
}

interface Item {
  symbol: string;
  start: number;
  end: number;
  sigEnd: number;
  bodyStart: number;
  parent: string | null;
}

const MODIFIERS = new Set([
  "pub",
  "spec",
  "proof",
  "exec",
  "open",
  "closed",
  "const",
  "async",
  "unsafe",
  "extern",
  "default",
  "tracked",
  "ghost",
  "uninterp",
  "axiom",
  "broadcast"
]);

export function isVerusText(text: string): boolean {
  return /\bverus!\s*\{/.test(text) || /\bvstd::/.test(text);
}

export function fingerprintRust(path: string, text: string): FpIdentity[] {
  const lang = isVerusText(text) ? "verus" : "rust";
  const fileId = `${lang}:${encodePath(path)}`;
  const toks = lexRust(text);
  const code = toks.filter((t) => !t.comment);
  const items: Item[] = [];
  const stack: { kind: "scope" | "block"; seg: string | null }[] = [];
  const segs = (): string[] => stack.filter((s) => s.seg !== null).map((s) => s.seg as string);
  let macroItems = false;
  const matchBrace = (from: number): number => {
    let d = 0;
    for (let j = from; j < code.length; j += 1) {
      const t = (code[j] as Tok).t;
      if (t === "{") d += 1;
      else if (t === "}") {
        d -= 1;
        if (d === 0) return j;
      }
    }
    return code.length - 1;
  };

  const scanRange = (from: number, to: number): void => {
    let k = from;
    while (k < to) {
      const t = (code[k] as Tok).t;
      if (t === "macro_rules" && code[k + 1]?.t === "!") macroItems = true;
      if (t === "#" && code[k + 1]?.t === "[" && code[k + 2]?.t === "derive") macroItems = true;
      k = scanOne(k, to);
    }
  };

  // one construct starting at k: mod/trait/impl scopes, verus! blocks and fn items
  const scanOne = (k: number, to: number): number => {
    const t = (code[k] as Tok).t;
    if ((t === "mod" || t === "trait") && /^\w+$/.test(code[k + 1]?.t ?? "")) {
      let j = k + 2;
      while (j < to && code[j]?.t !== "{" && code[j]?.t !== ";") j += 1;
      if (code[j]?.t !== "{") return j + 1;
      const end = matchBrace(j);
      stack.push({ kind: "scope", seg: code[k + 1]?.t ?? null });
      scanRange(j + 1, end);
      stack.pop();
      return end + 1;
    }
    if (t === "impl") {
      let j = k + 1;
      let angle = 0;
      const header: string[] = [];
      while (j < to && !(code[j]?.t === "{" && angle === 0)) {
        const x = code[j]?.t ?? "";
        if (x === "<") angle += 1;
        else if (x === ">") angle -= 1;
        header.push(x);
        j += 1;
      }
      const end = matchBrace(j);
      stack.push({ kind: "scope", seg: implSegment(header) });
      scanRange(j + 1, end);
      stack.pop();
      return end + 1;
    }
    if (t === "verus" && code[k + 1]?.t === "!" && code[k + 2]?.t === "{") {
      const end = matchBrace(k + 2);
      scanRange(k + 3, end);
      return end + 1;
    }
    if (t === "fn" && /^\w+$/.test(code[k + 1]?.t ?? "")) {
      const name = code[k + 1]?.t ?? "";
      // start: back over modifiers, pub(crate) and attributes
      let s = k;
      for (;;) {
        const prev = code[s - 1]?.t;
        if (prev && MODIFIERS.has(prev)) {
          s -= 1;
          continue;
        }
        if (prev === ")") {
          let m = s - 1;
          while (m > 0 && code[m]?.t !== "(") m -= 1;
          if (code[m - 1]?.t === "pub") {
            s = m - 1;
            continue;
          }
          break;
        }
        if (prev === "]") {
          let m = s - 1;
          let d = 0;
          while (m >= 0) {
            if (code[m]?.t === "]") d += 1;
            else if (code[m]?.t === "[") {
              d -= 1;
              if (d === 0) break;
            }
            m -= 1;
          }
          if (code[m - 1]?.t === "#") {
            s = m - 1;
            continue;
          }
        }
        break;
      }
      let j = k + 2;
      let paren = 0;
      while (j < to) {
        const x = code[j]?.t;
        if (x === "(" || x === "[") paren += 1;
        else if (x === ")" || x === "]") paren -= 1;
        else if ((x === "{" || x === ";") && paren === 0) break;
        j += 1;
      }
      const end = code[j]?.t === "{" ? matchBrace(j) : j;
      const parentSegs = segs();
      const symbol = [...parentSegs, name]
        .map((x) => (x.startsWith("<") ? x : encodeSegment(x, "::")))
        .join("::");
      items.push({
        symbol,
        start: s,
        end,
        sigEnd: j,
        bodyStart: j,
        parent: parentSegs.length > 0 ? parentSegs.join("::") : null
      });
      return end + 1;
    }
    return k + 1;
  };
  scanRange(0, code.length);

  // nested fn items inside fn bodies are not identities here (Verus code rarely nests them)
  const scheme = (p: string, v: string): string => `${lang}.${p}.${v}`;
  const tokSlice = (a: number, b: number): Tok[] => {
    const s = code[a]?.start ?? 0;
    const e = code[b]?.end ?? 0;
    return toks.filter((t) => t.start >= s && t.end <= e);
  };
  const markersOf = (ts: Tok[]): Record<string, number> => {
    const m: Record<string, number> = {};
    const add = (k: string): void => {
      m[k] = (m[k] ?? 0) + 1;
    };
    const c2 = ts.filter((t) => !t.comment);
    for (let k = 0; k < c2.length; k += 1) {
      const t = c2[k]?.t;
      const nx = c2[k + 1]?.t;
      if (t === "verifier" && nx === "::") {
        const attr = c2[k + 2]?.t;
        if (attr === "external_body") add("external_body");
        else if (attr === "external" || attr === "external_fn_specification") add("external");
        else if (attr === "uninterp") add("uninterp");
        else if (attr === "axiom") add("axiom");
      } else if (t === "verifier" && nx === "(") {
        const attr = c2[k + 2]?.t;
        if (attr === "external_body") add("external_body");
        else if (attr === "external") add("external");
      } else if (t === "assume" && nx === "(") add("assume");
      else if (t === "admit" && nx === "(") add("admit");
      else if (t === "assume_specification") add("assume_specification");
      else if (t === "uninterp" && (nx === "spec" || nx === "fn")) add("uninterp");
      else if (t === "axiom" && (nx === "fn" || nx === "spec" || nx === "proof")) add("axiom");
      // A.12.2.8 [D20]: unsafe blocks, fn, impl and trait
      else if (t === "unsafe" && (nx === "{" || nx === "fn" || nx === "impl" || nx === "trait"))
        add("unsafe");
    }
    if (lang !== "verus") {
      const u = m.unsafe;
      return u ? { unsafe: u } : {};
    }
    delete m.unsafe;
    return m;
  };

  const out: FpIdentity[] = [];
  const itemSpans = items.map(
    (it) => [code[it.start]?.start ?? 0, code[it.end]?.end ?? 0] as [number, number]
  );
  const ownFile = toks.filter((t) => !itemSpans.some(([a, b]) => t.start >= a && t.end <= b));
  const fnNames = new Map<string, Item>();
  for (const it of items) fnNames.set(it.symbol.split("::").pop() ?? it.symbol, it);
  out.push({
    id: fileId,
    kind: "file",
    parent: null,
    digests: [
      {
        projection: "file",
        scheme: scheme("file", "v1"),
        digest: codeDigest(scheme("file", "v1"), canonToks(toks))
      },
      {
        projection: "own",
        scheme: scheme("own", "v2"),
        digest: codeDigest(
          scheme("own", "v2"),
          `${canonToks(ownFile)} ${items.map((x) => `⟨${x.symbol}⟩`).join(" ")}`
        )
      }
    ],
    markers: markersOf(ownFile),
    hatchComplete: !macroItems,
    executable: true
  });
  const bySym = new Map<string, Item[]>();
  for (const it of items) bySym.set(it.symbol, [...(bySym.get(it.symbol) ?? []), it]);
  for (const [sym, list] of [...bySym.entries()].sort((a, b) => cmpStr(a[0], b[0]))) {
    const unitToks = list.flatMap((it) => tokSlice(it.start, it.end));
    const contractToks = list.flatMap((it) =>
      tokSlice(it.start, Math.max(it.start, it.sigEnd - 1))
    );
    const unitCanon = canonToks(unitToks);
    const digests: FpIdentity["digests"] = [
      {
        projection: "own",
        scheme: scheme("own", "v2"),
        digest: codeDigest(scheme("own", "v2"), unitCanon)
      },
      {
        projection: "unit",
        scheme: scheme("unit", "v2"),
        digest: codeDigest(scheme("unit", "v2"), unitCanon)
      }
    ];
    if (lang === "verus") {
      const contract = canonToks(contractToks);
      const refs = new Set<string>();
      for (const t of contractToks)
        if (!t.comment && fnNames.has(t.t) && t.t !== sym.split("::").pop()) refs.add(t.t);
      const closure = [...refs]
        .sort(cmpStr)
        .map((r) => {
          const it = fnNames.get(r) as Item;
          return `${r}=${canonToks(tokSlice(it.start, it.end))}`;
        })
        .join("\n");
      digests.push({
        projection: "contract",
        scheme: "verus.contract.syn1",
        digest: codeDigest("verus.contract.syn1", contract)
      });
      digests.push({
        projection: "closure",
        scheme: "verus.closure.syn1",
        digest: codeDigest("verus.closure.syn1", `${contract}\n--closure--\n${closure}`)
      });
    }
    out.push({
      id: `${fileId}#${sym}`,
      kind: "function",
      parent: fileId,
      digests,
      markers: markersOf(unitToks),
      hatchComplete: !macroItems,
      executable: true,
      ...(list.length > 1 ? { merged: list.length } : {})
    });
  }
  return out.sort((a, b) => cmpStr(a.id, b.id));
}

function implSegment(header: string[]): string {
  // impl<T> Trait for Type<T>  →  <Type as Trait>;  impl Type  →  Type
  const strip = (xs: string[]): string[] => {
    const out: string[] = [];
    let angle = 0;
    for (const x of xs) {
      if (x === "<") angle += 1;
      else if (x === ">") angle -= 1;
      else if (angle === 0) out.push(x);
    }
    return out;
  };
  const h = strip(header);
  const forIdx = h.indexOf("for");
  const lastIdent = (xs: string[]): string =>
    [...xs].reverse().find((x) => /^\w+$/.test(x) && x !== "where") ?? "_";
  if (forIdx >= 0) {
    const whereIdx = h.indexOf("where");
    const ty = lastIdent(h.slice(forIdx + 1, whereIdx > forIdx ? whereIdx : undefined));
    const tr = lastIdent(h.slice(0, forIdx));
    return `<${ty} as ${tr}>`;
  }
  const whereIdx = h.indexOf("where");
  return lastIdent(h.slice(0, whereIdx >= 0 ? whereIdx : undefined));
}
