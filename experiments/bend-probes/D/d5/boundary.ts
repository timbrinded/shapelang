// @ts-nocheck -- research script, run with bun; Bend's checker is loaded untyped at runtime.
// D5: the JS boundary of law-proven Bend modules. Each module was compiled with
// `bend main.bend -o x.mjs` (see d5/build.sh); this script calls the exports from
// TypeScript with out-of-domain and mis-shaped values and checks the law's
// conclusion on what comes back.
//
//   bun d5/boundary.ts <d5-work-dir>          run every case, each in its own
//                                              process with a 5 s timeout
//   bun d5/boundary.ts <d5-work-dir> <case>   run one case (used by the above)
//
// Outcomes: holds (the conclusion holds on the output), VIOLATION (an output
// that breaks the conclusion), rejected (the module's own guard threw a bend:
// error before computing), crash (any other exception), hang (timeout).

import { spawnSync } from "node:child_process";
import * as path from "node:path";

const WORK = process.argv[2];
type Out = { holds: boolean; detail: string };
type Case = {
  id: string;
  module: "sort" | "num" | "u32" | "arr";
  law: string;
  input: string;
  run: (M: any) => Out;
};

// ---- helpers: lists and the laws' conclusions, written in TypeScript ----------
const list = (xs: unknown[]): any =>
  xs.reduceRight((t: any, h) => ({ $: "Con", head: h, tail: t }), { $: "Nil" });
const unlist = (l: any): unknown[] => {
  const out = [];
  for (let n = 0; l && l.$ === "Con" && n < 1e6; n++, l = l.tail) out.push(l.head);
  return out;
};
const isNat = (x: unknown) => typeof x === "number" && Number.isInteger(x) && x >= 0;
const show = (x: unknown) =>
  typeof x === "bigint"
    ? x + "n"
    : typeof x === "string"
      ? JSON.stringify(x)
      : Object.is(x, -0)
        ? "-0"
        : String(x);
const showL = (xs: unknown[]) => "[" + xs.map(show).join(", ") + "]";
// sort_sorted: Sorted.from(0n, out): every element a Nat, ascending from 0
const sortedNat = (xs: unknown[]) =>
  xs.every(isNat) && xs.every((x, i) => i === 0 || (xs[i - 1] as number) <= (x as number));
// sort_perm: count(x, sort(xs)) == count(x, xs) for every x: equal multisets
const sameMultiset = (a: unknown[], b: unknown[]) => {
  if (a.length !== b.length) return false;
  const rest = [...b];
  for (const x of a) {
    const i = rest.findIndex((y) => Object.is(x, y));
    if (i < 0) return false;
    rest.splice(i, 1);
  }
  return true;
};
function sortCase(id: string, input: unknown[] | (() => any), label?: string): Case {
  return {
    id,
    module: "sort",
    law: "sort_sorted, sort_perm",
    input: label ?? showL(input as unknown[]),
    run: (M) => {
      const xs = typeof input === "function" ? input() : list(input);
      const before = typeof input === "function" ? [] : [...input];
      const out = unlist(M.sort(xs));
      const s = sortedNat(out),
        p = typeof input === "function" ? true : sameMultiset(out, before);
      return { holds: s && p, detail: `out ${showL(out)} sorted=${s} perm=${p}` };
    }
  };
}
function numCase(id: string, law: string, input: string, f: (M: any) => Out): Case {
  return { id, module: "num", law, input, run: f };
}
const pair = (t: any) => [t?.fst ?? t?.[0], t?.snd ?? t?.[1]];

