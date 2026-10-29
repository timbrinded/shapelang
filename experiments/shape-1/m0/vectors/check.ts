#!/usr/bin/env bun
// M0 conformance runner: reads experiments/shape-1/m0/vectors/<id>/expected.json (format: FORMAT.md),
// runs each case's input through an implementation, evaluates the assertions against its core output
// (shape.check.output/v1) and prints per-assertion results and a summary. Exit 1 on any failure.
//
//   bun experiments/shape-1/m0/vectors/check.ts [--impl proto|kernel] [--root DIR] [--vector ID]...
//       [--cmd "ARGV"] [--shapek PATH] [--timeout MS] [--strict] [--quiet] [--json OUT] [--self-test]
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
type JsonObject = { [k: string]: Json };

const HERE = import.meta.dir;
const SHAPE1 = resolve(HERE, "../..");
const PROTO_CLI = join(SHAPE1, "proto/src/cli.ts");
const DEFAULT_SHAPEK = join(SHAPE1, "kernel/.lake/build/bin/shapek");
const DRTLIB = join(SHAPE1, "trials/DRT/drtlib.ts");

const ARRAY_SECTIONS = new Set([
  "errors",
  "rejected",
  "obligations",
  "answered",
  "loosening",
  "renames",
  "debt",
  "preexisting"
]);
const SCALAR_SECTIONS = new Set(["verdict", "order"]);
const OBJECT_SECTIONS = new Set(["budget", "health"]);
const CHECKS = new Set(["count", "fields", "equals"]);
const ASSERT_KEYS = ["in", "select", "check", "value", "why"];

/** What shapek prints of the output contract (kernel README "Output"; drtlib OB_FIELDS). */
const KERNEL_FIELDS: Record<string, Set<string> | null> = {
  verdict: null,
  errors: new Set(["code", "subject"]),
  obligations: new Set([
    "key",
    "kind",
    "reason",
    "questions",
    "introduced",
    "severity",
    "tier",
    "budget",
    "force",
    "owner",
    "group",
    "claim",
    "subject",
    "witness",
    "exploited",
    "final",
    "binding",
    "exception"
  ]),
  answered: new Set(["obligation", "as"]),
  debt: new Set(["obligation", "exception", "owner", "expiresInDays"])
};
const KERNEL_ERROR_CODES = new Set([
  "E-conduct",
  "E-structure",
  "E-provider-missing",
  "E-exception"
]);

interface Assertion {
  in: string;
  select: JsonObject;
  check: "count" | "fields" | "equals";
  value: Json;
  why: string;
}
interface Case {
  case: string;
  input: Json;
  assert: Assertion[];
}
interface Vector {
  vector: string;
  title: string;
  decides: string[];
  cases: Case[];
  dir: string;
}

type Status = "PASS" | "FAIL" | "NOT RUN";
interface Result {
  vector: string;
  case: string;
  index: number;
  status: Status;
  assertion: string;
  why: string;
  detail: string;
}

/** An implementation's answer for one case. */
type Run =
  | {
      kind: "output";
      out: JsonObject;
      exit: number | null;
      ms: number;
      notes: string[];
      filter?: KernelFilter;
    }
  | { kind: "error"; error: string; ms: number }
  | { kind: "skip"; reason: string };

interface KernelFilter {
  prepassErrors: string[];
}

// ---------------------------------------------------------------- JSON helpers

function isObject(v: unknown): v is JsonObject {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function canon(v: Json): string {
  if (Array.isArray(v)) return `[${v.map(canon).join(",")}]`;
  if (isObject(v))
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canon(v[k] as Json)}`)
      .join(",")}}`;
  return JSON.stringify(v);
}

const eq = (a: Json, b: Json): boolean => canon(a) === canon(b);

function short(v: Json | undefined, n = 160): string {
  const s = v === undefined ? "(absent)" : canon(v);
  return s.length > n ? `${s.slice(0, n - 3)}...` : s;
}

type Got = { present: true; value: Json } | { present: false };

