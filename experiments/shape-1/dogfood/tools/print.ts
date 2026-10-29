// Prints a shape.source.v1 model in the Shape 1.0 surface syntax (syntax §2), one module after
// another. Used to render Shape's own 1.0 model legibly: model.source.json → model.shape1.
// (The extension is not .shape: the repository's `format:shape` runs the 0.x formatter on every
// *.shape file.)
//
//   bun experiments/shape-1/dogfood/tools/print.ts [--model <json>] [--out <file>] [--overlay]
//
// --overlay prints shape1.yaml's declarations only (the authored 1.0 additions).
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  Clause,
  Decl,
  EvidenceSpec,
  SourceDoc,
  TBody,
  TemplateApp,
  UnitDecl
} from "../../proto/src/source.ts";
import { DOGFOOD, readModel, readOverlay } from "./lib.ts";

const q = (s: string): string => JSON.stringify(s);
const app = (t: TemplateApp): string =>
  `${t.name}${t.args && t.args.length > 0 ? `<${t.args.map((a) => (typeof a === "number" ? String(a) : /^[\w.:]+$/.test(a) || /^\w+<[\w.:]+>$/.test(a) || a.startsWith("code ") ? a : q(a))).join(", ")}>` : ""}`;
const attach = (xs: TemplateApp[] | undefined): string =>
  xs && xs.length > 0 ? ` : ${xs.map(app).join(", ")}` : "";

function evidence(e: EvidenceSpec | undefined): string[] {
  if (!e) return [];
  const level =
    e.judged && !e.level ? "judged" : `${e.level ?? "declared"}${e.orJudged ? " or judged" : ""}`;
  return [
    `evidence ${level}${e.at ? ` at ${e.at}` : ""}${e.by && e.by.length > 0 ? ` by ${e.by.join(", ")}` : ""}`
  ];
}

function meta(d: { owner?: string; tier?: string; was?: string }): string[] {
  return [
    ...(d.owner ? [`owner ${d.owner}`] : []),
    ...(d.tier ? [`tier ${d.tier}`] : []),
    ...(d.was ? [`was ${d.was}`] : [])
  ];
}

function clause(c: Clause): string {
  const fin = c.final ? "final " : "";
  switch (c.forbid) {
    case "effect":
      return `forbid ${fin}${c.atom}${c.within && c.within.length > 0 ? ` within ${c.within.join(", ")}` : ""}${c.except && c.except.length > 0 ? ` except ${c.except.join(", ")}` : ""}`;
    case "path":
      return `forbid ${fin}path ${c.from.join(", ")} -> ${c.to.join(", ")} over ${c.over.join(", ")}${c.exceptVia && c.exceptVia.length > 0 ? ` except via ${c.exceptVia.join(", ")}` : ""}`;
    case "edge":
      return `forbid ${fin}edge ${c.kind} from ${c.from.join(", ")} to ${c.to.join(", ")}${c.exceptFrom && c.exceptFrom.length > 0 ? ` except from ${c.exceptFrom.join(", ")}` : ""}${c.exceptTo && c.exceptTo.length > 0 ? ` except to ${c.exceptTo.join(", ")}` : ""}`;
    case "cycle":
      return `forbid ${fin}cycle over ${c.over.join(", ")}`;
    case "hatch":
      return `forbid ${fin}hatch ${c.kinds.join(", ")} outside boundaries`;
  }
}

function block(head: string, lines: string[]): string[] {
  if (lines.length === 0) return [head];
  return [`${head} {`, ...lines.map((l) => `  ${l}`), "}"];
}

function unit(u: UnitDecl): string[] {
  const body: string[] = [...meta(u)];
  if (u.bind) body.push(`bind ${u.bind}`);
  if (u.effects?.mode === "unknown") body.push("effects unknown");
  else if (u.effects) {
    const atoms = [
      ...new Set((u.effects.atoms ?? []).map((a) => `${a.atom}${a.via ? ` via ${a.via}` : ""}`))
    ];
    body.push(
      atoms.length === 0
        ? `effects ${u.effects.mode} {}`
        : `effects ${u.effects.mode} { ${atoms.join(" ")} }`
    );
  }
  return block(`unit ${u.name}${attach(u.attach)}`, body);
}

