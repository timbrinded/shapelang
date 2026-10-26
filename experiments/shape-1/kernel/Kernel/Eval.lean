import Kernel.Util
import Kernel.Closure
/-! Worlds and evaluation of the authority/conduct fragment (model §3.3–§4.4, A.4.4).

* `att` is attribution; `permitted` is P(u) = A(u) ∖ Prot(u); `lvl` is Lvl(u).
* `HoldsA` is the semantics of authority and effect forbids over raw worlds, defined from
  the ⇒-closure Xd(u), independently of `permitted`; `perm_exact` proves them equal.
* L1 (`l1Gain`, `l1Drop`) is proved sound and complete for this fragment. -/
namespace Shape

/-! ### The effect order ⇒ -/

/-- `implies` pairs, plus `h ⇒ Hatch` for each declared hatch kind (A.3.4.3). -/
def implPairs (S : Esf) : List (String × String) := S.effects ++ S.hatches.map (fun h => (h.1, "Hatch"))

def impl (S : Esf) (v w : String) : Bool := rtc (implPairs S) v w

/-- `atomLe S a b`: a ⇒ b (same resource, verb implication). -/
def atomLe (S : Esf) (a b : Atom) : Bool := a.res == b.res && impl S a.verb b.verb

theorem atomLe_refl (S : Esf) (a : Atom) : atomLe S a a = true := by
  simp [atomLe, impl, rtc_refl]

theorem atomLe_trans (S : Esf) (a b c : Atom) (h1 : atomLe S a b = true) (h2 : atomLe S b c = true) :
    atomLe S a c = true := by
  simp only [atomLe, Bool.and_eq_true, beq_iff_eq, impl] at *
  exact ⟨h1.1.trans h2.1, rtc_trans _ _ _ _ h1.2 h2.2⟩

theorem atomLe_res (S : Esf) (a b : Atom) (h : atomLe S a b = true) : a.res = b.res := by
  simp only [atomLe, Bool.and_eq_true, beq_iff_eq] at h; exact h.1

/-! ### Attribution -/

inductive URef | unit (q : String) | pseudo (k : String) | ungov
deriving DecidableEq, Repr, Inhabited

def URef.name : URef → String
  | .unit q => q | .pseudo k => k ++ ".*" | .ungov => "ungoverned"

def parseURef (s : String) : URef :=
  if s == "ungoverned" then .ungov
  else if strSuffix ".*" s then .pseudo (String.ofList (s.toList.take (s.length - 2)))
  else .unit s

def mIds (m : List MEntry) : List String := sortStrs (m.map (·.id))

def mDigest (m : List MEntry) (x proj : String) : Option String :=
  (m.find? (fun me => me.id == x && me.proj == proj)).map (·.digest)

def parentOf (m : List MEntry) (x : String) : Option String :=
  (m.find? (fun me => me.id == x && me.parent.isSome)).bind (·.parent)

/-- x and its ancestors by `parent`, nearest first. -/
def ancestors (m : List MEntry) (x : String) : List String :=
  let rec go (fuel : Nat) (y : String) : List String :=
    match fuel with
    | 0 => [y]
    | fuel + 1 => match parentOf m y with
      | some p => y :: go fuel p
      | none => [y]
  go (m.length + 1) x

def unitBind (S : Esf) (m : List MEntry) (u : UnitD) : Option String :=
  match u.bind with
  | some b => some b
  | none =>
    let paths := (S.comps.find? (·.q == u.comp)).map (·.paths) |>.getD []
    match (mIds m).filter (fun x => idSym x != "" && symLast (idSym x) == u.name &&
        paths.any (fun g => globMatch g (idPath x))) with
    | [x] => some x
    | _ => none

def unitOf (S : Esf) (m : List MEntry) (x : String) : Option String :=
  (S.units.find? (fun u => unitBind S m u == some x)).map (·.q)