/** Dotted-path lookup (FORMAT.md "Paths and comparison"). */
function lookup(v: Json, segs: string[]): Got {
  if (segs.length === 0) return { present: true, value: v };
  const [seg, ...rest] = segs as [string, ...string[]];
  if (Array.isArray(v)) {
    if (/^\d+$/.test(seg)) {
      const i = Number(seg);
      return i < v.length ? lookup(v[i] as Json, rest) : { present: false };
    }
    const found: Json[] = [];
    for (const e of v) {
      const g = lookup(e, segs);
      if (g.present) found.push(g.value);
    }
    return { present: true, value: found };
  }
  if (isObject(v) && Object.hasOwn(v, seg)) return lookup(v[seg] as Json, rest);
  return { present: false };
}

const path = (p: string): string[] => p.split(".");

function meets(el: Json, cond: JsonObject): boolean {
  for (const [p, want] of Object.entries(cond)) {
    const g = lookup(el, path(p));
    if (!g.present) return false;
    if (Array.isArray(g.value)) {
      if (!(g.value.some((x) => eq(x, want)) || eq(g.value, want))) return false;
    } else if (!eq(g.value, want)) return false;
  }
  return true;
}

// ---------------------------------------------------------------- loading and validation

function validateVector(
  raw: unknown,
  id: string,
  dir: string
): { vector?: Vector; errors: string[] } {
  const errors: string[] = [];
  if (!isObject(raw)) return { errors: ["expected.json is not a JSON object"] };
  if (raw.vector !== id)
    errors.push(`"vector" is ${JSON.stringify(raw.vector)}, expected the directory name "${id}"`);
  if (typeof raw.title !== "string" || raw.title.trim() === "")
    errors.push(`"title" must be a non-empty string`);
  let decides: string[] = [];
  if (typeof raw.decides === "string" && raw.decides.trim() !== "") decides = [raw.decides];
  else if (
    Array.isArray(raw.decides) &&
    raw.decides.length > 0 &&
    raw.decides.every((d) => typeof d === "string" && d.trim() !== "")
  )
    decides = raw.decides as string[];
  else errors.push(`"decides" must be a clause or a non-empty list of clauses`);
  const known = new Set(["vector", "title", "decides", "cases"]);
  for (const k of Object.keys(raw))
    if (!known.has(k)) errors.push(`unknown top-level field "${k}"`);
  const cases: Case[] = [];
  if (!Array.isArray(raw.cases) || raw.cases.length === 0)
    errors.push(`"cases" must be a non-empty list`);
  else {
    const names = new Set<string>();
    raw.cases.forEach((c, ci) => {
      const at = `cases[${ci}]`;
      if (!isObject(c)) {
        errors.push(`${at} is not an object`);
        return;
      }
      for (const k of Object.keys(c))
        if (!["case", "input", "assert"].includes(k)) errors.push(`${at}: unknown field "${k}"`);
      if (typeof c.case !== "string" || c.case === "")
        errors.push(`${at}: "case" must be a non-empty string`);
      else if (names.has(c.case)) errors.push(`${at}: duplicate case name "${c.case}"`);
      else names.add(c.case);
      if (!(typeof c.input === "string" || isObject(c.input)))
        errors.push(`${at}: "input" must be an input object or a file name`);
      if (!Array.isArray(c.assert) || c.assert.length === 0) {
        errors.push(`${at}: "assert" must be a non-empty list`);
        return;
      }
      const asserts: Assertion[] = [];
      c.assert.forEach((a, ai) => {
        const e = validateAssertion(a);
        for (const m of e) errors.push(`${at}.assert[${ai}]: ${m}`);
        if (e.length === 0) asserts.push(a as unknown as Assertion);
      });
      cases.push({ case: String(c.case), input: c.input as Json, assert: asserts });
    });
  }
  if (errors.length > 0) return { errors };
  return {
    vector: { vector: id, title: String(raw.title), decides, cases, dir },
    errors
  };
}

