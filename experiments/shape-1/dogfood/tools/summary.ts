// One-screen summary of a derive output: verdict, errors, obligations by kind, reason,
// severity and tier, groups, debt and health.
import type { CheckOutput } from "../../proto/src/io-types.ts";

export function summarize(o: CheckOutput): string {
  const lines: string[] = [];
  const count = <T>(xs: T[], key: (x: T) => string): string =>
    [...xs.reduce((m, x) => m.set(key(x), (m.get(key(x)) ?? 0) + 1), new Map<string, number>()).entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([k, v]) => `${k}=${v}`)
      .join(" ");
  lines.push(`verdict ${o.verdict}`);
  lines.push(`errors ${o.errors.length}: ${count(o.errors, (e) => e.code)}`);
  lines.push(`rejected ${o.rejected.length}: ${count(o.rejected, (r) => r.code)}`);
  lines.push(`obligations ${o.obligations.length}`);
  lines.push(`  by kind: ${count(o.obligations, (x) => x.kind)}`);
  lines.push(`  by kind/reason: ${count(o.obligations, (x) => `${x.kind}/${x.reason ?? (x.questions ?? []).join("+") ?? "-"}`)}`);
  lines.push(`  by severity: ${count(o.obligations, (x) => x.severity)}`);
  lines.push(`  by kind/severity/tier: ${count(o.obligations, (x) => `${x.kind}/${x.severity}/${x.tier}`)}`);
  lines.push(`  by budget: ${count(o.obligations, (x) => x.budget)}  introduced: ${o.obligations.filter((x) => x.introduced).length}`);
  lines.push(`  groups: ${new Set(o.obligations.map((x) => x.group)).size}`);
  lines.push(`answered ${o.answered.length}; debt ${o.debt.length}; loosening rows ${o.loosening.length}; preexisting ${o.preexisting.length}; renames ${o.renames.length}`);
  lines.push(`budget ${JSON.stringify(o.budget)}`);
  const h = o.health as Record<string, unknown>;
  const brief = (v: unknown): string => (Array.isArray(v) ? `${v.length}` : typeof v === "object" && v ? JSON.stringify(v).slice(0, 120) : String(v));
  lines.push(`health: ${Object.entries(h).map(([k, v]) => `${k}=${brief(v)}`).join(" ")}`);
  return lines.join("\n");
}
