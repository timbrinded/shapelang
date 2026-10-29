# Shape 1.0 core model (version 7, release candidate)

**Status.** The normative core of Shape 1.0, version 7: it integrates the build feedback, experiments H1–H6 and DRT, the upheld red-team gaps and the completeness review; the RFC records each decision (D1–D28). The annex (A.n) governs detail, and until the differential gate reports zero residual (A.11.2) its text, not either implementation, is the reference. *(prediction)* marks unmeasured text.

## 0. Conventions

- MUST, SHOULD and MAY are normative; outputs are sorted and byte-identical under any input order (A.0).
- `H(x) = "sha256:" + hex(SHA-256(JCS(x)))`. No float appears in a hashed or core-output value. Time is integer UTC seconds. The checker reads only its input: never a clock, the environment, files or source code.
- `Q` is `module::Name`; a unit is `module::Component.unit`; `K.*` is component K's code that no unit binds; `ungoverned` is code no component owns.

## 1. The model in one paragraph

A **shape** is the reviewed theory of one system: **claims** about **components**, **resources** and **units**, bound to code identities that each revision's **manifest** fingerprints. **Providers** produce **records**. The **checker** is one pure function, `derive`, from a **change** to a verdict, errors, **obligations**, debt and health. It decides structure, authority and conduct, which hold unless an observation contradicts them, and asks separately whether changed code was observed (**coverage**) where something can observe. Providers decide laws by tests and proofs; judgment decides informal laws. A change is judged under the base's governance, which the head may tighten but not loosen.

## 2. Concepts

| # | Concept | Kind | What it is |
|---|---|---|---|
| 1 | Shape | authored | the shape's files; owner of last resort, **policy**, optional manifest identity |
| 2 | Actor | authored | person, team or agent with identities and members; agents name an operator |
| 3 | Component | authored | owner, tier, path globs, grants, units; a **boundary** adds allowed hatches and assumptions |
| 4 | Resource | authored | owner, tier, bound resource code |
| 5 | Unit | authored | a named piece of a component bound to one code identity, with an optional summary of its own effects |
| 6 | Effect | authored in packs | a verb with `implies`; an **atom** is `Verb<Resource>`; hatches are verbs on `Trust` |
| 7 | Claim | authored | op and args, owner, tier; laws add a requirement |
| 8 | Template | authored | parameterised claims |
| 9 | Exception | authored | owned, dated acceptance of a known deviation |
| 10 | Note | authored | rationale, memory or decision `about` items; never decides |
| 11 | Provider | authored | a declared source of records: produces, observes or decides; soundness; implementation; identity |
| 12 | Record | produced | an in-toto statement: observation, test, proof, judgment or equivalence |
| 13 | Manifest | produced | a revision's code identities: digests, parents, references, hatch markers, flags |
| 14 | Change | derived | a base compared with a head |
| 15 | Obligation | derived | owed work: contradiction, unestablished, loosening or coverage |

Everything else (fingerprints, footprints, heirs, tier\*, outputs) is a function of these; SEED's other terms map onto them (A.2).

## 3. Code, vocabulary and bindings