function validateAssertion(a: unknown): string[] {
  const e: string[] = [];
  if (!isObject(a)) return ["not an object"];
  for (const k of Object.keys(a)) if (!ASSERT_KEYS.includes(k)) e.push(`unknown key "${k}"`);
  for (const k of ASSERT_KEYS) if (!Object.hasOwn(a, k)) e.push(`missing "${k}"`);
  if (e.length > 0) return e;
  const sec = a.in;
  if (
    typeof sec !== "string" ||
    !(ARRAY_SECTIONS.has(sec) || SCALAR_SECTIONS.has(sec) || OBJECT_SECTIONS.has(sec))
  )
    e.push(`"in" must name a core output section, got ${JSON.stringify(sec)}`);
  if (!isObject(a.select)) e.push(`"select" must be an object`);
  if (typeof a.check !== "string" || !CHECKS.has(a.check))
    e.push(`"check" must be count, fields or equals`);
  if (typeof a.why !== "string" || a.why.trim() === "")
    e.push(`"why" must name the deciding clause`);
  if (e.length > 0) return e;
  const array = ARRAY_SECTIONS.has(sec as string);
  if (!array && Object.keys(a.select as JsonObject).length > 0)
    e.push(`"select" must be {} for the scalar or object section ${sec}`);
  if (a.check === "equals" && array)
    e.push(`"equals" applies to scalar and object sections; use count or fields`);
  if (a.check !== "equals" && !array) e.push(`"${a.check}" applies to array sections; use equals`);
  if (
    a.check === "count" &&
    !(typeof a.value === "number" && Number.isInteger(a.value) && a.value >= 0)
  )
    e.push(`"count" needs a non-negative integer value`);
  if (a.check === "fields" && !(isObject(a.value) && Object.keys(a.value).length > 0))
    e.push(`"fields" needs a non-empty object of path -> value`);
  return e;
}

function loadVectors(root: string, only: string[]): { vectors: Vector[]; formatErrors: Result[] } {
  const vectors: Vector[] = [];
  const formatErrors: Result[] = [];
  if (!existsSync(root) || !statSync(root).isDirectory())
    throw new Error(`--root ${root} is not a directory`);
  const ids = readdirSync(root)
    .filter((d) => existsSync(join(root, d, "expected.json")))
    .sort();
  for (const id of ids) {
    if (only.length > 0 && !only.includes(id)) continue;
    const dir = join(root, id);
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(join(dir, "expected.json"), "utf8"));
    } catch (err) {
      formatErrors.push(fmtErr(id, `expected.json does not parse: ${String(err)}`));
      continue;
    }
    const { vector, errors } = validateVector(raw, id, dir);
    for (const m of errors) formatErrors.push(fmtErr(id, m));
    if (vector) vectors.push(vector);
  }
  for (const id of only)
    if (!ids.includes(id)) formatErrors.push(fmtErr(id, `no ${join(root, id, "expected.json")}`));
  return { vectors, formatErrors };
}

function fmtErr(id: string, m: string): Result {
  return {
    vector: id,
    case: "-",
    index: -1,
    status: "FAIL",
    assertion: "format",
    why: "FORMAT.md",
    detail: m
  };
}

function readInput(v: Vector, c: Case): JsonObject {
  if (typeof c.input === "string") {
    const p = resolve(v.dir, c.input);
    const x: unknown = JSON.parse(readFileSync(p, "utf8"));
    if (!isObject(x)) throw new Error(`${p} is not a JSON object`);
    return x;
  }
  if (!isObject(c.input)) throw new Error("input is not an object");
  return c.input;
}

// ---------------------------------------------------------------- implementations

interface Options {
  impl: "proto" | "kernel";
  cmd: string[];
  shapek: string;
  timeout: number;
}

function runCommand(argv: string[], input: JsonObject, timeout: number): Run {
  const [exe, ...args] = argv as [string, ...string[]];
  const t0 = performance.now();
  const r = spawnSync(exe, args, { input: JSON.stringify(input), maxBuffer: 1 << 30, timeout });
  const ms = Math.round(performance.now() - t0);
  if (r.error || r.signal)
    return { kind: "error", error: `${exe} did not finish: ${String(r.error ?? r.signal)}`, ms };
  try {
    const out: unknown = JSON.parse(r.stdout.toString());
    if (!isObject(out)) throw new Error("not an object");
    return { kind: "output", out, exit: r.status, ms, notes: [] };
  } catch {
    return {
      kind: "error",
      error: `output is not a JSON object (exit ${r.status}): ${r.stdout.toString().slice(0, 200)} ${r.stderr.toString().slice(0, 300)}`,
      ms
    };
  }
}

