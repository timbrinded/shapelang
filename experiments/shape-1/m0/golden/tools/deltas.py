"""Differences between the version 6 prototype's core output (spec/example-inputs, `cli.ts check --core`) and the
version 7 golden output of the same scenario, each with the clause that causes it.

  python3 -I deltas.py <v6 outputs dir> <v7 golden dir> <input-changes.json> <out deltas.json>
"""
import json
import os
import sys

V6, V7, CHANGES, OUT = sys.argv[1:5]

SER = {"what": "serialisation: v6 prints JSON.stringify(core, null, 1) (insertion-order keys, 1-space indent, trailing newline); the golden file is the RFC 8785 JCS bytes of the core output (keys sorted, no whitespace, no trailing newline)",
       "clause": "A.0.2, A.0.4, A.12.10.6 (byte-identical core output; JCS is the only canonical form the text defines)"}
HEALTH = {"what": "health: keys cells, records and baseUnreadable dropped (not A.10.4 health items); keys declaredOnly, unrecorded, rejected {count, rj06}, finalDrift, lawsContradictedAtBase, inertExceptions and vacuousLaws added (all empty unless listed below)",
          "clause": "A.10.4; A.4.5.6 [D3]; A.7.6.8 [D28]; A.12.6 (RJ06 counted apart); A.7.7.2 [D11]; A.7.3.3 [D4]; A.4.6.9; A.5.3.7 [D14]"}
DIGEST = {"what": "inputDigest recomputed over the version 7 input (see input_changes), with records and baseRecords in record-id order and authors, reviews and persisted lists in the A.12.7.6 orders",
          "clause": "A.12.7.6"}
MANIFESTS = {"what": "health.unauthenticated gains \"manifest base\" and \"manifest head\": the base names no manifest identity",
             "clause": "A.5.2.17, A.10.4 [D27]"}


def order(v, why):
    return {"what": "new top-level field order = %s" % json.dumps(v), "clause": "records §5, A.12.10.1, A.8.1.3 [D17]; " + why}


def common(name, order_value, order_why, manifests=True):
    out = [SER, DIGEST, HEALTH, order(order_value, order_why)]
    if manifests:
        out.append(MANIFESTS)
    return out


B_CONTRA = [
    {"what": "contradiction claim: the AppendOnly clause is forbid Update<audit::AuditEvent> (fp 3fe8f5ac7169085e, id audit::AuditEvent/AppendOnly/effect.forbid-Update) instead of forbid HardDelete (fp ccfcbabf10265d64, id …/effect.forbid-HardDelete); HardDelete is below Update, so the fact still violates it",
     "clause": "syntax §4 std AppendOnly, A.3.4.2, A.4.1.1, A.4.4.7 [D13]"},
    {"what": "contradiction key ob:bb51a88f52f5081e -> ob:98ff6f5f02010232, binding bd:0ee8731661d897e6 -> bd:1c907a8a119dd310, group g:d8aa91339ae209d8 -> g:e49eeaef1d87eb9a (same subject, affected and code; new claim fp)",
     "clause": "records §2 keys and bindings, A.7.2.1-3, A.12.8.5-6 [D13]; EXAMPLES Example 1 Variant B"},
    {"what": "contradiction causes gain {type claim, id sha256:3fe8f5ac…} (the AppendOnly clause, tier final, Lvl_b final at AuditStore.*) as the root, after the fact, the AuditEvent binding, the AuditStore.* attribution and authority",
     "clause": "A.14.1.3, A.7.1.2 (causes proximate to root), A.6.2.3"},
    {"what": "facts[sha256:51ed979304abfea6…] gains \"n\": 1 (the fact id is unchanged: it excludes n)",
     "clause": "records §2 facts, A.12.8.4, A.4.4.5 (n = max over sources) [D15]"},
]

D = {}

