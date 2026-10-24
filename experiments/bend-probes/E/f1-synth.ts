// @ts-nocheck
// F1: SupGen-style bounded enumerative synthesis without HVM.
// Bottom-up enumeration by AST size over a small grammar with observational-
// equivalence pruning on a large test set (one representative per behaviour),
// then law checking on a bounded input set. Two semantics: Nat (inputs >= 0,
// saturating subtraction) and JS numbers (integers, negatives allowed).
// Usage: bun f1-synth.ts [targetId...] [--sem nat|js] [--max N]
// Prints a JSON report per target/semantics/law-set to stdout.

type Sem = "nat" | "js";
type Node =
  | { k: "var"; i: number }
  | { k: "const"; v: number }
  | { k: "bool"; v: boolean }
  | { k: "add" | "sub" | "min" | "max" | "lt" | "le" | "eq"; a: Node; b: Node }
  | { k: "div"; a: Node; d: number }
  | { k: "ite"; c: Node; a: Node; b: Node };
type Prog = { t: "I" | "B"; size: number; sig: Int32Array; ast: Node };

export function show(n: Node, names: string[]): string {
  switch (n.k) {
    case "var":
      return names[n.i];
    case "const":
      return String(n.v);
    case "bool":
      return String(n.v);
    case "div":
      return `div(${show(n.a, names)}, ${n.d})`;
    case "ite":
      return `if ${show(n.c, names)} then ${show(n.a, names)} else ${show(n.b, names)}`;
    case "add":
      return `(${show(n.a, names)} + ${show(n.b, names)})`;
    case "sub":
      return `(${show(n.a, names)} - ${show(n.b, names)})`;
    case "lt":
      return `${show(n.a, names)} < ${show(n.b, names)}`;
    case "le":
      return `${show(n.a, names)} <= ${show(n.b, names)}`;
    case "eq":
      return `${show(n.a, names)} == ${show(n.b, names)}`;
    default:
      return `${n.k}(${show(n.a, names)}, ${show(n.b, names)})`;
  }
}

function evalNode(n: Node, env: number[], sem: Sem): number {
  switch (n.k) {
    case "var":
      return env[n.i];
    case "const":
      return n.v;
    case "bool":
      return n.v ? 1 : 0;
    case "add":
      return evalNode(n.a, env, sem) + evalNode(n.b, env, sem);
    case "sub": {
      const x = evalNode(n.a, env, sem) - evalNode(n.b, env, sem);
      return sem === "nat" && x < 0 ? 0 : x;
    }
    case "min":
      return Math.min(evalNode(n.a, env, sem), evalNode(n.b, env, sem));
    case "max":
      return Math.max(evalNode(n.a, env, sem), evalNode(n.b, env, sem));
    case "div":
      return Math.floor(evalNode(n.a, env, sem) / n.d);
    case "lt":
      return evalNode(n.a, env, sem) < evalNode(n.b, env, sem) ? 1 : 0;
    case "le":
      return evalNode(n.a, env, sem) <= evalNode(n.b, env, sem) ? 1 : 0;
    case "eq":
      return evalNode(n.a, env, sem) === evalNode(n.b, env, sem) ? 1 : 0;
    case "ite":
      return evalNode(n.c, env, sem) ? evalNode(n.a, env, sem) : evalNode(n.b, env, sem);
  }
}

// ---------- targets ----------
type Fn = (...xs: number[]) => number;
type Law = { name: string; holds: (f: Fn, x: number[]) => boolean };
type Target = {
  id: string;
  vars: string[];
  out: "I" | "B" | "pair";
  consts: number[];
  div: number[];
  domain: (x: number[], sem: Sem) => boolean;
  lawInputs: (sem: Sem) => number[][];
  testInputs: (sem: Sem) => number[][];
  intended: (sem: Sem) => Fn | [Fn, Fn];
  laws: Law[]; // as a spec author writes them
  strengthen: Law[]; // added one at a time, in order
  maxSize: number;
  // pair targets: field-local necessary conditions implied by the laws (used only to prune the product)
  fieldFilter?: [(f: Fn, x: number[]) => boolean, (f: Fn, x: number[]) => boolean];
};

