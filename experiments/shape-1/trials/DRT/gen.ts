// @ts-nocheck
// DRT random case generator (one-off experiment code). genCase(seed) builds a prototype CheckInput
// within the Lean kernel's fragment: one module over std, persons/teams/agents, 2-3 resources bound
// to pg.table/ts.call codes, 2-3 components (+ an optional boundary) with fixed paths and unit
// bindings (so no identity changes attribution between base and head: L6 never applies), effect,
// hatch, edge, path and cycle forbids, relations, summaries, schema and informal laws, providers,
// policy and exceptions; a head made by 0-5 random edit operators; base and head manifests with
// digest moves, new and deleted identities and hatch markers; signed observations, tests and claim
// judgments (fresh, stale, partial, base-revision, expired); optional committer time and authors.
// Out-of-fragment constructs the generator avoids by construction (kernel interface "Open problems"):
// renames/was, path or binding changes (L6), unreadable base (L0), absence-sound call or edge
// observers (lower-bound refutation) except in the `refute` profile, unmapped resource codes and
// undeclared verbs in facts (vocabulary coverage), facts at identities missing from M_h (relocation),
// equivalence records, ordered-template strength, Bounded<> templates, equal-specificity globs.
import { label } from "../../proto/src/jcs.ts";
import { elaborate } from "../../proto/src/elaborate.ts";
import { makeStatement, scopeRoot, signStatement, signerFromSeed } from "../../proto/src/records.ts";
import { manifest } from "../../proto/examples/fixtures.ts";

export function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const KEYCACHE = new Map();
function key(name) {
  let k = KEYCACHE.get(name);
  if (!k) {
    let h = 0;
    for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    k = signerFromSeed((h.toString(16) + "a5".repeat(32)).slice(0, 64));
    KEYCACHE.set(name, k);
  }
  return k;
}

const SCHEME = { ts: { file: "ts.file.v1", own: "ts.own.v2", unit: "ts.unit.v2" }, raw: { file: "raw.file.v1", own: "raw.own.v1" }, pkgjson: { file: "pkgjson.file.v1", own: "pkgjson.own.v1", unit: "pkgjson.unit.v1" } };
function citeOf(id, projection, digest) {
  const lang = id.split(":")[0];
  return { id, projection, scheme: SCHEME[lang]?.[projection] ?? `${lang}.${projection}.v1`, digest };
}

const PERSONS = ["alice", "bob", "carol", "dave"];
const NOW = "2026-10-25T12:00:00Z";
const NOW_S = Date.UTC(2026, 9, 25, 12, 0, 0) / 1000;
const CHANGE = "github:acme/sys#1";
const BASE_REV = "b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0";
const HEAD_REV = "1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e";