D["ex1-A"] = common("ex1-A", "tighter", "the head adds purgeOldEvents' complete summary, which bounds that position (A.4.4.7 [D2]); the added grant gains no permitted atom; the reverse pass loosens", manifests=False) + [
    {"what": "E-conduct subject \"audit::AuditEvent/AppendOnly/effect.forbid-HardDelete {\\\"code\\\":…,\\\"atom\\\":…}\" -> the JCS of the obligation key's preimage {claim: 3fe8f5ac… (the Update forbid), kind: contradiction, subject: {atom: HardDelete<audit::AuditEvent>, code: ts:src/audit/purge.ts#purgeOldEvents}, v: shape.obligation.v1}",
     "clause": "A.15.1 [D22] (subject the key's JSON), A.4.4.12, records §2; AppendOnly forbids Update [D13]"},
    {"what": "coverage obligation ob:f99ad91d0fb96186 (component audit::AuditStore, critical, blocking, unmet call(ts) at purgeOldEvents) removed: summaries have no call(ts) channel, and the effect(pg.table(\"audit_events\")) needs at purge.ts and purgeOldEvents are met by sqlEffects' complete entries",
     "clause": "A.4.5.1 [D2], A.7.4.2-3 [D3]; EXAMPLES Example 1 Variant A"},
    {"what": "L1 loosening ob:ca99c5461b8ff9a8 (component audit::AuditStore, authority+ HardDelete, exploited, blocking) and its loosening row removed: HardDelete and Update are newly in A but not in P, since the final Update forbid still excludes them; L1 is implied",
     "clause": "A.8.2.3 L1 authority part ('an atom gained in A that a forbid still blocks is no part') [D17]; EXAMPLES Example 1 Variant A"},
    {"what": "health.coverage {num 1, den 2} -> {num 2, den 2}", "clause": "A.7.4.2-3 [D2, D3]"},
    {"what": "verdict stays blocked, now by the error alone (no obligation remains)", "clause": "A.7.5.1 rule 1, A.10.2"},
]

D["ex1-B"] = common("ex1-B", "equivalent", "base and head shapes are identical", manifests=False) + B_CONTRA

D["ex1-B-weak-observer"] = common("ex1-B-weak-observer", "undecided", "the only forward part is an undecided L7 question on provider audit::sqlEffects (A.8.2.3 L7)", manifests=False) + B_CONTRA + [
    {"what": "the L7 loosening ob:ae867d9fedbd638a (provider audit::sqlEffects, undecided, final, blocking, delta 'L7 presence true false', binding bd:bb43581fbf9b506d, eligible carol only) is unchanged; it stays in its own group",
     "clause": "A.8.2.2-3 L7, A.14.1.5, A.6.3.4 [D12]; A.7.2.3 [D10] (the contradiction's causes name no changed base item)"},
]

D["ex1-Bprime"] = common("ex1-Bprime", "equivalent", "base and head shapes are identical", manifests=False) + [
    {"what": "contradiction claim HardDelete forbid (ccfcbabf…) -> Update forbid (3fe8f5ac…, id …/effect.forbid-Update); key ob:0e15fc409b2de2ab -> ob:66055a3355822d3b, binding bd:8061e184d3eaa0f7 -> bd:30826739357c3cfa, group g:e358f90b5333ff78 -> g:7090849974a91553",
     "clause": "syntax §4 std AppendOnly, A.4.4.7, records §2 [D13]; EXAMPLES Example 1 B′"},
    {"what": "causes gain {type claim, id sha256:3fe8f5ac…} as the root (ungoverned has no authority, so no other excluding claim)",
     "clause": "A.14.1.3, A.7.1.2, A.4.4.7 (ungoverned: all atoms in A)"},
    {"what": "facts[sha256:c91451290422bd92…] gains \"n\": 1", "clause": "records §2, A.12.8.4 [D15]"},
]

D["ex1-Bsecond"] = common("ex1-Bsecond", "equivalent", "base and head shapes are identical", manifests=False) + [
    {"what": "coverage binding bd:5f45c544d7284f45 -> bd:55aeb9df71bf26a0: the delta now holds the unmet pair \"sha256:3fe8f5ac… effect(pg.table(\\\"audit_events\\\"))\" (key ob:155fa0bf253e0793 unchanged)",
     "clause": "records §2 bindings, A.7.2.2, A.12.8.6 [D22] (lawyer L41); EXAMPLES Example 1 B″"},
    {"what": "coverage dischargers[1].act \"bind\" -> \"declare\"", "clause": "A.7.1.3 coverage ('bind or declare'), A.12.10.2 (act set has no bind)"},
]