const range = (lo: number, hi: number) => Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
const grid = (ranges: number[][]) =>
  ranges.reduce<number[][]>((acc, r) => acc.flatMap((a) => r.map((v) => [...a, v])), [[]]);
function sample(points: number[][], n: number, seed: number): number[][] {
  if (points.length <= n) return points;
  let s = seed >>> 0;
  const idx = new Set<number>();
  while (idx.size < n) {
    s = (s * 1664525 + 1013904223) >>> 0;
    idx.add(s % points.length);
  }
  return [...idx].sort((a, b) => a - b).map((i) => points[i]);
}
const lawR = (sem: Sem) => (sem === "nat" ? range(0, 6) : range(-4, 6));
const testR = (sem: Sem) => (sem === "nat" ? range(0, 30) : range(-25, 30));

// For pair targets, f(x...) returns a*65536-ish packing is avoided: pair laws receive f = [start, end] via a wrapper.
type PairFn = { s: Fn; e: Fn };
let currentPair: PairFn | undefined;

export const TARGETS: Target[] = [
  {
    id: "normalizeRange",
    vars: ["start", "end"],
    out: "pair",
    consts: [0, 1, 2],
    div: [],
    maxSize: 7,
    domain: ([s, e]) => s <= e,
    lawInputs: (sem) => grid([lawR(sem), lawR(sem)]).filter(([s, e]) => s <= e),
    testInputs: (sem) => grid([testR(sem), testR(sem)]).filter(([s, e]) => s <= e),
    intended: () => [(s: number) => s, (_s: number, e: number) => e],
    laws: [
      {
        name: "N1 contains start: out.start <= start <= out.end",
        holds: (_f, [s, e]) => currentPair!.s(s, e) <= s && s <= currentPair!.e(s, e)
      },
      {
        name: "N2 contains end: out.start <= end <= out.end",
        holds: (_f, [s, e]) => currentPair!.s(s, e) <= e && e <= currentPair!.e(s, e)
      },
      {
        name: "N3 ordered: out.start <= out.end",
        holds: (_f, [s, e]) => currentPair!.s(s, e) <= currentPair!.e(s, e)
      }
    ],
    strengthen: [
      {
        name: "N4 inclusive size preserved: out.end - out.start == end - start",
        holds: (_f, [s, e]) => currentPair!.e(s, e) - currentPair!.s(s, e) === e - s
      }
    ],
    fieldFilter: [
      (f, [s, e]) => f(s, e) <= s && f(s, e) <= e,
      (f, [s, e]) => f(s, e) >= s && f(s, e) >= e
    ]
  },
  {
    id: "inclusiveSize",
    vars: ["start", "end"],
    out: "I",
    consts: [0, 1, 2],
    div: [],
    maxSize: 9,
    domain: ([s, e]) => s <= e,
    lawInputs: (sem) => grid([lawR(sem), lawR(sem)]).filter(([s, e]) => s <= e),
    testInputs: (sem) => grid([testR(sem), testR(sem)]).filter(([s, e]) => s <= e),
    intended: () => (s, e) => e - s + 1,
    laws: [
      { name: "S1 single point: size(x, x) == 1", holds: (f, [s]) => f(s, s) === 1 },
      { name: "S2 positive: size(start, end) >= 1", holds: (f, [s, e]) => f(s, e) >= 1 },
      {
        name: "S3 monotone: size(start, end) < size(start, end + 1)",
        holds: (f, [s, e]) => f(s, e) < f(s, e + 1)
      }
    ],
    strengthen: [
      {
        name: "S4 unit step: size(start, end + 1) == size(start, end) + 1",
        holds: (f, [s, e]) => f(s, e + 1) === f(s, e) + 1
      }
    ]
  },
  {
    id: "includesValue",
    vars: ["start", "end", "v"],
    out: "B",
    consts: [0, 1],
    div: [],
    maxSize: 9,
    domain: ([s, e]) => s <= e,
    lawInputs: (sem) => grid([lawR(sem), lawR(sem), lawR(sem)]).filter(([s, e]) => s <= e),
    testInputs: (sem) =>
      sample(
        grid([testR(sem), testR(sem), testR(sem)]).filter(([s, e]) => s <= e),
        600,
        7
      ),
    intended: () => (s, e, v) => (s <= v && v <= e ? 1 : 0),
    laws: [
      { name: "I1 includes start", holds: (f, [s, e]) => f(s, e, s) === 1 },
      { name: "I2 includes end", holds: (f, [s, e]) => f(s, e, e) === 1 },
      {
        name: "I3 excludes below: v < start => !includes",
        holds: (f, [s, e, v]) => !(v < s) || f(s, e, v) === 0
      },
      {
        name: "I4 excludes above: v > end => !includes",
        holds: (f, [s, e, v]) => !(v > e) || f(s, e, v) === 0
      }
    ],
    strengthen: [
      {
        name: "I5 convex: includes(v) and includes(w) and v <= u <= w => includes(u)",
        holds: (f, [s, e, v]) => {
          if (f(s, e, v) !== 1) return true;
          for (let w = v; w <= e + 1; w++)
            if (f(s, e, w) === 1) for (let u = v; u <= w; u++) if (f(s, e, u) !== 1) return false;
          return true;
        }
      }
    ]
  },
  {
    id: "clamp",
    vars: ["x", "lo", "hi"],
    out: "I",
    consts: [0, 1],
    div: [],
    maxSize: 9,
    domain: ([, lo, hi]) => lo <= hi,
    lawInputs: (sem) => grid([lawR(sem), lawR(sem), lawR(sem)]).filter(([, lo, hi]) => lo <= hi),
    testInputs: (sem) =>
      sample(
        grid([testR(sem), testR(sem), testR(sem)]).filter(([, lo, hi]) => lo <= hi),
        600,
        11
      ),
    intended: () => (x, lo, hi) => Math.min(Math.max(x, lo), hi),
    laws: [
      {
        name: "C1 in bounds: lo <= clamp <= hi",
        holds: (f, [x, lo, hi]) => lo <= f(x, lo, hi) && f(x, lo, hi) <= hi
      },
      {
        name: "C2 identity inside: lo <= x <= hi => clamp == x",
        holds: (f, [x, lo, hi]) => !(lo <= x && x <= hi) || f(x, lo, hi) === x
      }
    ],
    strengthen: [
      {
        name: "C3 monotone in x: clamp(x) <= clamp(x + 1)",
        holds: (f, [x, lo, hi]) => f(x, lo, hi) <= f(x + 1, lo, hi)
      }
    ]
  },
  {
    id: "ringMove",
    vars: ["pos", "delta", "n"],
    out: "I",
    consts: [0, 1],
    div: [],
    maxSize: 13,
    domain: ([p, d, n], sem) =>
      n >= 1 && p >= 0 && p < n && (sem === "nat" ? d >= 0 && d < n : d > -n && d < n),
    lawInputs: (sem) =>
      grid([range(0, 5), sem === "nat" ? range(0, 5) : range(-5, 5), range(1, 6)]).filter(
        ([p, d, n]) => p < n && (sem === "nat" ? d < n : d > -n && d < n)
      ),
    testInputs: (sem) =>
      sample(
        grid([range(0, 19), sem === "nat" ? range(0, 19) : range(-19, 19), range(1, 20)]).filter(
          ([p, d, n]) => p < n && (sem === "nat" ? d < n : d > -n && d < n)
        ),
        300,
        13
      ),
    intended: () => (p, d, n) => (((p + d) % n) + n) % n,
    laws: [
      {
        name: "R1 stays on the ring: 0 <= move < n",
        holds: (f, [p, d, n]) => f(p, d, n) >= 0 && f(p, d, n) < n
      },
      { name: "R2 zero delta: move(pos, 0, n) == pos", holds: (f, [p, , n]) => f(p, 0, n) === p },
      {
        name: "R3 wraps at the edge: move(n - 1, 1, n) == 0 (n >= 2)",
        holds: (f, [, , n]) => n < 2 || f(n - 1, 1, n) === 0
      }
    ],
    strengthen: [
      {
        name: "R4 single step: move(pos, 1, n) == (pos + 1 == n ? 0 : pos + 1) (n >= 2)",
        holds: (f, [p, , n]) => n < 2 || f(p, 1, n) === (p + 1 === n ? 0 : p + 1)
      },
      {
        name: "R5 additive: move(move(pos, d, n), 1, n) == move(pos, d + 1, n) when d + 1 < n",
        holds: (f, [p, d, n]) => !(d >= 0 && d + 1 < n) || f(f(p, d, n), 1, n) === f(p, d + 1, n)
      },
      {
        name: "R6 inverse: move(move(pos, d, n), -d, n) == pos (JS only, |d| < n)",
        holds: (f, [p, d, n]) => f(f(p, d, n), -d, n) === p
      }
    ]
  },
  {
    id: "ledgerFee",
    vars: ["amount"],
    out: "I",
    consts: [0, 1, 2, 100],
    div: [2, 100],
    maxSize: 9,
    domain: ([a]) => a >= 0,
    lawInputs: () => range(0, 650).map((a) => [a]),
    testInputs: () =>
      range(0, 3000)
        .filter((a) => a % 3 === 0 || a % 100 === 0 || a % 100 === 99)
        .map((a) => [a]),
    intended: () => (a) => Math.max(1, Math.floor(a / 100)),
    laws: [
      { name: "F1 minimum fee: fee(amount) >= 1", holds: (f, [a]) => f(a) >= 1 },
      { name: "F2 monotone: fee(amount) <= fee(amount + 1)", holds: (f, [a]) => f(a) <= f(a + 1) },
      {
        name: "F3 one percent at round amounts: fee(100k) == k (k >= 1)",
        holds: (f, [a]) => a < 100 || a % 100 !== 0 || f(a) === a / 100
      }
    ],
    strengthen: [
      {
        name: "F4 never above one percent except the minimum: 100 * fee(amount) <= max(100, amount)",
        holds: (f, [a]) => 100 * f(a) <= Math.max(100, a)
      }
    ]
  }
];