const cases: Case[] = [
  // insertion sort over List<Nat>: elements are never checked
  sortCase("sort-ok", [3, 1, 2]),
  sortCase("sort-negative", [3, -1, 2]),
  sortCase("sort-negative-2", [-2, -5]),
  sortCase("sort-fraction", [1.5, 0.5]),
  sortCase("sort-fraction-int", [2, 0.5]),
  sortCase("sort-2^32", [2 ** 32 + 1, 2 ** 32, 7]),
  sortCase("sort-2^40", [2 ** 40 + 1, 2 ** 40]),
  sortCase("sort-2^53", [2 ** 53 + 2, 2 ** 53]),
  sortCase("sort-bigint", [3n, 1n]),
  sortCase("sort-digit-strings", ["3", "1", "2"]),
  sortCase("sort-strings", ["b", "a"]),
  sortCase("sort-NaN", [NaN, 1]),
  sortCase("sort-Infinity", [Infinity, 1]),
  sortCase("sort-undefined-elem", [undefined, 1]),
  sortCase("sort-null-elem", [null, 2, 1]),
  sortCase("sort-undefined-list", () => undefined, "undefined"),
  sortCase(
    "sort-wrong-tag",
    () => ({ $: "Cons", head: 2, tail: { $: "Cons", head: 1, tail: { $: "Nil" } } }),
    "{$:'Cons',..}"
  ),
  sortCase("sort-missing-tail", () => ({ $: "Con", head: 1 }), "{$:'Con', head: 1}"),
  sortCase(
    "sort-cyclic",
    () => {
      const l: any = { $: "Con", head: 1, tail: null };
      l.tail = l;
      return l;
    },
    "cyclic Con"
  ),
  sortCase(
    "sort-shared-tail",
    () => {
      const t = list([5, 4]);
      const l = { $: "Con", head: 9, tail: t };
      return { $: "Con", head: 1, tail: { $: "Con", head: 0, tail: l } };
    },
    "[1,0,9,5,4] with a shared tail"
  ),
  {
    id: "sort-alias-input-reuse",
    module: "sort",
    law: "sort_perm",
    input: "the input list read again after sort",
    run: (M) => {
      const xs = list([3, 1, 2]);
      const out = unlist(M.sort(xs));
      const again = unlist(xs);
      return {
        holds: sameMultiset(out, again) && sortedNat(out),
        detail: `out ${showL(out)} input after ${showL(again)}`
      };
    }
  },

  // numerics over Nat: the export wrapper checks top-level Nat arguments (nat_in)
  numCase("num-add-ok", "add_comm", "(3, 4)", (M) => ({
    holds: M.add(3, 4) === M.add(4, 3),
    detail: String(M.add(3, 4))
  })),
  numCase("num-add-negative", "add_comm", "(-1, 2)", (M) => ({
    holds: M.add(-1, 2) === M.add(2, -1),
    detail: ""
  })),
  numCase("num-add-fraction", "add_comm", "(1.5, 2)", (M) => ({
    holds: M.add(1.5, 2) === M.add(2, 1.5),
    detail: ""
  })),
  numCase("num-add-bigint", "add_comm", "(3n, 4n)", (M) => ({
    holds: M.add(3n, 4n) === M.add(4n, 3n),
    detail: ""
  })),
  numCase("num-add-string", "add_comm", "('3', 4)", (M) => ({
    holds: M.add("3", 4) === M.add(4, "3"),
    detail: ""
  })),
  numCase("num-add-2^47", "add_comm", "(2^47, 2^47)", (M) => ({
    holds: M.add(2 ** 47, 2 ** 47) === M.add(2 ** 47, 2 ** 47),
    detail: ""
  })),
  numCase("num-add-2^48", "add_comm", "(1, 2^48)", (M) => {
    const a = M.add(1, 2 ** 48);
    return { holds: a === M.add(2 ** 48, 1), detail: String(a) };
  }),
  numCase("num-add-2^53", "add_comm", "(2^53+2, 0)", (M) => ({
    holds: M.add(2 ** 53 + 2, 0) === M.add(0, 2 ** 53 + 2),
    detail: ""
  })),
  numCase("num-divmod-ok", "divmod_ok", "(1024, 7)", (M) => {
    const [q, r] = pair(M.divmod(1024, 7));
    return { holds: r < 7 && 1024 === r + q * 7, detail: `${q},${r}` };
  }),
  numCase("num-divmod-NaN", "divmod_ok", "(NaN, 7)", (M) => {
    const [q, r] = pair(M.divmod(NaN, 7));
    return { holds: r < 7, detail: `${q},${r}` };
  }),
  numCase("num-mul-undefined", "mul_comm", "(undefined, 2)", (M) => ({
    holds: M.mul(undefined, 2) === M.mul(2, undefined),
    detail: ""
  })),

  // U32: the export wrapper passes U32 arguments through unchecked
  {
    id: "u32-ok",
    module: "u32",
    law: "add_comm, add_zero",
    input: "(5, 7)",
    run: (M) => ({
      holds: M.add(5, 7) === M.add(7, 5) && M.add(5, 0) === 5,
      detail: String(M.add(5, 7))
    })
  },
  {
    id: "u32-zero-2^32",
    module: "u32",
    law: "add_zero",
    input: "a = 2^32 + 5",
    run: (M) => {
      const r = M.add(2 ** 32 + 5, 0);
      return { holds: r === 2 ** 32 + 5, detail: `add(a, 0) = ${r}` };
    }
  },
  {
    id: "u32-zero-negative",
    module: "u32",
    law: "add_zero",
    input: "a = -1",
    run: (M) => {
      const r = M.add(-1, 0);
      return { holds: r === -1, detail: `add(a, 0) = ${r}` };
    }
  },
  {
    id: "u32-zero-fraction",
    module: "u32",
    law: "add_zero",
    input: "a = 1.5",
    run: (M) => {
      const r = M.add(1.5, 0);
      return { holds: r === 1.5, detail: `add(a, 0) = ${r}` };
    }
  },
  {
    id: "u32-zero-string",
    module: "u32",
    law: "add_zero",
    input: "a = '7'",
    run: (M) => {
      const r = M.add("7", 0);
      return { holds: r === "7", detail: `add(a, 0) = ${show(r)}` };
    }
  },
  {
    id: "u32-zero-undefined",
    module: "u32",
    law: "add_zero",
    input: "a = undefined",
    run: (M) => {
      const r = M.add(undefined, 0);
      return { holds: r === undefined, detail: `add(a, 0) = ${show(r)}` };
    }
  },
  {
    id: "u32-comm-string",
    module: "u32",
    law: "add_comm",
    input: "('1', 2)",
    run: (M) => {
      const x = M.add("1", 2),
        y = M.add(2, "1");
      return { holds: x === y, detail: `${x} vs ${y}` };
    }
  },
  {
    id: "u32-comm-2^32",
    module: "u32",
    law: "add_comm",
    input: "(2^32, 1)",
    run: (M) => {
      const x = M.add(2 ** 32, 1),
        y = M.add(1, 2 ** 32);
      return { holds: x === y, detail: `${x} vs ${y}` };
    }
  },
  {
    id: "u32-comm-bigint",
    module: "u32",
    law: "add_comm",
    input: "(1n, 2n)",
    run: (M) => {
      const x = M.add(1n, 2n),
        y = M.add(2n, 1n);
      return { holds: x === y, detail: `${show(x)} vs ${show(y)}` };
    }
  },
  {
    id: "u32-comm-object",
    module: "u32",
    law: "add_comm",
    input: "({valueOf}, '1')",
    run: (M) => {
      const o = { valueOf: () => 2, toString: () => "x" };
      const x = M.add(o, "1"),
        y = M.add("1", o);
      return { holds: x === y, detail: `${x} vs ${y}` };
    }
  },

  // arrays: an Array argument is the caller's own array, updated in place
  {
    id: "arr-ok",
    module: "arr",
    law: "mark_reads_b",
    input: "two arrays",
    run: (M) => {
      const a = [1, 2],
        b = [7, 8];
      const before = b[0];
      const r = M.second(M.mark(a, b));
      return { holds: r === before, detail: `read ${r}, b[0] was ${before}` };
    }
  },
  {
    id: "arr-alias",
    module: "arr",
    law: "mark_reads_b",
    input: "the same array as a and b",
    run: (M) => {
      const a = [7, 8];
      const before = a[0];
      const r = M.second(M.mark(a, a));
      return { holds: r === before, detail: `read ${r}, b[0] was ${before}` };
    }
  },
  {
    id: "arr-view-alias",
    module: "arr",
    law: "mark_reads_b",
    input: "two Uint32Array views of one buffer",
    run: (M) => {
      const buf = new ArrayBuffer(8);
      const a = new Uint32Array(buf),
        b = new Uint32Array(buf);
      b[0] = 7;
      const r = M.second(M.mark(a, b));
      return { holds: r === 7, detail: `read ${r}, b[0] was 7` };
    }
  },
  {
    id: "arr-empty-a",
    module: "arr",
    law: "mark_reads_b",
    input: "a = []",
    run: (M) => {
      const a: number[] = [],
        b = [7];
      const r = M.second(M.mark(a, b));
      return { holds: r === 7, detail: `read ${r}; a = ${JSON.stringify(Object.assign({}, a))}` };
    }
  },
  {
    id: "arr-frozen-a",
    module: "arr",
    law: "mark_reads_b",
    input: "a frozen",
    run: (M) => {
      const a = Object.freeze([1]),
        b = [7];
      const r = M.second(M.mark(a, b));
      return { holds: r === 7, detail: `read ${r}` };
    }
  },
  {
    id: "arr-caller-sees-write",
    module: "arr",
    law: "(none: affinity)",
    input: "caller keeps a after the call",
    run: (M) => {
      const a = [1, 2];
      M.mark(a, [7]);
      return { holds: a[0] === 1, detail: `caller's a[0] is now ${a[0]}` };
    }
  }
];