D["ex1-C"] = common("ex1-C", "incomparable", "EXAMPLES Variant C: the new summary also rejects worlds the base admits", manifests=False) + [
    {"what": "coverage obligation ob:f99ad91d0fb96186 (component AuditStore, critical, blocking) removed; it was a member of the loosening group",
     "clause": "A.4.5.1 [D2], A.7.4.2-3 [D3]"},
    {"what": "forbid loosening: subject and claim fp ccfcbabf… -> 3fe8f5ac… (ids …/effect.forbid-Update), causes[0].id likewise; key ob:031024b1dfd16fe2 -> ob:e8ec989a6cf48d9a; binding bd:8d771e08d86d43b2 -> bd:a7514dcb4cfb7068 (delta: L1 level <atom> final>critical and final>none for all six atoms of ↓Update, HardDelete and Update included at appendEvent, whose complete summary protects them at critical)",
     "clause": "A.8.2.3 L1 level parts, A.4.4.7 (summary in Lvl), A.12.8.7 [D2, D13]; M0 errata M0-E1/E2; EXAMPLES Variant C"},
    {"what": "authority loosening (ob:ca99c5461b8ff9a8, key unchanged): binding bd:2785f31d20281bdd -> bd:6bca5b3fe0d0787d; its loosening row's affected drops ts:src/audit/store.ts#appendEvent (appendEvent's complete summary {Append} keeps HardDelete and Update out of P there); delta authority+ HardDelete and Update",
     "clause": "A.8.2.3 L1 authority part [D17], A.4.4.7 P with summaries [D2]; EXAMPLES Variant C ('not at appendEvent, bounded by its summary')"},
    {"what": "both loosenings: counterexample \"sha256:51ed979304abfea6…\" (a fact id) -> the fact printed as {at: ts:src/audit/purge.ts#purgeOldEvents, verb: HardDelete, resource: pg.table(\"audit_events\")}; the same in both loosening rows",
     "clause": "A.8.3.2, A.12.8.8 [D17]"},
    {"what": "group g:8456e4786582a819 -> g:9f2b9e1c945e6418 (members: the two loosenings only)", "clause": "A.7.2.3; EXAMPLES Variant C"},
    {"what": "loosening row subject ccfcbabf… -> 3fe8f5ac… and obligation ob:031024b1… -> ob:e8ec989a…", "clause": "as for the forbid loosening [D13]"},
    {"what": "health.coverage {num 1, den 2} -> {num 2, den 2}", "clause": "A.7.4.2-3 [D2, D3]"},
]

D["ex1-C-answered"] = common("ex1-C-answered", "incomparable", "as Variant C", manifests=False) + [
    {"what": "coverage obligation ob:f99ad91d0fb96186 (the only open obligation in v6, blocking) removed, so the verdict goes blocked -> pass: both loosenings are discharged and nothing stays open",
     "clause": "A.4.5.1 [D2], A.7.4.2 [D3]; A.7.6.5, A.7.5.2, A.10.2; EXAMPLES Variant C ('phase 2 discharges both')"},
    {"what": "answered rows: the forbid loosening's key ob:031024b1… -> ob:e8ec989a6cf48d9a with records [review:ba7c14f1688510c7, review:bea566bf016733d1] -> [bob's and carol's relay answer records sha256:5c45bce9c67ad27c…, sha256:8bcc651084dc84b5…]; the authority loosening's records [review:ba7c14f1688510c7] -> [sha256:5c45bce9c67ad27c…]; codepoint order puts ob:ca99… first",
     "clause": "A.14.1.8, A.7.6.3-5, A.6.3.4 (bob for AuditTeam, carol for Platform), A.12.10.1"},
    {"what": "health.unauthenticated: the two \"review audit::bob|carol: shape approve …\" entries removed (the answers are the base relay's signed records)",
     "clause": "A.5.2.11, A.6.3.3, A.7.6.8"},
    {"what": "loosening rows as in ex1-C: forbid subject 3fe8f5ac…, obligation ob:e8ec989a…, counterexamples printed as facts, authority row's affected without appendEvent",
     "clause": "A.8.2.3, A.8.3.2, A.12.8.8 [D2, D13, D17]"},
    {"what": "health.coverage {num 1, den 2} -> {num 2, den 2}", "clause": "A.7.4.2-3 [D2, D3]"},
]

D["ex1-audit"] = common("ex1-audit", None, "audit mode", manifests=False)

