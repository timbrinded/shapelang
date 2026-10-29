// @ts-nocheck
// DRT7 random case generator (version 7). genCase(seed, profile) builds a version 7 checker input
// (shape.check.input/v1, source profile, A.16.2) from the DRT generator (trials/DRT/gen.ts) with the
// version 7 rules added. The version 6 generator avoided what the version 6 kernel could not
// answer; the version 7 kernel's fragment (A.11.2.2 [D23], kernel/README.md) excludes only teeth,
// options.health false, unknown claim operators and the cell budget, so this generator also makes:
//   renames with and without `was` (components, resources, units, actors) [D17, D18, D25];
//   path and except-glob changes (L6) [D25]; an unreadable (L0) and an empty base (A.16.17);
//   absence-sound call and edge observers, refuted lower bounds [D7];
//   relocated files (moved code keeps its own digest) and hatch markers at edited code [D6];
//   undeclared hatch kinds, `forbid hatch *` [D1]; hatch-incomplete identities [D20];
//   complete summaries with `via`, edited summaries, calls out of summarised units [D2];
//   manifest refs, record deps and harnesses that move, base-revision records that contradict
//   with an equal or a different counterexample [D4, D9];
//   provider implementations by path, digest and identity (pkgjson scripts.test) [D9];
//   final tiers, two-person review lines [D11]; authors who judge, persisted judgments of earlier
//   changes, head policies narrowing judges, relay answers [D12, D28];
//   laws with an empty Req (an empty component, `at trust` without markers) [D14];
//   effect facts with and without n, from presence-sound and other observers [D15];
//   manifest entries with refs, executable and hatchComplete, a manifest identity and DSSE-signed
//   manifests [D27]; Bounded<> (ordered integer parameters) [D13]; Owns and Layering templates;
//   preview mode; options.health true (the health-less output is outside the frozen set).
// Not generated: equivalence records, gha identities, full-profile inputs.
// Profiles: "fragment" (seeds r1..r2500) and "clean" (c1..c1500: gen-corpus7.ts retries until the
// prototype raises no error). Phase 2 (addReviews) adds review lines or relay answers derived from
// the prototype's phase-1 output.
import { label } from "../../proto/src/jcs.ts";
import { elaborate } from "../../proto/src/elaborate.ts";
import { gitBlobId, manifestStatement } from "../../proto/src/manifest.ts";
import {
  makeStatement,
  persistedPath,
  recordId,
  scopeRoot,
  signStatement,
  signerFromSeed
} from "../../proto/src/records.ts";

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
export function key(name) {
  let k = KEYCACHE.get(name);
  if (!k) {
    let h = 0;
    for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    k = signerFromSeed((h.toString(16) + "a5".repeat(32)).slice(0, 64));
    KEYCACHE.set(name, k);
  }
  return k;
}

const SCHEME = {
  ts: { file: "ts.file.v1", own: "ts.own.v2", unit: "ts.unit.v2" },
  raw: { file: "raw.file.v1", own: "raw.own.v1" },
  pkgjson: { file: "pkgjson.file.v1", own: "pkgjson.own.v1", unit: "pkgjson.unit.v1" }
};
const schemeOf = (id, projection) => {
  const lang = id.split(":")[0];
  if (lang === "pkgjson" && id.includes("#")) return "pkgjson.unit.v1";
  return SCHEME[lang]?.[projection] ?? `${lang}.${projection}.v1`;
};
function citeOf(id, projection, digest) {
  return { id, projection, scheme: schemeOf(id, projection), digest };
}

const PERSONS = ["alice", "bob", "carol", "dave"];
export const NOW = "2026-10-25T12:00:00Z";
const NOW_S = Date.UTC(2026, 9, 25, 12, 0, 0) / 1000;
export const CHANGE = "github:acme/sys#1";
const OTHER_CHANGE = "github:acme/sys#0";
const BASE_REV = "b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0";
const HEAD_REV = "1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e";
const TS_KINDS = ["ts_ignore", "ts_ignore", "ts_ignore", "ts_expect_error", "ts_nocheck"];
const UNDECLARED_KIND = "ts_future_hatch";
const SCRIPT_TEST = "pkgjson:package.json#scripts.test";

