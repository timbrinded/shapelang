"""DRT: copies the prototype's src/ to a scratch directory and applies the switchable root-cause
patches there (never to the prototype itself). Each patch is active only when its name is in the
DRT_FIX environment variable (read at load time by src/drtflags.ts); with DRT_FIX unset the copy
computes exactly what the prototype does, plus four extra output fields (x_code, x_delta,
x_support, x_excl) used for triage.
Usage: python3 -I patch_proto.py <proto/src> <targetDir>   (creates <targetDir>/src)"""
import os, shutil, sys

SRC, TGT = sys.argv[1], sys.argv[2]
if os.path.exists(os.path.join(TGT, "src")):
    shutil.rmtree(os.path.join(TGT, "src"))
shutil.copytree(SRC, os.path.join(TGT, "src"))
S = os.path.join(TGT, "src")


def patch(rel, old, new, count=1):
    p = os.path.join(S, rel)
    s = open(p).read()
    assert s.count(old) == count, (rel, old[:70], s.count(old))
    s = s.replace(old, new)
    open(p, "w").write(s)


def addimport(rel, line):
    p = os.path.join(S, rel)
    s = open(p).read()
    if line not in s:
        open(p, "w").write(line + "\n" + s)


open(os.path.join(S, "drtflags.ts"), "w").write(
    "// DRT: runtime switches for the root-cause patches applied to this scratch copy of the prototype.\n"
    'export const FIX = new Set((process.env.DRT_FIX ?? "").split(",").filter(Boolean));\n'
    "export const fix = (name: string): boolean => FIX.has(name);\n")

# triage fields (no effect on any compared value)
patch("derive.ts", "      matched: o.matched.length > 0\n    };",
      "      matched: o.matched.length > 0,\n      x_code: o.code,\n      x_delta: o.delta,\n      x_support: o.supportFacts,\n      x_excl: o.excluding.map((c) => c.fp)\n    };")

# T1: binding code rows form a set (A.7.2.2 'code = ... plus ...'; A.12.8.6 sorted)
addimport("derive.ts", 'import { fix } from "./drtflags.ts";')
patch("derive.ts", "    code: [...code].sort((a, b) => cmpStr(a[0], b[0]) || cmpStr(a[1], b[1])),",
      "    code: (fix(\"T1\") ? [...new Map(code.map((r) => [JSON.stringify(r), r])).values()] : [...code]).sort((a, b) => cmpStr(a[0], b[0]) || cmpStr(a[1], b[1])),")

# T2: the law reason comes only from records that apply (eligible judge) and support or contradict (A.5.4.3)
addimport("laws.ts", 'import { fix } from "./drtflags.ts";')
patch("laws.ts", "evals.push({ record: r, review: null, judge: s.judge ?? null, direction, applicable: !partial && judgeOk, reason, force, self });",
      "evals.push({ record: r, review: null, judge: s.judge ?? null, direction, applicable: !partial && judgeOk, reason, force, self, judgeOk } as RecEval);")
patch("laws.ts", "        applicable: e.ok,\n        reason,", "        applicable: e.ok,\n        judgeOk: e.ok,\n        reason,")
patch("laws.ts", "        if (evals.some((e) => e.reason === o)) {",
      "        if (evals.some((e) => e.reason === o && (!fix(\"T2\") || ((e as { judgeOk?: boolean }).judgeOk !== false && e.direction !== \"inconclusive\")))) {")

# T8: dangling else in eligibleByRole (explicit actor judges never eligible); T4: owner role resolves to
# persons (A.6.3.3); A5 (ambiguity): explicit team judges resolve to persons too
addimport("governance.ts", 'import { fix } from "./drtflags.ts";')
patch("governance.ts", """  const owners = membersOf(q.owner, gov.actors);
  for (const j of judges) {
    if (j === "owner") for (const m of owners) out.add(m);
    else if (j === "agents") for (const a of gov.actors.values()) if (a.kind === "agent") out.add(a.q);
    else for (const m of membersOf(j, gov.actors)) out.add(m);
  }""", """  const owners = fix("T4") ? personsOf(q.owner, gov.actors) : membersOf(q.owner, gov.actors);
  for (const j of judges) {
    if (j === "owner") {
      for (const m of owners) out.add(m);
    } else if (j === "agents") {
      for (const a of gov.actors.values()) if (a.kind === "agent") out.add(a.q);
      else if (!fix("T8")) for (const m of membersOf(j, gov.actors)) out.add(m);
    } else if (fix("T8")) for (const m of (fix("A5") ? personsOf(j, gov.actors) : membersOf(j, gov.actors))) out.add(m);
  }""")