def compByGlob (S : Esf) (path : String) : Option String :=
  let cands := S.comps.flatMap fun c => (c.paths.filter (globMatch · path)).map (fun g => (specificity g, c.q))
  match cands with
  | [] => none
  | c :: cs => some (cs.foldl (fun best x =>
      if x.1 > best.1 || (x.1 == best.1 && strLt x.2 best.2) then x else best) c).2

/-- att_S(x) (A.3.3.5). -/
def att (S : Esf) (m : List MEntry) (x : String) : URef :=
  match (ancestors m x).findSome? (unitOf S m) with
  | some q => .unit q
  | none => match compByGlob S (idPath x) with
    | some k => .pseudo k
    | none => .ungov

/-- Positions of L1: identities and cells (A.8.1.4). -/
inductive Pos | ident (x : String) | cell (vb vh : String)
deriving DecidableEq, Repr, Inhabited

def Pos.name : Pos → String
  | .ident x => x
  | .cell vb vh => "cell:[" ++ "\"" ++ vb ++ "\",\"" ++ vh ++ "\"]"

def attPos (S : Esf) (m : List MEntry) (isBase : Bool) : Pos → URef
  | .ident x => att S m x
  | .cell vb vh => parseURef (if isBase then vb else vh)

def compOf (S : Esf) : URef → Option String
  | .unit q => (S.units.find? (·.q == q)).map (·.comp)
  | .pseudo k => some k
  | .ungov => none

/-! ### Selectors, A(u), Prot(u), P(u), Lvl(u) -/

def selCovers (S : Esf) (s : USel) (u : URef) : Bool :=
  match s, u with
  | .all, _ => true
  | .ungoverned, .ungov => true
  | .comp k, .unit q => compOf S (.unit q) == some k
  | .comp k, .pseudo k' => k == k'
  | .unit q, .unit q' => q == q'
  | _, _ => false

def covers (S : Esf) (sc ex : List USel) (u : URef) : Bool :=
  sc.any (selCovers S · u) && !ex.any (selCovers S · u)

def authGrants (S : Esf) (k : String) : List (List Atom) :=
  S.claims.filterMap fun c => match c.op with
    | .authority k' g => if k' == k then some g else none
    | _ => none

def authClaims (S : Esf) (k : String) : List Claim :=
  S.claims.filter fun c => match c.op with
    | .authority k' _ => k' == k
    | _ => false

/-- b ∈ A(u): trust atoms always; all atoms under open authority and for `ungoverned`. -/
def inA (S : Esf) (u : URef) (b : Atom) : Bool :=
  b.isTrust || match compOf S u with
    | none => true
    | some k => (authGrants S k).all (fun g => g.any (fun a => atomLe S a b))

def forbidCovers (S : Esf) (u : URef) (b : Atom) (c : Claim) : Bool :=
  match c.op with
  | .effectForbid f sc ex => covers S sc ex u && atomLe S b f
  | _ => false

def inProt (S : Esf) (u : URef) (b : Atom) : Bool := S.claims.any (forbidCovers S u b)

/-- P(u) (A.4.4.7). -/
def permitted (S : Esf) (u : URef) (b : Atom) : Bool := inA S u b && !inProt S u b

/-- Lvl(u)(b): the highest tier rank of forbids protecting b at u, 0 for ⊥. -/
def lvl (S : Esf) (u : URef) (b : Atom) : Nat :=
  (S.claims.filter (forbidCovers S u b)).foldl (fun m c => max m c.tier.rank) 0

/-! ### Semantics of the authority fragment over raw worlds -/

/-- Xd(u) ∋ b: some raw fact attributed to u has an atom a ⇒ b. -/
def Xd (S : Esf) (attF : Pos → URef) (W : List (Pos × Atom)) (u : URef) (b : Atom) : Prop :=
  ∃ x a, (x, a) ∈ W ∧ attF x = u ∧ atomLe S a b = true

/-- A.4.2.1: effect.forbid(f, Σ, X): Xd(u) ∩ ↓f = ∅ for covered u; authority(K, G): every
    non-trust atom of Xd(u), u ∈ U(K), is in cl(G). -/