type DrtLib = typeof import("../../trials/DRT/drtlib.ts");
let drt: DrtLib | null = null;

async function runKernel(o: Options, input: JsonObject): Promise<Run> {
  if (!existsSync(o.shapek))
    return {
      kind: "skip",
      reason: `shapek not built at ${o.shapek} (cd experiments/shape-1/kernel && lake build)`
    };
  const head = input.head;
  if (!isObject(head) || !isObject(head.source))
    return {
      kind: "skip",
      reason:
        "the input has no head.source: the converter elaborates shape.source.v1 with the prototype"
    };
  drt ??= (await import(DRTLIB)) as DrtLib;
  const ts = drt.runTs(input);
  if (ts.error)
    return { kind: "skip", reason: `pre-pass failed: ${String(ts.error).slice(0, 300)}` };
  const full = ts.full as { verdict?: string; errors?: { code: string; subject: string }[] };
  const prepassErrors = (full.errors ?? [])
    .map((e) => e.code)
    .filter((c) => !KERNEL_ERROR_CODES.has(c));
  if (full.verdict === "invalid")
    return {
      kind: "skip",
      reason: `the pre-pass finds the input invalid (${prepassErrors.join(", ") || "no error code"}); the kernel takes validated cases only`
    };
  let kcase: { reviews?: unknown[] };
  try {
    kcase = drt.kernelCase(input, ts.full) as { reviews?: unknown[] };
  } catch (err) {
    return { kind: "skip", reason: `converter failed: ${String(err).slice(0, 300)}` };
  }
  const notes: string[] = [];
  const nIn = Array.isArray(input.reviews) ? input.reviews.length : 0;
  const nK = kcase.reviews?.length ?? 0;
  if (nIn > nK)
    notes.push(
      `${nIn - nK} of ${nIn} review lines not bridged (identity not a base actor, or change not listed)`
    );
  if (prepassErrors.length > 0)
    notes.push(
      `pre-pass errors the kernel does not see: ${[...new Set(prepassErrors)].sort().join(", ")}`
    );
  const k = drt.runKernel(o.shapek, kcase, o.timeout) as {
    out?: unknown;
    status?: number;
    error?: string;
    ms: number;
  };
  const ms = Math.round(k.ms);
  if (k.error) return { kind: "error", error: `shapek: ${k.error}`, ms };
  if (!isObject(k.out)) return { kind: "error", error: "shapek output is not a JSON object", ms };
  return {
    kind: "output",
    out: k.out,
    exit: k.status ?? null,
    ms,
    notes,
    filter: { prepassErrors }
  };
}

async function runCase(o: Options, input: JsonObject): Promise<Run> {
  return o.impl === "kernel" ? runKernel(o, input) : runCommand(o.cmd, input, o.timeout);
}

// ---------------------------------------------------------------- evaluation

function describe(a: Assertion): string {
  const sel = Object.keys(a.select).length > 0 ? ` where ${short(a.select, 120)}` : "";
  return `${a.in} ${a.check}${sel} = ${short(a.value, 120)}`;
}

/** Why the kernel route cannot evaluate an assertion, or null when it can. */
function kernelGap(a: Assertion, f: KernelFilter): string | null {
  if (!Object.hasOwn(KERNEL_FIELDS, a.in)) return `shapek does not print "${a.in}"`;
  const fields = KERNEL_FIELDS[a.in] ?? null;
  if (a.in === "verdict")
    return f.prepassErrors.length > 0
      ? `the verdict is not the kernel's alone: the pre-pass raised ${[...new Set(f.prepassErrors)].join(", ")}`
      : null;
  const used = [
    ...Object.keys(a.select),
    ...(a.check === "fields" && isObject(a.value) ? Object.keys(a.value) : [])
  ];
  const missing = [...new Set(used.map((p) => path(p)[0] ?? p))].filter(
    (s) => fields !== null && !fields.has(s)
  );
  if (missing.length > 0) return `shapek does not print ${a.in}.${missing.join(", ")}`;
  if (a.in === "errors") {
    const code = a.select.code;
    if (typeof code === "string" && !KERNEL_ERROR_CODES.has(code))
      return `${code} is raised by the elaborator (pre-pass), not the kernel`;
    if (typeof code !== "string" && f.prepassErrors.length > 0)
      return `the error list is not the kernel's alone: the pre-pass raised ${[...new Set(f.prepassErrors)].join(", ")}`;
  }
  return null;
}

