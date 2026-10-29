# Migrating from Shape 0.x to 1.0

1.0 keeps what a 0.x shape says about components, effects, relations and rules, and replaces path-level guards, attestations and loosening labels with claims, evidence records and derived obligations. `shp migrate` does the translation deterministically and reports every construct it rewrites or drops; you then add providers and, where you want the checker to decide more, tighten by hand. Migration mints no judgment, exception or rule that 0.x did not enforce (annex A.11.1 is the normative mapping).

## 1. What happens to a 0.x shape

### Model declarations

| 0.x | 1.0 | Note |
|---|---|---|
| component, `fn` | component, `unit` (binds by name) | unique-suffix sources are rewritten and listed in `renames`; path-less components bind over the manifest; workflow sources bind gha job or step identities |
| `grants` | `grants` (authority) | no `grants` clause means open authority, listed in health |
| `owns R` | R's `owner` becomes the component's owner | 0.x `owns` is name-checked and not exclusive; use `std::Owns<R,K>` only if you mean exclusivity |
| `effects complete { … }` | `effects complete { … }` over the unit's own code | 1.0 summaries are direct, as 0.x's were; callees' effects belong to the callee |
| `effects unknown` | no summary | `--allow-unknown-effects` is no longer needed |
| an effect name std does not declare | `effect V` in the migrated module | 0.x names were free identifiers; 1.0 verbs are declared |
| an untargeted effect (no resource) | dropped, reported | 0.x checked only targeted effects |
| `evidence ref` on an effect entry | dropped | observations replace cited evidence |
| `unsafe effects … reason … expires … requires …` | a decision note about the unit holding the reason, expiry and capabilities | 0.x `unsafe` changes nothing else, so nothing else is minted; code-level escape hatches are 1.0 hatches (§3) |
| trait | template; plain `forbid`, `allow`, `require` dropped | they were not enforced in 0.x |
| `forbid final` | `tier final`; `tier critical` when the owner and the shape owner lack two distinct persons (reported) | 1.0 final needs two persons (E-policy) |
| prelude `AppendOnly` | `std::NoHardDelete` at tier final | its 0.x meaning (no HardDelete, Truncate, DropStorage); 1.0's `std::AppendOnly` also forbids Update and is an opt-in tightening |
| prelude markers (`PII`, `Persistent`, `Secret`, …, `StorageAdapter`, `DataPlane`, `ControlPlane`) | std markers of the same name | `when R has T` rules keep working |
| `require_context Type<T> satisfied_by K` | `requires note K` | context type names are dropped; 1.0 notes have kinds only |
| relation | `relation` (edge.exists per consecutive pair) | `roles` dropped; `summary` becomes a note |
| custom relation kind | `kind k from component to component` (or `to resource`) | it stays outside cycle rules, as in 0.x |
| rule (calls, provides, hypercycle) | `forbid edge`, `forbid path`, `forbid cycle` over the four 0.x traversal kinds, authority | call-order clauses have no 1.0 form; they stay informal laws |
| `implementation` | path bindings and coverage | |
| `binding` | one `DocumentedBy` law per document | "one of N documents changed" is lost and listed |
| `role`, `approver`, `sensitive` | actors, policy judges, `tier critical` | |
| `change`, `modify`, `transform`, `fingerprint`, `expects`, `pin`, `storage`, `effect candidate` | removed; manifests, bindings, observations and `via` replace them | |
| shapes with `origin: generated_ast` | not migrated; they are mapper output | regenerate observations instead |

### Design memory

| 0.x | 1.0 | Note |
|---|---|---|
| rationale, memory, decision | notes (`summary` → text, `who.owner` → owner, `confidence` kept when low, medium or high) | `status`, `why`, `observed`, `applies_to`, evidence refs and the context type are appended to the text as labelled lines, so nothing is lost |
| a guard `on_change require ReEvaluation<Self>` (memory or rationale) | one informal law on the target, naming the note; `tier critical` when the memory is `sensitive` | owed and preexisting until someone judges it |
| `protects { … }` narrowing | dropped, reported | the law's Req is the unit; it fires on any change to it |
| `forbid transform L` | dropped, reported | 1.0 has no transform intents |
| `: RefactorSensitive` with a guard | `RefactorSensitive` (informal law plus the memory note) | |
| `: RefactorSensitive` with no guard | the memory note alone | removing a guard later is still an L4 loosening |
| shape traits `PreserveInline`, `RequiresDescription`, `ProtectedCheckOrder`, `NonIdiomatic`, `TestOnly` | the std templates of the same name, each only `requires note` | on a component or resource, a local template of that kind with the same body |
| `description "…"` / `description required` | a rationale note about the unit / `RequiresDescription` | |
| `reevaluation` (`outcome`, `summary`, `reviewer`, `decided_on`) | not migrated; listed with its target | no judgment is minted; the reviewer writes `shape judge` once a relay exists |
| `attest` | nothing | answers are review lines bound to one change |
| `review_by`, `--as-of` | the tier's `max_age`, CI's `now` | |

### Files and packs

| 0.x | 1.0 | Note |
|---|---|---|
| `shape/**/*.shape` | the same files plus `shape.lock`; `shape/evidence/` is reserved for records | every `.shape` file under `shape/` is part of the shape |
| domain packs vendored under `shape/vendor/` | ordinary shape modules, migrated with the shape | a module with no active claim may instead become a pack pinned in `shape.lock` |
| a local declaration silently shadowing an import | E-shadow | rename one of them |

### Commands and flags