function tbody(b: TBody): string[] {
  if ("forbid" in b) return [clause(b)];
  if ("grants" in b) return [`grants ${b.grants}`];
  if ("requiresNote" in b) return [`requires note ${b.requiresNote}`];
  if ("order" in b) return [`order ${b.order[0]} by ${b.order[1]}`];
  return block("law", [
    ...(b.law.on ? [`on ${b.law.on.join(", ")}`] : []),
    ...(b.law.informal !== undefined ? [`informal ${q(b.law.informal)}`] : []),
    ...evidence(b.law.evidence)
  ]);
}

export function printDecl(d: Decl): string[] {
  switch (d.decl) {
    case "shape":
      return [`shape ${d.name} { owner ${d.owner}${d.policy ? ` policy ${d.policy}` : ""} }`];
    case "actor":
      return [
        `actor ${d.name} { kind ${d.kind}${d.operator ? ` operator ${d.operator}` : ""}${(d.identities ?? []).map((i) => ` identity ${i}`).join("")}${(d.members ?? []).map((m) => ` member ${m}`).join("")} }`
      ];
    case "effect":
      return [
        `effect ${d.name}${d.implies && d.implies.length > 0 ? ` implies ${d.implies.join(", ")}` : ""}`
      ];
    case "kind":
      return [`kind ${d.name} from ${d.from} to ${d.to}`];
    case "hatch":
      return [`hatch ${d.names.join(", ")} in ${d.lang}`];
    case "resource": {
      const body = [
        ...meta(d),
        ...(d.bind && d.bind.length > 0 ? [`bind ${d.bind.join(", ")}`] : [])
      ];
      return body.length === 0
        ? [`resource ${d.name}${attach(d.attach)}`]
        : block(`resource ${d.name}${attach(d.attach)}`, body);
    }
    case "component": {
      const body: string[] = [...meta(d)];
      if (d.paths && d.paths.length > 0) body.push(`bind paths { ${d.paths.map(q).join(" ")} }`);
      if (d.grants === "none") body.push("grants none");
      else if (d.grants && d.grants.length > 0) body.push(`grants ${d.grants.join(", ")}`);
      if (d.relationsComplete && d.relationsComplete.length > 0)
        body.push(`relations complete over ${d.relationsComplete.join(", ")}`);
      if (d.allows && d.allows.length > 0) body.push(`allows hatch ${d.allows.join(", ")}`);
      for (const a of d.assumes ?? []) body.push(`assumes ${a.id} ${q(a.text)}`);
      for (const u of d.units ?? []) body.push(...unit(u));
      return block(`${d.boundary ? "boundary" : "component"} ${d.name}${attach(d.attach)}`, body);
    }
    case "relation":
      return block(`relation ${d.name}`, [
        `kind ${d.kind}`,
        `connects ${d.connects.join(" -> ")}`,
        ...meta(d),
        ...evidence(d.evidence)
      ]);
    case "rule":
      if (d.template) return block(`rule ${d.name} = ${app(d.template)}`, [...meta(d)]);
      return block(`rule ${d.name}`, [
        ...(d.clauses ?? []).map(clause),
        ...(d.when ?? []).map((w) => `when ${w.param} has ${w.has}`),
        ...meta(d)
      ]);
    case "law": {
      const on = d.on && d.on.length > 0 ? [`on ${d.on.join(", ")}`] : [];
      const rest = [...meta(d), ...evidence(d.evidence)];
      if (d.template) return block(`law ${d.name} = ${app(d.template)}`, [...on, ...rest]);
      const st = d.statement
        ? [`statement ${d.statement}`]
        : d.informal !== undefined
          ? [`informal ${q(d.informal)}`]
          : [];
      return block(`law ${d.name}`, [...on, ...st, ...rest]);
    }
    case "template":
      return block(
        `template ${d.name}<${d.params.map(([p, k]) => `${p}: ${k}`).join(", ")}>`,
        d.body.flatMap(tbody)
      );
    case "exception":
      return block(`exception ${d.name}`, [
        `waives ${d.waives && d.waives.length > 0 ? `${d.waives.join(", ")} of ` : ""}${d.target}${d.for && d.for.length > 0 ? ` for ${d.for.join(", ")}` : ""}`,
        `owner ${d.owner}`,
        `expires ${q(d.expires)}`
      ]);
    case "note":
      return block(`note ${d.name} : ${d.kind}`, [
        `about ${d.about.join(", ")}`,
        ...(d.owner ? [`owner ${d.owner}`] : []),
        ...(d.text ? [`text ${q(d.text)}`] : []),
        ...(d.confidence ? [`confidence ${d.confidence}`] : [])
      ]);
    case "provider": {
      const body: string[] = [`produces ${d.produces.join(", ")}`];
      if (d.observes && d.observes.length > 0) body.push(`observes ${d.observes.join(", ")}`);
      for (const x of d.decides ?? []) body.push(`decides ${x}`);
      body.push(`sound ${d.sound && d.sound.length > 0 ? d.sound.join(", ") : "none"}`);
      if (d.persist) body.push("persist");
      if (d.depsComplete) body.push("deps complete");
      if (d.identity) body.push(`identity ${d.identity}`);
      for (const [t, v] of d.trusts ?? []) body.push(`trusts tool(${q(t)}, ${q(v)})`);
      if (d.implementation)
        body.push(
          `implementation { ${d.implementation.paths ? `bind paths { ${d.implementation.paths.map(q).join(" ")} }` : ""}${d.implementation.digest ? ` digest ${q(d.implementation.digest)}` : ""} }`
        );
      return block(`provider ${d.name}`, body);
    }
    case "policy": {
      const tiers = (["low", "normal", "critical"] as const).flatMap((t) => {
        const p = d.tiers[t];
        if (!p) return [];
        const parts = [
          ...(p.floor ? [`floor ${p.floor}`] : []),
          ...(p.blocks && p.blocks.length > 0
            ? [`blocks ${p.blocks.map((b) => b.replace("-", " ")).join(", ")}`]
            : []),
          ...(p.maxAge !== undefined ? [`max_age ${p.maxAge} days`] : []),
          ...(p.judges && p.judges.length > 0 ? [`judges ${p.judges.join(", ")}`] : [])
        ];
        return [`tier ${t} { ${parts.join(" ")} }`];
      });
      return block(`policy ${d.name}`, [
        ...tiers,
        ...(d.budget !== undefined ? [`judgment budget ${d.budget} per change`] : [])
      ]);
    }
  }
}

export function printModel(doc: SourceDoc): string {
  const out: string[] = [];
  for (const m of doc.modules) {
    out.push(
      `module ${m.module}`,
      ...(m.imports ?? []).filter((i) => i !== m.module).map((i) => `import ${i}`),
      ""
    );
    for (const d of m.decls) out.push(...printDecl(d), "");
  }
  return out.join("\n");
}

const argv = process.argv.slice(2);
const opt = (k: string): string | undefined => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
if (import.meta.main) {
  const doc: SourceDoc = argv.includes("--overlay")
    ? (readOverlay() as unknown as SourceDoc)
    : readModel(opt("model"));
  const text = `// Shape's own model in Shape 1.0 surface syntax, generated by tools/print.ts from ${argv.includes("--overlay") ? "shape1.yaml" : "model.source.json"}.\n\n${printModel(doc)}`;
  writeFileSync(
    opt("out") ?? join(DOGFOOD, argv.includes("--overlay") ? "shape1.shape1" : "model.shape1"),
    text
  );
}