# G1 (kernel-gap emulation): no coverage route for 'exploited' -- the kernel's documented simplification
addimport("loosening.ts", 'import { fix } from "./drtflags.ts";')
patch("loosening.ts", "    if (!p.exploited && (inp.blocksCoverage(tier) || tier === \"final\")) {",
      "    if (!fix(\"G1\") && !p.exploited && (inp.blocksCoverage(tier) || tier === \"final\")) {")

# T3: provider subject tier counts claims whose channels meet the provider's (A.8.2.2), for every
# checker-decided op (the prototype counted only effect forbids and authority)
patch("loosening.ts", """      const chans = ctx.Wb ? claimChannels(ctx, c) : [];
      const meets = chans.some((ch) => p.observes.some((o) => channelMeet(o, ch)));""",
      """      const chans = ctx.Wb ? (fix("T3") ? claimChannelsAll(ctx, c) : claimChannels(ctx, c)) : [];
      const meets = chans.some((ch) => p.observes.some((o) => (ch === "call(*)" ? o.startsWith("call(") : channelMeet(o, ch))));""")
patch("loosening.ts", "function claimChannels(ctx: Ctx, c: Claim): string[] {", """function claimChannelsAll(ctx: Ctx, c: Claim): string[] {
  const w = ctx.Wb as World;
  const bound = sortedUniq(w.esf.resources.flatMap((r) => r.bind)).map((t) => `effect(${t})`);
  const kindChan = (k: string): string => (k === "calls" ? "call(*)" : `edge(${k})`);
  switch (c.op) {
    case "effect.forbid":
    case "authority":
      return claimChannels(ctx, c);
    case "effects.upper":
    case "effects.lower":
      return ["call(*)", ...bound];
    case "edge.forbid":
    case "edge.exists":
      return [kindChan(String(c.args.kind))];
    case "path.forbid":
    case "cycle.forbid":
      return (c.args.kinds as string[]).map(kindChan);
    default:
      return [];
  }
}

function claimChannels(ctx: Ctx, c: Claim): string[] {""")

# T6: actor subject tier also counts the tiers whose judges list the actor ("owns or judges", A.8.2.2)
patch("loosening.ts", """    for (const x of [...base.components, ...base.resources, ...base.units, ...base.claims]) if (x.owner === q) t = maxTier(t, x.tier);
    return t;""", """    for (const x of [...base.components, ...base.resources, ...base.units, ...base.claims]) if (x.owner === q) t = maxTier(t, x.tier);
    if (fix("T6")) for (const tt of ["low", "normal", "critical"] as const) if (base.policy.tiers[tt].judges.includes(q)) t = maxTier(t, tt);
    return t;""")
print("proto patched:", S)

# A6 (ambiguity): a debt row's owner is the obligation's owner* (kernel) rather than the exception's owner
patch("derive.ts", "      debt.push({ obligation: o.key, exception: ex.q, owner: ex.owner, expiresInDays: days, flagged: days <= 14 });",
      "      debt.push({ obligation: o.key, exception: ex.q, owner: fix(\"A6\") ? o.owner : ex.owner, expiresInDays: days, flagged: days <= 14 });")
# A7 (ambiguity): a law obligation with empty Req is attributed to any component ("Req ⊆ code(K)", A.4.6.4-5)
patch("derive.ts", "    if (o.law) attributed = reqIds.length > 0 && reqIds.every((x) => code.has(x));",
      "    if (o.law) attributed = (fix(\"A7\") || reqIds.length > 0) && reqIds.every((x) => code.has(x));")
patch("derive.ts", "    if (o.law) return reqIds.length > 0 && reqIds.every(inSigma);",
      "    if (o.law) return (fix(\"A7\") || reqIds.length > 0) && reqIds.every(inSigma);")
print("ambiguity alignments A6 A7 applied")

# T10: two distinct answerers only for final loosenings (A.6.3.4); one eligible answer may settle every
# item of a coverage obligation (A.7.4.4)
patch("derive.ts", "      if (o.final && used.has(a.actor)) return false;",
      "      if (o.final && (!fix(\"T10\") || o.kind === \"loosening\") && used.has(a.actor)) return false;")
# T11: a record not at head is reusable only with deps from a deps-complete provider ("revision-tied
# record without deps not at head" is stale, A.5.4.1)
patch("laws.ts", "      if (!isJ && s.revision !== ctx.Mh.revision && !g?.depsCompleteB) reason = reason ?? \"stale\";",
      "      if (!isJ && s.revision !== ctx.Mh.revision && !(g?.depsCompleteB && (!fix(\"T11\") || (s.deps ?? []).length > 0))) reason = reason ?? \"stale\";")
