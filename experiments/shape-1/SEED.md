# Shape 1.0 model: seed

This is the shared starting point for the workflow that tests, refines and crystallises the next major version of Shape. It describes the target end state, not today's syntax. Everything here is a hypothesis to be tested and may be overturned by evidence.

## Goal

Keep architectural intent legible and true while agents write most of the code. Do this deterministically wherever possible, and with budgeted, recorded judgment where not.

## The one-sentence model

A **shape** is the authored statement of a system's intent:

- **Claims** about a **vocabulary** of parts, **bound** to code.
- **Providers** produce **evidence** about those claims.
- The **checker** compares claims with claims and claims with evidence, and derives **obligations**.
- **Context** explains why each claim exists. **Policy** says how much evidence is enough.
- A **change** is judged by how it moves claims (loosen or tighten) and evidence (invalidate or establish).

The three verbs are **assert** (claims), **establish** (evidence) and **owe** (obligations).

## Taxonomy

### 1. Vocabulary

| Concept | Meaning |
|---|---|
| Shape | The versioned, reviewed body of intent for one system, in modules. |
| Pack | Shared vocabulary, traits, templates and policy that shapes import. |
| Component | A unit of responsibility with an owner. |
| Resource | A thing of value that is acted on. |
| Unit | The finest named piece of behaviour (function, handler, job). |
| Effect | A typed verb on a resource. Effects form a lattice (`HardDelete` implies `Update`). |
| Trait | A named bundle that brings forbids, laws and evidence requirements to whatever carries it. |
| Boundary | Where meaning changes: language, process, network, trust. Assumptions are stated there. |
| Actor | A person, team or agent with a role: author, owner, approver. |
| Binding | The link from a vocabulary item to its code identity (symbol, table, module, binary). |
| Jurisdiction | The code a claim governs, computed from bindings. |

### 2. Claims

Every claim has a subject, a proposition, a jurisdiction, an owner, a criticality and a required evidence strength. There are five families.

| Family | Contents | Typical evidence | Decided by |
|---|---|---|---|
| Structure | Relations; topology rules (layering, forbidden paths, cycles). | Observed. | The checker, over the graph. |
| Authority | Grants, forbids, final forbids. | None; checked against conduct. | The checker. |
| Conduct | Effect summaries: complete, partial or unknown. | Observed, judged. | The checker, against observations. |
| Behaviour | Laws: invariants, contracts, history laws, equivalences, boundary domains. | Tested, proven. | Providers. |
| Trust | Trusted surfaces, assumptions, allowed escape hatches. | Observed (marker counts, axioms), judged. | The checker, against observations. |

Two further forms:

- **Template**: a parameterised claim (`HistoryPreserved<R>`, `Conservation<R>`, `Layering<A,B>`, `Idempotent<f>`).
- **Exception**: an owned, time-bounded deviation from a non-final claim. It can never apply to a final forbid.

Rules are claims over the architecture graph and are decided by the checker. Laws are claims over values and histories and are discharged by providers.

### 3. Context

- **Rationale**: why a claim exists.
- **Memory**: durable knowledge about a target, with owner, confidence and `protects`. Its checkable parts become laws.
- **Decision**: a recorded choice between alternatives.

Context explains claims and never replaces them.

### 4. Evidence

- **Evidence record**: one result about one claim. It carries:
  - the claim fingerprint and the code-subject fingerprint;
  - the provider and its version;
  - kind, scope or bound, and assumptions;
  - a result (supports, contradicts or inconclusive), a time, and an optional signature.
- **Provider**: anything that produces evidence. It declares a soundness (sound or heuristic), which caps the force of its evidence.
- **Strength**: declared (0) < observed (1) < tested (2) < proven (3). **Judged** is a separate axis: a human's or agent's decision with cited spans.
- **Freshness**: computed. Evidence is fresh while both fingerprints match, stale when either moves, and expired after the policy's time limit.
- **Fingerprint**: a normalised hash of meaning, for claims and for code subjects.
- **Meta-evidence (teeth)**: a claim is vacuous if no plausible change violates it. A gap is a plausible change that no claim catches.

### 5. Obligations

Obligations are derived, never authored. Each has a cause chain, an owner, the acts that can discharge it, a severity (blocking or owed) and a budget class (mechanical or judgment).

| Kind | Raised when |
|---|---|
| Evidence missing or too weak | Required strength is not met. |
| Evidence stale | A fingerprint moved. |
| Contradiction (drift) | An observation disagrees with a claim. |
| Loosening | A change admits a world the previous shape rejected. |
| Guarded change | A protected target changed; only a reevaluation discharges it. |
| Assumption | A new assumption or escape hatch, or an exception about to expire. |
| Coverage | Code changed inside a jurisdiction that no claim or evidence covers. |

**Debt** is the set of obligations deliberately left open, each owned and dated.

### 6. Change and governance

Change, the loosening/tightening order, guard, reevaluation, policy, approval.

### 7. Outputs and assurance

- **Verdict**: deterministic.
- **Obligation list**: the owed work.
- **Health**: evidence coverage, teeth, trust debt, judgment budget, escapes.
- **Semantic kernel**: Shape's meaning formalised in Lean. Implementations are tested against it.

## Invariants

1. Claims are authored, evidence is produced, obligations are derived. Nothing changes category.
2. Evidence establishes or contradicts; it never waives. Final forbids are final.
3. Every claim has an evidence route, or policy marks it declared-only.
4. Identity is by fingerprint, and freshness is computed.
5. Judgment is the residual. It is budgeted and recorded as evidence with checkable citations.
6. The checker reads only the shape, evidence records and the change. It never reads code.
7. Meaning is defined once, in the kernel, and every implementation answers to it.