D["ex1-empty-base"] = common("ex1-empty-base", "tighter", "the base is empty", manifests=True) + [
    {"what": "unestablished ob:e388df561228b690 reason weak -> missing, causes [record sha256:3934cae8dfb8c48c…] -> []: fastCheck is head-only, so its record never establishes and holds no reason",
     "clause": "A.5.1.3, A.5.4.3, A.6.2.6 (head-only providers: no reason) [D9]; EXAMPLES Example 1 ('Empty base: owed … preexisting missing')"},
    {"what": "health.unobservable [the four claim ids] -> []; health.declaredOnly lists the Update forbid (final), authority(AuditStore), appendEvent's effects.upper and effects.lower (critical), each with route declared-only: the empty base declares no provider",
     "clause": "A.4.5.6, A.10.4, A.7.4.2 [D3]"},
    {"what": "health.baseDefects [\"E-parse shape\"] -> []: an empty base holds no shape declaration and is no base defect", "clause": "A.16.17, A.6.4.2 [D18]"},
    {"what": "unestablished ob:e388df561228b690: the lower-requirement discharger's creates {loosening, critical, 1, [audit::AuditTeam]} -> null: the base holds no such law, so lowering it raises no question", "clause": "A.16.17, A.16.27, A.8.2.1"},
]

EX2 = [
    {"what": "the owed preexisting contradiction ob:220a9b307f0f3608 of the Hatch clause dc8454f26ba4a098 at verus:ironkv/src/host_t.rs#Host::send (external_body) removed, with its preexisting row; health.preexisting 1 -> 0",
     "clause": "A.4.2.4, A.12.8.1 [D1]; A.14.2.6; EXAMPLES Example 2"},
    {"what": "contradiction ob:815d7ebb9678dbea: causes[2] {claim dc8454f26ba4a098} (the Hatch clause as a second excluding claim) -> {claim 1584bb88c66cbc8b} (the assume clause itself, as the root)",
     "clause": "A.4.2.4 [D1], A.4.4.7, A.7.1.2, A.14.1.3"},
    {"what": "health.declaredOnly lists the Undeclared clause 6cd2e34ae382f227 (critical, route declared-only): under std every registry hatch kind is declared, so ↓Undeclared<Trust> holds no language's hatch kind and the clause has no channel",
     "clause": "A.4.5.2, A.4.5.6, A.3.4.5 [D1, D3]"},
]

D["ex2"] = common("ex2", "equivalent", "EXAMPLES Example 2", manifests=True) + EX2
D["ex2-approve-only"] = common("ex2-approve-only", "equivalent", "EXAMPLES Example 2", manifests=True) + EX2
D["ex2-exception-approve"] = common("ex2-exception-approve", "equivalent", "exceptions are not governance (A.8.1.1-2)", manifests=True) + EX2 + [
    {"what": "debt rows gain exceptions [\"ironkv::SetAssumeAccepted\"] and lose flagged",
     "clause": "records §5, A.12.10.1, A.7.7.1 [D22]"},
]

EX3S1 = [
    {"what": "coverage obligation ob:fc86e1bb3ce8d2d5 (component tooling::ShpCli, normal, owed, judgment, assignee agents) removed, with its health.unanswered entry: isoToday's summary has no call(ts) channel and SystemClock binds no resource code, so it has no channel at all",
     "clause": "A.4.5.1 [D2], A.4.5.2, A.7.4.2 [D3], A.7.5.3; EXAMPLES Example 3 Step 1"},
    {"what": "health.coverage {num 1, den 2} -> {num 2, den 2} (freshness.ts and isoToday covered vacuously)", "clause": "A.7.4.5"},
    {"what": "health.unobservable [isoToday effects.lower, effects.upper] -> []; health.declaredOnly lists both (normal, declared-only)",
     "clause": "A.4.5.6, A.10.4 [D3]; EXAMPLES Example 3 ('the summary is declared-only until SystemClock binds code')"},
]

D["ex3-step1"] = common("ex3-step1", "equivalent", "base and head shapes are identical", manifests=True) + EX3S1 + [
    {"what": "unestablished ob:5b2b722c136fd4da (stale, owed, binding bd:904f519651548b32 unchanged): group g:733c96ee86267271 -> g:317d24c25b95205f (its only member now)",
     "clause": "A.7.2.3"},
]

D["ex3-step1-judged"] = common("ex3-step1-judged", "equivalent", "base and head shapes are identical", manifests=True) + EX3S1 + [
    {"what": "verdict owed -> pass: the relay's claim judgment establishes the law (as in v6) and the coverage obligation is gone",
     "clause": "A.5.3.7, A.6.3.3 (self fallback), A.7.6.3 [D2, D3, D28]; EXAMPLES Example 3 Step 1 ('the next run passes'); A.11.5"},
    {"what": "budget.used and health.budget.used 1 -> 0 (no judgment group left)", "clause": "A.10.3, A.9.2 [D10]"},
    {"what": "health.unauthenticated: \"review tooling::tim: shape judge tooling::ShpCli.isoToday/RefactorSensitive/law\" removed (the judgment is the base relay's signed record); health.self keeps \"judgment … by tooling::tim\"",
     "clause": "A.7.6.8, A.5.8.1 [D28], A.6.3.3"},
]

