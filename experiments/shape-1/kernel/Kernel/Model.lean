import Kernel.Order
import Kernel.Json
import Kernel.Sha256
import Std.Data.HashMap
/-! Shape 1.0 kernel (model version 7): core datatypes (model §2–§9, annex A.3–A.9, A.12.9).

The kernel reads a `shape.kernel.case/v1` (records §4, A.11.2.1): both elaborated shapes (ESF),
manifests with refs and flags, pre-pass-validated records, review lines, authors* and now*.
Parsing of `.shape` text, signatures, record validation and tree checks are the pre-pass's
(A.11.2.1). -/
namespace Shape

def TRUST : String := "std::Trust"

inductive Tier | low | normal | critical | final
deriving DecidableEq, Repr, Inhabited

def Tier.rank : Tier → Nat
  | .low => 1 | .normal => 2 | .critical => 3 | .final => 4

def Tier.name : Tier → String
  | .low => "low" | .normal => "normal" | .critical => "critical" | .final => "final"

def Tier.ofRank : Nat → Tier
  | 1 => .low | 2 => .normal | 3 => .critical | 4 => .final | _ => .low

def tierMax (a b : Tier) : Tier := if a.rank ≥ b.rank then a else b

def tiersMax (ts : List Tier) (d : Tier := .low) : Tier := ts.foldl tierMax d

/-- Evidence level; `none` is the informal level no test or proof reaches (A.5.3.1). -/
inductive Level | declared | tested | proven | none
deriving DecidableEq, Repr, Inhabited

def Level.rank : Level → Nat
  | .declared => 0 | .tested => 1 | .proven => 2 | .none => 3

def Level.name : Level → String
  | .declared => "declared" | .tested => "tested" | .proven => "proven" | .none => "none"

def levelMax (a b : Level) : Level := if a.rank ≥ b.rank then a else b

inductive RecKind | observation | test | proof | judgment | equivalence
deriving DecidableEq, Repr, Inhabited

inductive Result | observes | supports | contradicts | inconclusive | approves | equivalent | implies
deriving DecidableEq, Repr, Inhabited

/-- An atom `Verb<Resource>`; the resource is a resource Q (or `std::Trust`). -/
structure Atom where
  verb : String
  res : String
deriving DecidableEq, Repr, Inhabited, Hashable

def Atom.show (a : Atom) : String := a.verb ++ "<" ++ a.res ++ ">"
def Atom.isTrust (a : Atom) : Bool := a.res == TRUST

/-- Unit selectors (A.4.2.2). -/
inductive USel | all | ungoverned | comp (q : String) | unit (q : String)
deriving DecidableEq, Repr, Inhabited

/-- Node selectors (A.4.2.2). -/
inductive NSel | all | comp (q : String) | res (q : String)
deriving DecidableEq, Repr, Inhabited

/-- Law statements: schema (template instance; args as JCS texts), hosted (symbol at closure),
    informal. -/
inductive Stmt | schema (name fp : String) (args : List String) | hosted (ref : String) | text (t : String)
deriving DecidableEq, Repr, Inhabited

/-- Claim operators (model §4.2). Trust claims are `effectForbid` on `std::Trust` atoms.
    `effectsLower` carries its plain atoms and its `a via v` entries separately. -/
inductive Op
  | effectForbid (a : Atom) (scope exc : List USel)
  | authority (k : String) (grants : List Atom)
  | effectsUpper (u : String) (atoms : List Atom)
  | effectsLower (u : String) (atoms : List Atom) (vias : List (Atom × String))
  | edgeExists (a kind b : String)
  | edgeForbid (S X : List NSel) (kind : String) (T Y : List NSel)
  | pathForbid (S T : List NSel) (kinds : List String) (V : List NSel)
  | cycleForbid (kinds : List String)
  | law (on : List String) (stmt : Stmt)
  | other (name : String)
deriving DecidableEq, Repr, Inhabited

