import Kernel.Util
import Kernel.Closure
/-! Worlds and evaluation of the authority/conduct fragment (model §3.3–§4.4, A.4.4.7).

Version 7: summaries are direct and enter P and Lvl [D2].
* `permitted` is P(u) = (A(u) ∩ S(u)) ∖ Prot(u); `lvlT`/`lvl` is Lvl(u) (forbids, the unit's
  complete summary, and authority(comp(u)) [D11]).
* `HoldsA` is the semantics of authority, effect forbids and complete summaries over raw worlds,
  defined from the ⇒-closure Xd(u), independently of `permitted`; `perm_exact` proves them equal
  (`raw_fact_exact`, A.4.4.7).
* L1 (`l1Gain`, `l1Drop`) is proved sound and complete for this fragment.
Attribution is a parameter (`attF`), so the theorems hold for the executable attribution of
`Kernel.World`. -/
namespace Shape

/-! ### The effect order ⇒ -/

/-- `implies` pairs, `h ⇒ Hatch` for each declared hatch kind (A.3.4.3), and the reserved
    `Undeclared ⇒ Hatch`. -/
def implPairs (S : Esf) : List (String × String) :=
  S.effects ++ S.hatches.map (fun h => (h.1, "Hatch")) ++ [("Undeclared", "Hatch")]

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

/-! ### Positions -/

inductive URef | unit (q : String) | pseudo (k : String) | ungov
deriving DecidableEq, Repr, Inhabited, Hashable

def URef.name : URef → String
  | .unit q => q | .pseudo k => k ++ ".*" | .ungov => "ungoverned"

def parseURef (s : String) : URef :=
  if s == "ungoverned" then .ungov
  else if strSuffix ".*" s then .pseudo (dropRight 2 s)
  else .unit s

/-- Positions of L1: identities and cells (A.8.1.4). -/
inductive Pos | ident (x : String) | cell (id : String)
deriving DecidableEq, Repr, Inhabited

def Pos.name : Pos → String
  | .ident x => x
  | .cell id => id

def compOf (S : Esf) : URef → Option String
  | .unit q => (S.units.find? (·.q == q)).map (·.comp)
  | .pseudo k => some k
  | .ungov => none

/-! ### Selectors, A(u), S(u), Prot(u), P(u), Lvl(u) -/

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

/-- The complete summaries (effects.upper) of a unit. -/
def summaryAtoms (S : Esf) (q : String) : List (List Atom) :=
  S.claims.filterMap fun c => match c.op with
    | .effectsUpper u C => if u == q then some C else none
    | _ => none

def summaryClaims (S : Esf) (q : String) : List Claim :=
  S.claims.filter fun c => match c.op with
    | .effectsUpper u _ => u == q
    | _ => false

/-- b ∈ A(u): trust atoms always; all atoms under open authority and for `ungoverned`. -/
def inA (S : Esf) (u : URef) (b : Atom) : Bool :=
  b.isTrust || match compOf S u with
    | none => true
    | some k => (authGrants S k).all (fun g => g.any (fun a => atomLe S a b))

/-- b ∈ S(u) = cl(C) ∪ TrustAtoms for a unit with a complete summary, else all atoms
    (A.4.4.7, A.16.34). -/
def inS (S : Esf) (u : URef) (b : Atom) : Bool :=
  b.isTrust || match u with
    | .unit q => (summaryAtoms S q).all (fun C => C.any (fun a => atomLe S a b))
    | _ => true

def forbidCovers (S : Esf) (u : URef) (b : Atom) (c : Claim) : Bool :=
  match c.op with
  | .effectForbid f sc ex => covers S sc ex u && atomLe S b f
  | _ => false

def inProt (S : Esf) (u : URef) (b : Atom) : Bool := S.claims.any (forbidCovers S u b)

/-- P(u) (A.4.4.7). -/
def permitted (S : Esf) (u : URef) (b : Atom) : Bool := inA S u b && inS S u b && !inProt S u b

/-- The claims excluding b at u (A.4.4.7): forbids putting b in Prot(u), the summary if
    b ∉ S(u), authority if b ∉ A(u). -/
def excluding (S : Esf) (u : URef) (b : Atom) : List Claim :=
  S.claims.filter (forbidCovers S u b) ++
  (match u with
   | .unit q => if inS S u b then [] else summaryClaims S q
   | _ => []) ++
  (if inA S u b then [] else match compOf S u with
    | some k => authClaims S k
    | none => [])

/-- Lvl(u)(b) under a tier assignment: the highest tier rank among the excluding claims, 0 for ⊥. -/
def lvlT (S : Esf) (tr : Claim → Nat) (u : URef) (b : Atom) : Nat :=
  (excluding S u b).foldl (fun m c => max m (tr c)) 0

def lvl (S : Esf) (u : URef) (b : Atom) : Nat := lvlT S (fun c => c.tier.rank) u b

/-! ### Semantics of the fragment over raw worlds -/

/-- Xd(u) ∋ b: some raw fact attributed to u has an atom a ⇒ b. -/
def Xd (S : Esf) (attF : Pos → URef) (W : List (Pos × Atom)) (u : URef) (b : Atom) : Prop :=
  ∃ x a, (x, a) ∈ W ∧ attF x = u ∧ atomLe S a b = true