// what kind of input each case is: a value of the Bend type (in), one past the
// runtime's caps (cap: Nat > 2^48-1), a value outside the type (out), a malformed
// structure (shape), or aliasing that affinity forbids in Bend (alias)
const DOMAIN: Record<string, string> = {
  "sort-ok": "in",
  "sort-2^32": "in",
  "sort-2^40": "in",
  "sort-2^53": "cap",
  "sort-shared-tail": "in",
  "num-add-ok": "in",
  "num-add-2^47": "in",
  "num-add-2^48": "cap",
  "num-add-2^53": "cap",
  "num-divmod-ok": "in",
  "u32-ok": "in",
  "u32-comm-2^32": "out",
  "arr-ok": "in",
  "sort-undefined-list": "shape",
  "sort-wrong-tag": "shape",
  "sort-missing-tail": "shape",
  "sort-cyclic": "shape",
  "arr-empty-a": "shape",
  "arr-frozen-a": "shape",
  "sort-alias-input-reuse": "alias",
  "arr-alias": "alias",
  "arr-view-alias": "alias",
  "arr-caller-sees-write": "alias"
};

const MODS: Record<string, string> = {
  sort: "isort/sort.mjs",
  num: "num/num.mjs",
  u32: "u32/u32.mjs",
  arr: "arr/arr.mjs"
};

