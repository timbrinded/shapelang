// @ts-nocheck
// DRT: the part of a prototype output the comparison needs (core fields plus the prototype's
// extensions used in triage: affected, rule, matched, and, from the patched copy, x_code, x_delta,
// x_support, x_excl).
export function projectOut(full) {
  return {
    verdict: full.verdict,
    errors: (full.errors ?? []).map((e) => ({ code: e.code, subject: e.subject })),
    rejected: (full.rejected ?? []).map((r) => ({ record: r.record, code: r.code })),
    obligations: (full.obligations ?? []).map((o) => ({
      key: o.key,
      kind: o.kind,
      reason: o.reason,
      questions: o.questions,
      introduced: o.introduced,
      severity: o.severity,
      tier: o.tier,
      budget: o.budget,
      force: o.force,
      owner: o.owner,
      group: o.group,
      claim: o.claim ? { fp: o.claim.fp, ids: o.claim.ids, tier: o.claim.tier } : null,
      subject: o.subject,
      witness: o.witness,
      exploited: o.exploited,
      final: o.final,
      binding: o.binding,
      exception: o.exception,
      affected: o.affected,
      rule: o.rule,
      matched: o.matched,
      x_code: o.x_code,
      x_delta: o.x_delta,
      x_support: o.x_support,
      x_excl: o.x_excl
    })),
    answered: (full.answered ?? []).map((a) => ({ obligation: a.obligation, as: a.as })),
    debt: (full.debt ?? []).map((d) => ({ obligation: d.obligation, exception: d.exception, owner: d.owner, expiresInDays: d.expiresInDays })),
    loosening: (full.loosening ?? []).map((r) => ({ question: r.question, subject: r.subject, answer: r.answer, exploited: r.exploited }))
  };
}
