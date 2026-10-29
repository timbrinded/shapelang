// @ts-nocheck
// H6: does `allows hatch K` on a boundary let that boundary carry a K marker under
// HatchesStayAtBoundaries? Spec Example 2 (proto examples/fixtures.ts ex2): HostTrusted allows
// external_body, external, uninterp, and Host::send carries one external_body marker in base and head.
// Variant "new": the base manifest lists no marker at Host::send, so the head's marker is a new fact.
// Prints the obligations whose claim is a NoHatchesOutsideBoundaries forbid.
//   bun experiments/shape-1/trials/H6/hatch-allows.ts
import { ex2 } from "../../proto/examples/fixtures.ts";
import { derive } from "../../proto/src/derive.ts";
import { manifestStatement } from "../../proto/src/manifest.ts";

const rows = [];
for (const variant of ["as-published", "new-marker-in-boundary", "no-host-marker"]) {
  const input = ex2(variant === "no-host-marker" ? { hostMarkers: false } : {});
  if (variant === "new-marker-in-boundary") {
    const p = input.base.manifest.predicate.shape;
    const entries = p.entries
      .map((e) => (e.id.endsWith("host_t.rs#Host::send") ? { ...e, markers: undefined } : e))
      .map((e) => {
        const { markers, ...rest } = e;
        return markers ? { ...rest, markers } : rest;
      });
    input.base.manifest = manifestStatement({ ...p, entries });
  }
  const out = derive(input);
  const hatch = out.obligations.filter((o) =>
    (o.claim?.ids ?? []).some((id) => id.includes("NoHatchesOutsideBoundaries"))
  );
  rows.push({
    variant,
    verdict: out.verdict,
    errors: out.errors.map((e) => e.code),
    obligations: out.obligations.length,
    hatch: hatch.map((o) => ({
      forbid: o.claim.ids[0],
      atom: o.subject.atom,
      code: o.subject.code,
      severity: o.severity,
      introduced: o.introduced,
      force: o.force
    }))
  });
}
const elaborated = ex2()
  .head.source.modules.flatMap((m) => m.decls)
  .find((d) => d.name === "HostTrusted");
process.stdout.write(
  `${JSON.stringify({ boundary: { name: elaborated.name, allows: elaborated.allows }, rows }, null, 1)}\n`
);