/-- A.4.2.1: effect.forbid(f, Σ, X): Xd(u) ∩ ↓f = ∅ for covered u; authority(K, G): every
    non-trust atom of Xd(u), u ∈ U(K), is in cl(G); effects.upper(u, C): every non-trust atom of
    Xd(u) is in cl(C) (A.16.34). -/
def claimHoldsA (S : Esf) (attF : Pos → URef) (W : List (Pos × Atom)) (c : Claim) : Prop :=
  match c.op with
  | .effectForbid f sc ex => ∀ u b, covers S sc ex u = true → Xd S attF W u b → atomLe S b f = false
  | .authority k g => ∀ u b, compOf S u = some k → Xd S attF W u b → b.isTrust = false →
      ∃ a ∈ g, atomLe S a b = true
  | .effectsUpper q C => ∀ b, Xd S attF W (.unit q) b → b.isTrust = false →
      ∃ a ∈ C, atomLe S a b = true
  | _ => True

def HoldsA (S : Esf) (attF : Pos → URef) (W : List (Pos × Atom)) : Prop :=
  ∀ c ∈ S.claims, claimHoldsA S attF W c

theorem trust_of_le (S : Esf) (a b : Atom) (h : atomLe S a b = true) : a.isTrust = b.isTrust := by
  simp [Atom.isTrust, atomLe_res S a b h]

theorem mem_authGrants (S : Esf) (k : String) (g : List Atom) (hg : g ∈ authGrants S k) :
    ∃ c ∈ S.claims, c.op = .authority k g := by
  simp only [authGrants, List.mem_filterMap] at hg
  obtain ⟨c, hc, hcg⟩ := hg
  split at hcg
  · rename_i k' g' hop
    split at hcg
    · rename_i hkk
      simp only [Option.some.injEq] at hcg
      subst hcg
      simp only [beq_iff_eq] at hkk
      subst hkk
      exact ⟨c, hc, hop⟩
    · simp at hcg
  · simp at hcg

theorem mem_summaryAtoms (S : Esf) (q : String) (C : List Atom) (hC : C ∈ summaryAtoms S q) :
    ∃ c ∈ S.claims, c.op = .effectsUpper q C := by
  simp only [summaryAtoms, List.mem_filterMap] at hC
  obtain ⟨c, hc, hcC⟩ := hC
  split at hcC
  · rename_i u C' hop
    split at hcC
    · rename_i huq
      simp only [Option.some.injEq] at hcC
      subst hcC
      simp only [beq_iff_eq] at huq
      subst huq
      exact ⟨c, hc, hop⟩
    · simp at hcC
  · simp at hcC

/-- **raw_fact_exact** on the executable model: the fragment holds on a world iff every raw
    fact is permitted at its attribution. -/
theorem perm_exact (S : Esf) (attF : Pos → URef) (W : List (Pos × Atom)) :
    HoldsA S attF W ↔ ∀ x a, (x, a) ∈ W → permitted S (attF x) a = true := by
  constructor
  · intro h x a hxa
    simp only [permitted, Bool.and_eq_true, Bool.not_eq_true']
    refine ⟨⟨?_, ?_⟩, ?_⟩
    · simp only [inA, Bool.or_eq_true]
      by_cases ht : a.isTrust = true
      · exact Or.inl ht
      · right
        cases hk : compOf S (attF x) with
        | none => rfl
        | some k =>
          simp only [List.all_eq_true, List.any_eq_true]
          intro g hg
          obtain ⟨c, hc, hop⟩ := mem_authGrants S k g hg
          have := h c hc
          simp only [claimHoldsA, hop] at this
          exact this (attF x) a hk ⟨x, a, hxa, rfl, atomLe_refl S a⟩ (by simpa using ht)
    · simp only [inS, Bool.or_eq_true]
      by_cases ht : a.isTrust = true
      · exact Or.inl ht
      · right
        cases hu : attF x with
        | unit q =>
          simp only [List.all_eq_true, List.any_eq_true]
          intro C hC
          obtain ⟨c, hc, hop⟩ := mem_summaryAtoms S q C hC
          have := h c hc
          simp only [claimHoldsA, hop] at this
          exact this a ⟨x, a, hxa, hu, atomLe_refl S a⟩ (by simpa using ht)
        | pseudo k => rfl
        | ungov => rfl
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
      rcases hp.1.1 with ht | hp1
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
    · rename_i q C hop
      intro b ⟨x, a, hxa, hatt, hab⟩ hbt
      have hp := h x a hxa
      simp only [permitted, Bool.and_eq_true, inS, Bool.or_eq_true] at hp
      rcases hp.1.2 with ht | hp1
      · rw [trust_of_le S a b hab] at ht
        rw [ht] at hbt
        exact absurd hbt (by decide)
      · rw [hatt] at hp1
        simp only [List.all_eq_true, List.any_eq_true] at hp1
        have hC : C ∈ summaryAtoms S q := by
          simp only [summaryAtoms, List.mem_filterMap]
          exact ⟨c, hc, by simp [hop]⟩
        obtain ⟨a', ha', hle⟩ := hp1 C hC
        exact ⟨a', ha', atomLe_trans S a' a b hle hab⟩
    · trivial

/-! ### L1 for the fragment (A.8.2.3) -/

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
    admits is admitted by the base (⟦S_h⟧ ⊆ ⟦S_b⟧ on the fragment, summaries included). -/
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
