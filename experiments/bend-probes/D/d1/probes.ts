// D1 probes: one small Bend project per (escape hatch, context). Each probe
// is written to $OUT/<id>/ as main.bend + LAWS.bend + PROOF.bend (+ extras),
// then three commands run and their output is recorded:
//   run    bend main.bend              (checks, then runs or normalizes main)
//   check  bend main.bend --check-only (checks, prints the verdict)
//   gate   bend PROOF.bend             (the PROOF gate; no main, so a verdict)
//
//   bun d1/probes.ts <out-dir> > probes.json

import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

const OUT = process.argv[2];
const BEND = process.env.BEND
  ?? "/tmp/claude-0/-home-user-shapelang/83ff80bc-0161-572f-9e5a-9075cccad6d0/scratchpad/bendexp/bendc/bend";

// the baseline project: a law-covered def `twice`, a pure main
const TWICE = `def twice(n: Nat) -> Nat:
  match n:
    case 0n:
      0n
    case 1n+p:
      1n+1n+twice(p)
`;
const LAW = `import Base
import ./main.bend as M

# LAW: twice adds two per successor
law twice_succ:
  for n: Nat
  {M.twice(1n+n) == 1n+1n+M.twice(n) : Nat}
`;
const PROOF = `import Base
import ./main.bend as M
import ./LAWS.bend as Laws

def Laws.twice_succ(n):
  {==}
`;
const PURE_MAIN = `def main() -> Nat:
  twice(3n)
`;
const IO_MAIN = (body: string) => `def main() -> IO(Unit):
  do IO<Unit>:
${body}
`;

// hatch snippets
const HALVE_UNSAFE = `@unsafe
def halve(+n: U32, acc: U32) -> U32:
  halve.go(U32.is_le(n, 1), n, acc)

def halve.go(b: Bool, n: U32, acc: U32) -> U32:
  match b:
    case True{}:
      acc
    case False{}:
      halve((n / 2 : U32), (acc + 1 : U32))
`;
const HALVE_Q = HALVE_UNSAFE.replace("@unsafe\ndef halve(", "def halve?(");
const CLOCK = `def Clock.now() -> IO(U32):
  import "./clock.c"
  import "./clock.js"
`;
const CLOCK_JS = `function clock_now() {
  return Math.floor(performance.now()) >>> 0;
}
io_eff(CID(Clock.now), clock_now);
`;
const CLOCK_C = `Term clock_now_run(Env e, Term* f, IoWork* w) {
  return (Term)(uint32_t)(io_tick() / 1000000ull);
}
static void __attribute__((constructor)) clock_now_use(void) {
  io_eff(CID(Clock.now), clock_now_run);
}
`;
const clockFiles = { "clock.js": CLOCK_JS, "clock.c": CLOCK_C };

type Probe = {
  id: string; hatch: string; context: string;
  main: string; laws?: string; proof?: string; extra?: Record<string, string>;
  hatchDefs: string[];      // defs that are the hatch (names as the entry file spells them)
  dependents?: string[];    // defs that depend on it
  note?: string;
};

const m = (...parts: string[]) => "import Base\n\n" + parts.join("\n");

