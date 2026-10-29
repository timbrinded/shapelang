# Shape 1.0 surface syntax (core, version 7)

Explicit style: each keyword answers one reviewer question, one form per concept, no meaning from layout; finality is a tier; code identities are written as diagnostics print them. Defaults: `std::DefaultPolicy`, units bound by name, inherited owner and tier, a built-in manifest builder. Version 7 adds `except` paths, `was` on actors, identities in `implementation` and `manifest` on the shape.

## 1. A complete file

`shape.lock`: `{"v": "shape.lock.v1", "packs": [{"name": "std", "version": "1.0.0", "digest": "sha256:9a1f0c2e5b7d3a8f…"}]}`

`shape/audit.shape`:

```shape
module audit
import std

shape AuditService { owner Platform manifest sigstore("https://github.com/acme/audit/.github/workflows/manifest.yml@refs/heads/main") }

actor Platform { kind team member alice member carol }
actor AuditTeam { kind team member bob }
actor alice { kind person identity github("alice") }
actor carol { kind person identity github("carol") }
actor bob { kind person identity github("bob") }
actor codeAgent { kind agent operator alice identity github("acme-code-agent[bot]") }

resource AuditEvent : AppendOnly {
  owner AuditTeam
  tier final
  bind pg.table("audit_events")
}

component AuditStore {
  owner AuditTeam
  tier critical
  bind paths { "src/audit/**/*.ts" }
  grants Append<AuditEvent>, Read<AuditEvent>
  unit appendEvent { effects complete { Append<AuditEvent> } }
}

law EventsArePreserved = HistoryPreserved<AuditEvent> {
  on component AuditStore
  evidence tested by fastCheck
}

provider sqlEffects {
  produces observation
  observes effect(pg.table("*"))
  sound presence, absence
  deps complete
  identity sigstore("https://github.com/acme/audit/.github/workflows/sql.yml@refs/heads/main")
  implementation { digest "sha256:<sql-effects 2.3.1 release archive>" }
}

provider fastCheck {
  produces test
  decides template HistoryPreserved
  sound presence
  identity sigstore("https://github.com/acme/audit/.github/workflows/test.yml@refs/heads/main")
  implementation { bind pkgjson("package.json#scripts.test") bind paths { "bun.lock" "bunfig.toml" } }
}

provider reviews { produces judgment identity sigstore("https://github.com/acme/audit/.github/workflows/relay.yml@refs/heads/main") implementation { digest "sha256:<relay 1.0.0>" } }
```

The law inherits owner and tier from AuditStore; E-policy checks that two persons can lift `tier final` (bob, and alice or carol). The manifest job and each provider sign with their own identities; `fastCheck`'s runner is the `test` script alone.

## 2. Grammar sketch

