// A5 oracle: decides, without looking at any proof, whether each law of a demo
// holds for a (mutated) implementation, and whether its behaviour differs from
// the original, by evaluating both on enumerated small inputs.
//
// usage: bun oracle.mjs <demo> <original.mjs> <mutant.mjs>
// prints one JSON object: {laws: {name: {holds, cex}}, changed, diff, inputs}
//
// Values cross as the Bend JS backend exports them: Nat and U32 are numbers,
// Bool is a JS boolean, constructors are {$: "Name", field: value}, erased
// arguments are dropped. Every input is rebuilt fresh before each call, since
// the backend may reuse an argument's cells in place.

const [demo, origPath, mutPath] = process.argv.slice(2);
const O = (await import(origPath)).default;
const M = (await import(mutPath)).default;

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const L = (xs) => xs.reduceRight((t, h) => ({ $: "Con", head: h, tail: t }), { $: "Nil" });
const unL = (l) => { const o = []; while (l.$ === "Con") { o.push(l.head); l = l.tail; } return o; };
const lists = (vals, maxLen) => { const out = [[]]; let layer = [[]]; for (let n = 1; n <= maxLen; n++) { const nx = []; for (const p of layer) for (const v of vals) nx.push([...p, v]); out.push(...nx); layer = nx; } return out; };
const range = (n) => [...Array(n).keys()];
const safe = (f) => { try { return { v: f() }; } catch (e) { return { err: String(e).slice(0, 120) }; } };

const laws = {};
let changed = false, diff = null, inputs = 0;
const law = (name) => (laws[name] ??= { holds: true, cex: null });
const fail = (name, cex) => { const l = law(name); if (l.holds) { l.holds = false; l.cex = cex; } };
const cmp = (label, f) => { inputs++; const a = safe(() => f(O)), b = safe(() => f(M)); if (!eq(a, b) && !changed) { changed = true; diff = { label, orig: a, mut: b }; } };

if (demo === "proof_insertion_sort") {
  law("sort_sorted"); law("sort_perm");
  for (const xs of lists([0, 1, 2, 3], 5)) {
    const r = safe(() => unL(M.sort(L(xs))));
    if (r.err) { fail("sort_sorted", { xs, err: r.err }); fail("sort_perm", { xs, err: r.err }); continue; }
    for (let i = 1; i < r.v.length; i++) if (r.v[i - 1] > r.v[i]) { fail("sort_sorted", { xs, out: r.v }); break; }
    for (const x of [0, 1, 2, 3, 4]) {
      const c1 = M.count(x, L(r.v)), c0 = M.count(x, L(xs));
      if (c1 !== c0) { fail("sort_perm", { x, xs, out: r.v }); break; }
    }
    cmp("sort " + JSON.stringify(xs), (X) => X.sort(L(xs)));
    for (const x of [0, 2, 4]) cmp("insert " + x + " " + JSON.stringify(xs), (X) => X.insert(x, L(xs)));
  }
}

if (demo === "proof_typed_eval") {
  law("opt_sound"); law("opt_complete");
  const Num = (n) => ({ $: "Num", n, eq: null }), Bit = (b) => ({ $: "Bit", b, eq: null });
  const N = [[0, 1, 2].map(Num)], B = [[true, false].map(Bit)];
  for (let d = 1; d <= 2; d++) {
    const n = [...N[0]], b = [...B[0]];
    for (const x of N[d - 1]) for (const y of N[d - 1]) n.push({ $: "Add", a: x, b: y, eq: null });
    for (const c of B[d - 1]) for (const x of N[d - 1]) for (const y of N[d - 1]) n.push({ $: "If", c, a: x, b: y });
    for (const x of N[d - 1]) b.push({ $: "IsZero", a: x, eq: null });
    for (const c of B[d - 1]) for (const x of B[d - 1]) for (const y of B[d - 1]) b.push({ $: "If", c, a: x, b: y });
    N.push(n); B.push(b);
  }
  const fresh = (e) => JSON.parse(e);
  for (const [t, es] of [[{ $: "TNum" }, N[2]], [{ $: "TBool" }, B[2]]]) {
    for (const e0 of es) {
      const e = JSON.stringify(e0);
      const v = M.eval(fresh(e));
      const o = safe(() => M.opt(fresh(e)));
      if (o.err) { fail("opt_sound", { e, err: o.err }); fail("opt_complete", { e, err: o.err }); continue; }
      if (!eq(M.eval(o.v), v)) fail("opt_sound", { e, opt: o.v });
      if (!eq(M.lit(t, v), o.v)) fail("opt_complete", { e, opt: o.v });
      cmp("opt " + e, (X) => X.opt(fresh(e)));
    }
  }
}

