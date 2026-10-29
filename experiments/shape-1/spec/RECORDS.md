# Records, fingerprints and the checker contract (core, version 7)

Values come from `experiments/shape-1/spec/vectors/vectors.py` (113 values) and are shown to 16 hex digits; registry entries and remaining encodings are in A.12.

## 1. Names

- Digest `sha256:<64 hex>` (bare hex in in-toto `digest` maps); record id `H(JCS(statement))`, the DSSE payload when enveloped. Code identity `<lang>:<path>[#<symbol>]`, NFC, `%` and `#` percent-encoded (A.12.1); cells `cell:` + JCS `[v_b, v_h]`; resource code `<tag>.<kind>("<canonical value>")`, `*` in channels.
- Refs: answer `bd:` + ≥16 hex of a binding; claim: its id, or `c:` + ≥16 hex of its fp.

## 2. Fingerprints, facts and keys

**Claim NF**: `fp = H({"v":"shape.claim.v1","op":O,"args":A})`, names resolved, templates expanded, arrays sorted and deduplicated, strings NFC, informal text whitespace-collapsed.

| op | args |
|---|---|
| `edge.exists` | `{"from":Q,"kind":K,"to":Q}` |
| `path.forbid` | `{"from":[N],"to":[N],"kinds":[K],"exceptVia":[N]}` |
| `edge.forbid` | `{"from":[N],"exceptFrom":[N],"kind":K,"to":[N],"exceptTo":[N]}` |
| `cycle.forbid` | `{"kinds":[K]}` |
| `authority` | `{"component":Q,"grants":["Verb<Q>"]}` |
| `effect.forbid` | `{"atom":"Verb<Q>","scope":[U],"except":[U]}` |
| `effects.upper`, `effects.lower` | `{"unit":Q,"atoms":["Verb<Q>"]}` (lower may hold `"Verb<Q> via Q"`) |
| `law` | `{"on":[Target],"statement":S}`, S = `{"schema":Q,"schemaFp":D,"args":[Arg]}`, `{"ref":CodeId,"projection":"closure"}` or `{"text":T}` |

U is `"*"`, `"ungoverned"`, `"component Q"`, `"unit Q"`; N is `"*"`, `"component Q"`, `"resource Q"`; Target is `"unit Q"`, `"component Q"`, `"resource Q"`, `"code <id>"`. Verbs and kinds are unqualified; the trust resource is `std::Trust`. `schemaFp = H({"v":"shape.template.v1", name, params, body, order, notes})`, never including tier.

**Code digest**: `SHA-256(σ ‖ LF ‖ canon_σ(π(x)))`, scheme `σ = <lang>.<projection>.v<n>`: parse with the pinned parser, print canonically, drop only inert comments, canonicalise literals; `own` replaces nested identities by their path-free names, and only `unit` (and the Verus projections) appends what free names resolve to (A.12.3).

**Facts**: `{"type":"effect","at","verb","resource"}`, `{"type":"call","at","to"}`, `{"type":"edge","at","kind","to"}`, `{"type":"hatch","at","kind"}` (manifest only), with `"n"` (sites or markers; required on effect facts of presence-sound observers, RJ14); declared facts `{"type":"declared","claim":fp[,"atom"]}`. `factId = H(fact without "n")`, resource canonicalised first.

**Keys**: `"ob:" + hex(SHA-256(JCS({"v":"shape.obligation.v1", kind, claim?, subject})))`. Contradiction: claim fp and subject key (`{code, atom}`, `{from, to}`, `{nodes}`, `{unit, atom}` or `null`); unestablished: claim fp, `null`; loosening: the base item (`<fp>`, `"component Q"`, `"resource Q"`, `"unit Q"`, `"provider Q"`, `"actor Q"`, `"policy <tier>"`, `"shape"`); coverage: `"component Q"`, `"ungoverned"`, `"resourceCode <t>"`, `"verb <V>"`.

**Bindings**: `"bd:" + hex(SHA-256(JCS({"v":"shape.binding.v1", key, affected:[id], code:[[id, projection, base|null, head|null]], delta:[string]})))`; a coverage delta holds `"<claim fp> <channel>"` per unmet pair. **Groups**: `"g:" + hex(SHA-256(JCS(sorted keys)))`.

## 3. Statement profile

Records are in-toto Statement v1, optionally DSSE-enveloped, with Shape's fields in `predicate.shape`; tests SHOULD use the Test Result predicate, others SCAI v0.3 (A.12.5).