# G2 (kernel-gap emulation): a test/proof cone without closure under observed calls (kernel's documented
# simplification of A.5.4.4)
patch("laws.ts", "    for (const c of ctx.calls.get(x) ?? []) stack.push(c.to);\n  }\n  return seen;",
      "    if (!fix(\"G2\")) for (const c of ctx.calls.get(x) ?? []) stack.push(c.to);\n  }\n  return seen;")
# GV (kernel-gap emulation): `a via v` read as a plain summary atom of u (the kernel parser drops `via`)
addimport("checker.ts", 'import { fix } from "./drtflags.ts";')
patch("checker.ts", "        const via = m?.[2] ?? null;", "        const via = fix(\"GV\") ? null : (m?.[2] ?? null);")
print("batch 2 applied")

# T13: a law contradiction is introduced only when its Req meets the delta (A.7.3.3); it does not inherit
# the unestablished side's producer-changed reason
patch("derive.ts", """        affected: reqIds,
        witness: contraEv.record ? [contraEv.record.id] : [],""", """        affected: reqIds,
        ...(fix("T13") ? { introduced: hasBase && reqIds.some((x) => changed.has(x)) } : {}),
        witness: contraEv.record ? [contraEv.record.id] : [],""")
# T14: a self-loop is a cycle ("E|K acyclic", A.4.2.1): one-node SCCs with a self-edge count
addimport("checker.ts", 'import { fix } from "./drtflags.ts";')
patch("checker.ts", "      if (comp.length > 1) out.push(comp.sort(cmpStr));",
      "      if (comp.length > 1 || (fix(\"T14\") && edges.some((e) => e.from === v && e.to === v))) out.push(comp.sort(cmpStr));")
print("batch 3 applied")

# T15: summary support adds every call (x,y) with x in reach(u) and a site of the atom reachable from y
#      (A.4.4.11), not only the calls of each site's shortest chain
patch("checker.ts", "      const support = s.options.flatMap((o) => [...o.chain, o.f]);",
      """      let support = s.options.flatMap((o) => [...o.chain, o.f]);
      if (fix("T15")) {
        const sites = new Set(s.options.map((o) => (o.f.declared ? (o.f.at ?? `unit:${o.f.unit}`) : (o.f.at ?? ""))));
        const extra: WFact[] = [];
        for (const [x, list] of ctx.calls) {
          if (!r.has(x)) continue;
          for (const cl of list) if ([...reach(ctx, [cl.to]).keys()].some((k) => sites.has(k))) extra.push(cl.fact);
        }
        support = [...new Map([...support, ...extra].map((f) => [f.fid, f])).values()];
      }""")
print("batch 4 applied")

# G3 (kernel-gap emulation): no L6 parts (L6 NoShrunkJurisdiction is not implemented in the kernel)
patch("loosening.ts", "  parts.push(...l6(ctx));", "  if (!fix(\"G3\")) parts.push(...l6(ctx));")
print("G3 applied")

# T16: L4 affected = the removed law's Req identities (A.8.3.2), not all code of its targets
addimport("loosening.ts", 'import { reqOf } from "./laws.ts";')
patch("loosening.ts", """  return {
    question: "L4",
    subject: cb.fp,
    answer: removed ? "loosened" : "undecided",
    affected: sortedUniq(affected),""", """  const kindL = (cb.args.statement as { text?: string } | undefined)?.text !== undefined ? "judgment" : "test";
  const reqIds = reqOf(ctx, cb, kindL, cb.requirement?.projection ?? "unit").map((p) => p.id).filter((x) => !x.startsWith("unbound:"));
  return {
    question: "L4",
    subject: cb.fp,
    answer: removed ? "loosened" : "undecided",
    affected: fix("T16") ? sortedUniq(reqIds) : sortedUniq(affected),""")
# T17: producer-changed affected adds implementation/harness changes only of records for c (supporting or
#      contradicting, A.5.4.3), not of inconclusive ones
patch("laws.ts", """      if (producerChanged(ctx, r)) {
        anyProducerChanged = anyProducerChanged || reason === "producer-changed";
        for (const x of producerFinest(ctx, r)) pfinest.add(x);
      }""", """      if (producerChanged(ctx, r) && (!fix("T17") || (direction !== "inconclusive" && judgeOk))) {
        anyProducerChanged = anyProducerChanged || reason === "producer-changed";
        for (const x of producerFinest(ctx, r)) pfinest.add(x);
      }""")
print("T16 T17 applied")

# GL (kernel-gap emulation): no refutation of lower bounds (effects.lower, edge.exists); the kernel's
# documented "Not implemented: refutation of lower bounds"
patch("checker.ts", "export function evalLower(ctx: Ctx, facts: WFact[], edges: Edge[]): Contra[] {\n",
      "export function evalLower(ctx: Ctx, facts: WFact[], edges: Edge[]): Contra[] {\n  if (fix(\"GL\")) return [];\n")
print("GL applied")