- **Shape files**: `shape.lock` and the `.shape` files under `shape/` outside `shape/evidence/`, verified against git blob ids; the lock pins packs, which export vocabulary, templates and policies but no active claims (A.3.1).
- **Code identities** are `lang:path[#symbol]`, written `ts("src/a.ts#f")` in shapes; anonymous functions are not identities. Every tracked file except shape and evidence files is one; unclaimed files are `raw:<path>` (A.3.2).
- Digests exist per **projection**: `file`; `own`, the identity's text with nested identities replaced by path-free names and nothing resolved, so moved code keeps it; `unit`, adding what free names resolve to; Verus `contract` and `closure`. They ignore formatting and inert comments and keep hatch markers (A.5.7).
- The **manifest** lists each identity's digests, parent, **references** (what its free names resolve to), hatch-marker counts and two flags: `executable` (registered languages; raw files on the script list, starting `#!` or of mode `100755`; **command code**, i.e. `package.json` scripts and workflow jobs and steps; other raw files are data) and `hatchComplete`. The checker rebuilds the git tree from it and verifies the commit, so no code can be omitted; what it cannot recompute is authenticated by the manifest identity (§5.1).
- A component binds path globs minus optional `except` globs; a unit binds one identity, by default the unique one named like the unit in its component's paths (none: E-unbound; several: E-ambiguous). **Attribution** `att(x)` is total: the unit bound to x's nearest ancestor-or-self, else `K.*` for the component owning the most specific matching glob, else `ungoverned`; ties are E-overlap (A.3.3).
- A resource binds **resource code** `tag.kind("value")` (`pg.table`, `ts.call`, `http.route`, …), normalised by the registry's `canon` (`pg.table("public.AUDIT_EVENTS")` is `pg.table("audit_events")`). Facts on resource code no resource binds are **unmapped**. Calls are observed call facts plus declared `a via v`; references are not calls.
- `⇒` (reflexive-transitive `implies`, acyclic) orders verbs: in std DropStorage ⇒ Truncate ⇒ HardDelete ⇒ Update ⇒ Write and Redact, LogicalDelete ⇒ Update, so `forbid Update<R>` forbids all six and granting HardDelete grants Update.
- **Hatches are effects.** `hatch assume in verus` declares `assume ⇒ Hatch`; each marker the manifest counts in x is the fact `(x, assume<Trust>)`, sound for presence and absence where x is `hatchComplete` (parsed; only builtin or marker-free in-tree macros, in any position). Undeclared registry hatch kinds lift to the reserved `Undeclared ⇒ Hatch`, undeclared verbs to isolated atoms (A.3.4).

## 4. Claims

### 4.1 Fields, operators, templates

A claim has an **id** (display), an **op** with args, an **owner** (explicit, else its bearer's, else the shape owner), a **tier** ∈ {low, normal, critical, final} (explicit, else its bearer's, else normal; `forbid final` is `tier final`), a **requirement** (laws), and a **fingerprint** `fp = H(NF)` over op and args only; equal fps merge, keeping the highest tier and strictest requirement (A.4.1). Upper bounds forbid facts; lower bounds assert them.

| op | Holds iff |
|---|---|
| `edge.exists(A,k,B)` | the k-edge A→B exists (lower bound; `relation`) |
| `edge.forbid(S,X,k,T,Y)` | no k-edge from S∖X to T∖Y |
| `path.forbid(S,T,K,V)` | no K-path from S∖V to T with interior outside V |
| `cycle.forbid(K)` | K-edges are acyclic |
| `authority(K)` | every non-trust atom of K's code is entailed by a grant (no `grants` written: open authority) |
| `effect.forbid(a,Σ,X)` | no unit of Σ∖X has an atom below a |
| `effects.upper(u,C)` | every atom u's own code performs is entailed by C (`effects complete`) |
| `effects.lower(u,C)` | u's own code performs each atom of C (lower bound; `complete` or `partial`) |
| `law(on, statement)` | decided by providers (template instance, hosted symbol) or judgment (informal text) |

- A unit's **own code** is the identities attributed to it. Summaries are direct (callees' effects belong to their units; `a via v` states a dependency); call-graph drift belongs to structure claims.
- `forbid hatch K outside boundaries` is one `effect.forbid(h<Trust>, [*], boundaries allowing h)` per declared hatch verb h ⇒ K, plus `effect.forbid(Undeclared<Trust>, [*], [])` when K is `*` or `Hatch`. `Hatch` itself is never a clause, so `allows hatch h` takes effect.
- `*` in a unit position includes `ungoverned`, which has no authority. Grants, `allows` and `assumes` are fields compared by the loosening questions (A.4.2).
- **Templates** are attached (`X : N<rest>`, X first) or instantiated (`law|rule L = N<args>`); a template law without statement is a **schema law**, versioned by `schemaFp`; `order P by leq|geq|subset|superset|equal` says when a head instance is at least as strict (`leq`, `geq`: safe integers only); `requires note K` demands a note (A.4.3).

