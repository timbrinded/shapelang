// `shp migrate` for the prototype: 0.x `shp inspect --json` output (plus 0.x trait bodies, which
// inspect omits, read from the .shape text) → shape.source.v1, deterministically, minting no
// judgments or exceptions (A.11.1).
import type { Clause, Decl, SourceDoc, SourceModule, TemplateApp, UnitDecl } from "./source.ts";
import { cmpStr, sortedUniq } from "./util.ts";

export interface InspectRef {
  name: string;
  target: string;
}
export interface Inspect {
  documents: { file: string; module: string; imports: string[]; origin: string }[];
  resources: { id: string; name: string; module: string; file: string; traits: string[] }[];
  components: {
    id: string;
    name: string;
    module: string;
    classifiers: string[];
    grants: InspectRef[];
    owns: string[];
    functions: string[];
  }[];
  functions: {
    id: string;
    name: string;
    module: string;
    component: string;
    source: { language: string; path: string } | null;
    unsafe: boolean;
    effectsComplete: boolean;
    effects: { name: string; target: string }[];
    shapeTraits?: string[];
  }[];
  relations: {
    id: string;
    name: string;
    module: string;
    kind: string;
    endpoints?: { id: string; index: number }[];
    from?: string;
    to?: string;
  }[];
  implementations: {
    id: string;
    name: string;
    module: string;
    paths: string[];
    conformsTo: string;
  }[];
  bindings: { id: string; name: string }[];
  rules: {
    id: string;
    name: string;
    module: string;
    whenHas: { subject: string; trait: string }[];
    forbidEffects: { effect: string; target: string; targetBinding?: string; final: boolean }[];
    forbidProvides: { target: string; except?: string }[];
    forbidHypercycles: { kinds: string[] }[];
    forbidPaths: { source: string; target: string; kinds: string[] }[];
  }[];
  memories: {
    id: string;
    name: string;
    module: string;
    target: { kind: string; id: string };
    summary: string;
    owner?: string;
    confidence?: string;
    guards?: string[];
  }[];
}

export interface TraitBody {
  name: string;
  module: string;
  params: { name: string; kind: string }[];
  forbids: { effect: string; target: string; final: boolean }[];
}

const STD_EFFECTS = new Set([
  "Read",
  "Write",
  "Export",
  "Append",
  "Import",
  "Update",
  "Redact",
  "LogicalDelete",
  "HardDelete",
  "Truncate",
  "DropStorage",
  "Hatch"
]);
const STD_KINDS = new Set(["calls", "callbacks", "provides", "data_flow", "coordinated_call"]);
/** the 0.x prelude markers that std 1.0 declares (A.13.2) */
const STD_MARKERS = new Set([
  "PII",
  "Persistent",
  "Ephemeral",
  "Secret",
  "Public",
  "External",
  "Internal",
  "StorageAdapter",
  "DataPlane",
  "ControlPlane"
]);
/** 0.x shape traits that std 1.0 declares as unit templates requiring a note (A.11.1(f)) */
const STD_SHAPE_TRAITS = new Set([
  "PreserveInline",
  "RequiresDescription",
  "TestOnly",
  "ProtectedCheckOrder",
  "NonIdiomatic"
]);

/** Reads `trait Name<T: Kind> { forbid [final] Effect<T> … }` bodies from 0.x text. */
export function extractTraits(file: string, module: string, text: string): TraitBody[] {
  const out: TraitBody[] = [];
  const re = /\btrait\s+([A-Za-z_]\w*)\s*<([^>]*)>\s*\{([^}]*)\}/g;
  let m: RegExpExecArray | null = re.exec(text);
  while (m) {
    const params = (m[2] ?? "")
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => {
        const [n, k] = p.split(":").map((x) => x.trim());
        return { name: n ?? "T", kind: (k ?? "Resource").toLowerCase() };
      });
    const forbids: TraitBody["forbids"] = [];
    const fre = /\bforbid\s+(final\s+)?([A-Za-z_]\w*)\s*<\s*([A-Za-z_]\w*)\s*>/g;
    let f: RegExpExecArray | null = fre.exec(m[3] ?? "");
    while (f) {
      forbids.push({ effect: f[2] ?? "", target: f[3] ?? "", final: !!f[1] });
      f = fre.exec(m[3] ?? "");
    }
    out.push({ name: m[1] ?? "", module, params, forbids });
    m = re.exec(text);
  }
  void file;
  return out;
}

