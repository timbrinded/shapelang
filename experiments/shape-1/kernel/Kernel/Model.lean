import Kernel.Order
/-! Shape 1.0 kernel: core datatypes (model §2–§9, annex A.3–A.9, A.12.9).

The kernel reads elaborated shapes (ESF), manifests and pre-pass-validated records. Parsing
of `.shape` text, signatures and tree checks are outside the kernel (A.11.2.1). -/
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
deriving DecidableEq, Repr, Inhabited

def Atom.show (a : Atom) : String := a.verb ++ "<" ++ a.res ++ ">"
def Atom.isTrust (a : Atom) : Bool := a.res == TRUST

/-- Unit selectors (A.4.2.2). -/
inductive USel | all | ungoverned | comp (q : String) | unit (q : String)
deriving DecidableEq, Repr, Inhabited

/-- Node selectors (A.4.2.2). -/
inductive NSel | all | comp (q : String) | res (q : String)
deriving DecidableEq, Repr, Inhabited

/-- Law statements: schema (template instance), hosted (symbol at closure), informal. -/
inductive Stmt | schema (name fp : String) (args : List String) | hosted (ref : String) | text (t : String)
deriving DecidableEq, Repr, Inhabited

/-- Claim operators (model §4.2). Trust claims are `effectForbid` on `std::Trust` atoms. -/
inductive Op
  | effectForbid (a : Atom) (scope exc : List USel)
  | authority (k : String) (grants : List Atom)
  | effectsUpper (u : String) (atoms : List Atom)
  | effectsLower (u : String) (atoms : List Atom)
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
deriving DecidableEq, Repr, Inhabited

def Claim.isForbid (c : Claim) : Bool := match c.op with | .effectForbid .. => true | _ => false
def Claim.isAuthority (c : Claim) : Bool := match c.op with | .authority .. => true | _ => false
def Claim.isLaw (c : Claim) : Bool := match c.op with | .law .. => true | _ => false
def Claim.isStructUpper (c : Claim) : Bool :=
  match c.op with | .edgeForbid .. | .pathForbid .. | .cycleForbid .. => true | _ => false

structure Actor where
  q : String
  kind : String
  operator : Option String
  members : List String
deriving DecidableEq, Repr, Inhabited

structure Comp where
  q : String
  owner : String
  tier : Tier
  boundary : Bool
  paths : List String
  allows : List String
  assumes : List String
deriving DecidableEq, Repr, Inhabited

structure Res where
  q : String
  owner : String
  tier : Tier
  bind : List String
deriving DecidableEq, Repr, Inhabited

structure UnitD where
  q : String
  comp : String
  name : String
  owner : String
  tier : Tier
  bind : Option String
deriving DecidableEq, Repr, Inhabited