const probes: Probe[] = [
  { id: "base", hatch: "none", context: "baseline", main: m(TWICE, PURE_MAIN), hatchDefs: [] },

  // @unsafe
  { id: "unsafe-pure-unused", hatch: "@unsafe", context: "pure, unused by law/main",
    main: m(TWICE, HALVE_UNSAFE, PURE_MAIN), hatchDefs: ["halve"], dependents: ["halve.go"] },
  { id: "unsafe-pure-main", hatch: "@unsafe", context: "pure, used by a value main",
    main: m(TWICE, HALVE_UNSAFE, "def main() -> U32:\n  halve(1000, 0)\n"), hatchDefs: ["halve"], dependents: ["halve.go", "main"] },
  { id: "unsafe-law-def", hatch: "@unsafe", context: "pure, the law's def is @unsafe",
    main: m("@unsafe\n" + TWICE, PURE_MAIN), hatchDefs: ["twice"], dependents: ["main", "twice_succ"] },
  { id: "unsafe-proof-false", hatch: "@unsafe", context: "proof of a FALSE law via an @unsafe lemma",
    main: m(TWICE, PURE_MAIN),
    laws: LAW + `
# LAW (false): twice(1) is 3
law twice_one:
  {M.twice(1n) == 3n : Nat}
`,
    proof: PROOF + `
@unsafe
def bot() -> Empty:
  bot()

def absurd(e: Empty) -> {M.twice(1n) == 3n : Nat}:
  match e:

def Laws.twice_one():
  absurd(bot())
`, hatchDefs: ["bot"], dependents: ["Laws.twice_one"] },
  { id: "unsafe-io", hatch: "@unsafe", context: "IO, used by main only",
    main: m(TWICE, HALVE_UNSAFE, IO_MAIN('    IO.print(U32.show(halve(1000, 0)))')), hatchDefs: ["halve"], dependents: ["halve.go", "main"] },
  { id: "unsafe-io-loop", hatch: "@unsafe", context: "IO loop def (demo style), main only",
    main: m(TWICE, `@unsafe
def loop(n: U32) -> IO(Unit):
  loop.go(U32.is_zero(n), n)

def loop.go(b: Bool, n: U32) -> IO(Unit):
  match b:
    case True{}:
      IO.pure(Unit, Unit{})
    case False{}:
      do IO<Unit>:
        IO.print(U32.show(n))
        loop((n - 1 : U32))
`, IO_MAIN("    loop(2)")), hatchDefs: ["loop"], dependents: ["loop.go", "main"] },
  { id: "unsafe-dead", hatch: "@unsafe", context: "@unsafe call in dead code of the law's def",
    main: m(HALVE_UNSAFE, `def twice(n: Nat) -> Nat:
  match n:
    case 0n:
      (y => 0n)(halve(8, 0))
    case 1n+p:
      1n+1n+twice(p)
`, PURE_MAIN), hatchDefs: ["halve"], dependents: ["halve.go", "twice", "twice_succ"],
    note: "the guide/WONTFIX say the checker skips dead code" },
  { id: "unsafe-lib-module", hatch: "@unsafe", context: "pure, in an imported library used by the law's def",
    main: `import Base
import ./lib.bend as L

def twice(n: Nat) -> Nat:
  match n:
    case 0n:
      L.zero()
    case 1n+p:
      1n+1n+twice(p)

${PURE_MAIN}`,
    extra: { "lib.bend": `import Base

@unsafe
def zero() -> Nat:
  0n
` }, hatchDefs: ["lib.zero"], dependents: ["twice", "twice_succ"] },

  // def f?
  { id: "qsugar-pure-unused", hatch: "def f?", context: "pure, unused",
    main: m(TWICE, HALVE_Q, PURE_MAIN), hatchDefs: ["halve"], dependents: ["halve.go"] },
  { id: "qsugar-law-def", hatch: "def f?", context: "pure, the law's def",
    main: m(TWICE.replace("def twice(", "def twice?("), PURE_MAIN), hatchDefs: ["twice"], dependents: ["main", "twice_succ"] },
  { id: "qsugar-io", hatch: "def f?", context: "IO, main only",
    main: m(TWICE, HALVE_Q, IO_MAIN('    IO.print(U32.show(halve(1000, 0)))')), hatchDefs: ["halve"], dependents: ["halve.go", "main"] },

  // foreign effects (user JS/C)
  { id: "foreign-io-main", hatch: "foreign effect", context: "IO, main only",
    main: m(TWICE, CLOCK, IO_MAIN('    t : U32 <- Clock.now()\n    IO.print("ms " ++ U32.show(t))')), extra: clockFiles,
    hatchDefs: ["Clock.now"], dependents: ["main"] },
  { id: "foreign-io-unused", hatch: "foreign effect", context: "declared, used by nothing",
    main: m(TWICE, CLOCK, PURE_MAIN), extra: clockFiles, hatchDefs: ["Clock.now"] },
  { id: "foreign-io-lib", hatch: "foreign effect", context: "IO, in an imported library",
    main: `import Base
import ./clk.bend as K

${TWICE}
${IO_MAIN('    t : U32 <- K.Clock.now()\n    IO.print("ms " ++ U32.show(t))')}`,
    extra: { "clk.bend": "import Base\n\n" + CLOCK, ...clockFiles }, hatchDefs: ["clk.Clock.now"], dependents: ["main"] },
  { id: "foreign-io-law", hatch: "foreign effect", context: "IO def that a law mentions",
    main: m(TWICE, CLOCK, `def stamp(n: Nat) -> IO(U32):
  do IO<U32>:
    t : U32 <- Clock.now()
    return t
`, IO_MAIN('    t : U32 <- stamp(1n)\n    IO.print("ms " ++ U32.show(t))')), extra: clockFiles,
    laws: LAW + `
# LAW: stamp ignores its argument
law stamp_const:
  for a: Nat
  for b: Nat
  {M.stamp(a) == M.stamp(b) : IO(U32)}
`, proof: PROOF + `
def Laws.stamp_const(a, b):
  {==}
`, hatchDefs: ["Clock.now"], dependents: ["stamp", "main", "Laws.stamp_const"] },
  { id: "foreign-pure-type", hatch: "foreign effect", context: "foreign def with a non-IO type",
    main: m(TWICE, `def magic(n: U32) -> U32:
  import "./clock.c"
  import "./clock.js"
`, PURE_MAIN), extra: clockFiles, hatchDefs: ["magic"] },
  { id: "base-effect-io", hatch: "Base effect (IO.print, TCP)", context: "IO, main only",
    main: m(TWICE, IO_MAIN('    IO.print("hi")')), hatchDefs: [], note: "Base effects are foreign defs (import ./x.js) inside base.bend" },

  // holes
  { id: "todo-pure-unused", hatch: "?TODO", context: "pure, unused def",
    main: m(TWICE, "def later(n: Nat) -> Nat:\n  ?TODO\n", PURE_MAIN), hatchDefs: ["later"] },
  { id: "todo-proof", hatch: "?TODO", context: "the law's proof body",
    main: m(TWICE, PURE_MAIN), proof: PROOF.replace("{==}", "?TODO"), hatchDefs: ["Laws.twice_succ"] },
  { id: "todo-io", hatch: "?TODO", context: "IO code",
    main: m(TWICE, "def greeting() -> String:\n  ?TODO\n", IO_MAIN("    IO.print(greeting())")), hatchDefs: ["greeting"] },
  { id: "todo-dead", hatch: "?TODO", context: "dead code of the law's def",
    main: m(`def twice(n: Nat) -> Nat:
  match n:
    case 0n:
      (y => 0n)(?TODO)
    case 1n+p:
      1n+1n+twice(p)
`, PURE_MAIN), hatchDefs: ["twice"] },
  { id: "named-hole-proof", hatch: "?name", context: "the law's proof body",
    main: m(TWICE, PURE_MAIN), proof: PROOF.replace("{==}", "?goal"), hatchDefs: ["Laws.twice_succ"] },
  { id: "named-hole-pure", hatch: "?name", context: "pure, unused def",
    main: m(TWICE, "def later(n: Nat) -> Nat:\n  ?goal\n", PURE_MAIN), hatchDefs: ["later"] },

  // open laws
  { id: "open-law-gate", hatch: "open law", context: "a LAWS.bend law with no proof",
    main: m(TWICE, PURE_MAIN), laws: LAW + `
law twice_zero:
  {M.twice(0n) == 0n : Nat}
`, hatchDefs: ["twice_zero"] },
  { id: "open-law-main", hatch: "open law", context: "an unused law left open in main.bend",
    main: m(TWICE, "law twice_assoc:\n  for n: Nat\n  {twice(n) == Nat.add(n, n) : Nat}\n", PURE_MAIN), hatchDefs: ["twice_assoc"] },
  { id: "open-law-io", hatch: "open law", context: "an open law in a file with an IO main",
    main: m(TWICE, "law twice_assoc:\n  for n: Nat\n  {twice(n) == Nat.add(n, n) : Nat}\n", IO_MAIN('    IO.print("hi")')), hatchDefs: ["twice_assoc"] },
  { id: "open-law-type", hatch: "open law (user handle type)", context: "law Token: Type, unused",
    main: m(TWICE, "law Token:\n  Type\n", PURE_MAIN), hatchDefs: ["Token"] },
  { id: "open-law-filled-elsewhere", hatch: "open law", context: "law open in main.bend, filled in PROOF.bend",
    main: m(TWICE, "law twice_zero:\n  {twice(0n) == 0n : Nat}\n", PURE_MAIN),
    proof: PROOF + "\ndef M.twice_zero():\n  {==}\n", hatchDefs: ["twice_zero"],
    note: "guide: a law left open in one file may be filled in another" },

  // F32 axioms (Base laws with no def)
  { id: "f32-law-def", hatch: "F32 axiom", context: "the law's def computes with F32",
    main: m(TWICE, "def scale(x: F32) -> F32:\n  F32.mul(x, 2.0)\n", PURE_MAIN),
    laws: LAW + "\nlaw scale_def:\n  for x: F32\n  {M.scale(x) == F32.mul(x, 2.0) : F32}\n",
    proof: PROOF + "\ndef Laws.scale_def(x):\n  {==}\n", hatchDefs: ["scale"] },
  { id: "f32-value-law", hatch: "F32 axiom", context: "a law about an F32 value (true in IEEE)",
    main: m(TWICE, PURE_MAIN),
    laws: LAW + "\nlaw one_plus_one:\n  {F32.add(1.0, 1.0) == 2.0 : F32}\n",
    proof: PROOF + "\ndef Laws.one_plus_one():\n  {==}\n", hatchDefs: [] },
  { id: "f32-io", hatch: "F32 axiom", context: "IO code",
    main: m(TWICE, IO_MAIN('    IO.print(F32.show(F32.mul(1.5, 2.0)))')), hatchDefs: [] },

  // Base @unsafe (Array.fork)
  { id: "fork-pure-unused", hatch: "Base @unsafe (Array.fork)", context: "pure, unused",
    main: m(TWICE, `def both(a: Array<U32>) -> Array<U32> & Array<U32>:
  Array.fork(U32, a)
`, PURE_MAIN), hatchDefs: ["both"] },
  { id: "fork-law-def", hatch: "Base @unsafe (Array.fork)", context: "used by the law's def",
    main: m(`def touch(a: Array<U32>) -> Nat:
  (x, y) = Array.fork(U32, a)
  0n

def twice(n: Nat) -> Nat:
  match n:
    case 0n:
      touch([0 : U32*1n])
    case 1n+p:
      1n+1n+twice(p)
`, PURE_MAIN), hatchDefs: ["touch"], dependents: ["twice", "twice_succ"] },
];