```ebnf
File ::= ("module" QName)? ("import" QName)* Decl*
Decl ::= ShapeDecl | Actor | "effect" Id ("implies" Ids)? | "kind" Id "from" Node "to" Node
  | "hatch" Ids "in" Lang | Resource | Component | Boundary | Relation | Rule | Law
  | Template | Exception | Note | Provider | Policy
ShapeDecl ::= "shape" Id "{" "owner" Owner ("policy" Ref)? ("manifest" Identity)? "}"
Actor ::= "actor" Id "{" "kind" ("person"|"team"|"agent") ("operator" Ref)?
  ("identity" Identity)* ("member" Ref)* ("was" QName)? "}"
Owner ::= Ref | Identity
Identity ::= Id "(" String ")"
Node ::= "component" | "resource"
Resource ::= "resource" Id Attach? ("{" (Meta | "bind" CodeRef ("," CodeRef)*)* "}")?
Component ::= "component" Id Attach? "{" CompMember* "}"
Boundary ::= "boundary" Id Attach? "{" (CompMember | "allows" "hatch" Ids | "assumes" Id String)* "}"
CompMember ::= Meta | "bind" "paths" "{" String+ "}" ("except" "{" String+ "}")? | "grants" (Atoms | "none")
  | "relations" "complete" "over" Ids | Unit
Unit ::= "unit" Id Attach? ("{" (Meta | "bind" SourceRef
  | "effects" ("complete"|"partial") "{" (Atom ("via" Ref)?)* "}" | "effects" "unknown")* "}")?
Meta ::= "owner" Owner | "tier" Tier | "was" QName
Relation ::= "relation" Id "{" "kind" Id "connects" Ref ("->" Ref)+ ClaimMeta* "}"
Rule ::= "rule" Id "{" (Clause | "when" Id "has" QName | ClaimMeta)* "}"
  | "rule" Id "=" TemplateApp ("{" ClaimMeta* "}")?
Clause ::= "forbid" "final"? ( Atom ("within" UnitSels)? ("except" UnitSels)?
  | "path" NodeSels "->" NodeSels "over" Ids ("except" "via" NodeSels)?
  | "edge" Id "from" NodeSels "to" NodeSels ("except" "from" NodeSels)? ("except" "to" NodeSels)?
  | "cycle" "over" Ids
  | "hatch" (Ids | "*") "outside" "boundaries" )
Law ::= "law" Id "{" "on" Targets ("statement" SourceRef | "informal" String) ClaimMeta* "}"
  | "law" Id "=" TemplateApp ("{" ("on" Targets)? ClaimMeta* "}")?
ClaimMeta ::= "owner" Owner | "tier" Tier
  | "evidence" (Level ("or" "judged")? | "judged") ("at" ("unit"|"contract"|"trust"))? ("by" Refs)?
Template ::= "template" Id "<" (Id ":" ParamKind ("," Id ":" ParamKind)*)? ">" "{" TBody* "}"
ParamKind ::= "resource" | "component" | "unit" | "effect" | "kind" | "value" | "code"
TBody ::= Clause | "grants" Atom | "law" "{" ("on" Targets)? ("informal" String)? ClaimMeta* "}"
  | "requires" "note" NoteKind ("," NoteKind)* | "order" Id "by" ("leq"|"geq"|"subset"|"superset"|"equal")
Exception ::= "exception" Id "{" "waives" (ObKinds "of")? (ClaimRef | "component" Ref)
  ("for" Subject ("," Subject)*)? "owner" Owner "expires" Date "}"
ObKinds ::= ("contradiction" | "unestablished") ("," ObKinds)?
Subject ::= UnitSel | "code" SourceRef | "pair" Ref "->" Ref
Note ::= "note" Id ":" NoteKind "{" "about" Targets ("owner" Owner | "text" String
  | "confidence" ("low"|"medium"|"high") | "chose" String "over" Strings)* "}"
NoteKind ::= "rationale" | "memory" | "decision"
Provider ::= "provider" Id "{" ( "produces" RecKinds | "observes" Channels | "decides" Decided
  | "sound" (("presence"|"absence") ("," ("presence"|"absence"))? | "none")
  | "persist" | "deps" "complete" | "identity" Identity | "trusts" "tool" "(" String "," String ")"
  | "implementation" "{" ("bind" "paths" "{" String+ "}" | "bind" SourceRef | "digest" String)+ "}" )* "}"
RecKinds ::= ("observation"|"test"|"proof"|"judgment"|"equivalence") ("," RecKinds)?
Channel ::= "effect" "(" CodeRef ")" | "call" "(" Lang ")" | "edge" "(" Id ("," CodeRef)? ")"
Decided ::= "template" QName | "statements" Lang | "equivalence"
Policy ::= "policy" Id "{" ("tier" ("low"|"normal"|"critical") "{" ("floor" Level)?
  ("blocks" Blocks)? ("max_age" Int "days")? ("judges" ("owner"|"agents"|Ref) ("," …)*)? "}")*
  ("judgment" "budget" Int "per" "change")? "}"
Blocks ::= ("unestablished" | "coverage" | "latent" "loosening") ("," Blocks)?
Attach ::= ":" TemplateApp ("," TemplateApp)*
TemplateApp ::= QName ("<" Args? ">")?
Arg ::= Ref | Atom | String | Int | "code" SourceRef
Atom ::= Id "<" Ref ">"
SourceRef ::= Lang "(" String ")"
CodeRef ::= Id "." Id "(" String ")"   (* pg.table("…"); "*" allowed in channels *)
UnitSel ::= "*" | "ungoverned" | "component" Ref | "unit" Ref | Ref
NodeSel ::= "*" | "component" Ref | "resource" Ref | Ref
Target ::= ("unit"|"component"|"resource"|"rule"|"law"|"relation"|"exception") Ref | "code" SourceRef
ClaimRef ::= ("rule"|"law"|"relation"|"authority") Ref | "claim" String
Level ::= "declared" | "tested" | "proven"
Tier ::= "low" | "normal" | "critical" | "final"

(* review lines, written in code-host reviews *)
ReviewLine ::= "shape" "approve" ("bd:" Hex{16,})+ | "shape" "judge" ClaimSel | "shape" "reject" ClaimSel Text
ClaimSel ::= ClaimId | "c:" Hex{16,}
```