function evaluate(a: Assertion, out: JsonObject): { pass: boolean; detail: string } {
  if (!Object.hasOwn(out, a.in))
    return { pass: false, detail: `section "${a.in}" absent from the output` };
  const sec = out[a.in] as Json;
  if (a.check === "equals") {
    return eq(sec, a.value)
      ? { pass: true, detail: "" }
      : { pass: false, detail: `got ${short(sec)}` };
  }
  if (!Array.isArray(sec))
    return { pass: false, detail: `"${a.in}" is not an array: ${short(sec)}` };
  const selected = sec.filter((el) => meets(el, a.select));
  if (a.check === "count") {
    return selected.length === a.value
      ? { pass: true, detail: "" }
      : {
          pass: false,
          detail: `selected ${selected.length} of ${sec.length}${selected.length > 0 ? `: ${short(selected.map(brief), 300)}` : ""}`
        };
  }
  if (selected.length !== 1)
    return {
      pass: false,
      detail: `selected ${selected.length} of ${sec.length} elements, expected exactly 1${selected.length > 1 ? `: ${short(selected.map(brief), 300)}` : ""}`
    };
  const el = selected[0] as Json;
  const bad: string[] = [];
  for (const [p, want] of Object.entries(a.value as JsonObject)) {
    const g = lookup(el, path(p));
    if (!g.present) bad.push(`${p}: expected ${short(want, 90)}, absent`);
    else if (!eq(g.value, want))
      bad.push(`${p}: expected ${short(want, 90)}, got ${short(g.value, 90)}`);
  }
  return bad.length === 0 ? { pass: true, detail: "" } : { pass: false, detail: bad.join("; ") };
}

/** A short identification of an output element in failure messages. */
function brief(el: Json): Json {
  if (!isObject(el)) return el;
  for (const k of ["key", "obligation", "code", "record", "question", "base"])
    if (Object.hasOwn(el, k)) {
      const b: JsonObject = { [k]: el[k] as Json };
      if (k === "key") b.kind = el.kind ?? null;
      if (k === "code") b.subject = el.subject ?? null;
      return b;
    }
  return el;
}

const VERDICT_EXIT: Record<string, number> = { pass: 0, owed: 0, blocked: 1, invalid: 2 };