/-- Requirement (A.5.3.1): projection is `unit`, `contract` or `trust`. -/
structure Req where
  level : Level
  judged : Bool
  pins : List String
  proj : String
deriving DecidableEq, Repr, Inhabited

structure Claim where
  ids : List String
  op : Op
  fp : String
  owner : String
  tier : Tier
  req : Option Req
  /-- JCS of the NF's `args`, used for renaming under ρ (A.5.6.3) -/
  argsJ : String := "{}"
  /-- the op name as printed (`effect.forbid`, …) -/
  opName : String := ""
  /-- schema | hosted | informal (laws only), "" otherwise -/
  form : String := ""
  /-- the declaration bearing the claim (unit, component or resource Q) -/
  bearer : Option String := none
  /-- where an inherited owner / tier is written (`shape`, `component Q`, `unit Q`, `default`;
      none when the claim's own declaration writes it), A.8.2.3 L7 [D18] -/
  ownerFrom : Option String := none
  tierFrom : Option String := none
deriving DecidableEq, Repr, Inhabited

def Claim.isForbid (c : Claim) : Bool := match c.op with | .effectForbid .. => true | _ => false
def Claim.isAuthority (c : Claim) : Bool := match c.op with | .authority .. => true | _ => false
def Claim.isSummary (c : Claim) : Bool := match c.op with | .effectsUpper .. => true | _ => false
def Claim.isLaw (c : Claim) : Bool := match c.op with | .law .. => true | _ => false
def Claim.isStructUpper (c : Claim) : Bool :=
  match c.op with | .edgeForbid .. | .pathForbid .. | .cycleForbid .. => true | _ => false
def Claim.isLower (c : Claim) : Bool :=
  match c.op with | .effectsLower .. | .edgeExists .. => true | _ => false
/-- Upper bounds: forbids, authority, summaries, structural forbids (A.4.1.6). -/
def Claim.isUpper (c : Claim) : Bool :=
  match c.op with
  | .effectForbid .. | .authority .. | .effectsUpper .. | .edgeForbid .. | .pathForbid .. | .cycleForbid .. => true
  | _ => false
def Claim.checkerDecided (c : Claim) : Bool := !c.isLaw && match c.op with | .other _ => false | _ => true
def Claim.firstId (c : Claim) : String := c.ids.headD c.fp

structure Actor where
  q : String
  kind : String
  operator : Option String
  members : List String
  identities : List String := []
  was : Option String := none
deriving DecidableEq, Repr, Inhabited

structure Comp where
  q : String
  owner : String
  tier : Tier
  boundary : Bool
  paths : List String
  allows : List String
  /-- ids of the boundary's named assumptions -/
  assumes : List String
  exceptPaths : List String := []
  /-- `none`: open authority (no grants clause) -/
  grants : Option (List Atom) := none
  was : Option String := none
  ownerFrom : Option String := none
deriving DecidableEq, Repr, Inhabited

structure Res where
  q : String
  owner : String
  tier : Tier
  bind : List String
  was : Option String := none
  ownerFrom : Option String := none
deriving DecidableEq, Repr, Inhabited

structure UnitD where
  q : String
  comp : String
  name : String
  owner : String
  tier : Tier
  bind : Option String
  was : Option String := none
  /-- summary mode (`complete` | `partial`), when the unit declares effects -/
  summaryMode : Option String := none
  ownerFrom : Option String := none
  tierFrom : Option String := none
deriving DecidableEq, Repr, Inhabited

structure Prov where
  q : String
  produces : List RecKind
  producesS : List String
  observes : List String
  decides : List String
  presence : Bool
  absence : Bool
  persist : Bool
  depsComplete : Bool
  identity : Option String
  trusts : List (String × String)
  hasImpl : Bool
  implPaths : List String
  implIds : List String
  implDigest : Option String
deriving DecidableEq, Repr, Inhabited

structure TierPol where
  floor : Level
  blocks : List String
  maxAge : Nat
  judges : List String
deriving DecidableEq, Repr, Inhabited

structure Policy where
  low : TierPol
  normal : TierPol
  critical : TierPol
  budget : Option Nat
deriving DecidableEq, Repr, Inhabited

/-- std::DefaultPolicy (syntax §4, A.9.5). -/
def defaultPolicy : Policy :=
  { low := ⟨.declared, [], 365, ["agents", "owner"]⟩
    normal := ⟨.declared, ["latent-loosening"], 365, ["agents", "owner"]⟩
    critical := ⟨.tested, ["coverage", "latent-loosening", "unestablished"], 90, ["owner"]⟩
    budget := none }

def Policy.tier (p : Policy) : Tier → TierPol
  | .low => p.low | .normal => p.normal | .critical => p.critical | .final => p.critical

inductive ExcSubj | unitSel (s : String) | code (id : String) | pair (a b : String)
deriving DecidableEq, Repr, Inhabited

structure Exc where
  q : String
  waives : List String
  targetClaims : List String
  targetComp : Option String
  /-- the target as written (`rule X`, `component K`, …) -/
  targetRef : String
  subjects : Option (List ExcSubj)
  owner : String
  expires : Int
deriving DecidableEq, Repr, Inhabited

structure Template where
  q : String
  schemaFp : String
  params : List (String × String)
  order : List (String × String)
deriving DecidableEq, Repr, Inhabited

/-- An error passed through from the elaborator (head shape errors, base defects). -/
structure ErrIn where
  code : String
  subject : String
  causes : List (String × String) := []
  dischargers : J := .arr []
deriving Inhabited

/-- The elaborated shape (shape.elaborated.v1, A.12.9). -/
structure Esf where
  q : String
  owner : String
  /-- the shape's manifest identity (A.5.2.17, D27) -/
  manifestId : Option String := none
  actors : List Actor := []
  verbs : List String := []
  effects : List (String × String) := []
  hatches : List (String × String) := []
  kinds : List (String × String × String) := []
  comps : List Comp := []
  res : List Res := []
  units : List UnitD := []
  claims : List Claim := []
  provs : List Prov := []
  templates : List Template := []
  excs : List Exc := []
  policy : Policy := defaultPolicy
  errors : List ErrIn := []
deriving Inhabited

/-! ### Manifests -/

structure IdInfo where
  id : String
  lang : String
  path : String
  symbol : Option String
  kind : String
  parent : Option String
  /-- projection → digest (the first scheme listed) -/
  digests : List (String × String)
  /-- projection → scheme -/
  schemes : List (String × String)
  /-- every (projection, digest) listed, all schemes (multi-scheme digests are ≡, A.5.6.2) -/
  allDigests : List (String × String)
  markers : List (String × Nat)
  hatchComplete : Bool
  executable : Bool
  refs : List String
deriving Inhabited, Repr

structure Manifest where
  revision : String
  ids : Std.HashMap String IdInfo
  /-- the identities, sorted -/
  order : List String
  children : Std.HashMap String (List String)
  /-- signed by the base manifest identity (decided by the pre-pass, A.5.2.17) -/
  authenticated : Bool
  present : Bool
deriving Inhabited

def Manifest.empty : Manifest := { revision := "", ids := {}, order := [], children := {}, authenticated := false, present := false }

def Manifest.info? (m : Manifest) (x : String) : Option IdInfo := m.ids.get? x
def Manifest.has (m : Manifest) (x : String) : Bool := m.ids.contains x
def Manifest.digest (m : Manifest) (x p : String) : Option String :=
  (m.ids.get? x).bind fun i => (i.digests.find? (·.1 == p)).map (·.2)
def Manifest.scheme (m : Manifest) (x p : String) : Option String :=
  (m.ids.get? x).bind fun i => (i.schemes.find? (·.1 == p)).map (·.2)
/-- x's digest at p is ≡ d: equal to some digest listed at p (any scheme). -/
def Manifest.digestIs (m : Manifest) (x p d : String) : Bool :=
  match m.ids.get? x with
  | some i => i.allDigests.any (fun q => q.1 == p && q.2 == d)
  | none => false
def Manifest.markers (m : Manifest) (x : String) : List (String × Nat) :=
  ((m.ids.get? x).map (·.markers)).getD []
def Manifest.parent (m : Manifest) (x : String) : Option String := (m.ids.get? x).bind (·.parent)

/-- x and its ancestors by `parent`, nearest first. -/
def Manifest.ancestors (m : Manifest) (x : String) : List String :=
  let rec go (fuel : Nat) (y : String) (acc : List String) : List String :=
    match fuel with
    | 0 => (y :: acc).reverse
    | fuel + 1 =>
      if acc.contains y then acc.reverse
      else match m.parent y with
        | some p => go fuel p (y :: acc)
        | none => (y :: acc).reverse
  go (m.order.length + 1) x []

partial def Manifest.descendants (m : Manifest) (x : String) : List String :=
  let rec go (stack : List String) (seen : List String) : List String :=
    match stack with
    | [] => seen
    | y :: rest =>
      if seen.contains y then go rest seen
      else go (((m.children.get? y).getD []) ++ rest) (y :: seen)
  go [x] []

/-! ### Records -/

structure Cite where
  id : String
  proj : String
  digest : String
deriving DecidableEq, Repr, Inhabited

structure OEntry where
  id : String
  proj : String
  digest : String
  complete : Bool
  deps : List Cite
deriving DecidableEq, Repr, Inhabited

/-- A raw fact: `ty` is `effect`, `call`, `edge` (records). `n` is absent when the provider
    did not report it (a missing n counts as unknown, A.12.8.4). -/
structure Fact where
  ty : String
  loc : String
  verb : String
  res : String
  to : String
  kind : String
  n : Option Nat
  /-- the fact as the record gives it -/
  raw : J := .null
deriving Repr, Inhabited

structure Record where
  id : String
  kind : RecKind
  result : Result
  provider : Option String
  revision : String
  time : Int
  claimFp : Option String
  claimId : Option String
  code : List Cite
  deps : List Cite
  /-- the record carries a `deps` field (reuse through deps complete needs one, A.5.4.1) -/
  hasDeps : Bool := false
  harness : List Cite
  hasHarness : Bool
  entries : List OEntry
  facts : List Fact
  assumptions : List (String × String)
  /-- the counterexample as given (records §3) -/
  counterexample : Option J
  judge : Option String
  aboutChange : Option String
  refs : List String
  authenticated : Bool
  /-- a persisted judgment of an earlier change (persisted.base), A.16.4(b) -/
  persistedBase : Bool
  pairSpace : String
  pairFrom : String
  pairTo : String
deriving Inhabited

/-- A review line (A.7.6), with its base actor resolved by the pre-pass when there is one. -/
structure Review where
  actor : Option String
  identity : String
  line : String
  change : Option String
  /-- `review:` + 16 hex of H(review as the input gives it) (A.16.28) -/
  ref : String
deriving Inhabited, Repr

inductive Mode | change | audit | preview
deriving DecidableEq, Repr, Inhabited

def Mode.name : Mode → String | .change => "change" | .audit => "audit" | .preview => "preview"

/-- A kernel case (records §4, A.11.2.1). -/
structure Input where
  mode : Mode
  now : Int
  changeIds : List String
  authors : List String
  unmappedBot : Bool
  head : Esf
  /-- the base shape (`none` in audit mode or when unreadable) -/
  base : Option Esf
  hasBaseRev : Bool
  baseUnreadable : Bool
  headRev : String
  baseRev : String
  mh : Manifest
  mb : Manifest
  records : List Record
  baseRecords : List Record
  /-- how many baseRecords the input supplied, rejected ones included (health baseObservations) -/
  baseRecordsSupplied : Nat := 0
  reviews : List Review
  /-- pre-pass products printed as given -/
  inputDigest : String
  rejected : List J
  clockClamped : Bool
  options : J
deriving Inhabited

end Shape