| Field | Content | Required for |
|---|---|---|
| `v`, `kind`, `result` | `shape.evidence.v1`; kind; observes, supports, contradicts, inconclusive, approves, equivalent, implies | all |
| `provider` | `{"id": Q, "version"}`; `null` for a judgment signed by its judge | all |
| `revision`, `time` | commit hex; RFC 3339 UTC seconds | all |
| `claim` | `{"id","fp"}` | test, proof, claim judgment |
| `code`, `deps` | `[{"id","projection","scheme","digest"}]` | code: test, proof, claim judgment, equivalence |
| `harness` | as `code`, possibly empty | observation, test, proof |
| `scope`, `facts` | `{"root","entries":[{…,"complete","deps"}]}`; raw facts | observation |
| `assumptions`, `bound`, `counterexample` | `[{"id","kind"}]` (hatch, named, tool); teeth data (`mutants`); float-free JSON, for tests at least `{seed, inputs, assertion}` | test, proof |
| `judge`, `identity`, `about` | actor; reviewer's code-host identity (relayed); `{"change","refs"}` | judgment; answers |
| `pair` | `{"space","from","to"}` | equivalence |

Example 1's observation (A.14.1.2) is from `audit::sqlEffects` 2.3.1, with scope root `sha256:ae2c60231357f6ff…`, entries such as `{"id": "ts:src/audit/purge.ts#purgeOldEvents", "projection": "unit", "scheme": "ts.unit.v2", "digest": "sha256:f60c501bff9e4c1b…", "complete": true, "deps": []}`, and the fact `{"type": "effect", "at": "ts:src/audit/purge.ts#purgeOldEvents", "verb": "HardDelete", "resource": "pg.table(\"public.audit_events\")", "n": 1}`.

**Validation** (RJ01–RJ14, A.12.6) runs before evaluation in both checkers; rejected records are listed by id with no force. **Persisted** records live at exactly `shape/evidence/<2 hex>/<64 hex>.json`, append-only.

## 4. Checker input and manifests

`shape.check.input/v1` = `{contract, mode, now, head: {revision, commit, files: [{path, text}], manifest}, base: {…} | null, packs: [{name, version, files}], change: {ids}, authors: [{identity, verified, bot}], reviews, records, baseRecords, persisted: {base, head}, trustRoots: {fulcio, rekor}, options: {health, teeth}}` with `mode` `change`, `audit` (`base: null`) or `preview` (gates accept only `change`). `files` is exactly the shape's files, checked against blob ids. A **manifest** is a statement (signed by the manifest identity when the base names one) whose `predicate.shape` is `{"v":"shape.manifest.v1", revision, tree: [{path, mode, blob}], entries: [{id, projection, scheme, digest, kind, parent, refs, markers?, executable, hatchComplete}]}`; `refs` lists what env(x) resolves to, `executable` makes a raw or command identity a raw carrier, `hatchComplete` follows A.3.4.4. The checker rebuilds the git tree and checks the commit (A.12.7).

The differential gate's **kernel case** `shape.kernel.case/v1` is `{contract, mode, now*, head: {revision, esf, manifest}, base | null, records, baseRecords, reviews, authors*, change}` after validation and authentication; cells are never supplied (A.11.2.1).

## 5. Checker output

`shape.check.output/v1` = `{contract, mode, inputDigest, verdict, errors: [{code, subject, message, causes, dischargers}], rejected: [{record, code, detail}], obligations, answered, loosening, order, renames, debt: [{obligation, exceptions, exception, owner, expiresInDays}], preexisting, budget: {limit, used, overflow}, health}`. An obligation is `{key, kind, reason, questions, introduced, severity, tier, budget, force, owner, assignee, group, claim: {fp, ids, tier}, subject, witness, facts, counterexample, exploited, final, binding, exception, dischargers, message, causes: [{type, id, text}]}`. Dischargers are `{act, by, agentSafe, eligible, creates, command?, snippet?}`, `command` being the review line to write. `order` is the order class (`null` in audit). `exception` is set once an exception takes effect; a debt row's `exceptions` lists every match, and `exception`, `owner` and `expiresInDays` come from the earliest-expiring. Exception-answered obligations appear in `obligations` and `answered`. **Core output** omits `message`, `causes[].text`, `command` and `snippet` and is byte-identical under input permutation; obligations sort by (severity, kind, key), errors by (code, subject). After 1.0, any change to an NF, projection, scheme, registry entry or key bumps its `v`.
