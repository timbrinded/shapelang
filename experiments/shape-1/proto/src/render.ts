// Diagnostic-style rendering with cause chains (A.12.10.4-5), and the core output (A.11.2.3).
import { idToSourceRef } from "./elaborate.ts";
import type { CheckOutput, ObligationOut } from "./io-types.ts";
import { jcs } from "./jcs.ts";
import type { Discharger, ShapeError } from "./model.ts";

/** Core output (A.11.2.3, A.16.31): omits message, causes[].text, command, snippet, the
 *  prototype extensions (affected, rule, matched) and the display summary. */
export function coreOutput(out: CheckOutput): CheckOutput {
  const stripD = (d: Discharger): Discharger => ({
    act: d.act,
    by: d.by,
    agentSafe: d.agentSafe,
    eligible: d.eligible,
    creates: d.creates
  });
  const stripE = (e: ShapeError): ShapeError => ({
    code: e.code,
    subject: e.subject,
    causes: e.causes.map((c) => ({ type: c.type, id: c.id })),
    dischargers: e.dischargers.map(stripD)
  });
  const { summary: _s, ...rest } = out;
  void _s;
  return {
    ...rest,
    errors: out.errors.map(stripE),
    obligations: out.obligations.map((o) => {
      const { message: _m, affected: _a, rule: _r, matched: _x, ...ob } = o;
      void _m;
      void _a;
      void _r;
      void _x;
      return {
        ...ob,
        causes: o.causes.map((c) => ({ type: c.type, id: c.id })),
        dischargers: o.dischargers.map(stripD)
      };
    })
  };
}

/** The core output's RFC 8785 bytes, with no trailing newline (A.16.31). */
export function coreBytes(out: CheckOutput): string {
  return jcs(coreOutput(out));
}

function short(h: string): string {
  const m = /^(sha256:|bd:|g:|ob:|c:)([0-9a-f]+)$/.exec(h);
  return m ? `${m[1]}${(m[2] ?? "").slice(0, 16)}` : h;
}

function where(o: ObligationOut): string | null {
  const s = o.subject as Record<string, unknown> | string | null;
  if (s && typeof s === "object" && typeof s.code === "string")
    return s.code.startsWith("unit:") ? s.code.slice(5) : idToSourceRef(s.code);
  if (s && typeof s === "object" && typeof s.unit === "string") return s.unit;
  if (s && typeof s === "object" && typeof s.from === "string")
    return `${s.from} -> ${String(s.to)}`;
  if (s && typeof s === "object" && Array.isArray(s.nodes)) return (s.nodes as string[]).join(", ");
  if (typeof s === "string") return s.startsWith("sha256:") ? `base claim c:${s.slice(7, 23)}` : s;
  return o.claim ? (o.claim.ids[0] ?? null) : null;
}

function renderDischarger(d: Discharger, i: number): string {
  const bits = [`${i + 1}. ${d.act}`, `(${d.by}${d.agentSafe ? ", agent-safe" : ""})`];
  if (d.eligible.length > 0) bits.push(`eligible: ${d.eligible.join(", ")}`);
  if (d.creates)
    bits.push(
      `-> creates ${d.creates.tier} ${d.creates.kind} answered by ${d.creates.owners.join(" and ")}${d.creates.answers > 1 ? ` (${d.creates.answers} persons)` : ""}`
    );
  if (d.command) bits.push(`\`${d.command}\``);
  if (d.snippet) bits.push(`[${d.snippet}]`);
  return bits.join(" ");
}