function run(cwd: string, args: string[]): { code: number | null; out: string } {
  const r = spawnSync(BEND, args, { cwd, encoding: "utf8", timeout: 120000, env: { ...process.env, BEND_NO_TELEMETRY: "1" } });
  return { code: r.status, out: ((r.stdout ?? "") + (r.stderr ?? "")).trim() };
}

const results = [];
for (const p of probes) {
  const dir = path.join(OUT, p.id);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "main.bend"), p.main);
  fs.writeFileSync(path.join(dir, "LAWS.bend"), p.laws ?? LAW);
  fs.writeFileSync(path.join(dir, "PROOF.bend"), p.proof ?? PROOF);
  for (const [f, c] of Object.entries(p.extra ?? {})) fs.writeFileSync(path.join(dir, f), c);
  const runR = run(dir, ["main.bend"]);
  const checkR = run(dir, ["main.bend", "--check-only"]);
  const gateR = run(dir, ["PROOF.bend"]);
  // hatchDefs/dependents are spelled as the gate prints them (PROOF.bend is the
  // entry: its own defs bare, main.bend's as main.x, LAWS.bend's as LAWS.x);
  // --check-only on main.bend prints main.bend's defs bare
  const has = (out: string, n: string) => new RegExp("(^|[ ,:])" + n.replace(/\./g, "\\.") + "(,|$|\\n| )", "m").test(out);
  const inGate = (n: string) => has(gateR.out, n);
  const inCheck = (n: string) => has(checkR.out, n.startsWith("main.") ? n.slice(5) : n);
  const verdict = (o: string) => o.includes("ALL PROOFS CHECK") ? "PASS" : o.includes("SOME PROOFS FAIL") ? "FAIL" : "none";
  results.push({
    id: p.id, hatch: p.hatch, context: p.context, note: p.note,
    run: { code: runR.code, verdict: verdict(runR.out), out: runR.out.split("\n").slice(0, 6).join("\n") },
    check: { code: checkR.code, verdict: verdict(checkR.out), out: checkR.out.split("\n").slice(0, 6).join("\n"),
      namesHatch: p.hatchDefs.filter((n) => !n.startsWith("LAWS.") && !/^[^.]+$/.test(n) || n.startsWith("main.")).map(inCheck) },
    gate: { code: gateR.code, verdict: verdict(gateR.out), out: gateR.out.split("\n").slice(0, 8).join("\n"),
      namesHatch: p.hatchDefs.map(inGate), namesDependents: (p.dependents ?? []).map(inGate) },
    hatchDefs: p.hatchDefs, dependents: p.dependents ?? [],
  });
  process.stderr.write(p.id + " run=" + runR.code + " check=" + checkR.code + " gate=" + gateR.code + "\n");
}
console.log(JSON.stringify(results, null, 1));
