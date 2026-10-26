import Kernel.Eval
import Kernel.Sha256
/-! Obligations (model §7), keys, bindings and groups (records §2, A.7.2, A.12.8). -/
namespace Shape

inductive ObKind | contradiction | unestablished | loosening | coverage
deriving DecidableEq, Repr, Inhabited

def ObKind.name : ObKind → String
  | .contradiction => "contradiction" | .unestablished => "unestablished"
  | .loosening => "loosening" | .coverage => "coverage"

def ObKind.rank : ObKind → Nat
  | .contradiction => 0 | .unestablished => 1 | .loosening => 2 | .coverage => 3

/-- Which part of the checker raised it: authority/effect forbids, structure, conduct
    (summaries), laws, loosening questions, coverage. -/
inductive Family | authority | structure | conduct | law | loosening | coverage
deriving DecidableEq, Repr, Inhabited

inductive Force | sound | heuristic
deriving DecidableEq, Repr, Inhabited

def Force.name : Force → String | .sound => "sound" | .heuristic => "heuristic"

inductive Reason | missing | weak | stale | expired | producerChanged | assumption
deriving DecidableEq, Repr, Inhabited

def Reason.name : Reason → String
  | .missing => "missing" | .weak => "weak" | .stale => "stale" | .expired => "expired"
  | .producerChanged => "producer-changed" | .assumption => "assumption"

inductive Severity | blocking | owed
deriving DecidableEq, Repr, Inhabited

def Severity.name : Severity → String | .blocking => "blocking" | .owed => "owed"

inductive Subj
  | null
  | codeAtom (code atom : String)
  | unitAtom (u atom : String)
  | fromTo (a b : String)
  | nodes (ns : List String)
  | item (s : String)
deriving DecidableEq, Repr, Inhabited

def Subj.toE : Subj → Nat × List String
  | .null => (0, []) | .codeAtom c a => (1, [c, a]) | .unitAtom u a => (2, [u, a])
  | .fromTo a b => (3, [a, b]) | .nodes ns => (4, ns) | .item s => (5, [s])
instance : Enc Subj := Enc.ofInj Subj.toE (by intro a b h; cases a <;> cases b <;> simp_all [Subj.toE])

def Subj.toJ : Subj → J
  | .null => .null
  | .codeAtom c a => .obj [("code", .str c), ("atom", .str a)]
  | .unitAtom u a => .obj [("unit", .str u), ("atom", .str a)]
  | .fromTo a b => .obj [("from", .str a), ("to", .str b)]
  | .nodes ns => .obj [("nodes", .arr (ns.map .str))]
  | .item s => .str s

/-- A binding code entry `[id, projection, base|null, head|null]`. -/
abbrev CodeRow := String × String × Option String × Option String

structure Ob where
  kind : ObKind
  family : Family
  key : String
  claimFp : Option String := none
  claimIds : List String := []
  claimTier : Option Tier := none
  /-- excluding claims (fps) and their owners*, for exceptions (A.4.6.5) -/
  excl : List String := []
  exclOwners : List String := []
  subject : Subj := .null
  reason : Option Reason := none
  questions : List String := []
  force : Option Force := none
  introduced : Bool := false
  tier : Tier := .normal
  owner : String := ""
  affected : List String := []
  code : List CodeRow := []
  delta : List String := []
  witness : List String := []
  exploited : Option Bool := none
  /-- has an answer discharger (A.7.6.5) -/
  answerable : Bool := false
  mechanical : Bool := false
  /-- coverage: owners* of unmet final claims (rule 4) -/
  unmetFinal : List String := []
  /-- unestablished: Req meets the code delta (rule 8) -/
  reqInDelta : Bool := false
  severity : Severity := .owed
  exception : Option String := none
  group : String := ""
deriving Repr, Inhabited

def optStrJ : Option String → J
  | some s => .str s
  | none => .null

def obKey (kind : String) (claim : Option String) (subj : Subj) : String :=
  "ob:" ++ hexh (.obj ([("v", .str "shape.obligation.v1"), ("kind", .str kind)] ++
    (match claim with | some fp => [("claim", .str fp)] | none => []) ++ [("subject", subj.toJ)]))

def codeRowLt (a b : CodeRow) : Bool := strLt a.1 b.1 || (a.1 == b.1 && strLt a.2.1 b.2.1)

def bindingOf (key : String) (affected : List String) (code : List CodeRow) (delta : List String) : String :=
  let codeS := sortBy codeRowLt (code.foldr (fun r acc => if acc.contains r then acc else r :: acc) [])
  "bd:" ++ hexh (.obj [("v", .str "shape.binding.v1"), ("key", .str key),
    ("affected", .arr ((sortStrs affected).map .str)),
    ("code", .arr (codeS.map fun r => .arr [.str r.1, .str r.2.1, optStrJ r.2.2.1, optStrJ r.2.2.2])),
    ("delta", .arr ((sortStrs delta).map .str))])

def Ob.binding (o : Ob) : String := bindingOf o.key o.affected o.code o.delta

def groupId (keys : List String) : String := "g:" ++ hexh (.arr ((sortStrs keys).map .str))

/-- The fact id `H(fact without n)` (records §2). -/
def factJ (f : Fact) : J :=
  if f.ty == "effect" then .obj [("type", .str "effect"), ("at", .str f.loc), ("verb", .str f.verb), ("resource", .str f.res)]
  else if f.ty == "call" then .obj [("type", .str "call"), ("at", .str f.loc), ("to", .str f.to)]
  else if f.ty == "edge" then .obj [("type", .str "edge"), ("at", .str f.loc), ("kind", .str f.kind), ("to", .str f.to)]
  else .obj [("type", .str "hatch"), ("at", .str f.loc), ("kind", .str f.kind)]

def factId (f : Fact) : String := Hd (factJ f)

end Shape
