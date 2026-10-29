# Worked examples (core, version 7)

Values come from `experiments/shape-1/spec/vectors/vectors.py` (16 hex digits); code digests hash labels. All use `std` 1.0, DefaultPolicy, change mode, head = merge commit, `now` 2026-10-25T12:00:00Z. Details: A.14; golden core outputs: roadmap M0.

## Example 1: an agent PR adds a purge to an append-only log

**Base**: syntax §1. AppendOnly gives `forbid Update<audit::AuditEvent>` over `*` (fp `3fe8f5ac7169085e…`, tier final, covering `ungoverned`); `authority(AuditStore)` is `987106a04014478f…`; the law `2da8fb7008513c5d…` is critical, level tested. Audit mode: `pass`. Empty base: `owed` (head-only providers only contradict, so the law is preexisting `missing`).

**Change**: `codeAgent` (operator alice) opens `github:acme/audit#57`, adding `src/audit/purge.ts` whose `purgeOldEvents` runs `DELETE FROM audit_events …`. authors\* = {codeAgent, alice}.

**Variant A** (the agent also adds `grants HardDelete<AuditEvent>` and a unit `purgeOldEvents` whose complete summary lists it): E-conduct at `{code: ts:src/audit/purge.ts#purgeOldEvents, atom: HardDelete<audit::AuditEvent>}`, not raised again as a contradiction; L1 is implied, since the final forbid still excludes HardDelete and Update. `blocked`.

**Variant B** (nothing declared). The signed `sqlEffects` observation reports HardDelete at `purgeOldEvents` on `pg.table("public.audit_events")`, canonically `pg.table("audit_events")` (fact `51ed979304abfea6…`, `n: 1`), attributed to `AuditStore.*`. The final forbid and authority exclude it; one contradiction is raised against the forbid, authority a cause: `ob:98ff6f5f02010232…`, binding `bd:1c907a8a119dd310…`, group `g:e49eeaef1d87eb9a…`; sound, introduced (new fact), tier\* final (`Lvl_b` final at `AuditStore.*` too), blocking (rule 2); dischargers edit-code (agentSafe), then edit-shape (a final loosening for AuditTeam and Platform).

Complete, absence-sound entries cover both new identities, so coverage is met; a fresh `fastCheck` record establishes the law. No exception can match a final obligation (T2, T3). Today's checker passes this PR.