function local(q: string, module: string): string {
  return q.startsWith(`${module}::`) ? q.slice(module.length + 2) : q;
}

export interface MigrateOptions {
  /** owner actor for the synthesised shape declaration (default: Maintainers) */
  owner?: string;
  /** persons (code-host logins) placed in the owner team, e.g. github logins */
  maintainers?: string[];
  shapeName?: string;
  traits?: TraitBody[];
  /** include `origin: generated_ast` documents (mapper output; default false: observe, don't author) */
  includeGenerated?: boolean;
}

export interface MigrateResult {
  source: SourceDoc;
  notes: string[];
  renames: { from: string; to: string }[];
}

export function migrate(insAll: Inspect, opts: MigrateOptions = {}): MigrateResult {
  const notes: string[] = [];
  const ins = opts.includeGenerated ? insAll : withoutGenerated(insAll);
  if (ins !== insAll) {
    const n = insAll.documents.length - ins.documents.length;
    if (n > 0)
      notes.push(`skipped ${n} generated_ast documents (mapper output, not authored claims)`);
  }
  const modules = new Map<string, SourceModule>();
  const mod = (name: string): SourceModule => {
    let m = modules.get(name);
    if (!m) {
      const doc = ins.documents.find((d) => d.module === name);
      m = {
        module: name,
        imports: sortedUniq(["std", ...(doc?.imports ?? [])]),
        decls: [],
        file: doc?.file
      };
      modules.set(name, m);
    }
    return m;
  };
  for (const d of ins.documents) mod(d.module);
  const MIG = "shape1.migrated";
  const effects = new Set<string>();
  const kinds = new Map<string, { from: "component" | "resource"; to: "component" | "resource" }>();
  const resourceIds = new Set(ins.resources.map((r) => r.id));
  const traitsByQ = new Map<string, TraitBody>();
  for (const t of opts.traits ?? []) traitsByQ.set(`${t.module}::${t.name}`, t);
  const usedTemplates = new Map<string, "resource" | "component">();

  const atom = (effect: string, target: string, module: string): string => {
    if (!STD_EFFECTS.has(effect)) effects.add(effect);
    return `${effect}<${target.includes("::") ? target : local(target, module)}>`;
  };

  // resources (A.11.1(e), A.16.33(a)): the tier of forbid final and of the prelude AppendOnly
  // belongs to the migrated claim, never to the bearer; a resource keeps its 0.x tier
  const twoPersons = sortedUniq(opts.maintainers ?? []).length >= 2;
  const finalTier = twoPersons ? "final" : "critical";
  const ruleDecls: { module: string; decl: Decl }[] = [];
  for (const r of [...ins.resources].sort((a, b) => cmpStr(a.id, b.id))) {
    const attach: TemplateApp[] = [];
    for (const t of [...r.traits].sort(cmpStr)) {
      const short = t.split("::").pop() ?? t;
      if (short === "AppendOnly" && !t.includes("::")) {
        // the 0.x prelude AppendOnly (final HardDelete, Truncate, DropStorage) is std::NoHardDelete
        ruleDecls.push({
          module: r.module,
          decl: {
            decl: "rule",
            name: `${r.name}_NoHardDelete`,
            template: { name: "std::NoHardDelete", args: [r.name] },
            tier: finalTier
          }
        });
        notes.push(
          `prelude AppendOnly on ${r.id} → rule ${r.name}_NoHardDelete = std::NoHardDelete<${r.name}> tier ${finalTier}` +
            (twoPersons ? "" : " (lowered: the owner and shape owner lack two distinct persons)")
        );
      } else if (STD_MARKERS.has(short) && !t.includes("::"))
        attach.push({ name: `std::${short}` });
      else {
        const tb = traitsByQ.get(t);
        if (tb?.forbids.some((f) => f.final) && !twoPersons) {
          ruleDecls.push({
            module: r.module,
            decl: {
              decl: "rule",
              name: `${r.name}_${short}`,
              template: { name: t, args: [r.name] },
              tier: "critical"
            }
          });
          notes.push(
            `trait ${t} on ${r.id}: forbid final lowered to critical (no two distinct persons)`
          );
        } else attach.push({ name: t });
        usedTemplates.set(t, "resource");
      }
    }
    mod(r.module).decls.push({
      decl: "resource",
      name: r.name,
      ...(attach.length > 0 ? { attach } : {})
    });
  }

  // components, units, implementations → paths
  const pathsOf = new Map<string, string[]>();
  for (const i of ins.implementations)
    pathsOf.set(i.conformsTo, sortedUniq([...(pathsOf.get(i.conformsTo) ?? []), ...i.paths]));
  for (const c of [...ins.components].sort((a, b) => cmpStr(a.id, b.id))) {
    const units: UnitDecl[] = [];
    for (const fq of [...c.functions].sort(cmpStr)) {
      const f = ins.functions.find((x) => x.id === fq);
      if (!f) continue;
      const attach: TemplateApp[] = [];
      for (const st of f.shapeTraits ?? []) {
        const short = st.split("::").pop() ?? st;
        // a RefactorSensitive marker yields its law only with a guard (A.11.1(g)), added below
        if (short === "RefactorSensitive") continue;
        if (STD_SHAPE_TRAITS.has(short)) attach.push({ name: `std::${short}` });
        else notes.push(`dropped shape trait ${st} on ${f.id}`);
      }
      const u: UnitDecl = { name: f.name };
      if (f.source?.path) u.bind = `${f.source.language}(${JSON.stringify(f.source.path)})`;
      if (f.effectsComplete)
        u.effects = {
          mode: "complete",
          atoms: f.effects.map((e) => ({ atom: atom(e.name, e.target, c.module) }))
        };
      else if (f.effects.length > 0)
        u.effects = {
          mode: "partial",
          atoms: f.effects.map((e) => ({ atom: atom(e.name, e.target, c.module) }))
        };
      if (attach.length > 0) u.attach = attach;
      if (f.unsafe) {
        // 0.x unsafe effects → a decision note holding them as text; nothing else (A.11.1(c))
        mod(c.module).decls.push({
          decl: "note",
          name: `${c.name}_${f.name}_unsafe`,
          kind: "decision",
          about: [`unit ${c.name}.${f.name}`],
          text: "0.x unsafe effects (reason, expires, requires), kept as text by migrate."
        });
        notes.push(`unsafe on ${f.id} → decision note ${c.name}_${f.name}_unsafe`);
      }
      units.push(u);
    }
    const attach: TemplateApp[] = c.classifiers.map((t) => {
      const short = t.split("::").pop() ?? t;
      if (STD_MARKERS.has(short) && !t.includes("::")) return { name: `std::${short}` };
      usedTemplates.set(t, "component");
      return { name: t };
    });
    const decl: Decl = {
      decl: "component",
      name: c.name,
      ...(attach.length > 0 ? { attach } : {}),
      ...(pathsOf.has(c.id) ? { paths: pathsOf.get(c.id) } : {}),
      ...(c.grants.length > 0
        ? { grants: sortedUniq(c.grants.map((g) => atom(g.name, g.target, c.module))) }
        : {}),
      ...(units.length > 0 ? { units } : {})
    };
    // owns R → R's owner is the owning component's owner only; 0.x owns is name-checked and not
    // exclusive, so no std::Owns is minted (A.11.1(d) [D19])
    mod(c.module).decls.push(decl);
    for (const r of c.owns) notes.push(`owns ${r} in ${c.id} → resource owner only (no std::Owns)`);
  }

  // relations
  for (const r of [...ins.relations].sort((a, b) => cmpStr(a.id, b.id))) {
    const ends =
      r.endpoints && r.endpoints.length > 0
        ? [...r.endpoints].sort((a, b) => a.index - b.index).map((e) => e.id)
        : [r.from ?? "", r.to ?? ""];
    if (!STD_KINDS.has(r.kind) && !kinds.has(r.kind)) {
      kinds.set(r.kind, {
        from: "component",
        to: resourceIds.has(ends[ends.length - 1] ?? "") ? "resource" : "component"
      });
    }
    mod(r.module).decls.push({ decl: "relation", name: r.name, kind: r.kind, connects: ends });
  }

  // rules
  for (const r of [...ins.rules].sort((a, b) => cmpStr(a.id, b.id))) {
    const clauses: Clause[] = [];
    for (const f of r.forbidEffects)
      clauses.push({ forbid: "effect", final: f.final, atom: atom(f.effect, f.target, r.module) });
    for (const p of r.forbidProvides)
      clauses.push({
        forbid: "edge",
        kind: "provides",
        from: ["*"],
        to: [p.target],
        ...(p.except ? { exceptFrom: [p.except] } : {})
      });
    for (const h of r.forbidHypercycles)
      clauses.push({ forbid: "cycle", over: [...h.kinds].sort(cmpStr) });
    // forbid paths with the same target and kinds are one multi-source clause (A.13.4)
    const byTarget = new Map<string, { target: string; kinds: string[]; sources: string[] }>();
    for (const p of r.forbidPaths) {
      const k = `${p.target}|${[...p.kinds].sort(cmpStr).join(",")}`;
      const e = byTarget.get(k) ?? {
        target: p.target,
        kinds: [...p.kinds].sort(cmpStr),
        sources: []
      };
      e.sources.push(p.source);
      byTarget.set(k, e);
    }
    for (const e of [...byTarget.values()].sort((a, b) => cmpStr(a.target, b.target)))
      clauses.push({ forbid: "path", from: sortedUniq(e.sources), to: [e.target], over: e.kinds });
    const when = r.whenHas.map((w) => ({
      param: w.subject,
      has: w.trait.includes("::")
        ? w.trait
        : STD_MARKERS.has(w.trait) || w.trait === "AppendOnly"
          ? `std::${w.trait}`
          : w.trait
    }));
    for (const w of when) {
      if (w.has === "std::AppendOnly")
        notes.push(
          `rule ${r.id}: when ${w.param} has AppendOnly names the prelude trait, migrated as std::NoHardDelete rules`
        );
      if (!w.has.startsWith("std::") && !usedTemplates.has(w.has))
        usedTemplates.set(w.has, "resource");
    }
    mod(r.module).decls.push({
      decl: "rule",
      name: r.name,
      clauses,
      ...(when.length > 0 ? { when } : {})
    });
  }

  // memories → notes (A.11.1(g)); a guard → one informal law on its target (RefactorSensitive's
  // law when the target carries that marker); a marker with no guard → the note alone
  const markerOn = new Set(
    ins.functions
      .filter((f) =>
        (f.shapeTraits ?? []).some((t) => (t.split("::").pop() ?? t) === "RefactorSensitive")
      )
      .map((f) => f.id)
  );
  for (const m of [...ins.memories].sort((a, b) => cmpStr(a.id, b.id))) {
    const tkind = m.target.kind === "fn" ? "unit" : m.target.kind;
    // a 0.x owner names no actor migrate declares: dropped from owner, kept as a text line
    const lines = [m.summary];
    if (m.owner) {
      lines.push(`owner: ${m.owner}`);
      notes.push(`memory ${m.id}: owner ${m.owner} names no migrated actor; kept as text`);
    }
    mod(m.module).decls.push({
      decl: "note",
      name: m.name,
      kind: "memory",
      about: [`${tkind} ${m.target.id}`],
      text: lines.join("\n"),
      ...(m.confidence
        ? { confidence: m.confidence.toLowerCase() as "low" | "medium" | "high" }
        : {})
    });
    if ((m.guards ?? []).length === 0) continue;
    if (m.target.kind === "fn" && markerOn.has(m.target.id)) {
      const comp = m.target.id.slice(0, m.target.id.lastIndexOf("."));
      const unitName = m.target.id.slice(m.target.id.lastIndexOf(".") + 1);
      const cm = [...modules.values()]
        .flatMap((x) => x.decls.map((d) => ({ x, d })))
        .find(({ x, d }) => d.decl === "component" && `${x.module}::${d.name}` === comp);
      if (cm && cm.d.decl === "component") {
        const u = (cm.d.units ?? []).find((y) => y.name === unitName);
        if (u && !(u.attach ?? []).some((a) => a.name.endsWith("RefactorSensitive")))
          u.attach = [...(u.attach ?? []), { name: "std::RefactorSensitive" }];
      }
    } else {
      const target = `${tkind} ${local(m.target.id, m.module)}`;
      mod(m.module).decls.push({
        decl: "law",
        name: `${m.name}Guard`,
        on: [target],
        informal: `Changes to this ${tkind} preserve the constraint recorded in memory ${m.name}.`
      });
    }
  }
  for (const r of ruleDecls) mod(r.module).decls.push(r.decl);
  for (const b of ins.bindings)
    notes.push(
      `binding ${b.id} (when changed → require changed) maps to DocumentedBy; not migrated`
    );

  // the migration module: shape declaration, owners, undeclared effects, kinds, marker templates
  const migDecls: Decl[] = [];
  const ownerName = opts.owner ?? "Maintainers";
  migDecls.push({
    decl: "shape",
    name: opts.shapeName ?? "Migrated",
    owner: `${MIG}::${ownerName}`
  });
  const maint = sortedUniq(opts.maintainers ?? []);
  migDecls.push({
    decl: "actor",
    name: ownerName,
    kind: "team",
    members: maint.map((m) => `person_${m.replace(/\W/g, "_")}`)
  });
  for (const m of maint)
    migDecls.push({
      decl: "actor",
      name: `person_${m.replace(/\W/g, "_")}`,
      kind: "person",
      identities: [`github(${JSON.stringify(m)})`]
    });
  for (const e of [...effects].sort(cmpStr)) migDecls.push({ decl: "effect", name: e });
  for (const [k, v] of [...kinds.entries()].sort((a, b) => cmpStr(a[0], b[0])))
    migDecls.push({ decl: "kind", name: k, from: v.from, to: v.to });
  for (const [t, bearer] of [...usedTemplates.entries()].sort((a, b) => cmpStr(a[0], b[0]))) {
    if (t.startsWith("std::")) continue;
    const tb = traitsByQ.get(t);
    const [m, n] = t.includes("::")
      ? [t.slice(0, t.lastIndexOf("::")), t.slice(t.lastIndexOf("::") + 2)]
      : [MIG, t];
    const params = (tb?.params ?? [{ name: "T", kind: bearer }]).map(
      (p) =>
        [p.name, p.kind === "component" ? "component" : p.kind === "fn" ? "unit" : "resource"] as [
          string,
          "resource" | "component" | "unit"
        ]
    );
    const body = (tb?.forbids ?? []).map(
      (f): Clause => ({ forbid: "effect", final: f.final, atom: `${f.effect}<${f.target}>` })
    );
    for (const f of tb?.forbids ?? []) if (!STD_EFFECTS.has(f.effect)) effects.add(f.effect);
    const target = m === MIG ? migDecls : mod(m).decls;
    if (!target.some((d) => d.decl === "template" && d.name === n))
      target.push({ decl: "template", name: n, params, body });
  }
  for (const e of [...effects].sort(cmpStr))
    if (!migDecls.some((d) => d.decl === "effect" && d.name === e))
      migDecls.push({ decl: "effect", name: e });
  modules.set(MIG, { module: MIG, imports: ["std"], decls: migDecls, file: "shape1.migrated" });
  // every module imports the migration module so marker templates and owners resolve
  for (const m of modules.values())
    if (m.module !== MIG) m.imports = sortedUniq([...(m.imports ?? []), MIG]);
  const source: SourceDoc = {
    v: "shape.source.v1",
    modules: [...modules.values()].sort((a, b) => cmpStr(a.module, b.module))
  };
  return { source, notes: sortedUniq(notes), renames: [] };
}