export function renderHuman(out: CheckOutput): string {
  const lines: string[] = [];
  const blocking = out.obligations.filter((o) => o.severity === "blocking").length;
  const owed = out.obligations.length - blocking;
  lines.push(
    `verdict: ${out.verdict} (${out.errors.length} errors, ${blocking} blocking, ${owed} owed, ${out.answered.length} answered)`
  );
  if (out.verdict === "invalid") {
    for (const e of out.errors) lines.push(`  invalid: ${e.message ?? e.subject}`);
    return `${lines.join("\n")}\n`;
  }
  for (const e of out.errors) {
    lines.push("");
    lines.push(`error[${e.code}] ${e.subject}`);
    if (e.message) lines.push(`  ${e.message}`);
    if (e.causes.length > 0) {
      lines.push("  caused by:");
      for (const c of e.causes)
        lines.push(`    ${c.type} ${short(c.id)}${c.text ? ` ${c.text}` : ""}`);
    }
    if (e.dischargers.length > 0)
      lines.push(`  discharge: ${e.dischargers.map((d, i) => renderDischarger(d, i)).join("; ")}`);
  }
  for (const r of out.rejected) lines.push(`rejected ${short(r.record)} ${r.code}: ${r.detail}`);
  // obligations by (severity, group, location)
  const sorted = [...out.obligations].sort((a, b) =>
    a.severity !== b.severity
      ? a.severity < b.severity
        ? -1
        : 1
      : a.group !== b.group
        ? a.group < b.group
          ? -1
          : 1
        : (where(a) ?? "") < (where(b) ?? "")
          ? -1
          : 1
  );
  for (const o of sorted) {
    lines.push("");
    const tags = [
      o.tier,
      o.force,
      o.reason,
      o.introduced ? "introduced" : "preexisting",
      o.exploited === true ? "exploited" : o.exploited === false ? "latent" : null,
      o.budget
    ].filter(Boolean);
    lines.push(
      `${o.severity} ${o.kind} [${tags.join(", ")}] ${short(o.key)}${o.questions ? ` ${o.questions.join(",")}` : ""}`
    );
    const w = where(o);
    if (w) lines.push(`  --> ${w}`);
    if (o.message) lines.push(`  ${o.message}`);
    if (o.claim)
      lines.push(
        `  claim: ${o.claim.ids.join(", ")} (c:${o.claim.fp.slice(7, 23)}, tier ${o.claim.tier})`
      );
    lines.push(
      `  owner: ${o.owner}   group: ${short(o.group)}   binding: ${short(o.binding)}${o.exception ? `   debt under ${o.exception}` : ""}${o.assignee ? `   assignee: ${o.assignee}` : ""}`
    );
    if (o.counterexample !== null && o.counterexample !== undefined)
      lines.push(`  counterexample: ${JSON.stringify(o.counterexample)}`);
    if (o.causes.length > 0) {
      lines.push("  caused by:");
      for (const c of o.causes)
        lines.push(`    ${c.type} ${short(c.id)}${c.text ? `: ${c.text}` : ""}`);
    }
    if (o.dischargers.length > 0) {
      lines.push("  dischargers:");
      for (const [i, d] of o.dischargers.entries()) lines.push(`    ${renderDischarger(d, i)}`);
    }
  }
  if (out.answered.length > 0) {
    lines.push("");
    lines.push("answered:");
    for (const a of out.answered)
      lines.push(
        `  ${short(a.obligation)} as ${a.as}${a.self ? " (self)" : ""} by ${a.records.map(short).join(", ")}`
      );
  }
  if (out.debt.length > 0) {
    lines.push("");
    lines.push("debt:");
    for (const d of out.debt)
      lines.push(
        `  ${short(d.obligation)} under ${d.exception}, owner ${d.owner}, expires in ${d.expiresInDays} days${d.expiresInDays <= 14 ? " (flagged)" : ""}`
      );
  }
  if (out.summary && out.summary.length > 0) {
    lines.push("");
    lines.push("review lines per group:");
    for (const s of out.summary) {
      if (!s.approve && s.judge.length === 0) continue;
      lines.push(`  ${short(s.group)} [${s.tier}] eligible: ${s.eligible.join(", ") || "none"}`);
      if (s.approve) lines.push(`    ${s.approve}`);
      for (const j of s.judge) lines.push(`    ${j}`);
    }
  }
  lines.push("");
  lines.push(
    `budget: limit ${out.budget.limit ?? "unlimited"}, used ${out.budget.used}, overflow ${out.budget.overflow.length}`
  );
  const h = out.health as Record<string, unknown>;
  const cov = h.coverage as { num: number; den: number } | undefined;
  if (cov)
    lines.push(
      `health: coverage ${cov.num}/${cov.den}; unobservable ${(h.unobservable as string[] | undefined)?.length ?? 0}; open authority ${(h.openAuthority as string[] | undefined)?.length ?? 0}; unanswered ${(h.unanswered as unknown[] | undefined)?.length ?? 0}; preexisting ${String(h.preexisting ?? 0)}`
    );
  return `${lines.join("\n")}\n`;
}