- **Weakened observer**: dropping `presence` from `sqlEffects` keeps the contradiction sound (base ∨ head); dropping `absence` keeps the coverage need (observability reads the base) without meeting it; either edit is a final L7 question (A.14.1.5). **B′**: a purge in `scripts/purge-audit.ts` is `ungoverned` but under `*`: blocking `ob:66055a3355822d3b…`.
- **B″**: `src/audit/purge.sh` (`psql -c "DELETE …"`) is `executable`, a raw carrier of `pg.table`, `ungoverned`; no observer reads shell, so coverage `ob:155fa0bf253e0793…` (binding `bd:55aeb9df71bf26a0…`, delta naming the forbid and the channel) is final and blocks until bob (AuditTeam, the claim's owner) and carol (Platform, owner of `ungoverned` and shape owner) answer.

**Variant C** (the agent drops `: AppendOnly`, adds the grant and the unit). L1 compares the 7 identities and the cells `cell:["audit::AuditStore.*","audit::AuditStore.*"]` and `cell:["ungoverned","ungoverned"]`:

- the forbid's protection of Update and the five atoms below it fell from final to critical (authority still protects the ungranted ones) or to none (granted atoms; `ungoverned`): `ob:e8ec989a6cf48d9a…`, binding `bd:c5461f6efe0c3685…`, final;
- AuditStore newly permits HardDelete and Update at `purge.ts`, `purgeOldEvents`, `store.ts` and its cell (not at `appendEvent`, bounded by its summary): `ob:ca99c5461b8ff9a8…`, binding `bd:6bca5b3fe0d0787d…`, critical.

Both are exploited and block, in group `g:9f2b9e1c945e6418…`; order class `incomparable` (the new summary also rejects worlds the base admits). Phase 1 prints `shape approve bd:c5461f6efe0c3685 bd:6bca5b3fe0d0787d`; bob writes it and carol (second person for the final one) writes `shape approve bd:c5461f6efe0c3685`; phase 2 discharges both. A push editing `purgeOldEvents` reopens both.

## Example 2: a Verus project change adds an `assume`

```shape
boundary HostTrusted : ReviewedSurface {
  owner IronKvTeam tier critical
  bind paths { "ironkv/src/**/*_t.rs" }
  allows hatch external_body, external, uninterp
}
component DelegationMap {
  owner IronKvTeam tier critical
  bind paths { "ironkv/src/delegation_map_v.rs" }
  unit set { bind verus("ironkv/src/delegation_map_v.rs#DelegationMap::set") }
}
rule NoHatchesOutsideBoundaries = HatchesStayAtBoundaries<> { owner IronKvTeam tier critical }
law SetRefinesSpec { on unit DelegationMap.set statement verus("ironkv/src/delegation_map_v.rs#DelegationMap::set") evidence proven by verus }
law SetContractFaithful {
  on unit DelegationMap.set
  informal "The ensures clause of set states the map update the protocol layer relies on."
  evidence judged at contract
}
```

Provider `verus` proves (`decides statements verus`, `deps complete`, trusting z3 and verus). The rule is twelve forbids, one per declared hatch verb plus `Undeclared` (`assume` `1584bb88c66cbc8b…`; `external_body` `9dbce5edea4f3d2e…`, excepting HostTrusted; `Undeclared` `6cd2e34ae382f227…`), so HostTrusted's `external_body` markers raise nothing.

**Change**: an agent inserts `assume(self.valid());` in `set`. Its `unit` and `own` digests move, `contract` and `closure` do not; its markers go from none to `{"assume": 1}`.

1. **Hatch**: the fact `(set, assume<Trust>, 1)` (`56e82502df98e91a…`) is new (`set` is a finest change) and DelegationMap allows no `assume`: sound, introduced, blocking, mechanical contradiction `ob:815d7ebb9678dbea…`, binding `bd:2ea660886d27e5e3…`.
2. **SetRefinesSpec** (`60a867af53d80a7f…`): the proof verifies, but its cone holds the undeclared hatch: unestablished `assumption`, introduced, blocking at critical, `ob:8b9a1c953f7ed31c…`, binding `bd:1da36a42e325dc5a…`.
3. **SetContractFaithful**: its Req (`set` and the DelegationMap functions it references, at `contract`) did not move; the judgment stays usable.
4. **ReviewedSurface** cites HostTrusted's marked code, not `set`; `set` is `hatchComplete`, so coverage is met. Order class `equivalent`.

Two blocking mechanical obligations, group `g:f16ee5b2da967ed8…`, budget 0. **Discharge**: remove the assume, or accept debt with `exception … waives contradiction, unestablished of component DelegationMap for code verus("…#DelegationMap::set") owner IronKvTeam expires "2026-12-15"`, which matches both; both being introduced, a person of IronKvTeam (never an agent) also writes `shape approve bd:2ea660886d27e5e3 bd:1da36a42e325dc5a`, and both become debt (`expiresInDays: 51`). Without the exception that line discharges nothing. A later edit of `set` is new again.

## Example 3: a memory whose checkable part became a law

**Today**: `memory ClockReadAtCliBoundary` on `ShpCli.isoToday`, guarded on any edit to `freshness.ts`. **Step 1, `shp migrate`**: `unit isoToday : RefactorSensitive { bind ts("packages/shp-cli/src/freshness.ts#isoToday") effects complete { Read<SystemClock> } }` plus the memory as a note. The law (`c414eadc238d87c4…`, none/judged at `unit`, Req `isoToday` alone) is preexisting and owed until judged; the summary is declared-only until SystemClock binds code. A refactor of `isoToday` gives unestablished `stale`, `ob:5b2b722c136fd4da…`, binding `bd:904f519651548b32…`, owed at normal. One `shape judge tooling::ShpCli.isoToday/RefactorSensitive/law` line from the maintainer (the self fallback, when Claude authored) makes the relay commit a judgment; the next run passes.

**Step 2, the checkable parts.** A TS AST scan of Shape at HEAD finds 9 clock reads in 5 identities, none in a checker component:

```shape
resource SystemClock { bind ts.call("Date.now"), ts.call("Date"), ts.call("performance.now"), ts.call("process.hrtime") }
rule CheckerNeverReadsClock { tier critical forbid Read<SystemClock> within component ShapeChecker, ShapeRuleEngine, … }
law CheckIsDeterministic = Deterministic<ShapeChecker.checkShapeModules> { tier critical evidence tested by bunTest }
```

plus a note `about` both, an absence-sound `tsClockScan` observer on the four channels, and `bunTest` deciding `Deterministic`: rule `866e06e6bddd0add…` (9 checker components, A.14.3), law `8620c3bead39262d…`. A broader `forbid Read<SystemClock> except unit ShpCli.isoToday` gives 4 preexisting owed contradictions (summaries are direct, so callers need no exception). Removing `RefactorSensitive` is L4 loosened, latent (`ob:a4a8d01ab841cdac…`, normal), blocked by DefaultPolicy until one `shape approve` line; the new law stays preexisting `missing` until its provider merges.

**After Step 2**: a refactor of `isoToday` is covered by `tsClockScan` and raises no judgment obligation. Editing the test's harness makes the law producer-changed (`ob:79b18d16e2bc560c…`), blocking at critical until a person accepts the harness change. A seeded `Date.now()` in `checkFreshness` (fact `fedfa0b09d953521…`) gives a sound, introduced, blocking contradiction, `ob:d4218b3063c6f1b9…`, which an exception on the rule alone would not match, since authority also excludes the fact.

## Example 4: observed drift on a `calls` relation

```shape
relation ShapeRuleEngineReadsLoweredFacts { kind calls connects ShapeRuleEngine -> ShapeModelLowerer }
rule no_runtime_dependency_cycles { forbid cycle over calls }
```

Relation `8a8f0d5a3028807a…`, rule `d1d638be608c2992…`. `tsCallGraph` observes `call(ts)` with `sound none` (Bend-C4: 43.5% symbol precision); its first run reports calls from `lowering/facts.ts` and `lowering/context.ts` into `derivations.ts` (ShapeRuleEngine) and none from `rules/**` into `lowering/**`.

- Both claims are declared-only (route `contradiction-only`): the relation is never refuted and changed code needs no coverage.
- The declared edge (`fecfe7218a4d08dc…`) and the observed reverse edge (representative `1bb37b4784f7693a…`, the least call fact) form a cycle: one heuristic contradiction, `ob:6efc5ef79a4f52af…`, binding `bd:45ee0c48b6cfaddb…`, group `g:1a3d754f198b4400…`, preexisting and owed; verdict `owed`, budget 1 group. A later call along the same lifted edge keeps it preexisting; re-modelling the dependency as `data_flow` removes it.
- **Closing the set**: with `relations complete over calls` on ShapeRuleEngine (`8dd0a5e5758d7fb9…`), adding a `calls` relation to ShapeDiagnostics widens `exceptTo`, so the base claim has no heir and the declared edge violates it: L3 loosened, exploited, `ob:03dbcad44e521c74…`, blocking until ShapeRuleEngine's base owner answers.