// ---------- enumerator ----------
function hashSig(sig: Int32Array): string {
  let h1 = 0x811c9dc5 | 0,
    h2 = 0x01000193 | 0;
  for (let i = 0; i < sig.length; i++) {
    h1 = Math.imul(h1 ^ sig[i], 16777619);
    h2 = Math.imul(h2 + sig[i] + 0x9e3779b9, 0x85ebca6b) ^ (h2 >>> 13);
  }
  return `${h1 >>> 0}:${h2 >>> 0}`;
}

export function enumerate(
  t: Target,
  sem: Sem,
  maxSize: number,
  cap: number,
  onLevel?: (size: number, progs: Prog[]) => void
) {
  const pts = t.testInputs(sem).filter((x) => t.domain(x, sem));
  const P = pts.length;
  const buckets: Record<"I" | "B", Prog[][]> = { I: [[]], B: [[]] };
  const seen = new Set<string>();
  let total = 0,
    reached = 0,
    capped = false;
  const EMPTY = new Int32Array(0);
  let final = false;
  const add = (p: Prog, out: Prog[]) => {
    const key = p.t + hashSig(p.sig);
    if (seen.has(key)) return;
    seen.add(key);
    total++;
    out.push(final ? { ...p, sig: EMPTY } : p); // last level is never reused: drop its signature
  };
  for (let s = 1; s <= maxSize; s++) {
    final = s === maxSize;
    const I: Prog[] = [],
      B: Prog[] = [];
    if (s === 1) {
      t.vars.forEach((_, i) =>
        add(
          { t: "I", size: 1, sig: Int32Array.from(pts.map((x) => x[i])), ast: { k: "var", i } },
          I
        )
      );
      for (const v of t.consts)
        add({ t: "I", size: 1, sig: new Int32Array(P).fill(v), ast: { k: "const", v } }, I);
      for (const v of [true, false])
        add({ t: "B", size: 1, sig: new Int32Array(P).fill(v ? 1 : 0), ast: { k: "bool", v } }, B);
    } else {
      // binary int ops and comparisons
      for (let i = 1; i <= s - 2 && total < cap; i++) {
        const j = s - 1 - i;
        for (const a of buckets.I[i] ?? []) {
          if (total >= cap) break;
          for (const b of buckets.I[j] ?? []) {
            const as = a.sig,
              bs = b.sig;
            if (i <= j) {
              const add_ = new Int32Array(P),
                mn = new Int32Array(P),
                mx = new Int32Array(P);
              for (let q = 0; q < P; q++) {
                add_[q] = as[q] + bs[q];
                mn[q] = as[q] < bs[q] ? as[q] : bs[q];
                mx[q] = as[q] > bs[q] ? as[q] : bs[q];
              }
              add({ t: "I", size: s, sig: add_, ast: { k: "add", a: a.ast, b: b.ast } }, I);
              add({ t: "I", size: s, sig: mn, ast: { k: "min", a: a.ast, b: b.ast } }, I);
              add({ t: "I", size: s, sig: mx, ast: { k: "max", a: a.ast, b: b.ast } }, I);
              const eq = new Int32Array(P);
              for (let q = 0; q < P; q++) eq[q] = as[q] === bs[q] ? 1 : 0;
              add({ t: "B", size: s, sig: eq, ast: { k: "eq", a: a.ast, b: b.ast } }, B);
            }
            const sub = new Int32Array(P),
              lt = new Int32Array(P),
              le = new Int32Array(P);
            for (let q = 0; q < P; q++) {
              const d = as[q] - bs[q];
              sub[q] = sem === "nat" && d < 0 ? 0 : d;
              lt[q] = as[q] < bs[q] ? 1 : 0;
              le[q] = as[q] <= bs[q] ? 1 : 0;
            }
            add({ t: "I", size: s, sig: sub, ast: { k: "sub", a: a.ast, b: b.ast } }, I);
            add({ t: "B", size: s, sig: lt, ast: { k: "lt", a: a.ast, b: b.ast } }, B);
            add({ t: "B", size: s, sig: le, ast: { k: "le", a: a.ast, b: b.ast } }, B);
          }
        }
      }
      // division by a constant
      for (const d of t.div)
        for (const a of buckets.I[s - 2] ?? []) {
          const sg = new Int32Array(P);
          for (let q = 0; q < P; q++) sg[q] = Math.floor(a.sig[q] / d);
          add({ t: "I", size: s, sig: sg, ast: { k: "div", a: a.ast, d } }, I);
        }
      // if-then-else (int and bool results)
      for (let ci = 1; ci <= s - 3 && total < cap; ci++)
        for (let ai = 1; ai <= s - 1 - ci - 1 && total < cap; ai++) {
          const bi = s - 1 - ci - ai;
          for (const c of buckets.B[ci] ?? []) {
            if (total >= cap) break;
            let allSame = true;
            for (let q = 1; q < P; q++)
              if (c.sig[q] !== c.sig[0]) {
                allSame = false;
                break;
              }
            if (allSame) continue; // constant condition: never needed
            for (const ty of ["I", "B"] as const)
              for (const a of buckets[ty][ai] ?? [])
                for (const b of buckets[ty][bi] ?? []) {
                  const sg = new Int32Array(P);
                  for (let q = 0; q < P; q++) sg[q] = c.sig[q] ? a.sig[q] : b.sig[q];
                  add(
                    { t: ty, size: s, sig: sg, ast: { k: "ite", c: c.ast, a: a.ast, b: b.ast } },
                    ty === "I" ? I : B
                  );
                }
          }
        }
    }
    buckets.I[s] = I;
    buckets.B[s] = B;
    if (total >= cap) capped = true;
    reached = s;
    onLevel?.(s, t.out === "B" ? B : I);
    if (capped) break;
  }
  return { buckets, pts, total, reached, capped };
}