def claimHoldsA (S : Esf) (attF : Pos → URef) (W : List (Pos × Atom)) (c : Claim) : Prop :=
  match c.op with
  | .effectForbid f sc ex => ∀ u b, covers S sc ex u = true → Xd S attF W u b → atomLe S b f = false
  | .authority k g => ∀ u b, compOf S u = some k → Xd S attF W u b → b.isTrust = false →
      ∃ a ∈ g, atomLe S a b = true
  | _ => True

def HoldsA (S : Esf) (attF : Pos → URef) (W : List (Pos × Atom)) : Prop :=
  ∀ c ∈ S.claims, claimHoldsA S attF W c

theorem trust_of_le (S : Esf) (a b : Atom) (h : atomLe S a b = true) : a.isTrust = b.isTrust := by
  simp [Atom.isTrust, atomLe_res S a b h]

/-- **raw_fact_exact** on the executable model: the authority fragment holds on a world iff
    every raw fact is permitted at its attribution. -/
theorem perm_exact (S : Esf) (attF : Pos → URef) (W : List (Pos × Atom)) :
    HoldsA S attF W ↔ ∀ x a, (x, a) ∈ W → permitted S (attF x) a = true := by
  constructor
  · intro h x a hxa
    simp only [permitted, Bool.and_eq_true, Bool.not_eq_true']
    constructor
    · simp only [inA, Bool.or_eq_true]
      by_cases ht : a.isTrust = true
      · exact Or.inl ht
      · right
        cases hk : compOf S (attF x) with
        | none => rfl
        | some k =>
          simp only [List.all_eq_true, List.any_eq_true]
          intro g hg
          simp only [authGrants, List.mem_filterMap] at hg
          obtain ⟨c, hc, hcg⟩ := hg
          split at hcg
          · rename_i k' g' hop
            split at hcg
            · rename_i hkk
              simp only [Option.some.injEq] at hcg
              subst hcg
              have := h c hc
              simp only [claimHoldsA, hop] at this
              simp only [beq_iff_eq] at hkk
              subst hkk
              exact this (attF x) a hk ⟨x, a, hxa, rfl, atomLe_refl S a⟩ (by simpa using ht)
            · simp at hcg
          · simp at hcg
    · simp only [inProt, List.any_eq_false]
      intro c hc hcov
      simp only [forbidCovers] at hcov
      split at hcov
      · rename_i f sc ex hop
        simp only [Bool.and_eq_true] at hcov
        have := h c hc
        simp only [claimHoldsA, hop] at this
        have := this (attF x) a hcov.1 ⟨x, a, hxa, rfl, atomLe_refl S a⟩
        rw [hcov.2] at this
        exact Bool.noConfusion this
      · exact Bool.noConfusion hcov
  · intro h c hc
    unfold claimHoldsA
    split
    · rename_i f sc ex hop
      intro u b hcov ⟨x, a, hxa, hatt, hab⟩
      rw [Bool.eq_false_iff]
      intro hbf
      have hp := h x a hxa
      simp only [permitted, Bool.and_eq_true, Bool.not_eq_true', inProt, List.any_eq_false] at hp
      apply hp.2 c hc
      simp only [forbidCovers, hop, Bool.and_eq_true]
      exact ⟨hatt ▸ hcov, atomLe_trans S a b f hab hbf⟩
    · rename_i k g hop
      intro u b hk ⟨x, a, hxa, hatt, hab⟩ hbt
      have hp := h x a hxa
      simp only [permitted, Bool.and_eq_true, inA, Bool.or_eq_true] at hp
      rcases hp.1 with ht | hp1
      · rw [trust_of_le S a b hab] at ht
        rw [ht] at hbt
        exact absurd hbt (by decide)
      · rw [hatt, hk] at hp1
        simp only [List.all_eq_true, List.any_eq_true] at hp1
        have hg : g ∈ authGrants S k := by
          simp only [authGrants, List.mem_filterMap]
          exact ⟨c, hc, by simp [hop]⟩
        obtain ⟨a', ha', hle⟩ := hp1 g hg
        exact ⟨a', ha', atomLe_trans S a' a b hle hab⟩
    · trivial

/-! ### L1 for the authority fragment (A.8.2.3) -/

def l1Gain (Sb Sh : Esf) (attB attH : Pos → URef) (x : Pos) (a : Atom) : Bool :=
  permitted Sh (attH x) a && !permitted Sb (attB x) a

def l1Drop (Sb Sh : Esf) (attB attH : Pos → URef) (x : Pos) (a : Atom) : Bool :=
  decide (lvl Sh (attH x) a < lvl Sb (attB x) a)

def l1Loosened (Sb Sh : Esf) (attB attH : Pos → URef) (positions : List Pos) (atoms : List Atom) : Bool :=
  positions.any fun x => atoms.any fun a => l1Gain Sb Sh attB attH x a || l1Drop Sb Sh attB attH x a

theorem l1_false {Sb Sh : Esf} {attB attH : Pos → URef} {positions : List Pos} {atoms : List Atom}
    (h : l1Loosened Sb Sh attB attH positions atoms = false) (x : Pos) (hx : x ∈ positions)
    (a : Atom) (ha : a ∈ atoms) : l1Gain Sb Sh attB attH x a = false ∧ l1Drop Sb Sh attB attH x a = false := by
  unfold l1Loosened at h
  rw [List.any_eq_false] at h
  have h1 := h x hx
  rw [Bool.not_eq_true, List.any_eq_false] at h1
  have h2 := h1 a ha
  rw [Bool.not_eq_true, Bool.or_eq_false_iff] at h2
  exact h2

/-- **L1 soundness**: if L1 implies, every world over the positions and atoms that the head
    admits is admitted by the base (⟦S_h⟧ ⊆ ⟦S_b⟧ on the authority fragment). -/
theorem l1_sound (Sb Sh : Esf) (attB attH : Pos → URef) (positions : List Pos) (atoms : List Atom)
    (h : l1Loosened Sb Sh attB attH positions atoms = false) (W : List (Pos × Atom))
    (hW : ∀ p ∈ W, p.1 ∈ positions ∧ p.2 ∈ atoms) (hh : HoldsA Sh attH W) : HoldsA Sb attB W := by
  rw [perm_exact] at hh ⊢
  intro x a hxa
  have hp := hh x a hxa
  have := (l1_false h x (hW _ hxa).1 a (hW _ hxa).2).1
  simp only [l1Gain, hp, Bool.true_and, Bool.not_eq_false'] at this
  exact this

/-- **L1 completeness**: a reported gain has a one-fact counterexample world that the head
    admits and the base rejects. -/
theorem l1_complete (Sb Sh : Esf) (attB attH : Pos → URef) (x : Pos) (a : Atom)
    (h : l1Gain Sb Sh attB attH x a = true) :
    HoldsA Sh attH [(x, a)] ∧ ¬ HoldsA Sb attB [(x, a)] := by
  simp only [l1Gain, Bool.and_eq_true, Bool.not_eq_true'] at h
  constructor
  · rw [perm_exact]
    intro y b hyb
    simp only [List.mem_singleton, Prod.mk.injEq] at hyb
    obtain ⟨rfl, rfl⟩ := hyb
    exact h.1
  · rw [perm_exact]
    intro hb
    have := hb x a (by simp)
    rw [h.2] at this
    exact Bool.noConfusion this

/-- **L1 levels**: if L1 implies, no position's protection level fell. -/
theorem l1_levels (Sb Sh : Esf) (attB attH : Pos → URef) (positions : List Pos) (atoms : List Atom)
    (h : l1Loosened Sb Sh attB attH positions atoms = false) :
    ∀ x ∈ positions, ∀ a ∈ atoms, lvl Sb (attB x) a ≤ lvl Sh (attH x) a := by
  intro x hx a ha
  have := (l1_false h x hx a ha).2
  simp only [l1Drop, decide_eq_false_iff_not] at this
  omega

end Shape
