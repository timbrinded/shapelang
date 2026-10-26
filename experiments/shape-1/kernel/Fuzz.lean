import Kernel
/-! `l3fuzz`: compares the L3 decision (`l3Decide`, with its search) against brute force over
every subset of the candidate edges, on random small component graphs. Usage:
`l3fuzz <instances> <seed>`. -/
open Shape

def lcg (s : Nat) : Nat := (s * 6364136223846793005 + 1442695040888963407) % 18446744073709551616

def pick {α} [Inhabited α] (s : Nat) (l : List α) : α := l.getD ((s >>> 33) % l.length) default

def subsets {α} : List α → List (List α)
  | [] => [[]]
  | x :: xs => let r := subsets xs; r ++ r.map (x :: ·)

def claimPool (ns : List String) : List Op :=
  let c (x : String) := NSel.comp x
  (ns.flatMap fun x => (ns.filter (· != x)).flatMap fun y =>
    [Op.edgeForbid [c x] [] "calls" [c y] [], Op.edgeForbid [c x] [] "calls" [.all] [c y],
     Op.pathForbid [c x] [c y] ["calls"] []] ++
    ((ns.filter (fun z => z != x && z != y)).map fun z => Op.pathForbid [c x] [c y] ["calls"] [c z])) ++
  [Op.cycleForbid ["calls"]]

def main (args : List String) : IO UInt32 := do
  let n := (args.headD "500").toNat!
  let seed0 := (args.getD 1 "7").toNat!
  let mut s := seed0
  let mut agree := 0
  let mut disagree := 0
  let mut budget := 0
  let mut counts : List (String × Nat) := []
  for _ in [0:n] do
    s := lcg s
    let nn := if (s >>> 33) % 4 == 0 then 4 else 3
    let ns := (["A", "B", "C", "D"].take nn)
    let cands : List Edge := ns.flatMap fun a => (ns.filter (· != a)).map fun b => (a, "calls", b)
    let pool := claimPool ns
    s := lcg s
    let nh := (s >>> 35) % 4
    let mut heads : List Op := []
    for _ in [0:nh] do
      s := lcg s
      heads := pick s pool :: heads
    s := lcg s
    let cb := pick s pool
    -- declared head edges: a random subset of candidates that the head admits
    s := lcg s
    let W0 := cands.filter (fun _ => true) |>.zipIdx.filterMap (fun (e, i) => if (s >>> (i + 20)) % 3 == 0 then some e else none)
    let W := if heads.all (fun h => evalStruct h W0) then W0 else []
    if !heads.all (fun h => evalStruct h W) then continue
    let rest := cands.filter (fun e => !W.contains e)
    let truth := (subsets rest).any fun P => heads.all (fun h => evalStruct h (W ++ P)) && !evalStruct cb (W ++ P)
    let v := l3Decide heads cb W (gaEdges heads W cands)
    let (name, says) := match v with
      | .heir => ("heir", false) | .ga => ("ga", false) | .exhausted => ("exhausted", false)
      | .edgeCex _ => ("edgeCex", true) | .searchCex _ => ("searchCex", true) | .budget => ("budget", truth)
    counts := match counts.find? (·.1 == name) with
      | some _ => counts.map (fun p => if p.1 == name then (p.1, p.2 + 1) else p)
      | none => counts ++ [(name, 1)]
    if name == "budget" then budget := budget + 1
    if says == truth then agree := agree + 1 else
      disagree := disagree + 1
      IO.println s!"DISAGREE verdict={name} truth={truth} heads={repr heads} base={repr cb} W={W}"
  IO.println s!"instances={agree + disagree} agree={agree} disagree={disagree} budget={budget} verdicts={counts}"
  return (if disagree == 0 then 0 else 1)
