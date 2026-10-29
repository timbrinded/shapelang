import Kernel.Context
/-! Claim strength ⊒ and heirs (A.5.6.3–4, A.6.2.1 [D13]); tier*, owner*, R* (A.6.2.3–5,
A.16.13). Executable layer. -/
namespace Shape

open Std

def Ctx.headNodes (c : Ctx) (sels : List NSel) : List String := nodeSel c.Wh sels

def supsetS (a b : List String) : Bool := b.all (a.contains ·)

def jInt? (s : String) : Option Int :=
  match J.parse s with
  | .ok (.num n) => some n
  | _ => none

/-- Op order (A.5.6.4): does head claim `h` hold at least as strictly as the renamed base claim
    `b`? Equal NF is decided by the caller; effect forbids and authority have no order. -/
def Ctx.opGeq (c : Ctx) (h b : Claim) : Bool :=
  if h.opName != b.opName then false else
  match h.op, b.op with
  | .effectsUpper uh Ch, .effectsUpper ub Cb =>
    uh == ub && Ch.all (fun a => Cb.any (fun y => atomLe c.head y a))
  | .pathForbid Sh Th Kh Vh, .pathForbid Sb Tb Kb Vb =>
    supsetS (c.headNodes Sh) (c.headNodes Sb) && supsetS (c.headNodes Th) (c.headNodes Tb) &&
    supsetS Kh Kb && supsetS (c.headNodes Vb) (c.headNodes Vh)
  | .edgeForbid Sh Xh kh Th Yh, .edgeForbid Sb Xb kb Tb Yb =>
    kh == kb && supsetS (c.headNodes Sh) (c.headNodes Sb) && supsetS (c.headNodes Th) (c.headNodes Tb) &&
    supsetS (c.headNodes Xb) (c.headNodes Xh) && supsetS (c.headNodes Yb) (c.headNodes Yh)
  | .cycleForbid Kh, .cycleForbid Kb => supsetS Kh Kb
  | .law onh (.schema nh fh ah), .law onb (.schema nb fb ab) =>
    nh == nb && fh == fb && onh == onb && ah.length == ab.length &&
    (match (c.base.map (·.templates)).getD [] |>.find? (·.q == nb) with
     | none => match c.head.templates.find? (·.q == nb) with
       | none => ah == ab
       | some t => (t.params.zip (ah.zip ab)).all fun (p, x, y) =>
          let dir := ((t.order.find? (·.1 == p.1)).map (·.2)).getD "equal"
          dir == "equal" && x == y
     | some t =>
       (t.params.zip (ah.zip ab)).all fun (p, x, y) =>
         let dir := ((t.order.find? (·.1 == p.1)).map (·.2)).getD "equal"
         if dir == "equal" then x == y
         else if dir == "geq" then (match jInt? x, jInt? y with | some u, some v => u ≥ v | _, _ => false)
         else if dir == "leq" then (match jInt? x, jInt? y with | some u, some v => u ≤ v | _, _ => false)
         else
           let set (s : String) : List String := match J.parse s with
             | .ok (.arr xs) => xs.map (·.jcs)
             | .ok o => [o.jcs]
             | .error _ => [s]
           if dir == "subset" then supsetS (set y) (set x) else supsetS (set x) (set y))
  | _, _ => false

/-- Hosted laws keep an heir only with ≡ closure digests between M_b and M_h (A.5.6.4 [D13]). -/
def Ctx.closureEq (c : Ctx) (cl : Claim) : Bool :=
  match cl.op with
  | .law _ (.hosted r) =>
    match c.mb.digest r "closure", c.mh.digest r "closure" with
    | some a, some b => a == b || c.digestEq c.mh r "closure" a
    | _, _ => false
  | _ => true