const clone = (x) => JSON.parse(JSON.stringify(x));
function isoDay(daysFromNow) {
  return new Date((NOW_S + daysFromNow * 86400) * 1000).toISOString().slice(0, 10);
}
function isoTime(secondsFromNow) {
  return new Date((NOW_S + secondsFromNow) * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Deep rewrite of every string of a decl list (skipping identities and `was`). */
function rewriteDecls(decls, re, to) {
  const walk = (v, k) => {
    if (typeof v === "string") {
      if (k === "was" || /^(github|ed25519)\(/.test(v)) return v;
      return v.replace(re, to);
    }
    if (Array.isArray(v)) return v.map((x) => walk(x, k));
    if (v && typeof v === "object") {
      const o = {};
      for (const [kk, vv] of Object.entries(v))
        o[kk] =
          kk === "identities" || kk === "paths" || kk === "exceptPaths" || kk === "bind"
            ? vv
            : walk(vv, kk);
      return o;
    }
    return v;
  };
  return decls.map((d) => walk(d, ""));
}

/** v7 manifest (A.12.7.5, A.16.22): entries carry refs, executable and hatchComplete. */
function manifest7(revision, code, extraTree) {
  const entries = [];
  const tree = [];
  const dig = (info, proj) => label(`${info.okey} ${proj} v${info[proj]}`);
  for (const [id, info] of [...code.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const lang = id.split(":")[0];
    const symbol = id.includes("#");
    const fileId = symbol ? id.split("#")[0] : id;
    const fileInfo = code.get(fileId) ?? info;
    const executable = lang === "pkgjson" ? symbol : (fileInfo.executable ?? lang === "ts");
    const projections = lang === "pkgjson" && symbol ? ["own", "unit"] : ["file", "own", "unit"];
    for (const p of projections) {
      if (p === "file" && symbol) continue;
      if (info[p] === null || info[p] === undefined) continue;
      const e = {
        id,
        projection: p,
        scheme: schemeOf(id, p),
        digest: dig(info, p),
        kind: info.kind ?? (symbol ? "function" : "file"),
        parent: info.parent ?? null,
        refs: [...(info.refs ?? [])].sort(),
        executable,
        hatchComplete: lang === "ts" ? info.hatchComplete !== false : true
      };
      if (info.markers) e.markers = info.markers;
      entries.push(e);
    }
    if (!symbol) {
      const path = id.slice(lang.length + 1);
      tree.push({
        path,
        mode: info.executable && lang === "raw" ? "100755" : "100644",
        blob: gitBlobId(Buffer.from(`${info.okey} file v${info.file}`))
      });
    }
  }
  for (const f of ["shape.lock", "shape/m.shape"])
    tree.push({ path: f, mode: "100644", blob: gitBlobId(Buffer.from(f)) });
  for (const t of extraTree ?? []) if (!tree.some((x) => x.path === t.path)) tree.push(t);
  return manifestStatement({ v: "shape.manifest.v1", revision, tree, entries });
}

export function genCase(seed, profile = "fragment") {
  const clean = profile === "clean";
  const rnd = mulberry32(clean ? seed * 977 + 13 : seed * 7919 + 101);
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
  const feat = (f) => {
    if (!meta.features.includes(f)) meta.features.push(f);
  };

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
    ...PERSONS.map((p) => ({
      decl: "actor",
      name: p,
      kind: "person",
      identities: [`github("${p}")`, key(`p-${p}`).identity]
    })),
    ...Object.entries(teams).map(([n, ms]) => ({
      decl: "actor",
      name: n,
      kind: "team",
      members: ms
    })),
    {
      decl: "actor",
      name: "bot",
      kind: "agent",
      operator: botOperator,
      identities: ['github("bot[bot]")', key("a-bot").identity]
    }
  ];
  const RES = [
    {
      name: "Events",
      code: 'pg.table("events")',
      spell: ['pg.table("events")', 'pg.table("public.events")', 'pg.table("EVENTS")']
    },
    {
      name: "Users",
      code: 'pg.table("users")',
      spell: ['pg.table("users")', 'pg.table("public.Users")']
    },
    { name: "Clock", code: 'ts.call("Date.now")', spell: ['ts.call("Date.now")'] }
  ].slice(0, int(2, 3));
  const customVerb = chance(0.2);
  const VERBS = [
    "Read",
    "Write",
    "Append",
    "Update",
    "HardDelete",
    "Truncate",
    ...(customVerb ? ["Purge"] : [])
  ];
  const atoms = RES.flatMap((r) => VERBS.map((v) => `${v}<${r.name}>`));
  const nComp = int(2, 3);
  const COMPS = ["C1", "C2", "C3"].slice(0, nComp);
  const hasHost = chance(0.35);
  const hasEmpty = chance(0.12); // a component whose globs match no file (D14: its laws have empty Req)
  const exceptC1 = chance(0.15); // D25: bind paths {…} except {…}
  const compPaths = {
    C1: ["src/c1/**/*.ts"],
    C2: ["src/c2/**/*.ts"],
    C3: [pick(["src/c3/**", "src/c3/*.ts"])],
    Host: ["src/host/**/*.ts"],
    Empty: ["src/empty/**/*.ts"]
  };

  // ---- code -------------------------------------------------------------------------------------
  // id -> { okey, file, own, unit, markers, parent, kind, executable, refs, hatchComplete }
  let fn = 0;
  const code = new Map();
  const files = new Map(); // file id -> comp|null
  const addFile = (path, comp) => {
    const id = `ts:${path}`;
    files.set(id, comp);
    code.set(id, { okey: id, file: 0, own: 0, unit: null, markers: null, parent: null });
    const n = int(1, 2);
    const fns = [];
    for (let i = 0; i < n; i += 1) {
      fn += 1;
      const fid = `${id}#f${fn}`;
      code.set(fid, {
        okey: fid,
        file: null,
        own: 0,
        unit: 0,
        markers: null,
        parent: id,
        refs: []
      });
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
  if (hasEmpty) compFns.Empty = [];
  if (exceptC1) {
    addFile("src/c1/gen/out.ts", null);
    feat("except-paths");
  }
  const ungovFns = addFile("scripts/tool.ts", null);
  code.set("raw:tools/run.sh", {
    okey: "raw:tools/run.sh",
    file: 0,
    own: 0,
    unit: null,
    markers: null,
    parent: null,
    executable: true
  });
  code.set("raw:README.md", {
    okey: "raw:README.md",
    file: 0,
    own: 0,
    unit: null,
    markers: null,
    parent: null,
    executable: false
  });
  code.set("pkgjson:package.json", {
    okey: "pkgjson:package.json",
    file: 0,
    own: 0,
    unit: null,
    markers: null,
    parent: null,
    executable: false
  });
  const hasScript = chance(0.6);
  if (hasScript)
    code.set(SCRIPT_TEST, {
      okey: SCRIPT_TEST,
      file: null,
      own: 0,
      unit: 0,
      markers: null,
      parent: "pkgjson:package.json",
      kind: "script"
    });
  code.set("ts:test/sys.test.ts", {
    okey: "ts:test/sys.test.ts",
    file: 0,
    own: 0,
    unit: null,
    markers: null,
    parent: null
  });
  for (const [id, info] of code)
    if (id.startsWith("ts:") && chance(0.08)) {
      info.markers = { [pick(TS_KINDS)]: int(1, 2) };
      if (chance(0.25)) feat("marker-other-kind");
    }
  for (const [id, info] of code)
    if (id.startsWith("ts:") && chance(0.04)) {
      info.hatchComplete = false;
      feat("hatch-incomplete");
    }
  if (chance(0.06)) {
    const t = pick([...code.keys()].filter((x) => x.startsWith("ts:")));
    code.get(t).markers = { ...code.get(t).markers, [UNDECLARED_KIND]: 1 };
    feat("undeclared-hatch-kind");
  }
  // refs: env(x) resolves to another function of the same component (D4 cones, judgment Req)
  for (const c of Object.keys(compFns)) {
    const fs = compFns[c];
    for (const f of fs)
      if (fs.length > 1 && chance(0.35)) {
        const other = pick(fs.filter((x) => x !== f));
        code.get(f).refs = [other];
        feat("manifest-refs");
      }
  }

  // ---- units --------------------------------------------------------------------------------------
  const units = {};
  for (const c of Object.keys(compFns)) {
    units[c] = [];
    for (const fid of compFns[c])
      if (chance(0.5)) units[c].push({ name: fid.split("#")[1], fid, explicit: chance(0.85) });
  }
  const allUnits = Object.entries(units).flatMap(([c, us]) =>
    us.map((u) => ({ ...u, comp: c, q: `${c}.${u.name}` }))
  );

  // ---- base shape ---------------------------------------------------------------------------------
  const summaryAtoms = () =>
    someOf(
      atoms.filter(() => chance(0.3)),
      0
    ).slice(0, 2);
  const grantsFor = () =>
    chance(0.3)
      ? undefined
      : chance(0.12)
        ? "none"
        : someOf(
            atoms.filter(() => chance(0.25)),
            1
          ).slice(0, 3);
  const compDecl = (c) => {
    const d = {
      decl: "component",
      name: c,
      owner: pick(owners),
      tier: tierP(),
      paths: compPaths[c]
    };
    if (c === "C1" && exceptC1) d.exceptPaths = ["src/c1/gen/**"];
    const g = grantsFor();
    if (g !== undefined) d.grants = g;
    if (c === "Host") {
      d.boundary = true;
      d.allows = chance(0.6) ? [pick(["ts_ignore", "ts_ignore", "ts_expect_error"])] : [];
      if (chance(0.4)) d.assumes = [{ id: "HostTrusted", text: "host input is validated" }];
      if (chance(0.3)) d.attach = [{ name: "ReviewedSurface" }];
    }
    if (chance(0.15)) d.relationsComplete = ["calls"];
    d.units = units[c].map((u) => {
      const ud = { name: u.name };
      if (u.explicit) ud.bind = `ts("${u.fid.slice(3)}")`;
      if (chance(0.15)) ud.tier = tierP();
      const r = rnd();
      if (r < 0.45) {
        ud.effects = { mode: "complete", atoms: summaryAtoms().map((a) => ({ atom: a })) };
        feat("complete-summary");
      }
      if (ud.effects && chance(0.2)) {
        const other =
          allUnits.find((x) => x.comp === c && x.name !== u.name) ??
          allUnits.find((x) => x.name !== u.name);
        if (other && ud.effects.atoms.length > 0) {
          ud.effects.atoms[0] = {
            ...ud.effects.atoms[0],
            via: other.comp === c ? other.name : other.q
          };
          feat("via");
        }
      } else if (r < 0.6)
        ud.effects = {
          mode: "partial",
          atoms: someOf(
            atoms.filter(() => chance(0.3)),
            1
          )
            .slice(0, 2)
            .map((a) => ({ atom: a }))
        };
      if (chance(0.12)) {
        ud.attach = [{ name: "RefactorSensitive" }];
        feat("refactor-sensitive");
      }
      return ud;
    });
    return d;
  };
  const decls = [];
  decls.push(...actors);
  if (customVerb) decls.push({ decl: "effect", name: "Purge", implies: ["HardDelete"] });
  for (const r of RES) {
    const d = {
      decl: "resource",
      name: r.name,
      owner: pick(owners),
      tier: tierP(),
      bind: [r.code]
    };
    if (chance(0.3)) d.attach = [{ name: pick(["AppendOnly", "AppendOnly", "NoHardDelete"]) }];
    decls.push(d);
  }
  for (const c of Object.keys(compFns)) decls.push(compDecl(c));
  const unitSel = () =>
    pick([
      "*",
      "ungoverned",
      ...COMPS.map((c) => `component ${c}`),
      ...allUnits.map((u) => `unit ${u.q}`)
    ]);
  const nodeSel = () =>
    pick([
      "*",
      ...COMPS.map((c) => `component ${c}`),
      ...(chance(0.2) ? RES.map((r) => `resource ${r.name}`) : [])
    ]);
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
  if (chance(0.35)) {
    const r = rnd();
    decls.push(
      r < 0.4
        ? {
            decl: "rule",
            name: "NoHatches",
            template: { name: "HatchesStayAtBoundaries", args: [] },
            tier: tierP()
          }
        : r < 0.8
          ? {
              decl: "rule",
              name: "NoHatches",
              clauses: [{ forbid: "hatch", kinds: ["*"] }],
              tier: tierP()
            }
          : {
              decl: "rule",
              name: "NoHatches",
              clauses: [{ forbid: "hatch", kinds: [pick(["ts_ignore", "Hatch"])] }],
              tier: tierP()
            }
    );
    feat("hatch-rule");
  }
  if (chance(0.12)) {
    decls.push({
      decl: "rule",
      name: "Own1",
      template: { name: "Owns", args: [pick(RES).name, pick(COMPS)] }
    });
    feat("owns-template");
  }
  if (chance(0.12)) {
    const [a, b] = [COMPS[0], COMPS[1]];
    decls.push({
      decl: "rule",
      name: "Lay1",
      template: { name: "Layering", args: [a, b] },
      ...(chance(0.5) ? { tier: tierP() } : {})
    });
    feat("layering-template");
  }
  let relN = 0;
  const relation = () => {
    relN += 1;
    const a = pick(COMPS);
    const b = pick(COMPS.filter((x) => x !== a));
    return {
      decl: "relation",
      name: `Rel${relN}`,
      kind: chance(0.25) ? "data_flow" : "calls",
      connects: [a, b]
    };
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
    if (chance(0.08)) cl.final = true;
    const d = { decl: "rule", name: `S${ruleN}`, clauses: [cl] };
    if (chance(0.5)) d.tier = tierP();
    return d;
  };
  for (let i = int(chance(0.7) ? 1 : 0, 2); i > 0; i -= 1) decls.push(structRule());
  // laws
  const provs = {};
  const hasProver = chance(0.25);
  let lawN = 0;
  const lawDecl = () => {
    lawN += 1;
    const r = rnd();
    const ev = {};
    if (chance(0.5))
      ev.level = pick(["declared", "tested", "tested", ...(hasProver ? ["proven"] : [])]);
    if (chance(0.25)) ev.orJudged = true;
    if (chance(0.25)) ev.by = ["tests"];
    const tier = chance(0.6) ? tierP() : undefined;
    if (r < 0.3 && allUnits.length > 0) {
      const u = pick(allUnits);
      return {
        decl: "law",
        name: `L${lawN}`,
        template: { name: "Deterministic", args: [u.q] },
        tier,
        evidence: ev
      };
    }
    if (r < 0.38 && allUnits.length > 0) {
      const u = pick(allUnits);
      feat("bounded");
      return {
        decl: "law",
        name: `L${lawN}`,
        template: { name: "Bounded", args: [u.q, int(0, 5) * 10, int(6, 20) * 10] },
        tier,
        evidence: ev
      };
    }
    if (r < 0.6)
      return {
        decl: "law",
        name: `L${lawN}`,
        template: { name: "HistoryPreserved", args: [pick(RES).name] },
        on: [`component ${pick(hasEmpty && chance(0.25) ? ["Empty"] : COMPS)}`],
        tier,
        evidence: ev
      };
    const on =
      hasEmpty && chance(0.15)
        ? "component Empty"
        : chance(0.5) && allUnits.length > 0
          ? `unit ${pick(allUnits).q}`
          : `component ${pick(hasHost && chance(0.2) ? ["Host"] : COMPS)}`;
    const at = on === "component Host" || chance(0.15) ? "trust" : "unit";
    return {
      decl: "law",
      name: `L${lawN}`,
      on: [on],
      informal: `invariant ${lawN} holds`,
      tier,
      evidence: { judged: true, at, ...(chance(0.15) ? { by: [pick(PERSONS)] } : {}) }
    };
  };
  for (let i = int(0, 3); i > 0; i -= 1) decls.push(lawDecl());
  // providers
  const soundEff = someOf(["presence", "absence"], 0);
  provs.eff = {
    decl: "provider",
    name: "eff",
    produces: ["observation"],
    observes: ['effect(pg.table("*"))', ...(chance(0.7) ? ['effect(ts.call("*"))'] : [])],
    sound: soundEff,
    depsComplete: chance(0.3),
    identity: chance(0.75) ? key("prov-eff").identity : undefined,
    implementation: chance(0.5)
      ? { digest: `sha256:${"e".repeat(64)}` }
      : { paths: ["tools/run.sh"] }
  };
  const rc = rnd();
  provs.calls = {
    decl: "provider",
    name: "calls",
    produces: ["observation"],
    observes: ["call(ts)", ...(chance(0.4) ? ["edge(data_flow)"] : [])],
    sound:
      rc < 0.35 ? ["presence", "absence"] : rc < 0.7 ? ["presence"] : rc < 0.8 ? ["absence"] : [],
    identity: chance(0.6) ? key("prov-calls").identity : undefined,
    implementation: { digest: `sha256:${"c".repeat(64)}` }
  };
  const impl =
    hasScript && chance(0.35)
      ? { ids: ['pkgjson("package.json#scripts.test")'] }
      : chance(0.3)
        ? { digest: `sha256:${"a".repeat(64)}` }
        : { paths: ["package.json"] };
  if (impl.ids) feat("implementation-ids");
  provs.tests = {
    decl: "provider",
    name: "tests",
    produces: ["test"],
    decides: [
      "template Deterministic",
      "template HistoryPreserved",
      ...(chance(0.7) ? ["template Bounded"] : [])
    ],
    sound: chance(0.85) ? ["presence"] : [],
    depsComplete: chance(0.2),
    identity: chance(0.7) ? key("prov-tests").identity : undefined,
    implementation: impl
  };
  if (chance(0.3)) provs.tests.trusts = [["z3", "4.12.5"]];
  if (hasProver) {
    provs.prover = {
      decl: "provider",
      name: "prover",
      produces: ["proof"],
      decides: ["template Deterministic"],
      sound: ["presence"],
      depsComplete: chance(0.5),
      identity: key("prov-prover").identity,
      implementation: { digest: `sha256:${"d".repeat(64)}` },
      trusts: [["z3", "4.12.5"]]
    };
    feat("prover");
  }
  const provNames = Object.keys(provs).filter(
    (n) => n === "tests" || n === "prover" || chance(0.85)
  );
  for (const n of provNames) {
    const p = provs[n];
    if (!p.identity) delete p.identity;
    decls.push(p);
  }
  const hasRelay = chance(0.3);
  if (hasRelay) {
    decls.push({
      decl: "provider",
      name: "relay",
      produces: ["judgment"],
      identity: key("prov-relay").identity,
      implementation: { digest: `sha256:${"f".repeat(64)}` }
    });
    feat("relay");
  }
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
  const manifestId = chance(0.25) ? key("manifest").identity : null;
  if (manifestId) feat("manifest-identity");
  decls.unshift({
    decl: "shape",
    name: "Sys",
    owner: chance(0.85) ? "Platform" : "Store",
    ...(decls.some((d) => d.decl === "policy") ? { policy: "Pol" } : {}),
    ...(manifestId ? { manifest: manifestId } : {})
  });
  for (const c of Object.keys(compFns))
    for (const u of units[c])
      decls.push({
        decl: "note",
        name: `N_${c}_${u.name}`,
        kind: "memory",
        about: [`unit ${c}.${u.name}`]
      });
  // exceptions
  let excN = 0;
  const exceptionDecl = (target) => {
    excN += 1;
    const tgts = [
      ...decls.filter((d) => d.decl === "rule").map((d) => `rule ${d.name}`),
      ...decls.filter((d) => d.decl === "law").map((d) => `law ${d.name}`),
      ...COMPS.map((c) => `component ${c}`),
      ...COMPS.map((c) => `authority ${c}`),
      ...decls.filter((d) => d.decl === "relation").map((d) => `relation ${d.name}`)
    ];
    const d = {
      decl: "exception",
      name: `X${excN}`,
      target: target ?? pick(tgts),
      owner: pick(owners),
      expires: isoDay(pick(clean ? [-3, 10, 51, 200, 300] : [-3, 10, 51, 200, 360, 400]))
    };
    if (chance(0.5)) d.waives = someOf(["contradiction", "unestablished"], 1);
    if (chance(0.4) && !d.target.startsWith("law ")) {
      const fid = pick([...Object.values(compFns).flat(), ...ungovFns]);
      d.for = [
        pick([
          `component ${pick(COMPS)}`,
          `code ts("${fid.slice(3)}")`,
          "ungoverned",
          ...(allUnits.length ? [`unit ${pick(allUnits).q}`] : []),
          `pair ${pick(COMPS)} -> ${pick(COMPS)}`
        ])
      ];
    }
    if (!clean && chance(0.05)) d.for = [`component ${pick(COMPS)}`];
    return d;
  };
  for (let i = int(0, 2); i > 0; i -= 1) decls.push(exceptionDecl());
  if (chance(0.1)) {
    const x = exceptionDecl();
    decls.push(x, { ...exceptionDecl(x.target), waives: x.waives, for: x.for });
    feat("two-exceptions");
  }
  for (const d of decls) for (const k of Object.keys(d)) if (d[k] === undefined) delete d[k];

  const baseSrc = { v: "shape.source.v1", modules: [{ module: "m", imports: ["std"], decls }] };

  // ---- head shape: random edit operators ------------------------------------------------------------
  const mr = rnd();
  const mode = mr < 0.1 ? "audit" : mr < 0.15 ? "preview" : "change";
  if (mode === "preview") feat("preview");
  let head = clone(baseSrc);
  const hdOf = () => head.modules[0].decls;
  const byDecl = (k) => hdOf().filter((d) => d.decl === k);
  const headBind = new Map(); // unit q -> new bind (relocation)
  const ops = {
    tier: () => {
      const xs = [
        ...byDecl("component"),
        ...byDecl("resource"),
        ...byDecl("rule"),
        ...byDecl("law"),
        ...byDecl("component").flatMap((c) => c.units ?? [])
      ];
      const x = pick(xs);
      if (x) x.tier = tierP();
    },
    owner: () => {
      const x = pick([
        ...byDecl("component"),
        ...byDecl("resource"),
        ...byDecl("rule"),
        ...byDecl("law")
      ]);
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
      const hd = hdOf();
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
      const hd = hdOf();
      const laws = byDecl("law");
      const r = rnd();
      if (r < 0.25 && laws.length > 0) hd.splice(hd.indexOf(pick(laws)), 1);
      else if (r < 0.45 || laws.length === 0) hd.push(lawDecl());
      else {
        const l = pick(laws);
        l.evidence = { ...l.evidence };
        const s = rnd();
        if (l.template?.name === "Bounded" && s < 0.35) {
          l.template = {
            ...l.template,
            args: [
              l.template.args[0],
              l.template.args[1] + pick([-10, 10]),
              l.template.args[2] + pick([-10, 10])
            ]
          };
          feat("bounded-edited");
        } else if (s < 0.5) l.evidence.level = pick(["declared", "tested"]);
        else if (s < 0.75) l.evidence.orJudged = !l.evidence.orJudged;
        else l.evidence.by = l.evidence.by ? undefined : ["tests"];
        if (l.informal) l.evidence = { judged: true, at: l.evidence.at ?? "unit" };
      }
    },
    summary: () => {
      const us = byDecl("component").flatMap((c) => c.units ?? []);
      const u = pick(us);
      if (!u) return;
      feat("summary-edited");
      const r = rnd();
      if (r < 0.25) delete u.effects;
      else if (r < 0.5)
        u.effects = {
          mode: pick(["complete", "partial"]),
          atoms: summaryAtoms().map((a) => ({ atom: a }))
        };
      else if (u.effects) {
        const as = [...(u.effects.atoms ?? [])];
        if (chance(0.5) || as.length === 0) as.push({ atom: pick(atoms) });
        else as.splice(int(0, as.length - 1), 1);
        u.effects = { ...u.effects, atoms: as };
      } else u.effects = { mode: "complete", atoms: [{ atom: pick(atoms) }] };
    },
    structure: () => {
      const hd = hdOf();
      const r = rnd();
      const rels = byDecl("relation");
      const srules = byDecl("rule").filter((d) =>
        ["edge", "path", "cycle"].includes(d.clauses?.[0]?.forbid)
      );
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
      const hd = hdOf();
      const p = pick(byDecl("provider").filter((x) => x.name !== "relay"));
      if (!p) return;
      const r = rnd();
      if (r < 0.12 && p.name !== "tests") hd.splice(hd.indexOf(p), 1);
      else if (r < 0.35) {
        p.sound = someOf(["presence", "absence"], 0);
        feat("provider-soundness-edited");
      } else if (r < 0.5) p.depsComplete = !p.depsComplete;
      else if (r < 0.65) {
        p.implementation =
          chance(0.5) || !hasScript
            ? { digest: `sha256:${"9".repeat(64)}` }
            : { ids: ['pkgjson("package.json#scripts.test")'] };
        feat("implementation-edited");
      } else if (r < 0.8 && p.observes)
        p.observes =
          p.observes.length > 1
            ? [p.observes[0]]
            : [...p.observes, 'effect(ts.call("*"))'].filter((x, i, a) => a.indexOf(x) === i);
      else if (p.decides)
        p.decides =
          p.decides.length > 1
            ? [p.decides[0]]
            : ["template Deterministic", "template HistoryPreserved"];
    },
    policy: () => {
      let pol = byDecl("policy")[0];
      if (!pol) {
        pol = { decl: "policy", name: "Pol", tiers: { low: {}, normal: {}, critical: {} } };
        hdOf().push(pol);
        byDecl("shape")[0].policy = "Pol";
      }
      const t = pol.tiers[pick(["low", "normal", "critical"])];
      const r = rnd();
      if (r < 0.25) t.blocks = subset(["unestablished", "coverage", "latent-loosening"], 0.5);
      else if (r < 0.4) t.maxAge = pick([30, 90, 365, 1000]);
      else if (r < 0.55) t.floor = pick(["declared", "tested"]);
      else if (r < 0.85) {
        t.judges = someOf(["owner", "agents", "Platform", "dave", "alice"], 1);
        feat("head-judges-edited");
      } else pol.budget = int(0, 3);
    },
    actor: () => {
      const t = pick(byDecl("actor").filter((a) => a.kind === "team"));
      const m = pick(PERSONS);
      if (t.members.includes(m) && t.members.length > 1)
        t.members = t.members.filter((x) => x !== m);
      else t.members = [...new Set([...t.members, m])];
    },
    exception: () => {
      const hd = hdOf();
      const xs = byDecl("exception");
      if (xs.length > 0 && chance(0.4)) hd.splice(hd.indexOf(pick(xs)), 1);
      else hd.push(exceptionDecl());
    },
    boundary: () => {
      const b = byDecl("component").find((c) => c.boundary);
      if (!b) return;
      if (chance(0.5)) b.allows = b.allows?.length ? [] : ["ts_ignore"];
      else
        b.assumes = b.assumes?.length
          ? []
          : [{ id: "HostTrusted", text: "host input is validated" }];
    },
    addUnit: () => {
      const c = pick(Object.keys(compFns).filter((x) => x !== "Empty"));
      const free = compFns[c].filter((f) => !units[c].some((u) => u.fid === f));
      if (free.length === 0) return;
      const fid = pick(free);
      const cd = byDecl("component").find((d) => d.name === c || d.was === c || d.name === `${c}r`);
      if (!cd) return;
      cd.units = [
        ...(cd.units ?? []),
        {
          name: fid.split("#")[1],
          ...(chance(0.85) ? { bind: `ts("${fid.slice(3)}")` } : {}),
          effects: chance(0.5)
            ? { mode: "complete", atoms: summaryAtoms().map((a) => ({ atom: a })) }
            : undefined
        }
      ];
    },
    // ---- version 7 operators ----
    rename: () => {
      // ρ by name, by `was` or by identical binding; a unique remove-and-add without was is a hint
      const r = rnd();
      const withWas = chance(0.7);
      if (r < 0.4) {
        const c = pick(COMPS);
        const n = `${c}r`;
        head.modules[0].decls = rewriteDecls(hdOf(), new RegExp(`\\b${c}\\b`, "g"), n);
        const cd = byDecl("component").find((d) => d.name === n);
        if (cd && withWas) cd.was = c;
        feat(withWas ? "rename-was" : "rename-nowas");
      } else if (r < 0.7) {
        const res = pick(RES).name;
        const n = `${res}2`;
        head.modules[0].decls = rewriteDecls(hdOf(), new RegExp(`\\b${res}\\b`, "g"), n);
        const rd = byDecl("resource").find((d) => d.name === n);
        if (rd && withWas) rd.was = res;
        if (rd && !withWas && chance(0.4)) rd.bind = [`${rd.bind[0].replace(/"\)$/, '_v2")')}`];
        feat(withWas ? "rename-was" : "rename-binding");
      } else if (allUnits.length > 0) {
        const u = pick(allUnits);
        const n = `${u.name}x`;
        head.modules[0].decls = rewriteDecls(
          hdOf(),
          new RegExp(`\\b${u.comp}\\.${u.name}\\b`, "g"),
          `${u.comp}.${n}`
        );
        const cd = byDecl("component").find((d) => d.name === u.comp);
        const ud = cd?.units?.find((x) => x.name === u.name);
        if (ud) {
          ud.name = n;
          if (!ud.bind) ud.bind = `ts("${u.fid.slice(3)}")`;
          if (withWas) ud.was = u.name;
        }
        feat(withWas ? "rename-was" : "rename-binding");
      }
    },
    actorWas: () => {
      const p = pick(PERSONS);
      const n = `${p}2`;
      const re = new RegExp(`^${p}$`);
      const fix = (v) => (typeof v === "string" ? v.replace(re, n) : v);
      for (const d of hdOf()) {
        if (d.decl === "actor" && d.name === p) {
          d.name = n;
          d.was = p;
        }
        if (d.decl === "actor" && d.members) d.members = d.members.map(fix);
        if (d.decl === "actor" && d.operator) d.operator = fix(d.operator);
        if (d.owner) d.owner = fix(d.owner);
        if (d.decl === "component")
          for (const u of d.units ?? []) if (u.owner) u.owner = fix(u.owner);
        if (d.decl === "policy")
          for (const t of Object.values(d.tiers)) if (t.judges) t.judges = t.judges.map(fix);
        if (d.evidence?.by) d.evidence = { ...d.evidence, by: d.evidence.by.map(fix) };
      }
      feat("actor-was");
    },
    paths: () => {
      // L6: a position changes component (globs narrowed, widened or excepted)
      const r = rnd();
      const cs = byDecl("component").filter((d) => d.name !== "Host");
      const c = pick(cs);
      if (!c) return;
      if (r < 0.35)
        c.exceptPaths = c.exceptPaths?.length
          ? undefined
          : [`${c.paths[0].split("/").slice(0, 2).join("/")}/b.ts`];
      else if (r < 0.65 && c.paths[0].endsWith("/**/*.ts"))
        c.paths = [c.paths[0].replace("/**/*.ts", "/a.ts")];
      else if (c.name === "C3")
        c.paths = [c.paths[0] === "src/c3/**" ? "src/c3/*.ts" : "src/c3/**"];
      else c.paths = [...c.paths, "scripts/**/*.ts"];
      feat("paths-changed");
    },
    manifestId: () => {
      const sh = byDecl("shape")[0];
      if (sh.manifest) delete sh.manifest;
      else sh.manifest = key("manifest").identity;
      feat("manifest-identity-edited");
    }
  };
  // summaries are edited twice as often as other items (D2: L1 decides edited summaries)
  const opNames = [...Object.keys(ops), "summary"];
  if (mode !== "audit") {
    const k = pick([0, 1, 1, 2, 2, 3, 4, 5]);
    for (let i = 0; i < k; i += 1) {
      const o = pick(opNames.filter((n) => n !== "addUnit" || chance(0.3)));
      meta.ops.push(o);
      ops[o]();
    }
  }
  const tidy = (src) => {
    for (const d of src.modules[0].decls) {
      for (const k of Object.keys(d)) if (d[k] === undefined) delete d[k];
      if (d.decl === "component")
        for (const u of d.units ?? [])
          for (const k of Object.keys(u)) if (u[k] === undefined) delete u[k];
    }
  };
  tidy(head);

  // ---- manifests --------------------------------------------------------------------------------------
  const baseCode = new Map(clone([...code.entries()]));
  const headCode = new Map(clone([...code.entries()]));
  const persistTree = [];
  if (mode !== "audit") {
    for (const [id, info] of headCode) {
      if (chance(0.18)) {
        info.own += 1;
        if (info.unit !== null && info.unit !== undefined) info.unit += 1;
        if (info.parent) headCode.get(info.parent).file += 1;
        else if (info.file !== null) info.file += 1;
      } else if (info.unit !== null && info.unit !== undefined && chance(0.06)) info.unit += 1;
      if (id.startsWith("ts:") && chance(0.06)) {
        info.markers = { ...info.markers, ts_ignore: (info.markers?.ts_ignore ?? 0) + int(1, 2) };
        feat("marker-added");
      }
      if (id.startsWith("ts:") && info.markers && chance(0.05)) {
        info.markers = null;
        feat("marker-removed");
      }
    }
    // refs change (unit digest moves with what free names resolve to)
    for (const [id, info] of headCode)
      if (id.includes("#") && id.startsWith("ts:") && chance(0.05)) {
        const comp = files.get(info.parent);
        const others = (compFns[comp] ?? []).filter((x) => x !== id && headCode.has(x));
        if (others.length) {
          info.refs = info.refs?.length ? [] : [pick(others)];
          info.unit += 1;
          feat("refs-changed");
        }
      }
    if (chance(0.25)) {
      const comp = pick([...Object.keys(compFns), null]);
      const path = comp
        ? `src/${comp === "Host" ? "host" : comp.toLowerCase()}/new.ts`
        : "scripts/new.ts";
      const id = `ts:${path}`;
      headCode.set(id, {
        okey: id,
        file: 5,
        own: 5,
        unit: null,
        markers: chance(0.2) ? { ts_ignore: 1 } : null,
        parent: null
      });
      fn += 1;
      headCode.set(`${id}#f${fn}`, {
        okey: `${id}#f${fn}`,
        file: null,
        own: 5,
        unit: 5,
        markers: null,
        parent: id,
        refs: []
      });
      if (comp) compFns[comp].push(`${id}#f${fn}`);
      feat("new-file");
    }
    if (chance(0.2)) {
      const file = pick([...files.keys()]);
      if (headCode.has(file)) {
        fn += 1;
        headCode.set(`${file}#f${fn}`, {
          okey: `${file}#f${fn}`,
          file: null,
          own: 7,
          unit: 7,
          markers: null,
          parent: file,
          refs: []
        });
        headCode.get(file).own += 1;
        headCode.get(file).file += 1;
        const comp = files.get(file);
        if (comp) compFns[comp].push(`${file}#f${fn}`);
        feat("new-fn");
      }
    }
    if (chance(0.12)) {
      const bound = new Set(allUnits.map((u) => u.fid));
      const cands = [...headCode.keys()].filter(
        (id) => id.startsWith("ts:") && id.includes("#") && !bound.has(id)
      );
      if (cands.length > 0) {
        const del = pick(cands);
        const parent = headCode.get(del).parent;
        headCode.delete(del);
        headCode.get(parent).own += 1;
        headCode.get(parent).file += 1;
        feat("deleted-fn");
      }
    }
    // relocation (A.6.1.5 [D6]): a file moves, its text (and every own digest) unchanged
    if (chance(clean ? 0.15 : 0.2)) {
      const cands = [...files.keys()].filter((f) => headCode.has(f) && f !== "ts:scripts/tool.ts");
      const from = pick(cands);
      const path = from.slice(3);
      const parts = path.split("/");
      const within = chance(0.7);
      const to = within
        ? `${parts.slice(0, -1).join("/")}/moved/${parts.at(-1)}`
        : `scripts/moved_${parts.at(-1)}`;
      const toId = `ts:${to}`;
      if (!headCode.has(toId)) {
        const moved = [...headCode.entries()].filter(
          ([id, info]) => id === from || info.parent === from
        );
        for (const [id, info] of moved) {
          headCode.delete(id);
          const nid = id === from ? toId : `${toId}#${id.split("#")[1]}`;
          headCode.set(nid, {
            ...info,
            parent: info.parent ? toId : null,
            refs: (info.refs ?? []).map((r) =>
              r.startsWith(`${from}#`) ? `${toId}#${r.split("#")[1]}` : r
            )
          });
          for (const u of allUnits) if (u.fid === id) headBind.set(u.q, nid);
        }
        for (const [, info] of headCode)
          if (info.refs)
            info.refs = info.refs.map((r) =>
              r.startsWith(`${from}#`) ? `${toId}#${r.split("#")[1]}` : r
            );
        feat(within ? "relocation" : "relocation-across");
        const comp = files.get(from);
        files.set(toId, within ? comp : null);
        if (comp && within)
          for (const [id] of moved)
            if (id.includes("#")) compFns[comp].push(`${toId}#${id.split("#")[1]}`);
      }
    }
    if (chance(0.1)) {
      headCode.get("pkgjson:package.json").own += 1;
      headCode.get("pkgjson:package.json").file += 1;
      feat("pkg-changed");
    }
    if (hasScript && chance(0.15)) {
      headCode.get(SCRIPT_TEST).own += 1;
      headCode.get(SCRIPT_TEST).unit += 1;
      headCode.get("pkgjson:package.json").file += 1;
      feat("script-changed");
    }
    if (chance(0.12)) {
      headCode.get("ts:test/sys.test.ts").own += 1;
      headCode.get("ts:test/sys.test.ts").file += 1;
      feat("harness-changed");
    }
    if (chance(0.08)) {
      const t = pick([...headCode.keys()].filter((x) => x.startsWith("ts:")));
      headCode.get(t).hatchComplete = !(headCode.get(t).hatchComplete !== false);
      feat("hatch-complete-edited");
    }
  }
  // the head rebinds units whose code moved (relocation within the component)
  if (headBind.size > 0)
    for (const cd of head.modules[0].decls.filter((d) => d.decl === "component"))
      for (const u of cd.units ?? []) {
        const q = `${cd.was ?? cd.name}.${u.was ?? u.name}`;
        const nb = headBind.get(q) ?? headBind.get(`${cd.name}.${u.name}`);
        if (nb && u.bind) u.bind = `ts("${nb.slice(3)}")`;
      }
  const digestAt = (m, id, proj) => {
    const info = m.get(id);
    if (!info) return null;
    if (proj === "unit" && (info.unit === null || info.unit === undefined)) return null;
    if (proj === "file" && (info.file === null || info.file === undefined || id.includes("#")))
      return null;
    return label(`${info.okey} ${proj} v${info[proj]}`);
  };

  // ---- base variants: unreadable (L0) and empty (A.16.17) ---------------------------------------------
  const br = rnd();
  const baseKind =
    mode === "audit" ? "none" : !clean && br < 0.02 ? "unreadable" : br < 0.04 ? "empty" : "normal";
  if (baseKind !== "normal" && baseKind !== "none") feat(`base-${baseKind}`);

  // ---- records -----------------------------------------------------------------------------------------
  const headEsf = elaborate(head, { now: NOW_S });
  const baseEsf = elaborate(
    baseKind === "empty" ? { v: "shape.source.v1", modules: [] } : baseSrc,
    { now: NOW_S, lenient: true }
  );
  const govEsf = mode === "audit" || baseKind === "unreadable" ? headEsf : baseEsf;
  const hasProv = (n) =>
    govEsf.providers.some((p) => p.q === `m::${n}`) ||
    headEsf.providers.some((p) => p.q === `m::${n}`);
  const presenceSound = (n) =>
    [...govEsf.providers, ...headEsf.providers].some((p) => p.q === `m::${n}` && p.presence);
  const provSigner = (n) => key(`prov-${n}`);
  const signedRec = (r, signers) =>
    signers.length > 0 ? signStatement(makeStatement(r), signers) : makeStatement(r);
  const records = [];
  const baseRecords = [];
  const persisted = { base: [], head: [] };
  const recTime = (s) => isoTime(s);
  const tsIds = (m) =>
    [...m.keys()].filter((id) => id.startsWith("ts:") || id === "raw:tools/run.sh");
  const facts = [];
  const nOf = (presence) => {
    // D15: presence-sound observers report n (RJ14 otherwise); other observers may omit it
    if (presence) {
      if (!clean && chance(0.04)) {
        feat("fact-without-n-rejected");
        return undefined;
      }
      return pick([1, 1, 1, 2]);
    }
    if (chance(0.5)) {
      feat("fact-without-n");
      return undefined;
    }
    return pick([1, 2]);
  };
  const withN = (f, n) => (n === undefined ? f : { ...f, n });
  const effFactAt = (id, presence) => {
    const r = pick(RES);
    return withN(
      { type: "effect", at: id, verb: pick(VERBS), resource: pick(r.spell) },
      nOf(presence)
    );
  };
  const effUnitDecl = (u) =>
    head.modules[0].decls
      .filter((d) => d.decl === "component")
      .flatMap((c) => (c.name === u.comp || c.was === u.comp ? (c.units ?? []) : []))
      .find((x) => x.name === u.name || x.was === u.name);
  if (hasProv("eff") && chance(clean ? 1 : 0.9)) {
    const pres = presenceSound("eff");
    const stale = mode !== "audit" && chance(0.12);
    const m = stale ? baseCode : headCode;
    const rev = stale ? BASE_REV : HEAD_REV;
    const ids = tsIds(m).filter(() => chance(0.7));
    const entries = ids.map((id) => {
      const proj =
        m.get(id).unit !== null && m.get(id).unit !== undefined
          ? "unit"
          : id.includes("#")
            ? "own"
            : "file";
      const deps = chance(0.15)
        ? [citeOf(pick([...m.keys()].filter((x) => !x.includes("#"))), "own", null)].map((c) => ({
            ...c,
            digest: digestAt(m, c.id, "own")
          }))
        : [];
      return {
        ...citeOf(id, proj, digestAt(m, id, proj)),
        complete: chance(clean ? 0.95 : 0.75),
        deps
      };
    });
    const fs = [];
    for (const id of tsIds(m)) if (chance(0.25)) fs.push(effFactAt(id, pres));
    // summary-consistent facts at units (some left out: refutable lower bounds, D7)
    for (const u of allUnits) {
      const fid = headBind.get(u.q) ?? u.fid;
      const ud = effUnitDecl(u);
      for (const a of ud?.effects?.atoms ?? []) {
        if (!m.has(fid) || !chance(clean ? 0.9 : 0.75)) continue;
        const mm = /^(\w+)<(\w+)>$/.exec(a.atom);
        const rr = RES.find((x) => x.name === mm?.[2] || `${x.name}2` === mm?.[2]);
        if (mm && rr)
          fs.push(
            withN({ type: "effect", at: fid, verb: mm[1], resource: pick(rr.spell) }, nOf(pres))
          );
      }
    }
    facts.push(...fs);
    const rec = {
      v: "shape.evidence.v1",
      kind: "observation",
      result: "observes",
      provider: { id: "m::eff", version: "1" },
      revision: rev,
      time: recTime(-3600),
      scope: { root: scopeRoot(entries), entries },
      facts: fs,
      harness: [],
      assumptions: []
    };
    records.push(signedRec(rec, chance(0.95) ? [provSigner("eff")] : []));
    if (stale) feat("stale-observation");
    if (mode !== "audit" && baseKind === "normal" && chance(0.6)) {
      const bids = tsIds(baseCode).filter(() => chance(0.7));
      const bentries = bids.map((id) => {
        const proj =
          baseCode.get(id).unit !== null && baseCode.get(id).unit !== undefined
            ? "unit"
            : id.includes("#")
              ? "own"
              : "file";
        return {
          ...citeOf(id, proj, digestAt(baseCode, id, proj)),
          complete: chance(0.75),
          deps: []
        };
      });
      const bpres = baseEsf.providers.some((p) => p.q === "m::eff" && p.presence);
      const bfs = fs
        .filter((f) => baseCode.has(f.at) && chance(0.6))
        .map((f) => {
          // the base saw the fact as often, less often, or without n (D15: counts as more)
          const r = rnd();
          if (r < 0.15 && !bpres) {
            feat("base-fact-without-n");
            const { n: _n, ...rest } = f;
            return rest;
          }
          if (r < 0.3 && f.n) return { ...f, n: Math.max(1, f.n - 1) };
          return f.n === undefined && bpres ? { ...f, n: 1 } : f;
        });
      const brec = {
        v: "shape.evidence.v1",
        kind: "observation",
        result: "observes",
        provider: { id: "m::eff", version: "1" },
        revision: BASE_REV,
        time: recTime(-86400 * 5),
        scope: { root: scopeRoot(bentries), entries: bentries },
        facts: bfs,
        harness: [],
        assumptions: []
      };
      baseRecords.push(signedRec(brec, [provSigner("eff")]));
      feat("base-observation");
    }
  }
  if (hasProv("calls") && chance(clean ? 1 : 0.75)) {
    const callIds = (m) => [...m.keys()].filter((id) => id.startsWith("ts:") && id.includes("#"));
    const ids = callIds(headCode);
    const entries = ids
      .filter(() => chance(clean ? 0.95 : 0.6))
      .map((id) => ({
        ...citeOf(id, "unit", digestAt(headCode, id, "unit")),
        complete: chance(clean ? 0.95 : 0.55),
        deps: []
      }));
    const fs = [];
    for (let i = int(0, 4); i > 0; i -= 1) {
      const a = pick(ids);
      const b = pick(ids);
      if (a !== b) fs.push({ type: "call", at: a, to: b });
    }
    // calls out of summarised units (direct summaries, D2)
    for (const u of allUnits)
      if (effUnitDecl(u)?.effects?.mode === "complete" && chance(0.6)) {
        const fid = headBind.get(u.q) ?? u.fid;
        const b = pick(ids);
        if (headCode.has(fid) && b !== fid) {
          fs.push({ type: "call", at: fid, to: b });
          feat("call-from-summarised");
        }
      }
    // relations made true (most of the time; refutable otherwise, D7)
    for (const rel of head.modules[0].decls.filter((d) => d.decl === "relation")) {
      const ca = rel.connects[0].replace(/r$/, "");
      const cb = rel.connects[1].replace(/r$/, "");
      const fa = (compFns[ca] ?? []).filter((f) => headCode.has(f));
      const fb = (compFns[cb] ?? []).filter((f) => headCode.has(f));
      if (fa.length && fb.length && chance(clean ? 0.9 : 0.7))
        fs.push(
          rel.kind === "calls"
            ? { type: "call", at: fa[0], to: fb[0] }
            : { type: "edge", at: fa[0], kind: rel.kind, to: fb[0] }
        );
    }
    if (provs.calls.observes.includes("edge(data_flow)"))
      for (let i = int(0, 2); i > 0; i -= 1) {
        const a = pick(ids);
        const b = pick(ids);
        if (a !== b) fs.push({ type: "edge", at: a, kind: "data_flow", to: b });
      }
    const rec = {
      v: "shape.evidence.v1",
      kind: "observation",
      result: "observes",
      provider: { id: "m::calls", version: "1" },
      revision: HEAD_REV,
      time: recTime(-3600),
      scope: { root: scopeRoot(entries), entries },
      facts: fs,
      harness: [],
      assumptions: []
    };
    records.push(signedRec(rec, [provSigner("calls")]));
    if (provs.calls.sound.includes("absence")) feat("absence-sound-calls");
    // base call observation (lifted edges the base already had, D5; facts the base had seen, D7)
    if (
      mode !== "audit" &&
      baseKind === "normal" &&
      baseEsf.providers.some((p) => p.q === "m::calls") &&
      chance(0.5)
    ) {
      const bids = callIds(baseCode);
      const bentries = bids
        .filter(() => chance(0.7))
        .map((id) => ({
          ...citeOf(id, "unit", digestAt(baseCode, id, "unit")),
          complete: chance(0.6),
          deps: []
        }));
      const bfs = fs.filter((f) => baseCode.has(f.at) && baseCode.has(f.to) && chance(0.6));
      for (let i = int(0, 2); i > 0; i -= 1) {
        const a = pick(bids);
        const b = pick(bids);
        if (a !== b) bfs.push({ type: "call", at: a, to: b });
      }
      const brec = {
        v: "shape.evidence.v1",
        kind: "observation",
        result: "observes",
        provider: { id: "m::calls", version: "1" },
        revision: BASE_REV,
        time: recTime(-86400 * 5),
        scope: { root: scopeRoot(bentries), entries: bentries },
        facts: bfs,
        harness: [],
        assumptions: []
      };
      baseRecords.push(signedRec(brec, [provSigner("calls")]));
      feat("base-call-observation");
    }
  }
  // Req for a law claim (approximation of A.5.3.4 over this code model; partial on purpose sometimes)
  const unitFid = (uq) => {
    const [c0, n0] = uq.replace(/^m::/, "").split(".");
    const c = c0.replace(/r$/, "");
    const n = n0.replace(/x$/, "");
    const u = allUnits.find((x) => x.comp === c && x.name === n);
    if (u) return headBind.get(u.q) ?? u.fid;
    return compFns[c]?.find((f) => f.endsWith(`#${n}`)) ?? null;
  };
  const reqOf = (c, judgment, proj) => {
    const out = [];
    for (const t of c.args.on ?? []) {
      if (t.startsWith("unit ")) {
        const fid = unitFid(t.slice(5));
        if (fid && headCode.has(fid)) {
          out.push([fid, judgment ? (proj === "trust" ? "unit" : proj) : "unit"]);
          if (judgment)
            for (const r of headCode.get(fid).refs ?? [])
              if (headCode.has(r)) out.push([r, "unit"]);
        }
      } else if (t.startsWith("component ")) {
        const k = t.slice(10).replace(/^m::/, "").replace(/r$/, "");
        const fns = [...headCode.keys()].filter(
          (id) => id.includes("#") && files.get(headCode.get(id).parent) === k
        );
        for (const f of fns) out.push([f, "unit"]);
        for (const f of [...files.keys()].filter((x) => files.get(x) === k && headCode.has(x)))
          out.push([f, "own"]);
      }
    }
    return out;
  };
  const cites = (pairs, m) =>
    pairs
      .map(([id, p]) => citeOf(id, p, digestAt(m, id, p) ?? label(`${id} ${p} v0`)))
      .filter((c) => c.digest);
  const ce = (k) => ({ seed: k, inputs: [k, k + 1], assertion: `law ${k}` });
  for (const c of headEsf.claims.filter((x) => x.op === "law")) {
    const st = c.args.statement;
    if (st.schema && chance(clean ? 1 : 0.8)) {
      const r = rnd();
      const result = r < 0.55 ? "supports" : r < 0.8 ? "contradicts" : "inconclusive";
      const stale = mode !== "audit" && chance(0.15);
      const m = stale ? baseCode : headCode;
      let pairs = reqOf(c, false, "unit");
      if (pairs.length > 1 && chance(0.15)) pairs = pairs.slice(1);
      const codeC = cites(pairs, m);
      if (codeC.length === 0) continue;
      const harnessMoved = mode !== "audit" && chance(0.08);
      const rec = {
        v: "shape.evidence.v1",
        kind: "test",
        result,
        provider: { id: "m::tests", version: "1" },
        revision: stale ? BASE_REV : HEAD_REV,
        time: recTime(-7200),
        claim: { id: c.ids[0], fp: c.fp },
        code: codeC,
        harness: [
          citeOf(
            "ts:test/sys.test.ts",
            "own",
            digestAt(harnessMoved ? baseCode : m, "ts:test/sys.test.ts", "own")
          )
        ],
        assumptions: chance(0.1)
          ? [
              pick([
                { id: "z3@4.12.5", kind: "tool" },
                { id: "HostTrusted", kind: "named" },
                { id: "other@1", kind: "tool" }
              ])
            ]
          : [],
        bound: { runs: 100 }
      };
      if (harnessMoved) feat("harness-moved");
      const dr = rnd();
      if (dr < 0.2)
        rec.deps = [
          citeOf("pkgjson:package.json", "own", digestAt(m, "pkgjson:package.json", "own"))
        ];
      else if (dr < 0.45) {
        // the record's cone reaches a function of the same component (D4)
        const comp = files.get(m.get(codeC[0].id)?.parent ?? codeC[0].id);
        const others = (compFns[comp] ?? []).filter(
          (x) => m.has(x) && !codeC.some((cc) => cc.id === x)
        );
        if (others.length) {
          const o = pick(others);
          rec.deps = [citeOf(o, "unit", digestAt(m, o, "unit"))];
          feat("record-deps");
        }
      }
      const ceK = int(1, 3);
      if (result === "contradicts")
        rec.counterexample = chance(clean ? 0.95 : 0.85) ? ce(ceK) : { input: "[1,2]" };
      if (result === "contradicts" && !rec.counterexample.seed) feat("counterexample-v6-form");
      if (hasProv("tests")) records.push(signedRec(rec, [provSigner("tests")]));
      if (stale) feat("stale-test");
      // a base-revision record of the same provider (A.7.3.3's counterexample clause, D4)
      if (mode !== "audit" && baseKind === "normal" && hasProv("tests") && chance(0.2)) {
        const bpairs = reqOf(c, false, "unit").filter(([id]) => baseCode.has(id));
        const bcode = cites(bpairs, baseCode);
        if (bcode.length) {
          const brec = {
            ...rec,
            revision: BASE_REV,
            time: recTime(-86400 * 3),
            code: bcode,
            harness: [
              citeOf("ts:test/sys.test.ts", "own", digestAt(baseCode, "ts:test/sys.test.ts", "own"))
            ],
            result: "contradicts",
            counterexample:
              result === "contradicts" && rec.counterexample.seed && chance(0.5)
                ? rec.counterexample
                : ce(ceK + 5)
          };
          delete brec.deps;
          baseRecords.push(signedRec(brec, [provSigner("tests")]));
          feat("base-contradicting-test");
        }
      }
      if (hasProv("prover") && st.schema === "std::Deterministic" && chance(0.6)) {
        const prec = {
          ...rec,
          kind: "proof",
          provider: { id: "m::prover", version: "1" },
          result: chance(0.85) ? "supports" : "contradicts",
          assumptions: chance(0.3) ? [{ id: "z3@4.12.5", kind: "tool" }] : []
        };
        if (prec.result !== "contradicts") delete prec.counterexample;
        else prec.counterexample = ce(ceK);
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
      const m = rev === HEAD_REV ? headCode : baseCode;
      const codeC = cites(pairs, m);
      if (codeC.length === 0) continue;
      const rec = {
        v: "shape.evidence.v1",
        kind: "judgment",
        result: chance(0.8) ? "supports" : "contradicts",
        provider: null,
        revision: rev,
        time: recTime(-86400 * age - 60),
        claim: { id: c.ids[0], fp: c.fp },
        code: codeC,
        judge: `m::${judge}`
      };
      const env = signedRec(rec, [key(judge === "bot" ? "a-bot" : `p-${judge}`)]);
      const pr = rnd();
      if (mode !== "audit" && rev === BASE_REV && pr < 0.35) {
        // a persisted judgment of an earlier change (A.16.4(b), D12)
        const path = persistedPath(recordId(makeStatement(rec)));
        persisted.base.push({ path, record: env });
        persisted.head.push({ path, record: env });
        persistTree.push({ path, mode: "100644", blob: gitBlobId(Buffer.from(path)) });
        feat("persisted-judgment");
      } else if (mode !== "audit" && pr < 0.45) {
        const path = persistedPath(recordId(makeStatement(rec)));
        persisted.head.push({ path, record: env });
        persistTree.push({ path, mode: "100644", blob: gitBlobId(Buffer.from(path)) });
        feat("head-persisted-judgment");
      } else records.push(env);
      feat("judgment");
    }
  }
  const authorsPool = [
    [],
    [{ identity: 'github("bot[bot]")', verified: true, bot: true }],
    [{ identity: 'github("alice")', verified: true, bot: false }],
    [{ identity: 'github("bob")', verified: true, bot: false }],
    [{ identity: 'github("ghost[bot]")', verified: true, bot: true }],
    [
      { identity: 'github("carol")', verified: true, bot: false },
      { identity: 'github("bot[bot]")', verified: true, bot: true }
    ]
  ];
  const baseManifest = manifest7(
    BASE_REV,
    baseCode,
    persistTree.filter((t) => persisted.base.some((p) => p.path === t.path))
  );
  const headManifest = manifest7(HEAD_REV, headCode, persistTree);
  const signMan = (m) => {
    if (!manifestId) return m;
    if (chance(0.9)) {
      feat("manifest-signed");
      return signStatement(m, [key("manifest")]);
    }
    feat("manifest-unsigned");
    return m;
  };
  const input = {
    contract: "shape.check.input/v1",
    mode,
    now: NOW,
    head: { revision: HEAD_REV, source: head, manifest: signMan(headManifest) },
    base:
      mode === "audit"
        ? null
        : {
            revision: BASE_REV,
            source:
              baseKind === "unreadable"
                ? null
                : baseKind === "empty"
                  ? { v: "shape.source.v1", modules: [] }
                  : baseSrc,
            manifest: signMan(baseManifest),
            ...(chance(0.08) ? { committerTime: isoTime(86400 * 2) } : {})
          },
    change: { ids: [CHANGE] },
    authors: pick(authorsPool),
    reviews: [],
    records,
    baseRecords: mode === "audit" ? [] : baseRecords,
    persisted: mode === "audit" ? { base: [], head: [] } : persisted,
    options: { health: true, teeth: false }
  };
  if (input.authors.length > 0) feat("authors");
  meta.hasRelay = hasRelay;
  return { input, meta };
}

/** Phase 2: review lines (or, with a base relay, the relay's answer records) built from a phase-1
 *  output: approve refs (one or two persons), judge and reject lines. */
export function addReviews(input, phase1, seed, meta = {}) {
  const rnd = mulberry32(seed ^ 0x5bd1e995);
  const chance = (p) => rnd() < p;
  const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
  const people = ["alice", "bob", "carol", "dave", "bot"];
  const who = () => pick(people);
  const ident = (p) => (p === "bot" ? 'github("bot[bot]")' : `github("${p}")`);
  const obs = phase1.obligations ?? [];
  const reviews = [];
  const records = [...input.records];
  const features = [];
  const relayRecord = (p, refs, change) => {
    const s = {
      v: "shape.evidence.v1",
      kind: "judgment",
      result: "approves",
      provider: { id: "m::relay", version: "1" },
      revision: input.head.revision,
      time: "2026-10-25T11:30:00Z",
      judge: `m::${p}`,
      identity: ident(p),
      about: { change, refs: [...refs].sort() }
    };
    return signStatement(makeStatement(s), [key("prov-relay")]);
  };
  const n = Math.min(obs.length, 1 + Math.floor(rnd() * 4));
  for (let i = 0; i < n; i += 1) {
    const o = pick(obs);
    const refs = [o.binding.slice(0, 19)];
    if (chance(0.4)) refs.push(pick(obs).binding.slice(0, 19 + Math.floor(rnd() * 4)));
    const change = chance(0.92) ? CHANGE : OTHER_CHANGE;
    const approvers = o.tier === "final" || chance(0.25) ? [who(), who()] : [who()];
    if (approvers.length > 1) features.push("two-approvers");
    for (const p of approvers) {
      if (meta.hasRelay && chance(0.8)) {
        records.push(relayRecord(p, refs, change));
        features.push("relay-answer");
      } else reviews.push({ identity: ident(p), line: `shape approve ${refs.join(" ")}`, change });
    }
  }
  const laws = obs.filter(
    (o) =>
      o.claim && (o.kind === "unestablished" || o.kind === "contradiction") && o.subject === null
  );
  if (laws.length > 0 && chance(0.5)) {
    reviews.push({
      identity: ident(who()),
      line: `shape judge ${pick(laws).claim.ids[0]}`,
      change: CHANGE
    });
    features.push("judge-line");
  }
  if (laws.length > 0 && chance(0.15))
    reviews.push({
      identity: ident(who()),
      line: `shape reject ${pick(laws).claim.ids[0]} it is wrong`,
      change: CHANGE
    });
  return { input: { ...input, reviews, records }, features };
}