### 4.2 Evaluation of checker-decided claims

- `W_decl` is the world the head declares; a violation inside it is a **coherence error** (E-conduct, E-structure), not raised again as a contradiction. `W_eval` adds usable observations and the head manifest's hatch facts, lifted through the head's bindings (A.4.4).
- **Permitted set.** `P(u)` is what u's component grants (all atoms under open authority and for `ungoverned`; trust atoms always), intersected with the entailment of u's complete summary, minus every atom below a forbid covering u. A fact at x with atom b violates iff `b ∉ P(att(x))` (`raw_fact_exact`). Its **excluding claims** are the covering forbids, the summary and authority, each where it excludes b; one obligation is raised, against the first by (tier\*, forbids before summaries before authority, fp), the others being causes.
- **Subjects**: `{code, atom}` per site (effect forbids, summaries, authority); `{from, to}` (edge forbids; path forbids per minimal pair); `{nodes}` per strongly connected component; `null` or `{unit, atom}` (refutations). A **contradiction** is a subject whose canonical witness in `W_eval` contains an observed fact: **sound** if those facts are presence-sound, else **heuristic**. A lower bound is **refuted** when absence-sound complete entries cover its footprint and its fact is missing.

### 4.3 Footprints, channels and observability

- Each checker-decided claim c has a **footprint** F(c), the code it governs, and **channels** T(c): `effect(t)` per bound resource code, `hatch(L)` for trust atoms, `call(L)` and `edge(k…)` for structure (A.4.5). A channel applies only to code that can carry it (SQL tables to SQL and embedded-SQL languages, raw executables and command code; `ts.call` to TypeScript and web markup); an unregistered kind is carried by nothing.
- A channel is **observable** iff the base declares a provider absence-sound on it, or it is a hatch channel (the manifest observes those). Observability reads the base alone, so a head edit can neither remove it in the run nor add it before merge; meeting a need reads base and head (§7.4).
- A claim with no observable channel is **declared-only** by construction: still held against declared facts and presence-sound observations, it is listed in health with its tier and route (`contradiction-only` or `declared-only`) and counted per tier in the CI summary (A.4.5.6).

### 4.4 Exceptions and notes

`exception E { waives [kinds of] target [for subjects] owner O expires D }`, kinds ⊆ {contradiction, unestablished}.