D["ex3-step2"] = common("ex3-step2", "equivalent", "base and head shapes are identical", manifests=True)
D["ex3-step2-harness-edited"] = common("ex3-step2-harness-edited", "equivalent", "base and head shapes are identical", manifests=True) + [
    {"what": "producer-changed unestablished ob:79b18d16e2bc560c: the discharger rerun (2nd of 4) removed; dischargers are answer, exception, lower-requirement",
     "clause": "A.7.1.3 (producer-changed: a person's answer; last: exception, lower the requirement) [D9]"},
    {"what": "producer-changed unestablished ob:79b18d16e2bc560c: binding bd:c42a951fc2acb6de -> bd:1cff58dc3a971da2; code gains [determinism.test.ts, own, base, head], the harness finest change", "clause": "A.16.19, A.7.2.2, core §7.2"},
]
D["ex3-step2-record-dropped"] = common("ex3-step2-record-dropped", "equivalent", "base and head shapes are identical", manifests=True)
D["ex3-step2-refactor-sensitive-removed"] = common("ex3-step2-refactor-sensitive-removed", "looser", "the head removes the RefactorSensitive law (L4 loosened); the reverse pass adds it", manifests=True)
D["ex3-step2-seeded-clock"] = common("ex3-step2-seeded-clock", "equivalent", "base and head shapes are identical", manifests=True) + [
    {"what": "contradiction ob:d4218b3063c6f1b9: causes gain {claim 866e06e6bddd0add} (CheckerNeverReadsClock) as the root, after authority(ShapeRuleEngine)",
     "clause": "A.7.1.2, A.14.1.3, A.4.4.7"},
    {"what": "facts[sha256:fedfa0b09d953521…] gains \"n\": 1", "clause": "records §2, A.12.8.4 [D15]"},
]

EX4 = [
    {"what": "cycle contradiction ob:6efc5ef79a4f52af: causes gain {claim d1d638be608c2992} as the root", "clause": "A.7.1.2"},
]

D["ex4"] = common("ex4", "equivalent", "base and head shapes are identical", manifests=True) + EX4 + [
    {"what": "health.unobservable [the relation, the cycle rule] -> []; health.declaredOnly lists relation 8a8f0d5a3028807a and rule d1d638be608c2992 (normal, route contradiction-only: tsCallGraph declares call(ts) with sound none)",
     "clause": "A.4.5.6, A.10.4 [D3]; EXAMPLES Example 4 ('Both claims are declared-only (route contradiction-only)')"},
    {"what": "heuristic cycle contradiction ob:6efc5ef79a4f52af: the dismissing answer discharger's agentSafe false -> true (normal tier, judges owner and agents; its group is assigned to agents)", "clause": "A.16.27, A.6.3.3, A.10.3"},
]
D["ex4-closing-the-set"] = common("ex4-closing-the-set", "looser", "L3 loosened forward; in the reverse pass the base's exceptTo {ShapeModelLowerer} claim is an heir of the head's", manifests=True) + EX4 + [
    {"what": "health.unobservable [4 claim ids] -> []; health.declaredOnly lists the head's relations complete clause (630a3439992eb6fc), both relations (8a8f0d5a3028807a, f175b0883c27059c) and the cycle rule, all normal, route contradiction-only",
     "clause": "A.4.5.6, A.10.4 [D3]"},
    {"what": "heuristic cycle contradiction ob:6efc5ef79a4f52af: the dismissing answer discharger's agentSafe false -> true (normal tier, judges owner and agents; its group is assigned to agents)", "clause": "A.16.27, A.6.3.3, A.10.3"},
]

if __name__ == "__main__":
    changes = json.load(open(CHANGES))
    assert sorted(D) == sorted(changes), sorted(set(D) ^ set(changes))
    out = {}
    for n in sorted(D):
        v7 = json.loads(open(os.path.join(V7, n + ".output.json"), "rb").read())
        out[n] = {"verdict": v7["verdict"], "obligations": len(v7["obligations"]),
                  "input_changes": [c["what"] + " [" + c["clause"] + "]" for c in changes[n]], "deltas": D[n]}
    with open(OUT, "w") as f:
        json.dump(out, f, indent=1, ensure_ascii=False, sort_keys=True)
        f.write("\n")
    print(len(out), "files;", sum(len(v["deltas"]) for v in out.values()), "deltas")