async function runAll(
  o: Options,
  vectors: Vector[],
  quiet: boolean,
  log: (s: string) => void
): Promise<{ results: Result[]; runs: Map<string, Run>; warnings: string[] }> {
  const results: Result[] = [];
  const runs = new Map<string, Run>();
  const warnings: string[] = [];
  for (const v of vectors) {
    log(`vector ${v.vector}: ${v.title}  [decides ${v.decides.join(", ")}]`);
    for (const c of v.cases) {
      let run: Run;
      try {
        run = await runCase(o, readInput(v, c));
      } catch (err) {
        run = { kind: "error", error: `input: ${String(err)}`, ms: 0 };
      }
      runs.set(`${v.vector}\u0000${c.case}`, run);
      const head =
        run.kind === "output"
          ? `exit ${run.exit}, ${run.ms} ms`
          : run.kind === "error"
            ? `ERROR after ${run.ms} ms: ${run.error}`
            : `NOT RUN: ${run.reason}`;
      log(`  case ${c.case} (${head})`);
      if (run.kind === "output") {
        for (const n of run.notes) log(`    note: ${n}`);
        const verdict = run.out.verdict;
        if (
          typeof verdict === "string" &&
          run.exit !== null &&
          VERDICT_EXIT[verdict] !== run.exit
        ) {
          const w = `${v.vector}/${c.case}: exit code ${run.exit} does not match verdict ${verdict} (A.12.10.5)`;
          warnings.push(w);
          log(`    WARN ${w}`);
        }
      }
      c.assert.forEach((a, i) => {
        let status: Status;
        let detail = "";
        if (run.kind === "skip") {
          status = "NOT RUN";
          detail = run.reason;
        } else if (run.kind === "error") {
          status = "FAIL";
          detail = run.error;
        } else {
          const gap = run.filter ? kernelGap(a, run.filter) : null;
          if (gap) {
            status = "NOT RUN";
            detail = `kernel route: ${gap}`;
          } else {
            const r = evaluate(a, run.out);
            status = r.pass ? "PASS" : "FAIL";
            detail = r.detail;
          }
        }
        results.push({
          vector: v.vector,
          case: c.case,
          index: i,
          status,
          assertion: describe(a),
          why: a.why,
          detail
        });
        if (!(quiet && status === "PASS") && run.kind !== "error")
          log(
            `    ${status.padEnd(7)} ${describe(a)}${detail ? `\n            ${detail}` : ""}\n            why: ${a.why}`
          );
      });
      if (run.kind === "error") log(`    FAIL    all ${c.assert.length} assertions: ${run.error}`);
    }
  }
  return { results, runs, warnings };
}

// ---------------------------------------------------------------- self-test

function mutateValue(v: Json): Json {
  if (typeof v === "string") return `${v}~mutant`;
  if (typeof v === "number") return v + 1;
  if (typeof v === "boolean") return !v;
  if (v === null) return "~mutant";
  if (Array.isArray(v)) return [...v, "~mutant"];
  return { ...v, "~mutant": true };
}

function mutate(a: Assertion): Assertion {
  if (a.check === "count") return { ...a, value: (a.value as number) + 1 };
  if (a.check === "fields") {
    const obj = { ...(a.value as JsonObject) };
    const k = Object.keys(obj)[0] as string;
    obj[k] = mutateValue(obj[k] as Json);
    return { ...a, value: obj };
  }
  return { ...a, value: mutateValue(a.value) };
}

const MALFORMED: [string, unknown][] = [
  ["unknown section", { in: "witnesses", select: {}, check: "count", value: 0, why: "x" }],
  ["missing why", { in: "verdict", select: {}, check: "equals", value: "pass" }],
  ["empty why", { in: "verdict", select: {}, check: "equals", value: "pass", why: " " }],
  ["extra key", { in: "verdict", select: {}, check: "equals", value: "pass", why: "x", note: 1 }],
  [
    "select on a scalar section",
    { in: "verdict", select: { a: 1 }, check: "equals", value: "pass", why: "x" }
  ],
  [
    "equals on an array section",
    { in: "obligations", select: {}, check: "equals", value: [], why: "x" }
  ],
  ["count on an object section", { in: "budget", select: {}, check: "count", value: 0, why: "x" }],
  ["negative count", { in: "errors", select: {}, check: "count", value: -1, why: "x" }],
  ["fractional count", { in: "errors", select: {}, check: "count", value: 1.5, why: "x" }],
  ["empty fields", { in: "obligations", select: {}, check: "fields", value: {}, why: "x" }],
  ["unknown check", { in: "errors", select: {}, check: "contains", value: 0, why: "x" }]
];