- While active it **matches** an obligation of a listed kind whose claim is the target or which is attributed to the target component, with its subject inside the listed subjects; with several excluding claims, each must be matched. A law obligation is attributed to K only when its Req is non-empty and inside K (A.4.6).
- A matched obligation that is not introduced (§7.3) is owed **debt**; a matched introduced one becomes debt only when an **exception answer** lists it (an eligible person for each excluding claim's owner, never an agent). Never on loosenings, coverage or tier final; at most 365 days (E-exception); an active one matching nothing is `inert`.

**Notes** point at what they explain (`about`). The checker resolves them, enforces `requires note`, prints them beside obligations, and derives nothing from their text.

## 5. Evidence

### 5.1 Records and providers

| Kind | Level | Force |
|---|---|---|
| observation (facts over a scope; entries `complete` or not) | — | contradicts; refutes; supplies coverage |
| test, proof (a claim) | tested, proven | establishes or contradicts; proofs persisted if the provider says `persist` |
| judgment: **claim judgment** or **answer** (binding refs) | judged | claim judgments establish or contradict; answers discharge |
| equivalence (two digests or claims) | — | equates code or orders claims (§5.4) |

- Declared < tested < proven; judged is a separate axis. A record of a provider the base does not declare only contradicts: it never establishes and holds no usability reason (A.5.1).
- **Presence** soundness: every reported fact or counterexample is true at its location. **Absence** soundness: on entries marked `complete`, every true fact on the declared channels is reported, an effect through a root the entry supplies as a value at that entry. Presence-sound observers report `n` (sites) on effect facts.
- Observers declare channels (`effect(p)`, `call(L)`, `edge(k[, p])`); tests and proofs declare what they `decide` (`template Q`, `statements L`, `equivalence`). A deterministic test failure is `contradicts` with a counterexample (seed, inputs, assertion); crashes and timeouts are `inconclusive`.
- **Implementation** (globs, identities such as `pkgjson("package.json#scripts.test")`, or a digest) names the runner and its configuration; each record lists its **harness** (identities beyond its cited code that defined the check). If either changes, the records are **producer-changed**. Observers, tests and proofs MUST declare one; no two providers share an identity (E-provider).
- A provider whose base declaration names a signing **identity** is **authenticated**: its records MUST be signed by it from a job running no head code, and a missing record is E-provider-missing (`inconclusive` counts as supplied). Likewise a base **manifest identity** must sign both manifests, whose digests, references, markers and flags the checker cannot recompute. Health lists unauthenticated providers and manifests (A.5.2). A provider that `produces judgment` is the **review relay**.

### 5.2 Laws

- A law's **requirement** is (level, judged, pins, projection): level ∈ {declared, tested, proven}, raised to the tier's floor; `or judged` admits judgments; `by` pins providers or judges; `at unit|contract|trust` says what a judgment cites. Informal laws are (none, judged). Every law needs a route (E-route).
- `Sat(c)` iff Req(c) is empty (vacuous, listed), or c has no open sound contradiction and its level is declared, or a usable applicable record **supporting** c reaches its level (tests, proofs) or its judged route (judgments), respecting pins. A contradicting record never establishes; a heuristic one does not prevent Sat (A.5.3).
- A record **applies** to c iff its claim is at least as strong as c (supports) or at most as strong (contradicts), it cites in code or deps every identity of **Req(c)**, and its judge, if any, is eligible. Req: a unit's identity, plus, for judgments, the functions of its component it references transitively (free names, `this` methods, module object members); a component's units and files; a hosted statement's closure; a boundary's marked code for `at trust`. An identity without the cited projection is cited at `file`.

### 5.3 Usability and force

- The first matching reason makes an applicable record unusable: **stale** (a cited, dependency or harness digest moved, a revision-tied record is not at head, or it omits part of Req), **expired** (a judgment older than `max_age`), **assumption** (it rests on an undeclared assumption), **weak** (below the level, or excluded by a pin), **producer-changed** (implementation or harness changed; only for a record otherwise usable and with force). An unestablished law reports the first of (assumption, weak, producer-changed, expired, stale) that a record for it holds, else `missing`.
- A test or proof assumes every hatch fact in its **cone** (cited code and dependencies, closed under calls and references). Only a boundary allowing the hatch in base and head, a base boundary's `assumes`, or the provider's `trusts` declares an assumption; exceptions never do. A final law is never satisfied through any hatch fact in its cone (A.5.4).
- **Force is fixed.** Presence soundness makes reported violations and counterexamples sound contradictions, otherwise heuristic; absence soundness enables refutation and coverage. Tests and proofs establish at their level; eligible judgments establish (judged) or contradict soundly, a fresh contradicting judgment beating supporting ones. Producer-changed and assumption records keep contradiction force only; answers only discharge (A.5.5).

### 5.4 Strength and heirs

Digests are **equivalent** (≡) when a contributing equivalence record joins them or one identity lists several schemes. A claim is **at least as strong** (⊒) as another when their NFs are equal after renaming, a contributing record says so, or the op order does (A.5.6). The **heirs** of a base claim, the head claims at least as strong as it, inherit its tier, requirement and owners for the subjects it covered.

## 6. Change and governance

### 6.1 The change

- The head is what would land (the merge commit); the base is its first parent. Modes: `change` (a base, possibly empty), `audit` (no base: the head is the governance base, everything preexisting, no loosening or coverage), `preview` (local, unsigned; gates refuse it). `now* = max(now, base committer time)`.
- **ρ** matches base items to head items by name, by `was Old` (items and actors), or by identical non-empty bindings; a unique remove-and-add is a hint only.
- The **code delta** Δcode holds the pairs (identity, projection) whose identity is new or whose digest moved; cited pairs **meet** it when they share a pair. A new identity is **relocated** from a deleted one when the two are the only pair of their kind with that `own` digest. The **finest changes** are identities whose `own` digest moved and new identities not relocated.
- Both shapes resolve bindings over the head manifest. The base is read leniently; an unreadable base is question L0 (A.6.4).

### 6.2 Governance (G\*)

**The head can tighten governance in the change but cannot loosen it.** Each field is read in the direction that cannot lower severity (A.6.2):

- **tier\*(o)**: for a contradiction of an effect forbid, summary or authority at a fact, the higher of the head tier and the atom's base protection level at the fact's base position (`Lvl_b`); otherwise the strictest of the head claim and every base claim it is an heir of, except that a claim whose final loosening two persons answered in this run contributes its head tier. **R\*(o)** likewise;
- **owner\***: the base owners of what a claim inherits; actors, identities and memberships: base only;
- **policy\***: union of `blocks`, least `max_age`, highest floor, common judges; the self fallback reads the base judges alone;
- **providers**: contradiction force if base or head grants it; establishing force, meeting coverage and strength only if both do; observability from the base; producer change over both implementations; identity from the base. A head-only provider only contradicts ("establishes after merge").

Every head governance edit is also a loosening question (L7) and acts after merge, so adoption lands providers first.

### 6.3 Who may answer

- **authors\*** are the base actors behind everyone who opened, pushed, authored, committed or co-authored the change, closed under agent → operator (A.6.3).
- j is **eligible** for o iff j is a base actor acting through an authenticated record or a CI-supplied approve line; o's tier lists j among its judges (`owner`: the item's base owner; a team gives its persons, its agents only with `agents`); j is no agent for loosenings, exception or producer-changed answers and acts on final claims; and j ∉ authors\* for acts of this change. The **self fallback** admits an author who is the only base person eligible by role under the base judges, for non-final o, when no author is an unmapped bot (marked, counted).
- **Tier final** needs two distinct eligible persons, no agent, no fallback: one of the item's base owner and one of the base shape owner (two of that actor when they coincide). It covers final loosenings, claim judgments of final laws, producer-changed answers and dismissals on final claims, and coverage with an unmet final claim, where the two together cover each such claim's owner\*, the component's base owner and the base shape owner.