function compile(ast: Node, sem: Sem): Fn {
  return (...xs: number[]) => evalNode(ast, xs, sem);
}

function sigOf(f: Fn, pts: number[][]): string {
  return pts.map((x) => f(...x)).join(",");
}

export function synthesize(t: Target, sem: Sem, opts: { maxSize?: number; cap?: number } = {}) {
  const maxSize = opts.maxSize ?? t.maxSize;
  const cap = opts.cap ?? 2_500_000;
  const t0 = performance.now();
  const lawIn = t.lawInputs(sem).filter((x) => t.domain(x, sem));
  const lawSets: Law[][] = [t.laws];
  for (let k = 1; k <= t.strengthen.length; k++)
    lawSets.push([...t.laws, ...t.strengthen.slice(0, k)]);
  const intended = t.intended(sem);
  type Sol = { expr: string; size: number; sig: string; f: Fn | [Fn, Fn] };
  const sols: Sol[][] = lawSets.map(() => []);
  const firsts: ({ expr: string; size: number; ms: number } | undefined)[] = lawSets.map(
    () => undefined
  );
  const passes = (laws: Law[], f: Fn) => laws.every((l) => lawIn.every((x) => l.holds(f, x)));
  let result: ReturnType<typeof enumerate>;
  const fieldCands: [Prog[], Prog[]] = [[], []];

  result = enumerate(t, sem, maxSize, cap, (size, progs) => {
    if (t.out === "pair") {
      for (const p of progs) {
        const f = compile(p.ast, sem);
        if (lawIn.every((x) => t.fieldFilter![0](f, x))) fieldCands[0].push(p);
        if (lawIn.every((x) => t.fieldFilter![1](f, x))) fieldCands[1].push(p);
      }
      return;
    }
    for (const p of progs) {
      const f = compile(p.ast, sem);
      lawSets.forEach((laws, li) => {
        if (passes(laws, f)) {
          sols[li].push({ expr: show(p.ast, t.vars), size: p.size, sig: "", f });
          if (!firsts[li])
            firsts[li] = {
              expr: show(p.ast, t.vars),
              size,
              ms: Math.round(performance.now() - t0)
            };
        }
      });
    }
  });

  // pair targets: product of field candidates, full laws checked on each pair
  const pairFirst: typeof firsts = lawSets.map(() => undefined);
  if (t.out === "pair") {
    const [A, B] = fieldCands;
    const order = A.flatMap((a) => B.map((b) => [a, b] as const)).sort(
      (x, y) =>
        Math.max(x[0].size, x[1].size) - Math.max(y[0].size, y[1].size) ||
        x[0].size + x[1].size - (y[0].size + y[1].size)
    );
    for (const [a, b] of order) {
      const fs = compile(a.ast, sem),
        fe = compile(b.ast, sem);
      currentPair = { s: fs, e: fe };
      lawSets.forEach((laws, li) => {
        if (laws.every((l) => lawIn.every((x) => l.holds(fs, x)))) {
          const expr = `{ start: ${show(a.ast, t.vars)}, end: ${show(b.ast, t.vars)} }`;
          sols[li].push({ expr, size: a.size + b.size, sig: "", f: [fs, fe] });
          if (!pairFirst[li])
            pairFirst[li] = { expr, size: a.size + b.size, ms: Math.round(performance.now() - t0) };
        }
      });
    }
    pairFirst.forEach((p, i) => (firsts[i] = p));
  }

  // behaviour on the large test set (domain points) decides semantic distinctness and intent
  const pts = result.pts;
  const sigF = (f: Fn | [Fn, Fn]) =>
    Array.isArray(f) ? sigOf(f[0], pts) + "|" + sigOf(f[1], pts) : sigOf(f, pts);
  const intendedSig = sigF(intended);
  const report = lawSets.map((laws, li) => {
    const bySig = new Map<string, Sol>();
    for (const s of sols[li]) {
      const k = sigF(s.f);
      if (!bySig.has(k)) bySig.set(k, { ...s, sig: k });
    }
    const distinct = [...bySig.values()];
    const intendedFound = bySig.has(intendedSig);
    const unintended = distinct.filter((s) => s.sig !== intendedSig);
    // genuine under-specification: differs from intent already on the law inputs;
    // bound artefact: agrees with intent on every law input, differs only beyond the bound
    const lawSigF = (f: Fn | [Fn, Fn]) =>
      Array.isArray(f) ? sigOf(f[0], lawIn) + "|" + sigOf(f[1], lawIn) : sigOf(f, lawIn);
    const intendedLawSig = lawSigF(intended);
    const boundArtefacts = unintended.filter((u) => lawSigF(u.f) === intendedLawSig);
    // re-check every solution with the large test set as law inputs (a wider bound)
    const wideOk = (u: Sol) => {
      if (Array.isArray(u.f)) {
        const [fs, fe] = u.f;
        currentPair = { s: fs, e: fe };
        return laws.every((l) => pts.every((x) => l.holds(fs, x)));
      }
      const f = u.f;
      return laws.every((l) => pts.every((x) => l.holds(f, x)));
    };
    const survivorsWide = distinct.filter(wideOk);
    return {
      laws: laws.map((l) => l.name),
      first: firsts[li],
      distinctSolutions: distinct.length,
      intendedFound,
      intendedExpr: intendedFound ? bySig.get(intendedSig)!.expr : undefined,
      unintendedCount: unintended.length,
      underSpecified: unintended.length - boundArtefacts.length,
      boundArtefacts: boundArtefacts.length,
      distinctWithWideLawInputs: survivorsWide.length,
      unintendedWithWideLawInputs: survivorsWide.filter((u) => u.sig !== intendedSig).length,
      underSpecifiedExamples: unintended
        .filter((u) => !boundArtefacts.includes(u))
        .sort((a, b) => a.size - b.size)
        .slice(0, 3)
        .map((u) => u.expr),
      unintendedExamples: unintended
        .sort((a, b) => a.size - b.size)
        .slice(0, 4)
        .map((s) => s.expr)
    };
  });
  return {
    target: t.id,
    sem,
    maxSizeReached: result.reached,
    capped: result.capped,
    programsEnumerated: result.total,
    testPoints: pts.length,
    lawPoints: lawIn.length,
    ms: Math.round(performance.now() - t0),
    lawSets: report
  };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const semArg = args.includes("--sem")
    ? [args[args.indexOf("--sem") + 1] as Sem]
    : (["nat", "js"] as Sem[]);
  const maxArg = args.includes("--max") ? Number(args[args.indexOf("--max") + 1]) : undefined;
  const ids = args.filter(
    (a, i) => !a.startsWith("--") && !["--sem", "--max"].includes(args[i - 1])
  );
  for (const t of TARGETS.filter((x) => ids.length === 0 || ids.includes(x.id)))
    for (const sem of semArg) {
      // R6 uses negative deltas, outside the Nat domain: drop it for Nat only (without mutating the shared target)
      const tt =
        t.id === "ringMove" && sem === "nat"
          ? { ...t, strengthen: t.strengthen.filter((l) => !l.name.startsWith("R6")) }
          : t;
      console.log(JSON.stringify(synthesize(tt, sem, { maxSize: maxArg }), null, 1));
    }
}