## Strategic decisions already made

- **Evidence is an input to the checker.**
  - Records follow the in-toto Statement form (SCAI and Test Result predicates).
  - Subjects are matched by digest.
  - Signing is optional; Shape defines expiry and meaning.
  - Only what cannot be cheaply re-derived is persisted: judgments, signatures and expensive proofs.
- **Two kinds of law.**
  - Shape decides structure and authority natively.
  - It hosts behavioural laws, which providers discharge: property tests (TS), Verus (Rust), Lean or Bend proofs.
  - Templates are preferred to free-form specs (the Zelkova lesson).
- **Observe, don't author.**
  - Mappers and linters produce observations (evidence), never authored claims. A mismatch raises an obligation.
  - A provider's precision sets its force: sound observers can block, heuristic ones only raise obligations.
  - Resource bindings make conduct claims observable.
- **A checker you can audit.**
  - An executable Lean model, differential-tested against the TypeScript checker (the Cedar pattern).
  - Fixed loosening questions answered with counterexamples (the `CheckNoNewAccess` / `check_implies` pattern).
  - Teeth checks are built in.
- **Placement of each technology.**
  - Verus: provider.
  - TypeScript: provider and home ecosystem.
  - Lean: adopted inward.
  - Bend: two borrowed ideas, the law-file split and named escape hatches.
  - Claude CI: provider of judged evidence for what is left over, on a budget.
  - Structure linters: taken in as observations.
  - Rust/WASM kernel, Datalog spike and HVM: retired as engines.

## Hypotheses to test

| ID | Hypothesis | Falsified if |
|---|---|---|
| H1 | The per-change judgment budget falls sharply when only obligations whose dischargers include judgment go to a person or Claude. | Judgment obligations per change are not at least halved, against today's path-level coverage, on Shape's own history. |
| H2 | Intent stops rotting: drift surfaces as a stale or contradicted obligation at the change that causes it. | Seeded drift goes unflagged. |
| H3 | Behavioural bugs inside a law's jurisdiction don't merge. | Planted bugs survive at more than the tested scope's measured miss rate. |
| H4 | Loosening becomes a decision, with a counterexample. | The decider classifies fewer rule changes in `fixtures/loosening` than a syntactic diff, or classifies any wrongly. |
| H5 | Escape hatches cannot grow silently. | Hatch growth in the Verus corpus replay is missed at a higher rate than the 15% a per-file count diff missed (E9: 85% recall). |
| H6 | Teeth checks find real vacuity and gaps in real shapes. | They find nothing in Shape's own model. |

## Evidence base (read as needed)

- **Verus probes** (R1–R6, E1–E10), in `experiments/verus-probes/`:
  - results in `README.md`;
  - per-commit data in `results/per-commit/*.json.gz`;
  - E3 contract loosening in `results/e3_*.json`;
  - E10 model mutation in `e10/REPORT.md`.
- **Bend probes** (A1–G8), in `experiments/bend-probes/`: `README.md` and the per-track reports.
- **Bend and HVM research report**: `reports/Bend and HVM for Shape.md`.
- **Strategy research**:
  - `research_notes/Shape strategy/landscape.md`
  - `research_notes/Shape strategy/verification_evidence.md`
- **Shape's design boundary**:
  - `README.md`
  - `docs-site/src/content/docs/inside-shape/design-rationale.md` (design-pressure questions)
  - `docs-site/src/content/docs/reference/glossary.md`

## Resources

- **Shape CLI (0.x)**: `bun /home/user/shapelang/packages/shp-cli/src/index.ts <cmd>`, including `inspect --json`.
- **Lean 4.34.0 with lake**: `/tmp/claude-0/-home-user-shapelang/83ff80bc-0161-572f-9e5a-9075cccad6d0/scratchpad/lean/lean-4.34.0-linux/bin`.
- **Fixtures**:
  - `fixtures/loosening/` (23 base/head cases)
  - `fixtures/skills/` (review, guard and index cases)
  - `fixtures/pass`, `fixtures/fail`
- **E10 mutation scripts**: `experiments/verus-probes/e10/scripts/`, for about 82,000 model mutants of `shape/`.
- **Bend generation harness** (tasks, hidden tests, mutants):
  - `/tmp/claude-0/-home-user-shapelang/83ff80bc-0161-572f-9e5a-9075cccad6d0/scratchpad/bendexp/tasks/`
  - `/tmp/claude-0/-home-user-shapelang/83ff80bc-0161-572f-9e5a-9075cccad6d0/scratchpad/bendexp/hidden/`
  - Laws written by agents are in `.../bendexp/g8/`.
- **Scratch space**: `/tmp/claude-0/-home-user-shapelang/83ff80bc-0161-572f-9e5a-9075cccad6d0/scratchpad/shape1work/`.

## Rules for every agent

- Write only under `experiments/shape-1/` or the scratch space. Do not modify any other repository file, do not commit or push, and do not run the repository's AST generator.
- TypeScript library code under `experiments/shape-1/` must pass the repo's `bun run typecheck` and `bun run lint`. One-off scripts may start with `// @ts-nocheck`. Run Python with `python3 -I`.
- Return long documents as text in your structured result, not as Markdown files. The coordinator writes the documents into the repository.
- Report measured numbers and exact commands. Mark speculation as speculation.