## 7. Obligations

### 7.1 Kinds

| Kind | Raised when | Owner | Discharged by |
|---|---|---|---|
| contradiction | a checker-decided claim is contradicted or refuted; a usable test, proof or judgment contradicts a law | owner\* | edit code or shape; exception + exception answer; heuristic: dismissal |
| unestablished | a law is not Sat and has no sound contradiction (reason: missing, weak, stale, expired, producer-changed, assumption) | owner\* | evidence; `shape judge`; answer (producer-changed); remove or declare the assumption |
| loosening | a §8 question answers loosened or undecided for a base item | the item's base owner | revert; `was`; `implies` record; answer |
| coverage | changed code under a claim is not covered on a needed channel (§7.4) | the component's base owner | answer; bind or declare; add an observer |

At most one of a sound contradiction and unestablished per claim. Dischargers are ordered and say who may act; an obligation costs **judgment** budget unless its first discharger is checker-verifiable (**mechanical**).

### 7.2 Keys, bindings, groups

The **key** depends only on kind, claim fp and subject (T7). The **binding** hashes the key with the affected identities, their base and head digests and a delta (a loosening's parts; a coverage obligation's unmet pairs); answers approve bindings, so any change reopens (A.7.2). **Groups**, the display and budget unit, join obligations sharing a support fact, an affected finest change, or a cause (a changed implementation or harness identity, a removed or changed base item).

### 7.3 Introduced

With a base, an obligation is **introduced** iff:

- it is a loosening or coverage obligation; or
- it contradicts an effect forbid, summary or authority and its witness holds a **new fact**; or a structure claim, and its witness needs a **new lifted edge** (all supporting facts new); or it refutes a lower bound whose footprint meets Δcode or whose missing fact a base-revision record had reported; or
- it is a law obligation and Req(c), or the cone of a record that contradicts c or holds the obligation's reason, meets Δcode or the deleted identities, except a contradiction a usable base-revision record of the same provider already made with an equal counterexample (assertion and inputs); or its reason is producer-changed.

An observed fact is new if its code changed and no usable base-revision record reports it at least as often, at that identity or the one it is relocated from (a fact without `n` counts as more). A hatch fact at x is new unless x is not a finest change and the base manifest lists at least as many such markers at x or at the identity x is relocated from. **Adding or editing claims, bindings or exceptions never introduces anything by itself**, so tightenings are adoptable (A.7.3).

### 7.4 Coverage

- The **coverage set** is the finest changes, identities whose observed dependencies changed, and code newly in an unchanged claim's footprint.
- x **needs** each (upper-bound claim, channel) pair with x in the footprint, the channel applying to x, and the channel observable or the claim's tier\* at x final. x is **covered** iff each pair is met by a complete entry for x or its nearest ancestor from a provider absence-sound on it in base and head and not producer-changed, or, for hatch channels, by x being `hatchComplete`. A new claim only adds need.
- One coverage obligation per component (and for `ungoverned`) lists uncovered identities and unmet pairs, at the highest tier of the component and the unmet claims (below normal: health only). No observer reads raw files or command code, so changing them under a claim whose observable channel they carry always needs coverage.
- **Vocabulary coverage**: a new fact on unmapped resource code of a bound kind, or an undeclared verb, under a claim with that channel, raises one obligation per code or verb, owned by the shape owner (A.7.4).

### 7.5 Severity

The first matching rule decides:

1. Errors block.
2. An introduced sound contradiction with tier\* final blocks.
3. L0 blocks until the base shape owner answers.
4. A final loosening, or coverage with an unmet final claim, blocks until two eligible persons answer as §6.3 requires.
5. A matched obligation is owed **debt** if not introduced or listed by an exception answer.
6. A non-introduced obligation is owed (**preexisting**); in audit mode every obligation is.
7. A sound contradiction blocks; a heuristic one is owed.
8. An exploited loosening blocks; producer-changed with Req in the code delta blocks.
9. Otherwise policy\*: unestablished, coverage and latent loosening block iff the tier lists them in `blocks`.

Discharged obligations move to `answered`; exception-answered ones stay in `obligations` as debt and are also listed in `answered`. Owed loosening and coverage obligations lapse at merge (health: `unanswered`). Old drift never blocks an unrelated change.

### 7.6 Answers, debt and preexisting work

