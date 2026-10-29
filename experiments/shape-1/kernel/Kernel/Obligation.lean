import Kernel.Heirs
/-! Obligations (model §7), keys, bindings and groups (records §2, A.7.2, A.12.8). -/
namespace Shape

/-- A binding code row `[id, projection, base|null, head|null]` (A.12.8.6). -/
abbrev CodeRow := String × String × Option String × Option String

/-- A loosening part (A.8.2.1): one (question, subject) with its answer and data. -/
structure LPart where
  question : String
  subject : String
  answer : String          -- loosened | undecided
  affected : List String
  delta : List String
  counterexample : J := .null
  exploited : Bool := false
  /-- channels of the coverage route of `exploited` (A.8.3.2); `none`: the question has none -/
  channels : List String := []
  realised : List String := []
  /-- undecided under A.8.1.6 (a rule-3 hint) -/
  hintUndecided : Bool := false
deriving Inhabited

structure Ob where
  kind : String
  key : String
  claim : Option Claim := none
  subject : J := .null
  reason : Option String := none
  questions : Option (List String) := none
  force : Option String := none
  tier : Tier := .normal
  owner : String := ""
  introduced : Bool := false
  affected : List String := []
  code : List CodeRow := []
  delta : List String := []
  support : List String := []
  witness : List String := []
  facts : List (String × J) := []
  counterexample : J := .null
  exploited : Option Bool := none
  causes : List (String × String) := []
  excluding : List Claim := []
  /-- laws -/
  isLaw : Bool := false
  reqIds : List String := []
  pcReqDelta : Bool := false
  /-- coverage: K's subject, unmet claim fps, and those of them final -/
  isCoverage : Bool := false
  covComp : Option String := none
  covUnmet : List String := []
  covFinal : List String := []
  isVocab : Bool := false
  parts : List LPart := []
  /-- extra group tokens (causes: changed implementation/harness identities, changed base items) -/
  tokens : List String := []
  /-- a refutation (lower bound) -/
  refutation : Bool := false
  binding : String := ""
  group : String := ""
deriving Inhabited

def optStrJ : Option String → J
  | some s => .str s
  | none => .null

def obKey (kind : String) (claim : Option String) (subj : J) : String :=
  "ob:" ++ hexh (.obj ([("v", .str "shape.obligation.v1"), ("kind", .str kind)] ++
    (match claim with | some fp => [("claim", .str fp)] | none => []) ++ [("subject", subj)]))

/-- The JCS of the key preimage, the subject of E-conduct and E-structure (A.16.25). -/
def keyPreimage (kind : String) (claim : Option String) (subj : J) : String :=
  (J.obj ([("v", .str "shape.obligation.v1"), ("kind", .str kind)] ++
    (match claim with | some fp => [("claim", .str fp)] | none => []) ++ [("subject", subj)])).jcs

def codeRowLt (a b : CodeRow) : Bool := strLt a.1 b.1 || (a.1 == b.1 && strLt a.2.1 b.2.1)

def bindingOf (key : String) (affected : List String) (code : List CodeRow) (delta : List String) : String :=
  let codeS := sortWith codeRowLt (uniq code)
  "bd:" ++ hexh (.obj [("v", .str "shape.binding.v1"), ("key", .str key),
    ("affected", .arr ((sortStrs affected).map .str)),
    ("code", .arr (codeS.map fun r => .arr [.str r.1, .str r.2.1, optStrJ r.2.2.1, optStrJ r.2.2.2])),
    ("delta", .arr ((sortStrs delta).map .str))])

def groupId (keys : List String) : String := "g:" ++ hexh (.arr ((sortStrs keys).map .str))

def Ctx.ownRow (c : Ctx) (x : String) : CodeRow := (x, "own", c.mb.digest x "own", c.mh.digest x "own")

def Ctx.finestRows (c : Ctx) (xs : List String) : List CodeRow :=
  ((sortStrs xs).filter (c.delta.finest.contains ·)).map c.ownRow

def tierJ (t : Tier) : J := .str t.name

def claimRefJ (cl : Claim) : J :=
  .obj [("fp", .str cl.fp), ("ids", .arr (cl.ids.map .str)), ("tier", tierJ cl.tier)]

end Shape