/-- The nodes a claim names (for A.16.11(b)). -/
def claimNodes (cl : Claim) : List String :=
  let ns (l : List NSel) := l.filterMap fun s => match s with | .comp q => some q | .res q => some q | .all => none
  match cl.op with
  | .edgeForbid S X _ T Y => ns S ++ ns X ++ ns T ++ ns Y
  | .pathForbid S T _ V => ns S ++ ns T ++ ns V
  | .edgeExists a _ b => [a, b]
  | _ => []

/-- Does the base claim's NF name an item ρ rules 0–2 leave unmapped (A.8.1.6)? -/
def Ctx.unmappedIn (c : Ctx) (cb : Claim) : List String :=
  c.rho.unmapped.filter fun q =>
    let s := cb.argsJ
    -- q as a token: preceded by a quote, space or '<', followed by a quote, space, '>' or '.'
    let pats := ["\"" ++ q ++ "\"", " " ++ q ++ "\"", "<" ++ q ++ ">", " " ++ q ++ ".", "\"" ++ q ++ ".", " " ++ q ++ ">"]
    pats.any (containsSub · s)

def Ctx.withHeirs (c : Ctx) : Ctx := Id.run do
  let some b := c.base | return c
  let keys := rhoKeys c.rho.map
  let mut heirs : HashMap String (List String) := {}
  let mut heirOf : HashMap String (List String) := {}
  for cb in b.claims do
    let ren := renameClaim keys cb
    let um := c.unmappedIn cb
    let hs := c.head.claims.filter fun ch =>
      ch.opName == cb.opName &&
      (((ch.fp == ren.fp || ch.fp == cb.fp) && c.closureEq ch) ||
       (!cb.isForbid && !cb.isAuthority && (um.isEmpty || !cb.isStructUpper) && c.opGeq ch ren) ||
       (((c.impliesC.get? ch.fp).getD []).any (fun f => f == cb.fp || f == ren.fp)))
    let fps := sortStrs (hs.map (·.fp))
    heirs := heirs.insert cb.fp fps
    for h in fps do heirOf := heirOf.insert h (sortStrs (((heirOf.get? h).getD []) ++ [cb.fp]))
  return { c with heirs := heirs, heirOf := heirOf }

/-- tier*(c) for claim-scoped obligations (A.6.2.3): the strictest of the head claim and every
    base claim it is an heir of; a base claim whose final loosening two persons answered in this
    run contributes the heir's head tier [D11, A.16.13]. -/
def Ctx.tierStar (c : Ctx) (cl : Claim) (extra : List String := []) : Tier :=
  ((((c.heirOf.get? cl.fp).getD []) ++ extra).filterMap (c.bClaims.get? ·)).foldl (fun t bc =>
    if c.answeredFinal.contains bc.fp then tierMax t cl.tier else tierMax t bc.tier) cl.tier

/-- owner*(c) (A.6.2.5): the base owner of what it inherits (the least-fp base claim), else the
    head owner. -/
def Ctx.ownerStar (c : Ctx) (cl : Claim) : String :=
  match ((c.heirOf.get? cl.fp).getD []).filterMap (c.bClaims.get? ·) with
  | bc :: _ => bc.owner
  | [] => cl.owner

def isInformal (cl : Claim) : Bool := match cl.op with | .law _ (.text _) => true | _ => false

/-- R*(c) (A.5.3.1, A.5.3.3): strictest of the head and inherited requirements, level raised to
    the floor of tier*(c); informal laws (none, judged). -/
def Ctx.reqStar (c : Ctx) (cl : Claim) (t : Tier) : Req :=
  let r0 := cl.req.getD ⟨.declared, false, [], "unit"⟩
  let r1 := (((c.heirOf.get? cl.fp).getD []).filterMap (c.bClaims.get? ·)).foldl (fun r bc =>
    if c.answeredFinal.contains bc.fp then r else (reqStrictest (some r) bc.req).getD r) r0
  let r2 := if isInformal cl then { r1 with level := .none, judged := true } else r1
  { r2 with level := levelMax r2.level (c.pol.tier t).floor }

end Shape
