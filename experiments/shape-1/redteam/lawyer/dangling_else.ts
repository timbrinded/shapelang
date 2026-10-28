// @ts-nocheck
// Minimal reproduction: the prototype's eligibleByRole never adds a judge named by actor.
// Run: bun experiments/shape-1/redteam/lawyer/dangling_else.ts
import { eligibleByRole } from "../../proto/src/governance.ts";
const actors = new Map([
  ["m::Team", { q: "m::Team", kind: "team", operator: null, identities: [], members: ["m::tim"] }],
  ["m::tim", { q: "m::tim", kind: "person", operator: null, identities: [], members: [] }],
  ["m::bob", { q: "m::bob", kind: "person", operator: null, identities: [], members: [] }]
]);
const tp = (judges) => ({ floor: "declared", blocks: [], maxAge: 365, judges });
for (const judges of [["m::bob"], ["owner", "m::bob"], ["agents", "owner", "m::bob"]]) {
  const gov = { actors, byIdentity: new Map(), authors: new Set(), unmappedBot: false, shapeOwner: "m::Team", policy: { tiers: { low: tp(judges), normal: tp(judges), critical: tp(judges) }, budget: null } };
  console.log(JSON.stringify(judges), "->", JSON.stringify(eligibleByRole(gov, { tier: "normal", owner: "m::Team", noAgent: false, final: false })), "(expected to include m::bob)");
}