const clone = (x) => JSON.parse(JSON.stringify(x));
function isoDay(daysFromNow) {
  const d = new Date((NOW_S + daysFromNow * 86400) * 1000);
  return d.toISOString().slice(0, 10);
}
function isoTime(secondsFromNow) {
  return new Date((NOW_S + secondsFromNow) * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function genCase(seed, profile = "fragment") {
  const clean = profile === "clean";
  const rnd = mulberry32(clean ? seed * 977 + 13 : seed);
  const chance = (p) => rnd() < p;
  const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
  const subset = (xs, p) => xs.filter(() => chance(p));
  const someOf = (xs, min = 1) => {
    const s = subset(xs, 0.5);
    while (s.length < min && xs.length > 0) {
      const x = pick(xs);
      if (!s.includes(x)) s.push(x);
    }
    return s;
  };
  const tierP = () => pick(["low", "normal", "normal", "critical", "critical", "final"]);
  const meta = { seed, profile, ops: [], features: [] };
  const feat = (f) => meta.features.push(f);

  // ---- vocabulary -------------------------------------------------------------------------------
  const agentMember = chance(0.35);
  const teams = {
    Platform: someOf(PERSONS, 2),
    Store: [...someOf(PERSONS, 1), ...(agentMember ? ["bot"] : [])],
    Ops: [pick(PERSONS)]
  };
  if (agentMember) feat("agent-in-team");
  const botOperator = pick(["alice", "bob", "Store", "Platform"]);
  const owners = ["Platform", "Store", "Ops", "alice", "bob"];
  const actors = [
    ...PERSONS.map((p) => ({ decl: "actor", name: p, kind: "person", identities: [`github("${p}")`, key(`p-${p}`).identity] })),
    ...Object.entries(teams).map(([n, ms]) => ({ decl: "actor", name: n, kind: "team", members: ms })),
    { decl: "actor", name: "bot", kind: "agent", operator: botOperator, identities: ['github("bot[bot]")', key("a-bot").identity] }
  ];
  const RES = [
    { name: "Events", code: 'pg.table("events")', spell: ['pg.table("events")', 'pg.table("public.events")', 'pg.table("EVENTS")'] },
    { name: "Users", code: 'pg.table("users")', spell: ['pg.table("users")', 'pg.table("public.Users")'] },
    { name: "Clock", code: 'ts.call("Date.now")', spell: ['ts.call("Date.now")'] }
  ].slice(0, int(2, 3));
  const customVerb = chance(0.2);
  const VERBS = ["Read", "Write", "Append", "Update", "HardDelete", "Truncate", ...(customVerb ? ["Purge"] : [])];
  const atoms = RES.flatMap((r) => VERBS.map((v) => `${v}<${r.name}>`));
  const nComp = int(2, 3);
  const COMPS = ["C1", "C2", "C3"].slice(0, nComp);
  const hasHost = chance(0.35);
  const compPaths = { C1: ["src/c1/**/*.ts"], C2: ["src/c2/**/*.ts"], C3: [pick(["src/c3/**", "src/c3/*.ts"])], Host: ["src/host/**/*.ts"] };

  // ---- code -------------------------------------------------------------------------------------
  // id -> { ver: {own, unit, file}, markers, kind }
  let fn = 0;
  const code = new Map();
  const files = new Map(); // file id -> comp|null
  const addFile = (path, comp) => {
    const id = `ts:${path}`;
    files.set(id, comp);
    code.set(id, { file: 0, own: 0, unit: null, markers: null, parent: null });
    const n = int(1, 2);
    const fns = [];
    for (let i = 0; i < n; i += 1) {
      fn += 1;
      const fid = `${id}#f${fn}`;
      code.set(fid, { file: null, own: 0, unit: 0, markers: null, parent: id });
      fns.push(fid);
    }
    return fns;
  };
  const compFns = {};
  for (const c of [...COMPS, ...(hasHost ? ["Host"] : [])]) {
    compFns[c] = [];
    const nf = chance(0.3) ? 2 : 1;
    for (let i = 0; i < nf; i += 1) {
      const dir = c === "Host" ? "host" : c.toLowerCase();
      compFns[c].push(...addFile(`src/${dir}/${"ab"[i]}.ts`, c));
    }
  }
  const ungovFns = addFile("scripts/tool.ts", null);
  code.set("raw:tools/run.sh", { file: 0, own: 0, unit: null, markers: null, parent: null, executable: true });
  code.set("raw:README.md", { file: 0, own: 0, unit: null, markers: null, parent: null });
  code.set("pkgjson:package.json", { file: 0, own: 0, unit: null, markers: null, parent: null });
  code.set("ts:test/sys.test.ts", { file: 0, own: 0, unit: null, markers: null, parent: null });
  for (const [id, info] of code) if (id.startsWith("ts:") && chance(0.08)) info.markers = { ts_ignore: int(1, 2) };

  // ---- units --------------------------------------------------------------------------------------
  const units = {}; // comp -> [{name, fid, explicit}]
  for (const c of Object.keys(compFns)) {
    units[c] = [];
    for (const fid of compFns[c]) if (chance(0.5)) units[c].push({ name: fid.split("#")[1], fid, explicit: chance(0.85) });
  }
  const allUnits = Object.entries(units).flatMap(([c, us]) => us.map((u) => ({ ...u, comp: c, q: `${c}.${u.name}` })));

  // ---- base shape -----------------------------------------------------------------------------------
  const summaryAtoms = () => someOf(atoms.filter(() => chance(0.3)), 0).slice(0, 2);
  const grantsFor = () => (chance(0.3) ? undefined : chance(0.12) ? "none" : someOf(atoms.filter(() => chance(0.25)), 1).slice(0, 3));
  const compDecl = (c) => {
    const d = { decl: "component", name: c, owner: pick(owners), tier: tierP(), paths: compPaths[c] };
    const g = grantsFor();
    if (g !== undefined) d.grants = g;
    if (c === "Host") {
      d.boundary = true;
      d.allows = chance(0.6) ? ["ts_ignore"] : [];
      if (chance(0.4)) d.assumes = [{ id: "HostTrusted", text: "host input is validated" }];
      if (chance(0.3)) d.attach = [{ name: "ReviewedSurface" }];
    }
    if (chance(0.15)) d.relationsComplete = ["calls"];
    d.units = units[c].map((u) => {
      const ud = { name: u.name };
      if (u.explicit) ud.bind = `ts("${u.fid.slice(3)}")`;
      if (chance(0.15)) ud.tier = tierP();
      const r = rnd();
      if (r < 0.45) ud.effects = { mode: "complete", atoms: summaryAtoms().map((a) => ({ atom: a })) };
      if (ud.effects && chance(0.08)) {
        const other = allUnits.find((x) => x.comp === c && x.name !== u.name) ?? allUnits.find((x) => x.name !== u.name);
        if (other && ud.effects.atoms.length > 0) {
          ud.effects.atoms[0] = { ...ud.effects.atoms[0], via: other.comp === c ? other.name : other.q };
          feat("via");
        }
      }
      else if (r < 0.6) ud.effects = { mode: "partial", atoms: someOf(atoms.filter(() => chance(0.3)), 1).slice(0, 2).map((a) => ({ atom: a })) };
      if (chance(0.12)) {
        ud.attach = [{ name: "RefactorSensitive" }];
        feat("refactor-sensitive");
      }
      return ud;
    });
    return d;
  };
  const decls = [];
  const notes = [];
  decls.push(...actors);
  if (customVerb) decls.push({ decl: "effect", name: "Purge", implies: ["HardDelete"] });
  for (const r of RES) {
    const d = { decl: "resource", name: r.name, owner: pick(owners), tier: tierP(), bind: [r.code] };
    if (chance(0.3)) d.attach = [{ name: "AppendOnly" }];
    decls.push(d);
  }
  for (const c of Object.keys(compFns)) decls.push(compDecl(c));
  const unitSel = () => pick(["*", "ungoverned", ...COMPS.map((c) => `component ${c}`), ...allUnits.map((u) => `unit ${u.q}`)]);
  const nodeSel = () => pick(["*", ...COMPS.map((c) => `component ${c}`), ...(chance(0.2) ? RES.map((r) => `resource ${r.name}`) : [])]);
  let ruleN = 0;
  const effectRule = () => {
    ruleN += 1;
    const cl = { forbid: "effect", atom: pick(atoms) };
    if (chance(0.6)) cl.within = [unitSel()];
    if (chance(0.25)) cl.except = [unitSel()];
    if (chance(0.15)) cl.final = true;
    const d = { decl: "rule", name: `R${ruleN}`, clauses: [cl] };
    if (chance(0.5)) d.tier = tierP();
    if (chance(0.5)) d.owner = pick(owners);
    return d;
  };
  for (let i = int(0, 3); i > 0; i -= 1) decls.push(effectRule());
  if (chance(0.25)) {
    decls.push(chance(0.5) ? { decl: "rule", name: "NoHatches", template: { name: "HatchesStayAtBoundaries", args: [] }, tier: tierP() } : { decl: "rule", name: "NoHatches", clauses: [{ forbid: "hatch", kinds: ["*"] }], tier: tierP() });
    feat("hatch-rule");
  }
  let relN = 0;
  const relation = () => {
    relN += 1;
    const a = pick(COMPS);
    const b = pick(COMPS.filter((x) => x !== a));
    return { decl: "relation", name: `Rel${relN}`, kind: chance(0.25) ? "data_flow" : "calls", connects: [a, b] };
  };
  for (let i = int(0, 2); i > 0; i -= 1) decls.push(relation());
  const structRule = () => {
    ruleN += 1;
    const r = rnd();
    let cl;
    const kinds = chance(0.2) ? ["data_flow"] : chance(0.15) ? ["calls", "data_flow"] : ["calls"];
    if (r < 0.35) cl = { forbid: "edge", kind: kinds[0], from: [nodeSel()], to: [nodeSel()] };
    else if (r < 0.65) cl = { forbid: "path", from: [nodeSel()], to: [nodeSel()], over: kinds };
    else cl = { forbid: "cycle", over: kinds };
    if (cl.forbid === "edge" && chance(0.3)) cl.exceptTo = [nodeSel()];
    if (cl.forbid === "path" && chance(0.3)) cl.exceptVia = [nodeSel()];
    const d = { decl: "rule", name: `S${ruleN}`, clauses: [cl] };
    if (chance(0.5)) d.tier = tierP();
    return d;
  };
  for (let i = int(0, 2); i > 0; i -= 1) decls.push(structRule());
  // laws
  const provs = {};
  const hasProver = chance(0.25);
  let lawN = 0;
  const lawDecl = () => {
    lawN += 1;
    const r = rnd();
    const ev = {};
    if (chance(0.5)) ev.level = pick(["declared", "tested", "tested", ...(hasProver ? ["proven"] : [])]);
    if (chance(0.25)) ev.orJudged = true;
    if (chance(0.25)) ev.by = ["tests"];
    if (r < 0.4 && allUnits.length > 0) {
      const u = pick(allUnits);
      return { decl: "law", name: `L${lawN}`, template: { name: "Deterministic", args: [u.q] }, tier: chance(0.6) ? tierP() : undefined, evidence: ev };
    }
    if (r < 0.65) return { decl: "law", name: `L${lawN}`, template: { name: "HistoryPreserved", args: [pick(RES).name] }, on: [`component ${pick(COMPS)}`], tier: chance(0.6) ? tierP() : undefined, evidence: ev };
    const on = chance(0.5) && allUnits.length > 0 ? `unit ${pick(allUnits).q}` : `component ${pick(COMPS)}`;
    const at = chance(0.2) ? "trust" : "unit";
    return { decl: "law", name: `L${lawN}`, on: [on], informal: `invariant ${lawN} holds`, tier: chance(0.6) ? tierP() : undefined, evidence: { judged: true, at, ...(chance(0.15) ? { by: [pick(PERSONS)] } : {}) } };
  };
  for (let i = int(0, 3); i > 0; i -= 1) decls.push(lawDecl());
  // providers
  provs.eff = {
    decl: "provider",
    name: "eff",
    produces: ["observation"],
    observes: ['effect(pg.table("*"))', ...(chance(0.7) ? ['effect(ts.call("*"))'] : [])],
    sound: someOf(["presence", "absence"], 0),
    depsComplete: chance(0.3),
    identity: chance(0.75) ? key("prov-eff").identity : undefined,
    implementation: chance(0.5) ? { digest: `sha256:${"e".repeat(64)}` } : { paths: ["tools/run.sh"] }
  };
  provs.calls = {
    decl: "provider",
    name: "calls",
    produces: ["observation"],
    observes: ["call(ts)", ...(chance(0.4) ? ["edge(data_flow)"] : [])],
    sound: (profile === "refute" || clean) && chance(0.5) ? ["presence", "absence"] : chance(0.5) ? ["presence"] : [],
    identity: chance(0.6) ? key("prov-calls").identity : undefined,
    implementation: { digest: `sha256:${"c".repeat(64)}` }
  };
  provs.tests = {
    decl: "provider",
    name: "tests",
    produces: ["test"],
    decides: ["template Deterministic", "template HistoryPreserved"],
    sound: chance(0.85) ? ["presence"] : [],
    depsComplete: chance(0.2),
    identity: chance(0.7) ? key("prov-tests").identity : undefined,
    implementation: { paths: ["package.json"] }
  };
  if (chance(0.3)) provs.tests.trusts = [["z3", "4.12.5"]];
  if (hasProver) {
    provs.prover = { decl: "provider", name: "prover", produces: ["proof"], decides: ["template Deterministic"], sound: ["presence"], depsComplete: chance(0.5), identity: key("prov-prover").identity, implementation: { digest: `sha256:${"d".repeat(64)}` }, trusts: [["z3", "4.12.5"]] };
    feat("prover");
  }
  const provNames = Object.keys(provs).filter((n) => n === "tests" || n === "prover" || chance(0.85));
  for (const n of provNames) {
    const p = provs[n];
    if (!p.identity) delete p.identity;
    decls.push(p);
  }
  if (chance(0.3)) decls.push({ decl: "provider", name: "relay", produces: ["judgment"], identity: key("prov-relay").identity, implementation: { digest: `sha256:${"f".repeat(64)}` } });
  // policy
  if (chance(0.45)) {
    const tp = () => {
      const t = {};
      if (chance(0.5)) t.floor = pick(["declared", "tested"]);
      if (chance(0.6)) t.blocks = subset(["unestablished", "coverage", "latent-loosening"], 0.5);
      if (chance(0.4)) t.maxAge = pick([30, 90, 365]);
      if (chance(0.6)) t.judges = someOf(["owner", "agents", "Platform", "dave"], 1);
      return t;
    };
    const pol = { decl: "policy", name: "Pol", tiers: { low: tp(), normal: tp(), critical: tp() } };
    if (chance(0.2)) pol.budget = int(0, 3);
    decls.push(pol);
    feat("policy");
  }
  decls.unshift({ decl: "shape", name: "Sys", owner: chance(0.85) ? "Platform" : "Store", ...(decls.some((d) => d.decl === "policy") ? { policy: "Pol" } : {}) });
  // notes for RefactorSensitive (requires note memory)
  for (const c of Object.keys(compFns))
    for (const u of units[c]) notes.push({ decl: "note", name: `N_${c}_${u.name}`, kind: "memory", about: [`unit ${c}.${u.name}`] });
  decls.push(...notes);
  // exceptions (head only matter; generated on the base and kept/mutated)
  let excN = 0;
  const exceptionDecl = () => {
    excN += 1;
    const tgts = [
      ...decls.filter((d) => d.decl === "rule").map((d) => `rule ${d.name}`),
      ...decls.filter((d) => d.decl === "law").map((d) => `law ${d.name}`),
      ...COMPS.map((c) => `component ${c}`),
      ...COMPS.map((c) => `authority ${c}`),
      ...decls.filter((d) => d.decl === "relation").map((d) => `relation ${d.name}`)
    ];
    const d = { decl: "exception", name: `X${excN}`, target: pick(tgts), owner: pick(owners), expires: isoDay(pick(clean ? [-3, 10, 51, 200, 300] : [-3, 10, 51, 200, 360, 400])) };
    if (chance(0.5)) d.waives = someOf(["contradiction", "unestablished"], 1);
    if (chance(0.4) && !d.target.startsWith("law ")) {
      const fid = pick([...Object.values(compFns).flat(), ...ungovFns]);
      d.for = [pick([`component ${pick(COMPS)}`, `code ts("${fid.slice(3)}")`, "ungoverned", ...(allUnits.length ? [`unit ${pick(allUnits).q}`] : []), `pair ${pick(COMPS)} -> ${pick(COMPS)}`])];
    }
    if (!clean && chance(0.05)) d.for = [`component ${pick(COMPS)}`]; // law exception with for: E-exception
    return d;
  };
  for (let i = int(0, 2); i > 0; i -= 1) decls.push(exceptionDecl());

  const baseSrc = { v: "shape.source.v1", modules: [{ module: "m", imports: ["std"], decls }] };

  // ---- head shape: random edit operators ------------------------------------------------------------
  const mode = chance(0.12) ? "audit" : "change";
  const head = clone(baseSrc);
  const hd = head.modules[0].decls;
  const byDecl = (k) => hd.filter((d) => d.decl === k);
  const ops = {
    tier: () => {
      const xs = [...byDecl("component"), ...byDecl("resource"), ...byDecl("rule"), ...byDecl("law"), ...byDecl("component").flatMap((c) => c.units ?? [])];
      const x = pick(xs);
      if (x) x.tier = tierP();
    },
    owner: () => {
      const x = pick([...byDecl("component"), ...byDecl("resource"), ...byDecl("rule"), ...byDecl("law")]);
      if (x) x.owner = pick(owners);
    },
    grants: () => {
      const c = pick(byDecl("component"));
      const r = rnd();
      if (r < 0.3) delete c.grants;
      else if (r < 0.4) c.grants = "none";
      else {
        const g = Array.isArray(c.grants) ? [...c.grants] : [];
        if (chance(0.6) || g.length === 0) g.push(pick(atoms));
        else g.splice(int(0, g.length - 1), 1);
        c.grants = [...new Set(g)];
        if (c.grants.length === 0) c.grants = "none";
      }
    },
    forbid: () => {
      const rules = byDecl("rule").filter((d) => d.clauses?.[0]?.forbid === "effect");
      const r = rnd();
      if (r < 0.3 && rules.length > 0) hd.splice(hd.indexOf(pick(rules)), 1);
      else if (r < 0.55 || rules.length === 0) hd.push(effectRule());
      else {
        const cl = pick(rules).clauses[0];
        const s = rnd();
        if (s < 0.3) cl.atom = pick(atoms);
        else if (s < 0.5) cl.final = !cl.final;
        else if (s < 0.75) cl.within = chance(0.3) ? undefined : [unitSel()];
        else cl.except = chance(0.5) ? undefined : [unitSel()];
      }
    },
    appendOnly: () => {
      const r = pick(byDecl("resource"));
      r.attach = r.attach?.length ? [] : [{ name: "AppendOnly" }];
    },
    law: () => {
      const laws = byDecl("law");
      const r = rnd();
      if (r < 0.3 && laws.length > 0) hd.splice(hd.indexOf(pick(laws)), 1);
      else if (r < 0.5 || laws.length === 0) hd.push(lawDecl());
      else {
        const l = pick(laws);
        l.evidence = { ...(l.evidence ?? {}) };
        const s = rnd();
        if (s < 0.4) l.evidence.level = pick(["declared", "tested"]);
        else if (s < 0.7) l.evidence.orJudged = !l.evidence.orJudged;
        else l.evidence.by = l.evidence.by ? undefined : ["tests"];
        if (l.informal) l.evidence = { judged: true, at: l.evidence.at ?? "unit" };
      }
    },
    summary: () => {
      const us = byDecl("component").flatMap((c) => c.units ?? []);
      const u = pick(us);
      if (!u) return;
      const r = rnd();
      if (r < 0.25) delete u.effects;
      else if (r < 0.5) u.effects = { mode: pick(["complete", "partial"]), atoms: summaryAtoms().map((a) => ({ atom: a })) };
      else if (u.effects) {
        const as = [...(u.effects.atoms ?? [])];
        if (chance(0.5) || as.length === 0) as.push({ atom: pick(atoms) });
        else as.splice(int(0, as.length - 1), 1);
        u.effects = { ...u.effects, atoms: as };
      } else u.effects = { mode: "complete", atoms: [{ atom: pick(atoms) }] };
    },
    structure: () => {
      const r = rnd();
      const rels = byDecl("relation");
      const srules = byDecl("rule").filter((d) => ["edge", "path", "cycle"].includes(d.clauses?.[0]?.forbid));
      if (r < 0.25) hd.push(relation());
      else if (r < 0.4 && rels.length > 0) hd.splice(hd.indexOf(pick(rels)), 1);
      else if (r < 0.6) hd.push(structRule());
      else if (r < 0.75 && srules.length > 0) hd.splice(hd.indexOf(pick(srules)), 1);
      else if (srules.length > 0) {
        const cl = pick(srules).clauses[0];
        if (cl.forbid === "edge") cl.exceptTo = cl.exceptTo ? undefined : [nodeSel()];
        else if (cl.forbid === "path") cl.exceptVia = cl.exceptVia ? undefined : [nodeSel()];
        else cl.over = ["calls"];
      } else {
        const c = pick(byDecl("component"));
        c.relationsComplete = c.relationsComplete ? undefined : ["calls"];
      }
    },
    provider: () => {
      const ps = byDecl("provider");
      const p = pick(ps);
      if (!p) return;
      const r = rnd();
      if (r < 0.15 && p.name !== "tests") hd.splice(hd.indexOf(p), 1);
      else if (r < 0.4) p.sound = someOf(p.name === "calls" ? ["presence"] : ["presence", "absence"], 0);
      else if (r < 0.55) p.depsComplete = !p.depsComplete;
      else if (r < 0.7) p.implementation = { digest: `sha256:${"9".repeat(64)}` };
      else if (r < 0.85 && p.observes) p.observes = p.observes.length > 1 ? [p.observes[0]] : [...p.observes, 'effect(ts.call("*"))'].filter((x, i, a) => a.indexOf(x) === i);
      else if (p.decides) p.decides = p.decides.length > 1 ? [p.decides[0]] : ["template Deterministic", "template HistoryPreserved"];
    },
    policy: () => {
      let pol = byDecl("policy")[0];
      if (!pol) {
        pol = { decl: "policy", name: "Pol", tiers: { low: {}, normal: {}, critical: {} } };
        hd.push(pol);
        byDecl("shape")[0].policy = "Pol";
      }
      const t = pol.tiers[pick(["low", "normal", "critical"])];
      const r = rnd();
      if (r < 0.3) t.blocks = subset(["unestablished", "coverage", "latent-loosening"], 0.5);
      else if (r < 0.5) t.maxAge = pick([30, 90, 365, 1000]);
      else if (r < 0.7) t.floor = pick(["declared", "tested"]);
      else if (r < 0.9) t.judges = someOf(["owner", "agents", "Platform", "dave"], 1);
      else pol.budget = int(0, 3);
    },
    actor: () => {
      const t = pick(byDecl("actor").filter((a) => a.kind === "team"));
      const m = pick(PERSONS);
      if (t.members.includes(m) && t.members.length > 1) t.members = t.members.filter((x) => x !== m);
      else t.members = [...new Set([...t.members, m])];
    },
    exception: () => {
      const xs = byDecl("exception");
      if (xs.length > 0 && chance(0.4)) hd.splice(hd.indexOf(pick(xs)), 1);
      else hd.push(exceptionDecl());
    },
    boundary: () => {
      const b = byDecl("component").find((c) => c.boundary);
      if (!b) return;
      if (chance(0.5)) b.allows = b.allows?.length ? [] : ["ts_ignore"];
      else b.assumes = b.assumes?.length ? [] : [{ id: "HostTrusted", text: "host input is validated" }];
    },
    addUnit: () => {
      const c = pick(Object.keys(compFns));
      const free = compFns[c].filter((f) => !units[c].some((u) => u.fid === f));
      if (free.length === 0) return;
      const fid = pick(free);
      const cd = byDecl("component").find((d) => d.name === c);
      cd.units = [...(cd.units ?? []), { name: fid.split("#")[1], ...(chance(0.85) ? { bind: `ts("${fid.slice(3)}")` } : {}), effects: chance(0.5) ? { mode: "complete", atoms: summaryAtoms().map((a) => ({ atom: a })) } : undefined }];
    }
  };
  const opNames = Object.keys(ops);
  if (mode === "change") {
    const k = pick([0, 1, 1, 2, 2, 3, 4, 5]);
    for (let i = 0; i < k; i += 1) {
      const o = pick(opNames.filter((n) => n !== "addUnit" || chance(0.3)));
      meta.ops.push(o);
      ops[o]();
    }
  }
  for (const d of hd) for (const k of Object.keys(d)) if (d[k] === undefined) delete d[k];
  for (const c of hd.filter((d) => d.decl === "component")) for (const u of c.units ?? []) for (const k of Object.keys(u)) if (u[k] === undefined) delete u[k];

  // ---- manifests --------------------------------------------------------------------------------------
  const baseCode = clone([...code.entries()]);
  const headCode = new Map(clone([...code.entries()]));
  if (mode === "change") {
    for (const [id, info] of headCode) {
      if (chance(0.18)) {
        info.own += 1;
        if (info.unit !== null) info.unit += 1;
        if (info.parent) headCode.get(info.parent).file += 1;
        else if (info.file !== null) info.file += 1;
      } else if (info.unit !== null && chance(0.06)) info.unit += 1;
      if (id.startsWith("ts:") && chance(0.06)) info.markers = { ts_ignore: (info.markers?.ts_ignore ?? 0) + int(1, 2) };
    }
    if (chance(0.25)) {
      const comp = pick([...Object.keys(compFns), null]);
      const path = comp ? `src/${comp === "Host" ? "host" : comp.toLowerCase()}/new.ts` : "scripts/new.ts";
      const id = `ts:${path}`;
      headCode.set(id, { file: 5, own: 5, unit: null, markers: chance(0.2) ? { ts_ignore: 1 } : null, parent: null });
      fn += 1;
      headCode.set(`${id}#f${fn}`, { file: null, own: 5, unit: 5, markers: null, parent: id });
      if (comp) compFns[comp].push(`${id}#f${fn}`);
      feat("new-file");
    }
    if (chance(0.2)) {
      const file = pick([...files.keys()]);
      fn += 1;
      headCode.set(`${file}#f${fn}`, { file: null, own: 7, unit: 7, markers: null, parent: file });
      headCode.get(file).own += 1;
      headCode.get(file).file += 1;
      const comp = files.get(file);
      if (comp) compFns[comp].push(`${file}#f${fn}`);
      feat("new-fn");
    }
    if (chance(0.12)) {
      const bound = new Set(allUnits.map((u) => u.fid));
      const cands = [...headCode.keys()].filter((id) => id.includes("#") && !bound.has(id));
      if (cands.length > 0) {
        const del = pick(cands);
        const parent = headCode.get(del).parent;
        headCode.delete(del);
        headCode.get(parent).own += 1;
        feat("deleted-fn");
      }
    }
    if (chance(0.1)) headCode.get("pkgjson:package.json").own += 1, (headCode.get("pkgjson:package.json").file += 1), feat("pkg-changed");
    if (chance(0.1)) headCode.get("ts:test/sys.test.ts").own += 1, (headCode.get("ts:test/sys.test.ts").file += 1), feat("harness-changed");
  }
  const dig = (id, proj, v) => label(`${id} ${proj} v${v}`);
  const specs = (m) =>
    [...m.entries()].map(([id, info]) => {
      const s = { id, parent: info.parent ?? null, own: dig(id, "own", info.own) };
      if (info.file !== null && !id.includes("#")) s.file = dig(id, "file", info.file);
      if (info.unit !== null) s.unit = dig(id, "unit", info.unit);
      if (info.markers) s.markers = info.markers;
      if (info.executable) s.executable = true;
      return s;
    });
  const sf = ["shape.lock", "shape/m.shape"];
  const baseMap = new Map(baseCode);
  const baseMan = manifest(BASE_REV, specs(baseMap), sf);
  const headMan = manifest(HEAD_REV, specs(headCode), sf);
  const digestAt = (m, id, proj) => {
    const info = m.get(id);
    if (!info) return null;
    if (proj === "unit" && info.unit === null) return null;
    if (proj === "file" && (info.file === null || id.includes("#"))) return null;
    return dig(id, proj, info[proj]);
  };

  // ---- records -----------------------------------------------------------------------------------------
  const headEsf = elaborate(head, { now: NOW_S });
  const baseEsf = elaborate(baseSrc, { now: NOW_S, lenient: true });
  const govEsf = mode === "audit" ? headEsf : baseEsf;
  const hasProv = (n) => govEsf.providers.some((p) => p.q === `m::${n}`) || headEsf.providers.some((p) => p.q === `m::${n}`);
  const provSigner = (n) => key(`prov-${n}`);
  const signedRec = (r, signers) => (signers.length > 0 ? signStatement(makeStatement(r), signers) : makeStatement(r));
  const records = [];
  const baseRecords = [];
  const recTime = (s) => isoTime(s);
  const tsIds = (m) => [...m.keys()].filter((id) => id.startsWith("ts:") || id === "raw:tools/run.sh");
  const facts = [];
  const effFactAt = (id) => {
    const r = pick(RES);
    return { type: "effect", at: id, verb: pick(VERBS), resource: pick(r.spell), ...(chance(0.1) ? { n: 2 } : {}) };
  };
  if (hasProv("eff") && chance(0.9)) {
    const stale = mode === "change" && chance(0.12);
    const m = stale ? baseMap : headCode;
    const rev = stale ? BASE_REV : HEAD_REV;
    const ids = tsIds(m).filter(() => chance(0.7));
    const entries = ids.map((id) => {
      const proj = m.get(id).unit !== null ? "unit" : id.includes("#") ? "own" : "file";
      const deps = chance(0.15) ? [citeOf(pick([...m.keys()].filter((x) => !x.includes("#"))), "own", null)].map((c) => ({ ...c, digest: digestAt(m, c.id, "own") })) : [];
      return { ...citeOf(id, proj, digestAt(m, id, proj)), complete: chance(clean ? 0.95 : 0.75), deps };
    });
    const fs = [];
    for (const id of tsIds(m)) if (chance(0.25)) fs.push(effFactAt(id));
    // summary-consistent facts at units (keeps lower bounds unrefuted)
    for (const u of allUnits) {
      const ud = hd.filter((d) => d.decl === "component").flatMap((c) => (c.name === u.comp ? (c.units ?? []) : [])).find((x) => x.name === u.name);
      for (const a of ud?.effects?.atoms ?? []) {
        if (!m.has(u.fid) || !chance(clean ? 1 : 0.85)) continue;
        const mm = /^(\w+)<(\w+)>$/.exec(a.atom);
        const rr = RES.find((x) => x.name === mm?.[2]);
        if (mm && rr) fs.push({ type: "effect", at: u.fid, verb: mm[1], resource: pick(rr.spell) });
      }
    }
    facts.push(...fs);
    const rec = { v: "shape.evidence.v1", kind: "observation", result: "observes", provider: { id: "m::eff", version: "1" }, revision: rev, time: recTime(-3600), scope: { root: scopeRoot(entries), entries }, facts: fs, harness: [], assumptions: [] };
    records.push(signedRec(rec, chance(0.95) ? [provSigner("eff")] : []));
    if (stale) feat("stale-observation");
    // base observation reporting some of the same facts at base digests
    if (mode === "change" && chance(0.6)) {
      const bids = tsIds(baseMap).filter(() => chance(0.7));
      const bentries = bids.map((id) => {
        const proj = baseMap.get(id).unit !== null ? "unit" : id.includes("#") ? "own" : "file";
        return { ...citeOf(id, proj, digestAt(baseMap, id, proj)), complete: chance(0.75), deps: [] };
      });
      const bfs = fs.filter((f) => baseMap.has(f.at) && chance(0.6));
      const brec = { v: "shape.evidence.v1", kind: "observation", result: "observes", provider: { id: "m::eff", version: "1" }, revision: BASE_REV, time: recTime(-86400 * 5), scope: { root: scopeRoot(bentries), entries: bentries }, facts: bfs, harness: [], assumptions: [] };
      baseRecords.push(signedRec(brec, [provSigner("eff")]));
      feat("base-observation");
    }
  }
  if (hasProv("calls") && chance(0.75)) {
    const ids = [...headCode.keys()].filter((id) => id.includes("#"));
    const entries = ids.filter(() => chance(clean ? 0.95 : 0.6)).map((id) => ({ ...citeOf(id, "unit", digestAt(headCode, id, "unit")), complete: chance(clean ? 0.95 : 0.5), deps: [] }));
    const fs = [];
    for (let i = int(0, 4); i > 0; i -= 1) {
      const a = pick(ids);
      const b = pick(ids);
      if (a !== b) fs.push({ type: "call", at: a, to: b });
    }
    if (clean)
      for (const rel of hd.filter((d) => d.decl === "relation")) {
        const fa = (compFns[rel.connects[0]] ?? []).filter((f) => headCode.has(f));
        const fb = (compFns[rel.connects[1]] ?? []).filter((f) => headCode.has(f));
        if (fa.length && fb.length) fs.push(rel.kind === "calls" ? { type: "call", at: fa[0], to: fb[0] } : { type: "edge", at: fa[0], kind: rel.kind, to: fb[0] });
      }
    if (provs.calls.observes.includes("edge(data_flow)"))
      for (let i = int(0, 2); i > 0; i -= 1) {
        const a = pick(ids);
        const b = pick(ids);
        if (a !== b) fs.push({ type: "edge", at: a, kind: "data_flow", to: b });
      }
    const rec = { v: "shape.evidence.v1", kind: "observation", result: "observes", provider: { id: "m::calls", version: "1" }, revision: HEAD_REV, time: recTime(-3600), scope: { root: scopeRoot(entries), entries }, facts: fs, harness: [], assumptions: [] };
    records.push(signedRec(rec, [provSigner("calls")]));
  }
  // Req for a law claim (approximation of A.5.3.4 over our code model; partial on purpose sometimes)
  const unitFid = (uq) => {
    const [c, n] = uq.replace(/^m::/, "").split(".");
    const u = allUnits.find((x) => x.comp === c && x.name === n);
    if (u) return u.fid;
    const added = compFns[c]?.find((f) => f.endsWith(`#${n}`));
    return added ?? null;
  };
  const reqOf = (c, judgment, proj) => {
    const out = [];
    for (const t of c.args.on ?? []) {
      if (t.startsWith("unit ")) {
        const fid = unitFid(t.slice(5));
        if (fid && headCode.has(fid)) out.push([fid, judgment ? (proj === "trust" ? "unit" : proj) : "unit"]);
      } else if (t.startsWith("component ")) {
        const k = t.slice(10).replace(/^m::/, "");
        const fns = [...headCode.keys()].filter((id) => id.includes("#") && files.get(headCode.get(id).parent) === k);
        for (const f of fns) out.push([f, "unit"]);
        for (const f of [...files.keys()].filter((x) => files.get(x) === k && headCode.has(x))) out.push([f, "own"]);
      }
    }
    return out;
  };
  const cites = (pairs, m) => pairs.map(([id, p]) => citeOf(id, p, digestAt(m, id, p) ?? dig(id, p, 0))).filter((c) => c.digest);
  for (const c of headEsf.claims.filter((x) => x.op === "law")) {
    const st = c.args.statement;
    if (st.schema && chance(0.8)) {
      const r = rnd();
      const result = r < 0.6 ? "supports" : r < 0.8 ? "contradicts" : "inconclusive";
      const stale = mode === "change" && chance(0.15);
      const m = stale ? baseMap : headCode;
      let pairs = reqOf(c, false, "unit");
      if (pairs.length > 1 && chance(0.15)) pairs = pairs.slice(1);
      const codeC = cites(pairs, m);
      if (codeC.length === 0) continue;
      const rec = {
        v: "shape.evidence.v1",
        kind: "test",
        result,
        provider: { id: "m::tests", version: "1" },
        revision: stale ? BASE_REV : HEAD_REV,
        time: recTime(-7200),
        claim: { id: c.ids[0], fp: c.fp },
        code: codeC,
        harness: [citeOf("ts:test/sys.test.ts", "own", digestAt(m, "ts:test/sys.test.ts", "own"))],
        assumptions: chance(0.1) ? [pick([{ id: "z3@4.12.5", kind: "tool" }, { id: "HostTrusted", kind: "named" }, { id: "other@1", kind: "tool" }])] : [],
        bound: { runs: 100 }
      };
      if (chance(0.25)) rec.deps = [citeOf("pkgjson:package.json", "own", digestAt(m, "pkgjson:package.json", "own"))];
      if (result === "contradicts" && chance(0.7)) rec.counterexample = { input: "[1,2]" };
      if (hasProv("tests")) records.push(signedRec(rec, [provSigner("tests")]));
      if (stale) feat("stale-test");
      if (hasProv("prover") && st.schema === "std::Deterministic" && chance(0.6)) {
        const prec = { ...rec, kind: "proof", provider: { id: "m::prover", version: "1" }, result: chance(0.85) ? "supports" : "contradicts", assumptions: chance(0.3) ? [{ id: "z3@4.12.5", kind: "tool" }] : [] };
        if (prec.result !== "contradicts") delete prec.counterexample;
        records.push(signedRec(prec, [provSigner("prover")]));
        feat("proof");
      }
    }
    if ((c.requirement?.judged || st.text) && chance(0.6)) {
      const judge = pick([...PERSONS, "bot"]);
      const proj = c.requirement?.projection ?? "unit";
      let pairs = reqOf(c, true, proj);
      if (proj === "trust") pairs = pairs.filter(([id]) => headCode.get(id)?.markers);
      const age = pick([0, 0, 10, 100, 400]);
      const rev = chance(0.8) ? HEAD_REV : BASE_REV;
      const m = rev === HEAD_REV ? headCode : baseMap;
      const codeC = cites(pairs, m);
      if (codeC.length === 0) continue;
      const rec = { v: "shape.evidence.v1", kind: "judgment", result: chance(0.8) ? "supports" : "contradicts", provider: null, revision: rev, time: recTime(-86400 * age - 60), claim: { id: c.ids[0], fp: c.fp }, code: codeC, judge: `m::${judge}` };
      records.push(signedRec(rec, [key(judge === "bot" ? "a-bot" : `p-${judge}`)]));
      feat("judgment");
    }
  }
  const authorsPool = [
    [],
    [{ identity: 'github("bot[bot]")', verified: true, bot: true }],
    [{ identity: 'github("alice")', verified: true, bot: false }],
    [{ identity: 'github("bob")', verified: true, bot: false }],
    [{ identity: 'github("ghost[bot]")', verified: true, bot: true }]
  ];
  const input = {
    contract: "shape.check.input/v1",
    mode,
    now: NOW,
    head: { revision: HEAD_REV, source: head, manifest: headMan },
    base: mode === "audit" ? null : { revision: BASE_REV, source: baseSrc, manifest: baseMan, ...(chance(0.08) ? { committerTime: isoTime(86400 * 2) } : {}) },
    change: { ids: [CHANGE] },
    authors: pick(authorsPool),
    reviews: [],
    records: mode === "audit" ? records.filter(() => true) : records,
    baseRecords: mode === "audit" ? [] : baseRecords,
    persisted: { base: [], head: [] },
    options: { health: false, teeth: false }
  };
  if (mode === "audit") {
    // audit: everything at the head revision is base revision too (no base); keep records
    input.head = { revision: HEAD_REV, source: head, manifest: headMan };
  }
  return { input, meta };
}

/** Phase 2: review lines built from a phase-1 output (approve refs, judge and reject lines). */
export function addReviews(input, phase1, seed) {
  const rnd = mulberry32(seed ^ 0x5bd1e995);
  const chance = (p) => rnd() < p;
  const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
  const who = () => pick(['github("alice")', 'github("bob")', 'github("carol")', 'github("dave")', 'github("bot[bot]")']);
  const obs = phase1.obligations ?? [];
  const reviews = [];
  const n = Math.min(obs.length, 1 + Math.floor(rnd() * 4));
  for (let i = 0; i < n; i += 1) {
    const refs = [pick(obs).binding.slice(0, 19)];
    if (chance(0.4)) refs.push(pick(obs).binding.slice(0, 19 + Math.floor(rnd() * 4)));
    reviews.push({ identity: who(), line: `shape approve ${refs.join(" ")}`, change: chance(0.92) ? CHANGE : "github:acme/sys#2" });
  }
  const laws = obs.filter((o) => o.claim && (o.kind === "unestablished" || o.kind === "contradiction") && o.subject === null);
  if (laws.length > 0 && chance(0.5)) reviews.push({ identity: who(), line: `shape judge ${pick(laws).claim.ids[0]}`, change: CHANGE });
  if (laws.length > 0 && chance(0.15)) reviews.push({ identity: who(), line: `shape reject ${pick(laws).claim.ids[0]} it is wrong`, change: CHANGE });
  return { ...input, reviews };
}