function selfTestFormat(log: (s: string) => void): number {
  let failures = 0;
  for (const [name, a] of MALFORMED) {
    const errs = validateAssertion(a);
    if (errs.length === 0) {
      failures += 1;
      log(`  FAIL    malformed assertion accepted: ${name}`);
    } else log(`  PASS    malformed assertion rejected: ${name} (${errs[0]})`);
  }
  const good = { in: "verdict", select: {}, check: "equals", value: "pass", why: "x" };
  const vecs: [string, unknown][] = [
    [
      "vector id differs from the directory",
      {
        vector: "other",
        title: "t",
        decides: "A.0",
        cases: [{ case: "c", input: {}, assert: [good] }]
      }
    ],
    ["no decides", { vector: "v", title: "t", cases: [{ case: "c", input: {}, assert: [good] }] }],
    ["no cases", { vector: "v", title: "t", decides: "A.0", cases: [] }],
    [
      "duplicate case names",
      {
        vector: "v",
        title: "t",
        decides: ["A.0"],
        cases: [
          { case: "c", input: {}, assert: [good] },
          { case: "c", input: {}, assert: [good] }
        ]
      }
    ],
    [
      "input neither object nor file name",
      { vector: "v", title: "t", decides: "A.0", cases: [{ case: "c", input: 3, assert: [good] }] }
    ],
    [
      "empty assert list",
      { vector: "v", title: "t", decides: "A.0", cases: [{ case: "c", input: {}, assert: [] }] }
    ]
  ];
  for (const [name, raw] of vecs) {
    const { errors } = validateVector(raw, "v", "/nonexistent");
    if (errors.length === 0) {
      failures += 1;
      log(`  FAIL    malformed vector accepted: ${name}`);
    } else log(`  PASS    malformed vector rejected: ${name} (${errors[0]})`);
  }
  const ok = validateVector(
    { vector: "v", title: "t", decides: "A.0", cases: [{ case: "c", input: {}, assert: [good] }] },
    "v",
    "/x"
  );
  if (ok.errors.length > 0) {
    failures += 1;
    log(`  FAIL    well-formed vector rejected: ${ok.errors[0]}`);
  } else log("  PASS    well-formed vector accepted");
  return failures;
}

// ---------------------------------------------------------------- main

function usage(msg: string): never {
  process.stderr.write(`check.ts: ${msg}\n`);
  process.stderr.write(
    'usage: bun experiments/shape-1/m0/vectors/check.ts [--impl proto|kernel] [--root DIR] [--vector ID]... [--cmd "ARGV"] [--shapek PATH] [--timeout MS] [--strict] [--quiet] [--json OUT] [--self-test]\n'
  );
  process.exit(2);
}