if (demo === "proof_numerics") {
  for (const k of ["add_comm", "add_assoc", "mul_comm", "mul_dist", "divmod_ok"]) law(k);
  const R = range(8);
  for (const a of R) for (const b of R) {
    if (M.add(a, b) !== M.add(b, a)) fail("add_comm", { a, b });
    if (M.mul(a, b) !== M.mul(b, a)) fail("mul_comm", { a, b });
    cmp(`add ${a} ${b}`, (X) => X.add(a, b)); cmp(`mul ${a} ${b}`, (X) => X.mul(a, b)); cmp(`divmod ${a} ${b}`, (X) => X.divmod(a, b));
    for (const c of R) {
      if (M.add(a, M.add(b, c)) !== M.add(M.add(a, b), c)) fail("add_assoc", { a, b, c });
      if (M.add(M.mul(a, c), M.mul(b, c)) !== M.mul(M.add(a, b), c)) fail("mul_dist", { a, b, c });
    }
  }
  for (const n of range(16)) for (const m of range(6)) {
    const qr = M.divmod(n, 1 + m), q = qr.fst, r = qr.snd;
    if (!(r < 1 + m && n === M.add(r, M.mul(q, 1 + m)))) fail("divmod_ok", { n, m, q, r });
  }
}

if (demo === "pure_par_sum") {
  law("tree_is_seq");
  for (const d of range(6)) for (const i of range(7)) {
    if (M.sum(d, i) !== M.seq(M.pow2(d), i)) fail("tree_is_seq", { d, i, sum: M.sum(d, i), seq: M.seq(M.pow2(d), i) });
    cmp(`sum ${d} ${i}`, (X) => X.sum(d, i)); cmp(`pow2 ${d}`, (X) => X.pow2(d));
  }
}

if (demo === "pure_par_sort") {
  law("mix_leaves"); law("sort_leaves");
  const T = (d, xs) => d === 0 ? xs[0] : { $: "Tuple", fst: T(d - 1, xs.slice(0, xs.length / 2)), snd: T(d - 1, xs.slice(xs.length / 2)) };
  const leaves = (d, vals) => lists(vals, 1 << d).filter((x) => x.length === 1 << d);
  const S = (xs) => xs.reduce((a, b) => a + b, 0);
  for (const d of [0, 1, 2, 3]) {
    const ts = leaves(d, d === 3 ? [0, 1] : [0, 1, 2]);
    for (const xs of ts) for (const s of [true, false]) {
      const r = safe(() => M.sum(d, M.sort(d, s, T(d, xs))));
      if (r.err || r.v !== S(xs)) fail("sort_leaves", { d, s, xs, got: r.v ?? r.err });
      cmp(`sort ${d} ${s} ${xs}`, (X) => X.sort(d, s, T(d, xs)));
    }
    for (const xs of ts) for (const ys of ts) for (const s of [true, false]) {
      const r = safe(() => M.sum(d, M.mix(d, s, T(d, xs), T(d, ys))) + M.sum(d, M.mix(d, !s, T(d, xs), T(d, ys))));
      if (r.err || r.v !== S(xs) + S(ys)) fail("mix_leaves", { d, s, xs, ys, got: r.v ?? r.err });
      if (d <= 2) cmp(`mix ${d} ${s} ${xs} ${ys}`, (X) => X.mix(d, s, T(d, xs), T(d, ys)));
    }
  }
  for (const d of [0, 1, 2, 3, 4]) cmp(`gen ${d}`, (X) => X.gen(d, 0));
}

if (demo === "app_win_is_bug_2d") {
  law("you_cant_win"); law("never_on_flag");
  const MOVES = ["Up", "Down", "Left", "Right"].map(($) => ({ $ }));
  const G = (x, y, won) => ({ $: "Game", x, y, won });
  const key = (g) => g.x + "," + g.y + "," + g.won;
  // is replay the fold of step? (checked on every sequence up to length 6)
  let foldOk = true;
  for (const ms of lists([0, 1, 2, 3], 6)) {
    let g = M.start(); for (const m of ms) g = M.step(MOVES[m], g);
    if (!eq(g, M.replay(M.start(), L(ms.map((m) => MOVES[m]))))) { foldOk = false; break; }
  }
  const check = (g, how) => {
    if (M.is_won(g) !== false) fail("you_cant_win", { how, g });
    if (M.at_flag(g) !== false) fail("never_on_flag", { how, g });
  };
  // exhaustive reachability through step, bounded to coordinates below 64
  const seen = new Map([[key(M.start()), M.start()]]), todo = [M.start()];
  let bounded = false;
  while (todo.length) {
    const g = todo.pop(); check(g, "bfs");
    for (const m of MOVES) {
      const h = M.step(m, g);
      if (h.x > 63 || h.y > 63) { bounded = true; continue; }
      if (!seen.has(key(h))) { seen.set(key(h), h); todo.push(h); }
    }
  }
  if (!foldOk) for (const ms of lists([0, 1, 2, 3], 7)) check(M.replay(M.start(), L(ms.map((m) => MOVES[m]))), { replay: ms });
  laws._reach = { holds: true, cex: { states: seen.size, foldOk, bounded } };
  for (const x of range(12)) for (const y of range(8)) for (const w of [false, true]) for (const m of MOVES) cmp(`step ${m.$} ${x},${y},${w}`, (X) => X.step(m, G(x, y, w)));
  cmp("grid", (X) => X.drawn());
  for (const ms of lists([0, 1, 2, 3], 4)) cmp("replay " + ms, (X) => X.replay(X.start(), L(ms.map((m) => MOVES[m]))));
  cmp("start", (X) => X.start());
}

console.log(JSON.stringify({ laws, changed, diff, inputs }));