/** Merges a sidecar (shape.source.v1) into a source: same (module, decl, name) replaces, else appends. */
export function mergeSidecar(base: SourceDoc, sidecar: SourceDoc | null): SourceDoc {
  if (!sidecar) return base;
  const modules = new Map(base.modules.map((m) => [m.module, { ...m, decls: [...m.decls] }]));
  const hasShape = sidecar.modules.some((m) => m.decls.some((d) => d.decl === "shape"));
  if (hasShape)
    for (const m of modules.values()) m.decls = m.decls.filter((d) => d.decl !== "shape");
  for (const sm of sidecar.modules) {
    const m = modules.get(sm.module) ?? {
      module: sm.module,
      imports: [],
      decls: [],
      file: sm.file
    };
    m.imports = sortedUniq([...(m.imports ?? []), ...(sm.imports ?? [])]);
    for (const d of sm.decls) {
      const name = d.decl === "hatch" ? d.names.join(",") : d.name;
      const i = m.decls.findIndex(
        (x) => x.decl === d.decl && (x.decl === "hatch" ? x.names.join(",") : x.name) === name
      );
      if (i >= 0) m.decls[i] = d;
      else m.decls.push(d);
    }
    modules.set(sm.module, m);
  }
  return {
    v: "shape.source.v1",
    lock: sidecar.lock ?? base.lock,
    modules: [...modules.values()].sort((a, b) => cmpStr(a.module, b.module))
  };
}

