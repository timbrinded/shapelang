// @ts-nocheck
// H5 side finding: the spec's own Example 2 under the prototype. HostTrusted allows external_body,
// yet `forbid hatch * outside boundaries` (HatchesStayAtBoundaries) also elaborates to
// effect.forbid(Hatch<std::Trust>, [*], boundaries allowing Hatch); every declared hatch kind implies
// Hatch, so that forbid covers HostTrusted's external_body too and derive reports a preexisting
// contradiction the example text does not list.
//   bun experiments/shape-1/trials/H5/ex2-hatch.ts
import { ex2 } from "../../proto/examples/fixtures.ts";
import { derive } from "../../proto/src/derive.ts";

const out = derive(ex2({}));
process.stdout.write(`verdict ${out.verdict}\n`);
for (const o of out.obligations) {
  process.stdout.write(
    `${o.kind} ${o.reason ?? "-"} introduced=${o.introduced} ${o.severity} ${o.claim?.ids[0] ?? "-"} ${JSON.stringify(o.subject)}\n`
  );
}
