// Globs (A.3.3.3), specificity (A.3.3.4) and cells by product-automaton BFS (A.8.1.4).
import { cmpStr } from "./util.ts";

type Token =
  | { t: "lit"; ch: string }
  | { t: "any" }
  | { t: "star" }
  | { t: "dstar" }
  | { t: "dstarslash" };

function tokenize(glob: string): Token[] {
  const out: Token[] = [];
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i] ?? "";
    if (c === "*" && glob[i + 1] === "*" && glob[i + 2] === "/") {
      out.push({ t: "dstarslash" });
      i += 2;
    } else if (c === "*" && glob[i + 1] === "*") {
      out.push({ t: "dstar" });
      i += 1;
    } else if (c === "*") out.push({ t: "star" });
    else if (c === "?") out.push({ t: "any" });
    else out.push({ t: "lit", ch: c });
  }
  return out;
}

function escapeRegex(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

export function globToRegex(glob: string): RegExp {
  let re = "";
  for (const tok of tokenize(glob)) {
    if (tok.t === "dstarslash") re += "(?:.*/)?";
    else if (tok.t === "dstar") re += ".*";
    else if (tok.t === "star") re += "[^/]*";
    else if (tok.t === "any") re += ".";
    else re += escapeRegex(tok.ch);
  }
  return new RegExp(`^${re}$`, "s");
}

const regexCache = new Map<string, RegExp>();
export function globMatches(glob: string, path: string): boolean {
  let re = regexCache.get(glob);
  if (!re) {
    re = globToRegex(glob);
    regexCache.set(glob, re);
  }
  return re.test(path);
}

/** Leading wildcard-free segments; a literal path counts all its segments. */
export function specificity(glob: string): number {
  const segs = glob.split("/");
  let n = 0;
  for (const s of segs) {
    if (s.includes("*") || s.includes("?")) return n;
    n += 1;
  }
  return n;
}

export function literalChars(glob: string): string[] {
  return tokenize(glob).flatMap((t) => (t.t === "lit" ? [t.ch] : []));
}

// ---- NFA ------------------------------------------------------------------

type Pred = { k: "lit"; ch: string } | { k: "notSlash" } | { k: "any" };

interface Nfa {
  trans: { p: Pred; to: number }[][];
  eps: number[][];
  accept: number;
}

function buildNfa(glob: string): Nfa {
  const trans: { p: Pred; to: number }[][] = [[]];
  const eps: number[][] = [[]];
  const fresh = (): number => {
    trans.push([]);
    eps.push([]);
    return trans.length - 1;
  };
  let cur = 0;
  for (const tok of tokenize(glob)) {
    const next = fresh();
    if (tok.t === "lit") trans[cur]?.push({ p: { k: "lit", ch: tok.ch }, to: next });
    else if (tok.t === "any") trans[cur]?.push({ p: { k: "any" }, to: next });
    else if (tok.t === "star") {
      trans[cur]?.push({ p: { k: "notSlash" }, to: cur });
      eps[cur]?.push(next);
    } else if (tok.t === "dstar") {
      trans[cur]?.push({ p: { k: "any" }, to: cur });
      eps[cur]?.push(next);
    } else {
      const mid = fresh();
      eps[cur]?.push(next);
      trans[cur]?.push({ p: { k: "lit", ch: "/" }, to: next });
      trans[cur]?.push({ p: { k: "any" }, to: mid });
      trans[mid]?.push({ p: { k: "any" }, to: mid });
      trans[mid]?.push({ p: { k: "lit", ch: "/" }, to: next });
    }
    cur = next;
  }
  return { trans, eps, accept: cur };
}

function closure(nfa: Nfa, states: Iterable<number>): number[] {
  const seen = new Set<number>();
  const stack = [...states];
  while (stack.length > 0) {
    const s = stack.pop() as number;
    if (seen.has(s)) continue;
    seen.add(s);
    for (const e of nfa.eps[s] ?? []) stack.push(e);
  }
  return [...seen].sort((a, b) => a - b);
}

function predHolds(p: Pred, c: string): boolean {
  if (p.k === "any") return true;
  if (p.k === "notSlash") return c !== "/";
  return p.ch === c;
}

function step(nfa: Nfa, states: number[], c: string): number[] {
  const next: number[] = [];
  for (const s of states)
    for (const tr of nfa.trans[s] ?? []) if (predHolds(tr.p, c)) next.push(tr.to);
  return closure(nfa, next);
}

// ---- cells ----------------------------------------------------------------

export interface GlobOwner {
  side: "b" | "h";
  glob: string;
  /** pseudo-unit `Q.*` of the owning component */
  owner: string;
}

/** A cell's attribution on one side: a pseudo-unit, `ungoverned`, or (base ties) a sorted list. */
export type CellSide = string | string[];

export interface CellResult {
  cells: { b: CellSide; h: CellSide; example: string }[];
  undecided: boolean;
  states: number;
}

function classify(owners: GlobOwner[], accepting: boolean[], side: "b" | "h"): CellSide {
  let best = -1;
  let who = new Set<string>();
  owners.forEach((o, i) => {
    if (o.side !== side || !accepting[i]) return;
    const s = specificity(o.glob);
    if (s > best) {
      best = s;
      who = new Set([o.owner]);
    } else if (s === best) who.add(o.owner);
  });
  if (who.size === 0) return "ungoverned";
  const list = [...who].sort(cmpStr);
  return list.length === 1 ? (list[0] as string) : list;
}

/**
 * Enumerates every (base, head) attribution pair whose glob regions intersect, with the
 * shortlex-least example path, by BFS over the product of the glob automata.
 * Paths are non-empty, never start or end with `/` and never contain `//`.
 */
export function computeCells(owners: GlobOwner[], budget = 1_000_000): CellResult {
  const nfas = owners.map((o) => buildNfa(o.glob));
  const lits = new Set<string>(["/"]);
  for (const o of owners) for (const c of literalChars(o.glob)) lits.add(c);
  let freshChar = "";
  for (const c of "abcdefghijklmnopqrstuvwxyz") {
    if (!lits.has(c)) {
      freshChar = c;
      break;
    }
  }
  if (freshChar === "") freshChar = "_";
  const alphabet = [...lits, freshChar].sort(cmpStr);
  type St = { sets: number[][]; last: "" | "/" | "c"; path: string };
  const start: St = { sets: nfas.map((n) => closure(n, [0])), last: "", path: "" };
  const keyOf = (s: St): string => `${s.last}|${s.sets.map((x) => x.join(",")).join(";")}`;
  const seen = new Set<string>([keyOf(start)]);
  const queue: St[] = [start];
  const found = new Map<string, { b: CellSide; h: CellSide; example: string }>();
  let head = 0;
  let undecided = false;
  while (head < queue.length) {
    if (seen.size > budget) {
      undecided = true;
      break;
    }
    const st = queue[head] as St;
    head += 1;
    if (st.last === "c") {
      const acc = st.sets.map((s, i) => s.includes((nfas[i] as Nfa).accept));
      const b = classify(owners, acc, "b");
      const h = classify(owners, acc, "h");
      const k = JSON.stringify([b, h]);
      if (!found.has(k)) found.set(k, { b, h, example: st.path });
    }
    for (const c of alphabet) {
      if (c === "/" && st.last !== "c") continue;
      const sets = st.sets.map((s, i) => (s.length === 0 ? s : step(nfas[i] as Nfa, s, c)));
      const nx: St = { sets, last: c === "/" ? "/" : "c", path: st.path + c };
      const k = keyOf(nx);
      if (seen.has(k)) continue;
      seen.add(k);
      queue.push(nx);
    }
  }
  const cells = [...found.values()].sort((x, y) =>
    cmpStr(JSON.stringify([x.b, x.h]), JSON.stringify([y.b, y.h]))
  );
  return { cells, undecided, states: seen.size };
}

export function cellId(b: CellSide, h: CellSide): string {
  return `cell:${JSON.stringify([b, h])}`;
}