| 0.x | 1.0 |
|---|---|
| `shp check` | `shp check --mode change` (or `--mode audit` with no base) |
| `--changed-files`, `--base-ref`, `--base-model` | the input's base and head revisions and manifests (CI supplies them) |
| `--check-loosening` | always on: questions L0–L7 with counterexamples |
| `--check-cited-paths` | always on: E-unbound |
| `--as-of`, `--strict-freshness` | CI's `now` and the tier's `max_age` |
| `--allow-unknown-effects` | not needed |
| `shp coverage`, `shp obligations` | obligations in `shp check`'s output |
| `shp attest prune` | removed (no attestations) |
| `shp explain`, `shp memory`, `shp inspect` | `shp inspect --json` (the elaborated shape and notes) and each obligation's causes |
| `shp graph`, `shp lsp`, `shp author` | not in 1.0; the 0.x tools keep working on 0.x files |
| `shp analyze`, `shp ast` (`--allow-parse-errors`) | observation providers, which mark unparsable files incomplete |
| `shp update` | unchanged |

## 2. Steps

1. **Pin and run migrate.** Add `shape.lock` pinning `std` 1.0.0, run `shp migrate [--maintainer <actor>]` on the 0.x shape, read its report of rewritten and dropped constructs, and run `shp check --mode audit`. Audit reads your own shape as its governance and treats everything as preexisting, so only errors block. Fix the errors first:
   - **E-unbound / E-ambiguous**: rebind the unit (`bind ts("path#symbol")`); the error carries a snippet.
   - **E-overlap**: two units on one identity. On Shape this was two 0.x functions sourcing one workflow file and two sourcing one script; bind each to its own job (`gha(".github/workflows/x.yml#jobs.<job>")`) or function.
   - **E-route**: give each law a provider, `evidence judged`, or `evidence declared`.
   - **E-policy**: a final item whose owner and the shape owner lack two persons; add a person or accept the `critical` that migrate chose.
   - **Alias resources**: two resources may not bind one resource code; keep one name (Shape had 5 such pairs).
2. **Land the manifest job and providers first, in their own change.** Providers act with establishing force only once the base declares them, so a change that adds a provider and the claims it decides gets `owed`, not `pass`. Declare each provider's `implementation` as narrowly as you can (`pkgjson("package.json#scripts.test")`, not the whole `package.json`): any edit to an implementation identity makes its records producer-changed. Give each provider, and the shape's `manifest`, a signing identity. Run every deciding provider on every change.
3. **Declare a review relay**, or have judges sign their own judgment records: without a relay, `shape judge` lines make no judgment (they are counted as `unrecorded`), while `shape approve` lines still answer for the run.
4. **Adopt claims in small changes.** New claims are tightenings and introduce nothing by themselves, so adoption changes report what already exists as preexisting and owed. The order that worked on Shape: rebinds and paths (with `except` globs for test files under a component), then resources and rules, then laws.
5. **Turn memories into laws where you can.** A memory whose checkable part is a rule or a test becomes a claim; keep the memory as a note `about` it. Removing the RefactorSensitive guard is an L4 loosening that one `shape approve` line answers (Example 3).
6. **Switch CI from 0.x to `shp check --mode change`.** The change that replaces the 0.x files is judged against the 0.x base elaborated through migrate; review it as a whole, since its head supplies the actors the 0.x base lacks.

## 3. Things that behave differently

- **Loosening is a question, not a label.** A change that admits a world the base rejected raises a loosening obligation with a counterexample, answered by the item's base owner; normal and critical tiers block latent loosening by default, as Shape's `shape-loosening-approved` label did.
- **Governance comes from the base.** Owner, tier, policy, provider and manifest-identity edits act after merge. A change cannot approve itself with a policy it adds, nor silence coverage by weakening an observer.
- **Coverage needs an observer.** Changed code under a claim needs coverage only on channels a base provider observes absence-soundly (or under a final claim). A claim with no such channel is listed as declared-only, with its route; resource codes of kinds the registry does not list (`fs.path`, `ts.type`, `gha.*`, …) are documentation.
- **Final needs two people.** `tier final` needs two distinct persons, one from the item's owner and one from the shape owner; final coverage needs two who between them cover every owner involved.
- **Old drift does not block.** Violations that exist before a change are preexisting and owed; they block only when the change introduces them, including by editing the code that holds them. A law already failing at base blocks again only when its counterexample changes.
- **Hatches.** `rule NoHatches = HatchesStayAtBoundaries<>` forbids every escape-hatch marker outside boundaries that `allows hatch` it; registry markers your shape does not declare count as `Undeclared` and are forbidden everywhere. In TypeScript, `@ts-ignore`, `@ts-expect-error` and `@ts-nocheck` are hatches; in Rust, `unsafe`; code using macros from dependencies is not hatch-complete and needs coverage when it changes.
- **Effects of callees.** A unit's `effects complete` lists its own effects. To forbid a component from causing an effect through calls, forbid the call (`forbid edge calls from K to …` or `relations complete over calls`).

## 4. Tooling

- `shp migrate [--maintainer <actor>]`: 0.x to 1.0 source; deterministic; reports renames, rewrites and dropped constructs.
- `shp manifest`: builds and signs the revision's manifest without executing code.
- `shp check --mode audit|change|preview`: the checker; `preview` is local and unsigned.
- `shp inspect --json`: the elaborated shape; `shp fmt [--explicit]`: canonical printing, `--explicit` showing inherited owners, tiers and resolved bindings.
- A reference CI workflow (manifest job, phase 1, review lines, relay, phase 2) ships with the distribution.

## 5. Known gaps at 1.0

No hosted statements for TypeScript tests (use template laws such as `Deterministic<F>`); no glob matching for path-like resource codes; DocumentedBy takes one document; call order inside a body has no claim form; no graph view or language server yet; Sigstore identities need a verifier in your gate (the reference CLI accepts `ed25519` identities).