Plural forms are comma lists; `requires note` with several kinds accepts any. Keywords, `ungoverned` and `Undeclared` are reserved. `order … by leq|geq` accepts only `Int` (safe integer) arguments. Wrong-sort references are E-unknown; `ungoverned` is a unit, never a node; `*` as a node means every node.

## 3. Construct to model

| Construct | Model |
|---|---|
| `grants …` / `grants none` / no clause | `authority(K)` / empty grants / open authority |
| `relations complete over k`; `relation R { kind k connects A -> B }` | `edge.forbid` K → `*` except declared k-targets; `edge.exists` per consecutive pair |
| `effects complete/partial { … }`, `a via v` | `effects.upper`, `effects.lower` over the unit's own code |
| `forbid [final] V<R>`, `path`, `edge`, `cycle`, `hatch K outside boundaries` | `effect.forbid`, `path.forbid`, `edge.forbid`, `cycle.forbid`; per-verb hatch clauses (model §4.1) |
| `bind paths {…} except {…}`; `boundary { allows … assumes … }` | region minus excepted globs; fields read by hatch clauses, assumptions, L7 |
| `law L = T<args>` / `statement verus("…")` / `informal "…"` | schema / hosted (providers) / informal (judgment) |
| `exception`; `note`; `was Old` | debt; context; ρ |
| `provider`, `implementation`, `manifest`, `policy`, `evidence`, `owner`, `tier` | governance outside the NF (L7, heirs) |
| `shape approve bd:…`; `shape judge`, `shape reject` | answer; claim judgment |

## 4. The std pack (excerpt)

`module std` declares the verbs Read, Write, Export ⇒ Read, Append, Import and Update ⇒ Write, Redact, LogicalDelete and HardDelete ⇒ Update, Truncate ⇒ HardDelete, DropStorage ⇒ Truncate; `resource Trust` with `Hatch` and `Undeclared ⇒ Hatch`; the kinds calls, callbacks, data_flow and coordinated_call (component to component) and provides (component to resource); and the hatch kinds external_body, external, assume, admit, assume_specification, uninterp and axiom in verus, unsafe in bend and rust, and ts_ignore, ts_expect_error and ts_nocheck in ts. Its templates and policy:

```shape
template AppendOnly<R: resource> { forbid Update<R> }
template HatchesStayAtBoundaries<> { forbid hatch * outside boundaries }
template ReviewedSurface<B: component> {
  law { informal "The trusted surface of this component is acceptable." evidence judged at trust }
}
template RefactorSensitive<U: unit> {
  requires note memory
  law { informal "Changes to this unit preserve the constraint recorded in its memory note." }
}
template Deterministic<F: unit> { law { evidence tested } }
template HistoryPreserved<R: resource> { law { evidence tested } }

policy DefaultPolicy {
  tier low { floor declared max_age 365 days judges owner, agents }
  tier normal { floor declared blocks latent loosening max_age 365 days judges owner, agents }
  tier critical { floor tested blocks unestablished, coverage, latent loosening max_age 90 days judges owner }
}
```

The pack holds no active claim and no tier. `HatchesStayAtBoundaries<>` gives twelve forbids, one per declared hatch verb plus `Undeclared`. More std (`Bounded` with its order table, 0.x markers, shape traits), the Verus quickstart and removed 0.x constructs: A.13.
