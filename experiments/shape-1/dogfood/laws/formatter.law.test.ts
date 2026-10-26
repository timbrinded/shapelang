// Laws of memory FormatterCanonicalDiffs on unit shape.tooling::ShapeFormatter.formatShapeModule.
import { formatShapeSource } from "../../../../packages/shp-checker/src/formatter.ts";
import { type Rng, distinctNames, lawTest, property } from "./lawkit.ts";

const KINDS = ["calls", "callbacks", "provides", "coordinated_call", "data_flow"] as const;

function fmt(src: string): string {
  const r = formatShapeSource(src, "law.shape");
  if (!r.ok) throw new Error(`does not parse: ${r.diagnostics.map((d) => d.message).join("; ")}\n${src}`);
  return r.formatted;
}

/** Re-indents and re-spaces a source without changing its tokens. */
function noisy(r: Rng, src: string): string {
  return src
    .split("\n")
    .map((line) => `${" ".repeat(r.int(0, 3))}${r.bool(0.2) ? "\t" : ""}${line.trim()}${r.bool(0.2) ? "   " : ""}`)
    .join(r.bool(0.3) ? "\n\n" : "\n");
}

interface ModuleCase {
  ordered: string;
  shuffled: string;
}

function genModule(r: Rng): ModuleCase {
  const names = distinctNames(r, 11).map((n) => n.replace(/^_/, "u_"));
  const resources = names.slice(0, r.int(1, 3));
  const comps = names.slice(3, 3 + r.int(2, 4));
  const decls: string[] = resources.map((x) => `resource R${x}`);
  for (const c of comps) {
    const res = r.pick(resources);
    const lines = [`component C${c} {`, `  grants Read<R${res}>`];
    if (r.bool(0.7)) lines.push(`  fn f${c}`, "    effects complete {", `      Read<R${res}>`, "    }");
    lines.push("}");
    decls.push(lines.join("\n"));
  }
  for (let i = 0; i < r.int(0, 3); i += 1) {
    const [a, b] = r.shuffle(comps);
    decls.push([`relation Rel${i}${a}${b} {`, `  kind ${r.pick(["calls", "callbacks"])}`, `  connects C${a} -> C${b}`, "}"].join("\n"));
  }
  if (r.bool(0.6)) {
    const [a, b] = r.shuffle(comps);
    decls.push([`rule rule${a} {`, `  forbid path C${a} -> C${b} over ${r.subset(KINDS, 1).join(" or ")}`, "}"].join("\n"));
  }
  const header = "module law";
  return { ordered: [header, ...decls].join("\n\n"), shuffled: [header, ...r.shuffle(decls)].join("\n\n") };
}

// "formatter ordering and indentation are stable (canonical, idempotent)"
lawTest("shape.tooling::FormatterIdempotent", "holds", () =>
  property(
    "shape.tooling::FormatterIdempotent",
    { cases: 150, seed: 0x5eed01 },
    (r) => {
      const m = genModule(r);
      return { ...m, noisy: noisy(r, m.shuffled) };
    },
    (c) => {
      const once = fmt(c.noisy);
      if (fmt(once) !== once) return `format(format(x)) != format(x) for:\n${c.noisy}`;
      if (fmt(c.ordered) !== once) return `declaration order or indentation changed the output:\n--- ordered ---\n${fmt(c.ordered)}\n--- shuffled+noisy ---\n${once}`;
      return null;
    }
  )
);

// "nested rationale/memory grouping blocks canonicalize to flat members"
// The grammar now accepts only the grouped who/when/protects/guards blocks and the formatter
// emits them grouped, so the clause as recorded in the memory is contradicted.
lawTest("shape.tooling::FormatterFlattensGroupedContext", "fails", () =>
  property(
    "shape.tooling::FormatterFlattensGroupedContext",
    { cases: 40, seed: 0x5eed02 },
    (r) => {
      const [c = "C", f = "f", m = "M", t = "Team"] = distinctNames(r, 4).map((n) => n.replace(/^_/, "u_"));
      const groups = r.subset(["who", "when", "guards"] as const, 1);
      const body = [
        `  applies_to fn C${c}.f${f}`,
        "  status Explained",
        "  confidence High",
        '  summary "Kept for review."',
        ...(groups.includes("who") ? [`  who {`, `    owner T${t}`, "  }"] : []),
        ...(groups.includes("when") ? ["  when {", `    review_by "2027-0${r.int(1, 9)}-1${r.int(0, 9)}"`, "  }"] : []),
        ...(groups.includes("guards") ? ["  guards {", "    on_change require ReEvaluation<Self>", "  }"] : [])
      ];
      return [
        "module law",
        `component C${c} {`,
        `  fn f${f} : RefactorSensitive`,
        "    effects unknown",
        "}",
        `memory M${m} : RefactorConstraint<fn C${c}.f${f}> {`,
        ...body,
        "}"
      ].join("\n");
    },
    (src) => {
      const out = fmt(src);
      const grouped = /^\s*(who|when|protects|guards)\s*\{/m.exec(out);
      return grouped ? `formatter output keeps the grouped "${grouped[1]} {" block:\n${out}` : null;
    }
  )
);

// "graph-rule endpoints and kind filters have one canonical form"
// Read as: two spellings of the same rule (same endpoints, same kind set, any layout or kind
// order) format to one text. The formatter keeps kind filters in authored order.
lawTest("shape.tooling::FormatterCanonicalGraphRules", "fails", () =>
  property(
    "shape.tooling::FormatterCanonicalGraphRules",
    { cases: 80, seed: 0x5eed03 },
    (r) => {
      const kinds = r.subset(KINDS, 2);
      const [a = "A", b = "B"] = distinctNames(r, 2).map((n) => n.replace(/^_/, "u_"));
      const clause = r.bool() ? (ks: string[]) => `forbid path C${a} -> C${b} over ${ks.join(" or ")}` : (ks: string[]) => `forbid hypercycle over ${ks.join(" or ")}`;
      const mk = (ks: string[], spaced: boolean) => ["module law", `component C${a} {}`, `component C${b} {}`, `rule r {`, `  ${spaced ? clause(ks) : clause(ks).replace(" -> ", "->")}`, "}"].join("\n");
      return { one: mk(kinds, true), other: mk(r.shuffle(kinds), r.bool()) };
    },
    (c) => {
      const x = fmt(c.one);
      const y = fmt(c.other);
      return x === y ? null : `same rule, two canonical forms:\n${x.split("\n").find((l) => l.includes("forbid"))?.trim()}\n${y.split("\n").find((l) => l.includes("forbid"))?.trim()}`;
    }
  )
);