structure Prov where
  q : String
  produces : List RecKind
  observes : List String
  decides : List String
  presence : Bool
  absence : Bool
  depsComplete : Bool
  identity : Option String
  trusts : List String
  implPaths : List String
  implDigest : Option String
  /-- JCS of each governance field as written (L7 compares them, A.8.2.3) -/
  fields : List (String × String)
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
  { low := ⟨.declared, [], 365, ["owner", "agents"]⟩
    normal := ⟨.declared, ["latent-loosening"], 365, ["owner", "agents"]⟩
    critical := ⟨.tested, ["unestablished", "coverage", "latent-loosening"], 90, ["owner"]⟩
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
  subjects : Option (List ExcSubj)
  owner : String
  expires : Int
deriving DecidableEq, Repr, Inhabited

/-- The elaborated shape, without its policy and exceptions (those are separate inputs
    so that governance can be varied independently of the theory, see `Input`). -/
structure Esf where
  q : String
  owner : String
  actors : List Actor
  verbs : List String
  effects : List (String × String)
  hatches : List (String × String)
  kinds : List (String × String × String)
  comps : List Comp
  res : List Res
  units : List UnitD
  claims : List Claim
  provs : List Prov
deriving DecidableEq, Repr, Inhabited

structure MEntry where
  id : String
  proj : String
  digest : String
  kind : String
  parent : Option String
  markers : List (String × Nat)
  hatchComplete : Bool
deriving DecidableEq, Repr, Inhabited

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

/-- A raw fact: `ty` is `effect`, `call`, `edge` (records) or `hatch` (manifest). -/
structure Fact where
  ty : String
  loc : String
  verb : String
  res : String
  to : String
  kind : String
  n : Nat
deriving DecidableEq, Repr, Inhabited

structure Record where
  id : String
  kind : RecKind
  result : Result
  provider : Option String
  revision : String
  time : Int
  claimFp : Option String
  code : List Cite
  deps : List Cite
  harness : List Cite
  entries : List OEntry
  facts : List Fact
  assumptions : List (String × String)
  counterexample : Bool
  judge : Option String
  aboutChange : Option String
  refs : List String
  authenticated : Bool
deriving DecidableEq, Repr, Inhabited

inductive Mode | change | audit
deriving DecidableEq, Repr, Inhabited

/-- Everything the change fixes apart from evidence and governance values. -/
structure Env where
  mode : Mode
  now : Int
  changeIds : List String
  authors : List String
  unmappedBot : Bool
  head : Esf
  base : Option Esf
  headRev : String
  mh : List MEntry
  mb : List MEntry
  cells : List (String × String)
deriving Inhabited

/-- A kernel case: the change, its evidence and its governance values. -/
structure Input where
  env : Env
  records : List Record
  baseRecords : List Record
  headPolicy : Policy
  basePolicy : Option Policy
  headExcs : List Exc
  baseExcs : List Exc
deriving Inhabited

/-! ### Encodings (for canonical sets) -/

instance : Enc Tier := Enc.ofInj Tier.rank (by intro a b h; cases a <;> cases b <;> simp_all [Tier.rank])
instance : Enc Level := Enc.ofInj Level.rank (by intro a b h; cases a <;> cases b <;> simp_all [Level.rank])

def RecKind.code : RecKind → Nat
  | .observation => 0 | .test => 1 | .proof => 2 | .judgment => 3 | .equivalence => 4
instance : Enc RecKind := Enc.ofInj RecKind.code (by intro a b h; cases a <;> cases b <;> simp_all [RecKind.code])

def Result.code : Result → Nat
  | .observes => 0 | .supports => 1 | .contradicts => 2 | .inconclusive => 3 | .approves => 4
  | .equivalent => 5 | .implies => 6
instance : Enc Result := Enc.ofInj Result.code (by intro a b h; cases a <;> cases b <;> simp_all [Result.code])

instance : Enc Mode := Enc.ofInj (fun m => match m with | Mode.change => 0 | Mode.audit => 1)
  (by intro a b h; cases a <;> cases b <;> simp_all)

instance : Enc Atom := Enc.ofInj (fun a => (a.verb, a.res)) (by intro a b h; cases a; cases b; simp_all)

def USel.toE : USel → Nat × String
  | .all => (0, "") | .ungoverned => (1, "") | .comp q => (2, q) | .unit q => (3, q)
instance : Enc USel := Enc.ofInj USel.toE (by intro a b h; cases a <;> cases b <;> simp_all [USel.toE])

def NSel.toE : NSel → Nat × String
  | .all => (0, "") | .comp q => (1, q) | .res q => (2, q)
instance : Enc NSel := Enc.ofInj NSel.toE (by intro a b h; cases a <;> cases b <;> simp_all [NSel.toE])

def Stmt.toE : Stmt → Nat × String × String × List String
  | .schema n f a => (0, n, f, a) | .hosted r => (1, r, "", []) | .text t => (2, t, "", [])
instance : Enc Stmt := Enc.ofInj Stmt.toE (by intro a b h; cases a <;> cases b <;> simp_all [Stmt.toE])

def Op.toE : Op → Nat × List String × List Atom × List USel × List USel × List NSel × List NSel ×
    List NSel × List NSel × Option Stmt
  | .effectForbid a s x => (0, [], [a], s, x, [], [], [], [], none)
  | .authority k g => (1, [k], g, [], [], [], [], [], [], none)
  | .effectsUpper u c => (2, [u], c, [], [], [], [], [], [], none)
  | .effectsLower u c => (3, [u], c, [], [], [], [], [], [], none)
  | .edgeExists a k b => (4, [a, k, b], [], [], [], [], [], [], [], none)
  | .edgeForbid S X k T Y => (5, [k], [], [], [], S, X, T, Y, none)
  | .pathForbid S T K V => (6, K, [], [], [], S, T, V, [], none)
  | .cycleForbid K => (7, K, [], [], [], [], [], [], [], none)
  | .law on st => (8, on, [], [], [], [], [], [], [], some st)
  | .other n => (9, [n], [], [], [], [], [], [], [], none)
instance : Enc Op := Enc.ofInj Op.toE (by intro a b h; cases a <;> cases b <;> simp_all [Op.toE])

instance : Enc Req := Enc.ofInj (fun r => (r.level, r.judged, r.pins, r.proj))
  (by intro a b h; cases a; cases b; simp_all)
instance : Enc Claim := Enc.ofInj (fun c => (c.ids, c.op, c.fp, c.owner, c.tier, c.req))
  (by intro a b h; cases a; cases b; simp_all)
instance : Enc Actor := Enc.ofInj (fun a => (a.q, a.kind, a.operator, a.members))
  (by intro a b h; cases a; cases b; simp_all)
instance : Enc Comp := Enc.ofInj (fun c => (c.q, c.owner, c.tier, c.boundary, c.paths, c.allows, c.assumes))
  (by intro a b h; cases a; cases b; simp_all)
instance : Enc Res := Enc.ofInj (fun r => (r.q, r.owner, r.tier, r.bind))
  (by intro a b h; cases a; cases b; simp_all)
instance : Enc UnitD := Enc.ofInj (fun u => (u.q, u.comp, u.name, u.owner, u.tier, u.bind))
  (by intro a b h; cases a; cases b; simp_all)
instance : Enc Prov := Enc.ofInj (fun p => (p.q, p.produces, p.observes, p.decides, p.presence, p.absence,
    p.depsComplete, p.identity, p.trusts, p.implPaths, p.implDigest, p.fields))
  (by intro a b h; cases a; cases b; simp_all)
def ExcSubj.toE : ExcSubj → Nat × String × String
  | .unitSel s => (0, s, "") | .code i => (1, i, "") | .pair a b => (2, a, b)
instance : Enc ExcSubj := Enc.ofInj ExcSubj.toE (by intro a b h; cases a <;> cases b <;> simp_all [ExcSubj.toE])
instance : Enc Exc := Enc.ofInj (fun e => (e.q, e.waives, e.targetClaims, e.targetComp, e.subjects, e.owner, e.expires))
  (by intro a b h; cases a; cases b; simp_all)
instance : Enc MEntry := Enc.ofInj (fun m => (m.id, m.proj, m.digest, m.kind, m.parent, m.markers, m.hatchComplete))
  (by intro a b h; cases a; cases b; simp_all)
instance : Enc Cite := Enc.ofInj (fun c => (c.id, c.proj, c.digest)) (by intro a b h; cases a; cases b; simp_all)
instance : Enc OEntry := Enc.ofInj (fun e => (e.id, e.proj, e.digest, e.complete, e.deps))
  (by intro a b h; cases a; cases b; simp_all)
instance : Enc Fact := Enc.ofInj (fun f => (f.ty, f.loc, f.verb, f.res, f.to, f.kind, f.n))
  (by intro a b h; cases a; cases b; simp_all)
instance : Enc Record := Enc.ofInj (fun r => (r.id, r.kind, r.result, r.provider, r.revision, r.time, r.claimFp,
    r.code, r.deps, r.harness, r.entries, r.facts, r.assumptions, r.counterexample, r.judge, r.aboutChange,
    r.refs, r.authenticated))
  (by intro a b h; cases a; cases b; simp_all)

/-! ### Canonical inputs (T1) -/

def Esf.canon (s : Esf) : Esf :=
  { s with actors := Shape.canon s.actors, verbs := Shape.canon s.verbs, effects := Shape.canon s.effects, hatches := Shape.canon s.hatches,
           kinds := Shape.canon s.kinds, comps := Shape.canon s.comps, res := Shape.canon s.res,
           units := Shape.canon s.units, claims := Shape.canon s.claims, provs := Shape.canon s.provs }

def Env.canon (e : Env) : Env :=
  { e with changeIds := Shape.canon e.changeIds, authors := Shape.canon e.authors,
           head := e.head.canon, base := e.base.map Esf.canon, mh := Shape.canon e.mh,
           mb := Shape.canon e.mb, cells := Shape.canon e.cells }

def Input.canon (i : Input) : Input :=
  { i with env := i.env.canon, records := Shape.canon i.records, baseRecords := Shape.canon i.baseRecords,
           headExcs := Shape.canon i.headExcs, baseExcs := Shape.canon i.baseExcs }

/-- Two elaborated shapes are the same up to the order and multiplicity of every collection. -/
def Esf.Equiv (a b : Esf) : Prop :=
  a.q = b.q ∧ a.owner = b.owner ∧ SetEq a.actors b.actors ∧ SetEq a.verbs b.verbs ∧ SetEq a.effects b.effects ∧
  SetEq a.hatches b.hatches ∧ SetEq a.kinds b.kinds ∧ SetEq a.comps b.comps ∧ SetEq a.res b.res ∧
  SetEq a.units b.units ∧ SetEq a.claims b.claims ∧ SetEq a.provs b.provs

def OptEsfEquiv : Option Esf → Option Esf → Prop
  | none, none => True
  | some a, some b => Esf.Equiv a b
  | _, _ => False

def Env.Equiv (a b : Env) : Prop :=
  a.mode = b.mode ∧ a.now = b.now ∧ SetEq a.changeIds b.changeIds ∧ SetEq a.authors b.authors ∧
  a.unmappedBot = b.unmappedBot ∧ Esf.Equiv a.head b.head ∧ OptEsfEquiv a.base b.base ∧
  a.headRev = b.headRev ∧ SetEq a.mh b.mh ∧ SetEq a.mb b.mb ∧ SetEq a.cells b.cells

/-- Inputs equal up to permutation (and duplication) of every input collection. -/
def Input.Equiv (a b : Input) : Prop :=
  Env.Equiv a.env b.env ∧ SetEq a.records b.records ∧ SetEq a.baseRecords b.baseRecords ∧
  a.headPolicy = b.headPolicy ∧ a.basePolicy = b.basePolicy ∧ SetEq a.headExcs b.headExcs ∧
  SetEq a.baseExcs b.baseExcs

end Shape