if (process.argv[3] !== undefined) {
  const c = cases.find((x) => x.id === process.argv[3]) as Case;
  const M = (await import(path.join(WORK, MODS[c.module]))).default;
  try {
    const o = c.run(M);
    console.log(JSON.stringify({ outcome: o.holds ? "holds" : "VIOLATION", detail: o.detail }));
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    console.log(
      JSON.stringify({
        outcome: msg.startsWith("bend: ") ? "rejected" : "crash",
        detail: (e?.name ? e.name + ": " : "") + msg.slice(0, 120)
      })
    );
  }
  process.exit(0);
}

const rows = [];
for (const c of cases) {
  const r = spawnSync("bun", [process.argv[1], WORK, c.id], { encoding: "utf8", timeout: 5000 });
  let res: { outcome: string; detail: string };
  if (r.error || r.signal) res = { outcome: "hang", detail: "no answer in 5 s" };
  else {
    try {
      res = JSON.parse(r.stdout.trim().split("\n").pop() as string);
    } catch {
      res = {
        outcome: "crash",
        detail: (r.stderr || r.stdout).trim().split("\n").slice(-2).join(" ").slice(0, 160)
      };
    }
  }
  rows.push({
    id: c.id,
    module: c.module,
    domain: DOMAIN[c.id] ?? "out",
    law: c.law,
    input: c.input,
    ...res
  });
  process.stderr.write(`${c.id}: ${res.outcome} ${res.detail}\n`);
}
const by = (m: string, o: string) =>
  rows.filter((r) => (m === "*" || r.module === m) && r.outcome === o).length;
const summary: Record<string, Record<string, number>> = {};
for (const m of ["sort", "num", "u32", "arr", "*"]) {
  summary[m] = Object.fromEntries(
    ["holds", "VIOLATION", "rejected", "crash", "hang"].map((o) => [o, by(m, o)])
  );
}
const byDomain: Record<string, Record<string, number>> = {};
for (const d of ["in", "cap", "out", "shape", "alias"]) {
  byDomain[d] = Object.fromEntries(
    ["holds", "VIOLATION", "rejected", "crash", "hang"].map((o) => [
      o,
      rows.filter((r) => r.domain === d && r.outcome === o).length
    ])
  );
}
console.log(JSON.stringify({ summary, byDomain, rows }, null, 1));