function withoutGenerated(ins: Inspect): Inspect {
  const gen = new Set(
    ins.documents.filter((d) => d.origin === "generated_ast").map((d) => d.module)
  );
  if (gen.size === 0) return ins;
  const keep = <T extends { module: string }>(xs: T[]): T[] => xs.filter((x) => !gen.has(x.module));
  return {
    ...ins,
    documents: ins.documents.filter((d) => !gen.has(d.module)),
    resources: keep(ins.resources),
    components: keep(ins.components),
    functions: keep(ins.functions),
    relations: keep(ins.relations),
    implementations: keep(ins.implementations),
    bindings: ins.bindings,
    rules: keep(ins.rules),
    memories: keep(ins.memories)
  };
}

export interface BindIndex {
  fileIdByPath: Map<string, string>;
  idsByFile: Map<string, string[]>;
  has: (id: string) => boolean;
}

/**
 * Migration-time rewrite of 0.x unit sources against a manifest (A.11.1): registry languages by
 * path, exact symbols, then a unique same-file identity whose last segment is the symbol;
 * unregistered languages bind their raw file identity. Returns the rewritten source and renames.
 */
export function rewriteBinds(
  src: SourceDoc,
  idx: BindIndex
): { source: SourceDoc; renames: { from: string; to: string }[] } {
  const renames: { from: string; to: string }[] = [];
  const modules = src.modules.map((m) => ({
    ...m,
    decls: m.decls.map((d) => {
      if (d.decl !== "component" || !d.units) return d;
      return {
        ...d,
        units: d.units.map((u) => {
          if (!u.bind) return u;
          const mm = /^\s*([A-Za-z_][\w-]*)\("((?:[^"\\]|\\.)*)"\)\s*$/.exec(u.bind);
          if (!mm) return u;
          const raw = JSON.parse(`"${mm[2] ?? ""}"`) as string;
          const hash = raw.indexOf("#");
          const path = hash >= 0 ? raw.slice(0, hash) : raw;
          const sym = hash >= 0 ? raw.slice(hash + 1) : null;
          const fileId = idx.fileIdByPath.get(path);
          if (!fileId) return u;
          const lang = fileId.slice(0, fileId.indexOf(":"));
          let target: string | null = null;
          if (!sym || lang === "raw" || lang === "gha" || lang === "pkgjson") target = fileId;
          else {
            const exact = `${fileId}#${sym}`;
            if (idx.has(exact)) target = exact;
            else {
              const sep = lang === "rust" || lang === "verus" ? "::" : ".";
              const cands = (idx.idsByFile.get(fileId) ?? []).filter((x) => {
                const s = x.slice(fileId.length + 1);
                return s === sym || s.endsWith(`${sep}${sym}`);
              });
              if (cands.length === 1) target = cands[0] as string;
            }
          }
          if (!target) return u;
          const bind = `${lang}(${JSON.stringify(target.slice(lang.length + 1))})`;
          if (bind !== u.bind) renames.push({ from: u.bind, to: bind });
          return { ...u, bind };
        })
      };
    })
  }));
  return { source: { ...src, modules }, renames: renames.sort((a, b) => cmpStr(a.from, b.from)) };
}
