import Kernel.Util
import Std.Data.HashSet
/-! Cells (A.8.1.4): files not yet written, one per intersecting pair of base and head glob
regions, enumerated by BFS over the product of the glob automata with the shortlex-least
example path (wildcards from a–z). Computed by the kernel, never taken as input [D23].
Executable layer, differential-tested. -/
namespace Shape

/-- A component's glob on one side, with that component's except globs (A.3.3.3 [D25]). -/
structure GlobOwner where
  side : Bool        -- true: base, false: head
  glob : String
  owner : String     -- the pseudo-unit `Q.*`
  excepts : List String
deriving Inhabited, Repr

/-- A cell side: a pseudo-unit, `ungoverned`, or (ties) the sorted tied pseudo-units. -/
abbrev CellSide := List String

def cellSideJ (s : CellSide) : J :=
  match s with
  | [x] => .str x
  | xs => .arr (xs.map .str)

def cellId (b h : CellSide) : String := "cell:" ++ (J.arr [cellSideJ b, cellSideJ h]).jcs

structure Cell where
  b : CellSide
  h : CellSide
  sample : String
  id : String
deriving Inhabited, Repr

structure CellResult where
  cells : List Cell
  undecided : Bool
deriving Inhabited

/-- The owners matching at an accepting point on one side: most specific matching glob whose
    component's except globs do not match (A.3.3.5). -/
def classifySide (owners : List GlobOwner) (acc : Nat → Bool) (excAcc : String → Bool) (side : Bool) : CellSide :=
  let cands := (owners.zipIdx.filter fun (o, i) => o.side == side && acc i && !excAcc o.owner).map (·.1)
  match cands with
  | [] => ["ungoverned"]
  | _ =>
    let best := cands.foldl (fun m o => max m (specificity o.glob)) 0
    sortStrs ((cands.filter (fun o => specificity o.glob == best)).map (·.owner))

def computeCells (owners : List GlobOwner) (budget : Nat := 1000000) : CellResult := Id.run do
  -- one automaton per glob, plus one per (side, owner, except glob)
  let gn := owners.map (fun o => buildNfa o.glob)
  let excs : List (Bool × String × String) := uniq (owners.flatMap fun o => o.excepts.map (fun e => (o.side, o.owner, e)))
  let en := excs.map (fun (_, _, e) => buildNfa e)
  let nfas : Array Nfa := (gn ++ en).toArray
  let ng := gn.length
  let lits := sortStrs ("/" :: (owners.flatMap fun o => (literalChars o.glob ++ o.excepts.flatMap literalChars).map (fun c => String.ofList [c])))
  let fresh := ("abcdefghijklmnopqrstuvwxyz".toList.find? (fun c => !lits.contains (String.ofList [c]))).getD '_'
  let alphabet : List Char := (sortStrs (String.ofList [fresh] :: lits)).filterMap (fun s => s.toList.head?)
  let keyOf (sets : Array (List Nat)) (last : Nat) : String :=
    toString last ++ "|" ++ ";".intercalate (sets.toList.map fun l => ",".intercalate (l.map toString))
  let start : Array (List Nat) := nfas.map (fun n => n.closure [0])
  let mut seen : Std.HashSet String := Std.HashSet.emptyWithCapacity 64
  seen := seen.insert (keyOf start 0)
  -- last: 0 = start, 1 = after '/', 2 = after another character
  let mut queue : Array (Array (List Nat) × Nat × String) := #[(start, 0, "")]
  let mut head := 0
  let mut found : List (String × Cell) := []
  let mut undecided := false
  while head < queue.size do
    if seen.size > budget then
      undecided := true
      break
    let (sets, last, path) := queue[head]!
    head := head + 1
    if last == 2 then
      let acc (i : Nat) : Bool := (sets.getD i []).contains (nfas.getD i default).accept
      let excAcc (side : Bool) (owner : String) : Bool :=
        excs.zipIdx.any fun ((s, o, _), j) => s == side && o == owner && acc (ng + j)
      let b := classifySide owners acc (excAcc true) true
      let h := classifySide owners acc (excAcc false) false
      let k := cellId b h
      if !(found.any (·.1 == k)) then
        found := (k, { b := b, h := h, sample := path, id := k }) :: found
    for c in alphabet do
      if c == '/' && last != 2 then continue
      let sets' := sets.zipIdx.map fun (s, i) => if s.isEmpty then s else (nfas.getD i default).step s c
      let last' := if c == '/' then 1 else 2
      let k := keyOf sets' last'
      if seen.contains k then continue
      seen := seen.insert k
      queue := queue.push (sets', last', path ++ String.ofList [c])
  let cells := sortOn (·.id) (found.map (·.2))
  return { cells := cells, undecided := undecided }

end Shape