- Reviewers write `shape approve bd:<≥16 hex>…` (naming open obligations by binding prefix), `shape judge <claim>` or `shape reject <claim> <text>`. **Phase 1** runs `derive` without answers and prints per group one `shape approve` line for its answerable members; a base-declared relay turns review lines into signed records, persisting claim judgments under `shape/evidence/`; **phase 2** runs `derive` with them. Without a relay, approve lines act as answers in this run only (unauthenticated) and judge or reject lines make no judgment (health: `unrecorded`): a claim judgment persists as a record, relayed or signed by its judge (A.7.6).
- An answer acts only for a listed change id while its binding is current, and discharges only obligations with an answer discharger (loosening, heuristic contradiction, producer-changed unestablished, coverage), each answer item (subject, claim, or a coverage obligation's component and unmet claims) needing an eligible answer; other refs count only as exception answers. A producer-changed answer accepts only the producer change and re-evaluates the law. No answer meets a floor, declares an assumption or clears a sound contradiction.
- **Debt** is the matched obligations owed under rule 5. A debt row lists every matching exception and takes owner and days to expiry from the earliest-expiring one, flagged from 14 days before. **Preexisting** obligations are open, owned and visible and never block; preexisting sound contradictions of final claims are `final drift`, which no exception matches.

## 8. Loosening

The head **loosens** the base iff it admits a code-level world the base rejects or weakens governance, and **tightens** iff the converse holds. Both shapes lift the same worlds over the head manifest; files not yet written are **cells**, one per intersecting pair of base and head glob regions (A.8.1). Lower bounds count only through upper bounds elaborated from them. A forward and a reverse pass give the **order class** (looser, tighter, equivalent, incomparable, undecided). Each base item has at most one loosening obligation, at its base tier.

| Code | Question | Implied when | Otherwise |
|---|---|---|---|
| L0 | BaseReadable | the base parses and migrates | undecided |
| L1 | NoNewEffect | no identity or cell gains a permitted atom or loses protection tier (forbids, summaries and authority protect) | loosened |
| L3–L4 | NoWeakerClaim: structure (L3), laws (L4) | the base claim has an heir; structure also when no type-correct new edge satisfying the head violates it | L3 loosened (counterexample) or undecided at budget; L4 loosened if removed, else undecided |
| L6 | NoShrunkJurisdiction | every position that changed component keeps constraints at least as strict, tier and requirement included | loosened |
| L7 | NoWeakerGovernance | no tier, requirement, policy, provider, manifest identity, allowed hatch, assumption, actor or owner weakened | loosened or undecided |

L2 and L5 are retired. A part is **exploited** iff its counterexample occurs in this run, or the tier blocks coverage and affected changed code is uncovered on the question's observable channels (A.8.3). Counterexamples are the least fact or (position, atom) the head admits; a rename without `was` is undecided. L1 and L6 are exact; L3 is exact by heirs and a single-edge test, then by a normative search within 10^6 units resting on the open `dfs_complete` (20,000 fuzz instances, 0 disagreements); L4 uses heirs, `implies` records or answers (A.8.4).

## 9. Policy

A **policy** maps the tiers low, normal and critical to {floor ∈ {declared, tested, proven}, blocks ⊆ {unestablished, coverage, latent-loosening}, max_age in days, judges ⊆ {owner, agents} ∪ actors}, with a judgment budget ∈ ℕ ∪ {unlimited}. Tier final uses critical's policy without `agents`, plus the fixed rules. Omitted policy: std `DefaultPolicy` (syntax §4; normal and critical block latent loosening, as Shape's CI label does, and critical also blocks unestablished and coverage). Omitted budget: unlimited. Severity, eligibility, G\*, exception limits, force and the L3 budget are fixed. E-policy rejects unresolved judges, agents without operators, `or judged` without judges, and final items lacking two distinct persons across owner and shape owner (A.9).

## 10. Outputs

- **Errors** block: shape errors (head only), coherence (E-conduct, E-structure), input integrity (E-evidence-rewrite, E-evidence-path, E-provider-missing) (A.10.1).
- **Verdict**: `invalid` (exit 2, malformed input), `blocked` (1), `owed` (0, owed obligations only), `pass` (0).
- **Budget**: agents take the first `budget` judgment groups, by (blocking, tier, id), that their tier allows and that hold no loosening, exception answer, producer change or final claim.
- **Health** lists trusted or unobserved inputs (declared-only claims, unobservable pairs, ungoverned and unmapped code, unauthenticated inputs, unrecorded judge lines, rejected records), unanswered questions, debt, final drift, preexisting work and **teeth** (A.10).

## 11. Migration, kernel and properties

`shp migrate` translates 0.x deterministically and mints nothing 0.x did not enforce; a 0.x base is elaborated through it (A.11.1). The Lean kernel proves the core, and both checkers answer to the annex through a differential gate that must report zero residual before 1.0 (A.11.2).

Properties (A.11.3), over authenticated inputs: **T1** permutation invariance; **T2** final is final; **T2′** head governance edits never lower severity in the run nor make an author eligible; **T3** evidence never waives; **T4** implied answers are sound; **T5** valid counterexamples; **T6, T6′** monotone records; **T7** stable keys; **T8** derived values are never authored; **T9** one of a sound contradiction and unestablished per claim.