async function main(argv: string[]): Promise<number> {
  let root = HERE;
  const only: string[] = [];
  let impl: Options["impl"] = "proto";
  let cmd: string[] = [process.execPath, PROTO_CLI, "check", "--input", "-", "--core"];
  let shapek = DEFAULT_SHAPEK;
  let timeout = 600_000;
  let strict = false;
  let quiet = false;
  let selfTest = false;
  let jsonOut: string | null = null;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i] as string;
    const next = (): string => {
      const v = argv[i + 1];
      if (v === undefined) usage(`${a} needs a value`);
      i += 1;
      return v;
    };
    if (a === "--root") root = resolve(next());
    else if (a === "--vector") only.push(next());
    else if (a === "--impl") {
      const v = next();
      if (v !== "proto" && v !== "kernel") usage(`--impl must be proto or kernel, got ${v}`);
      impl = v;
    } else if (a === "--cmd") cmd = next().split(/\s+/).filter(Boolean);
    else if (a === "--shapek") shapek = resolve(next());
    else if (a === "--timeout") timeout = Number(next());
    else if (a === "--strict") strict = true;
    else if (a === "--quiet") quiet = true;
    else if (a === "--self-test") selfTest = true;
    else if (a === "--json") jsonOut = resolve(next());
    else usage(`unknown argument ${a}`);
  }
  if (cmd.length === 0) usage("--cmd is empty");
  if (!Number.isFinite(timeout) || timeout <= 0)
    usage("--timeout must be a positive number of milliseconds");
  const o: Options = { impl, cmd, shapek, timeout };
  const log = (s: string): void => {
    process.stdout.write(`${s}\n`);
  };
  log(
    impl === "kernel"
      ? `implementation: kernel ${shapek}, via the DRT pre-pass ${DRTLIB} (prototype elaboration, validation, authors*, cells)`
      : `implementation: ${cmd.join(" ")}  (input on stdin)`
  );
  log(`vectors: ${root}`);
  let loaded: ReturnType<typeof loadVectors>;
  try {
    loaded = loadVectors(root, only);
  } catch (err) {
    usage(String(err));
  }
  for (const f of loaded.formatErrors) log(`FORMAT  ${f.vector}: ${f.detail}`);
  const { results, runs, warnings } = await runAll(o, loaded.vectors, quiet, log);
  const all = [...loaded.formatErrors, ...results];
  const count = (s: Status): number => all.filter((r) => r.status === s).length;
  const nCases = loaded.vectors.reduce((n, v) => n + v.cases.length, 0);
  const notRunCases = [...runs.entries()].filter(([, r]) => r.kind === "skip");
  log("");
  log(
    `summary: ${loaded.vectors.length} vectors, ${nCases} cases, ${results.length} assertions: ${count("PASS")} passed, ${results.filter((r) => r.status === "FAIL").length} failed, ${count("NOT RUN")} not run; ${loaded.formatErrors.length} format errors; ${warnings.length} exit-code warnings`
  );
  if (impl === "kernel") {
    log(
      `kernel route: ${notRunCases.length} of ${nCases} cases cannot run at all${notRunCases.length ? ":" : ""}`
    );
    for (const [k, r] of notRunCases)
      if (r.kind === "skip") log(`  ${k.replace("\u0000", "/")}: ${r.reason}`);
    const partial = new Map<string, number>();
    for (const r of results)
      if (r.status === "NOT RUN" && !notRunCases.some(([k]) => k === `${r.vector}\u0000${r.case}`))
        partial.set(`${r.vector}/${r.case}`, (partial.get(`${r.vector}/${r.case}`) ?? 0) + 1);
    if (partial.size > 0) {
      log(`kernel route: ${partial.size} cases run with assertions it cannot evaluate:`);
      for (const [k, n] of partial) log(`  ${k}: ${n} assertions not run`);
    }
  }
  let failed = all.some((r) => r.status === "FAIL") || (strict && count("NOT RUN") > 0);
  if (loaded.vectors.length === 0 && loaded.formatErrors.length === 0) {
    log(`no vectors under ${root}: nothing was checked`);
    failed = true;
  }
  if (selfTest) {
    log("");
    log("self-test: mutants (each must fail)");
    let survived = 0;
    let killed = 0;
    for (const v of loaded.vectors)
      for (const c of v.cases) {
        const run = runs.get(`${v.vector}\u0000${c.case}`);
        if (!run || run.kind !== "output") continue;
        for (const a of c.assert) {
          if (run.filter && kernelGap(a, run.filter)) continue;
          const m = mutate(a);
          const r = evaluate(m, run.out);
          if (r.pass) {
            survived += 1;
            log(`  FAIL    mutant passed: ${v.vector}/${c.case}: ${describe(m)}`);
          } else killed += 1;
        }
      }
    log(`  ${killed} mutants failed as required, ${survived} passed`);
    log("self-test: malformed vectors (each must be rejected)");
    const formatFailures = selfTestFormat(log);
    // NOT RUN assertions (kernel route) are outside the self-test; --strict makes them fail it
    const nPass = count("PASS");
    const nNotRun = count("NOT RUN");
    const originalsPass =
      nPass > 0 &&
      results.every((r) => r.status !== "FAIL") &&
      loaded.formatErrors.length === 0 &&
      !(strict && nNotRun > 0);
    log(
      `self-test: ${nPass} assertions pass, ${results.filter((r) => r.status === "FAIL").length} fail, ${nNotRun} not run; ${survived} surviving mutants; ${formatFailures} malformed inputs accepted`
    );
    failed = !originalsPass || survived > 0 || formatFailures > 0;
  }
  if (jsonOut) {
    writeFileSync(
      jsonOut,
      `${JSON.stringify(
        {
          implementation: impl === "kernel" ? { kernel: shapek } : { cmd },
          root,
          results: all,
          warnings,
          notRunCases: notRunCases.map(([k, r]) => ({
            case: k.replace("\u0000", "/"),
            reason: r.kind === "skip" ? r.reason : ""
          })),
          failed
        },
        null,
        1
      )}\n`
    );
    log(`wrote ${jsonOut}`);
  }
  log(failed ? "RESULT: FAIL" : "RESULT: PASS");
  return failed ? 1 : 0;
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
