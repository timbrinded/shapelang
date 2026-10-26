import Kernel.Closure
import Kernel.Model
/-! The structure fragment: path, edge and cycle forbids over component graphs.

Semantics (`Reach`, `PathForbid`, `EdgeForbid`, `CycleForbid`) are version 4's
(Antitone4.lean); the executable evaluators are proved equal to them, which lets L3's
implied test G_A (`gaEdges`) be proved sound on the executable code (`l3_ga_sound`). -/
namespace Shape

/-! ### Abstract graphs (as Antitone4.lean) -/

structure Graph (N K : Type) where
  edge : N → K → N → Prop

inductive Reach {N K : Type} (G : Graph N K) (Ks : K → Prop) (V : N → Prop) : N → N → Prop
  | single {a k b} : G.edge a k b → Ks k → Reach G Ks V a b
  | step {a k b c} : G.edge a k b → Ks k → ¬ V b → Reach G Ks V b c → Reach G Ks V a c

def Sub {N K : Type} (G H : Graph N K) : Prop := ∀ a k b, G.edge a k b → H.edge a k b

def PathForbid {N K : Type} (G : Graph N K) (S T : N → Prop) (Ks : K → Prop) (V : N → Prop) : Prop :=
  ∀ s t, S s → ¬ V s → T t → ¬ Reach G Ks V s t

def CycleForbid {N K : Type} (G : Graph N K) (Ks : K → Prop) : Prop :=
  ∀ a, ¬ Reach G Ks (fun _ => False) a a

def EdgeForbid {N K : Type} (G : Graph N K) (S X : N → Prop) (k0 : K) (T Y : N → Prop) : Prop :=
  ∀ s t, S s → ¬ X s → T t → ¬ Y t → ¬ G.edge s k0 t

theorem reach_mono {N K : Type} {G H : Graph N K} {Ks Ks' : K → Prop} {V V' : N → Prop} (h : Sub G H)
    (hk : ∀ k, Ks k → Ks' k) (hv : ∀ n, V' n → V n) :
    ∀ {a b}, Reach G Ks V a b → Reach H Ks' V' a b := by
  intro a b r
  induction r with
  | single e hk' => exact Reach.single (h _ _ _ e) (hk _ hk')
  | step e hk' hvb _ ih => exact Reach.step (h _ _ _ e) (hk _ hk') (fun x => hvb (hv _ x)) ih

theorem reach_snoc {N K : Type} {G : Graph N K} {Ks : K → Prop} {V : N → Prop} :
    ∀ {a b}, Reach G Ks V a b → ∀ {k c}, ¬ V b → G.edge b k c → Ks k → Reach G Ks V a c := by
  intro a b r
  induction r with
  | single e hk => intro k' c hv e' hk'; exact Reach.step e hk hv (Reach.single e' hk')
  | step e hk hv _ ih => intro k' c hv' e' hk'; exact Reach.step e hk hv (ih hv' e' hk')

/-- A property of graphs is antitone if it survives removing edges. -/
def Antitone {N K : Type} (φ : Graph N K → Prop) : Prop := ∀ G H, Sub G H → φ H → φ G

theorem pathForbid_antitone {N K : Type} (S T : N → Prop) (Ks : K → Prop) (V : N → Prop) :
    Antitone (fun G => PathForbid G S T Ks V) :=
  fun _ _ h hp s t hs hv ht r => hp s t hs hv ht (reach_mono h (fun _ x => x) (fun _ x => x) r)

theorem cycleForbid_antitone {N K : Type} (Ks : K → Prop) : Antitone (fun (G : Graph N K) => CycleForbid G Ks) :=
  fun _ _ h hc a r => hc a (reach_mono h (fun _ x => x) (fun _ x => x) r)

theorem edgeForbid_antitone {N K : Type} (S X : N → Prop) (k0 : K) (T Y : N → Prop) :
    Antitone (fun G => EdgeForbid G S X k0 T Y) :=
  fun _ _ h he s t hs hx ht hy e => he s t hs hx ht hy (h _ _ _ e)

theorem and_antitone {N K : Type} {φ ψ : Graph N K → Prop} (hφ : Antitone φ) (hψ : Antitone ψ) :
    Antitone (fun G => φ G ∧ ψ G) :=
  fun G H h ⟨a, b⟩ => ⟨hφ G H h a, hψ G H h b⟩

def union {N K : Type} (G P : Graph N K) : Graph N K := ⟨fun a k b => G.edge a k b ∨ P.edge a k b⟩
def plus {N K : Type} (G : Graph N K) (a0 : N) (k0 : K) (b0 : N) : Graph N K :=
  ⟨fun a k b => G.edge a k b ∨ (a = a0 ∧ k = k0 ∧ b = b0)⟩

/-- Version 4's G_A over abstract graphs. -/
def GA {N K : Type} (head : Graph N K → Prop) (W : Graph N K) : Graph N K :=
  ⟨fun a k b => W.edge a k b ∨ head (plus W a k b)⟩

theorem ga_sound {N K : Type} {head base : Graph N K → Prop} (hh : Antitone head) (hb : Antitone base)
    (W P : Graph N K) (hP : head (union W P)) (hGA : base (GA head W)) : base (union W P) := by
  apply hb (union W P) (GA head W) _ hGA
  intro a k b e
  cases e with
  | inl w => exact Or.inl w
  | inr p =>
    apply Or.inr
    apply hh (plus W a k b) (union W P) _ hP
    intro a' k' b' e'
    cases e' with
    | inl w => exact Or.inl w
    | inr eq =>
      obtain ⟨h1, h2, h3⟩ := eq
      subst h1; subst h2; subst h3
      exact Or.inr p

theorem prune_sound {N K : Type} {head : Graph N K → Prop} (hh : Antitone head) (W P P' : Graph N K)
    (hsub : Sub P P') (hbad : ¬ head (union W P)) : ¬ head (union W P') := by
  intro hP'
  apply hbad
  apply hh (union W P) (union W P') _ hP'
  intro a k b e
  cases e with
  | inl w => exact Or.inl w
  | inr p => exact Or.inr (hsub a k b p)

/-! ### Executable structure claims over edge lists -/

abbrev Edge := String × String × String

def gOf (E : List Edge) : Graph String String := ⟨fun a k b => (a, k, b) ∈ E⟩

def nselMatch (l : List NSel) (n : String) : Bool :=
  l.any fun s => match s with
    | .all => true
    | .comp q => q == n
    | .res q => q == n

def kEdges (K : List String) (E : List Edge) : List (String × String) :=
  (E.filter (fun e => K.contains e.2.1)).map (fun e => (e.1, e.2.2))

def succK (K : List String) (E : List Edge) (s : String) : List String :=
  (E.filter (fun e => e.1 == s && K.contains e.2.1)).map (fun e => e.2.2)

/-- Nodes reachable from `s` by a K-path whose interior avoids `V`. -/
def reachK (K : List String) (V : String → Bool) (E : List Edge) (s : String) : List String :=
  reachSet (kEdges K E) (fun n => !V n) (succK K E s)

def evalEdgeForbid (S X : List NSel) (k : String) (T Y : List NSel) (E : List Edge) : Bool :=
  E.all fun e => !(e.2.1 == k && nselMatch S e.1 && !nselMatch X e.1 && nselMatch T e.2.2 && !nselMatch Y e.2.2)

def evalPathForbid (S T : List NSel) (K : List String) (V : List NSel) (E : List Edge) : Bool :=
  (E.map (·.1)).all fun s =>
    !(nselMatch S s && !nselMatch V s) || !(reachK K (nselMatch V) E s).any (nselMatch T)

def evalCycleForbid (K : List String) (E : List Edge) : Bool :=
  (E.map (·.1)).all fun n => !(reachK K (fun _ => false) E n).contains n

def evalStruct (op : Op) (E : List Edge) : Bool :=
  match op with
  | .edgeForbid S X k T Y => evalEdgeForbid S X k T Y E
  | .pathForbid S T K V => evalPathForbid S T K V E
  | .cycleForbid K => evalCycleForbid K E
  | _ => true

def holdsStruct (op : Op) (E : List Edge) : Prop :=
  match op with
  | .edgeForbid S X k T Y =>
    EdgeForbid (gOf E) (fun n => nselMatch S n) (fun n => nselMatch X n) k (fun n => nselMatch T n) (fun n => nselMatch Y n)
  | .pathForbid S T K V =>
    PathForbid (gOf E) (fun n => nselMatch S n) (fun n => nselMatch T n) (fun k => K.contains k) (fun n => nselMatch V n)
  | .cycleForbid K => CycleForbid (gOf E) (fun k => K.contains k)
  | _ => True

/-- `t ∈ reachK` iff a K-path from `s` to `t` with interior outside `V` exists. -/
theorem mem_reachK (K : List String) (V : String → Bool) (E : List Edge) (s t : String) :
    t ∈ reachK K V E s ↔ Reach (gOf E) (fun k => K.contains k) (fun n => V n) s t := by
  unfold reachK
  rw [mem_reachSet]
  constructor
  · intro h
    induction h with
    | base hb =>
      simp only [succK, List.mem_map, List.mem_filter, Bool.and_eq_true, beq_iff_eq] at hb
      obtain ⟨⟨a, k, b⟩, ⟨he, ha, hk⟩, rfl⟩ := hb
      simp only at ha; subst ha
      exact Reach.single he hk
    | step _ hok he ih =>
      simp only [kEdges, List.mem_map, List.mem_filter] at he
      obtain ⟨⟨a, k, b⟩, ⟨he, hk⟩, heq⟩ := he
      simp only [Prod.mk.injEq] at heq
      obtain ⟨rfl, rfl⟩ := heq
      exact reach_snoc ih (by simpa using hok) he hk
  · intro h
    have hcl : ∀ a b, RT (kEdges K E) (fun n => !V n) (succK K E s) a → (!V a) = true →
        (a, b) ∈ kEdges K E → RT (kEdges K E) (fun n => !V n) (succK K E s) b :=
      fun a b ha hok he => RT.step ha hok he
    have key : ∀ a b, Reach (gOf E) (fun k => K.contains k) (fun n => V n) a b →
        (a = s ∨ (RT (kEdges K E) (fun n => !V n) (succK K E s) a ∧ V a = false)) →
        RT (kEdges K E) (fun n => !V n) (succK K E s) b := by
      intro a b r
      induction r with
      | @single a k b e hk =>
        intro ha
        rcases ha with rfl | ⟨ha, hv⟩
        · apply RT.base
          simp only [succK, List.mem_map, List.mem_filter, Bool.and_eq_true, beq_iff_eq]
          exact ⟨(a, k, b), ⟨e, rfl, hk⟩, rfl⟩
        · apply hcl a b ha (by simp [hv])
          simp only [kEdges, List.mem_map, List.mem_filter]
          exact ⟨(a, k, b), ⟨e, hk⟩, rfl⟩
      | @step a k b c e hk hvb _ ih =>
        intro ha
        apply ih
        right
        refine ⟨?_, by simpa using hvb⟩
        rcases ha with rfl | ⟨ha, hv⟩
        · apply RT.base
          simp only [succK, List.mem_map, List.mem_filter, Bool.and_eq_true, beq_iff_eq]
          exact ⟨(a, k, b), ⟨e, rfl, hk⟩, rfl⟩
        · apply hcl a b ha (by simp [hv])
          simp only [kEdges, List.mem_map, List.mem_filter]
          exact ⟨(a, k, b), ⟨e, hk⟩, rfl⟩
    exact key s t h (Or.inl rfl)

theorem reach_src_mem {E : List Edge} {Ks : String → Prop} {V : String → Prop} {s t : String}
    (h : Reach (gOf E) Ks V s t) : s ∈ E.map (·.1) := by
  cases h with
  | single e _ => exact List.mem_map.mpr ⟨_, e, rfl⟩
  | step e _ _ _ => exact List.mem_map.mpr ⟨_, e, rfl⟩

/-- The executable evaluator decides the semantics exactly. -/
theorem evalStruct_correct (op : Op) (E : List Edge) : evalStruct op E = true ↔ holdsStruct op E := by
  cases op with
  | edgeForbid S X k T Y =>
    simp only [evalStruct, holdsStruct, evalEdgeForbid, EdgeForbid, gOf, List.all_eq_true]
    constructor
    · intro h s t hs hx ht hy he
      have := h _ he
      simp_all
    · intro h e he
      obtain ⟨a, k', b⟩ := e
      simp only [Bool.not_eq_true', Bool.and_eq_false_iff]
      by_cases hk : k' = k
      · subst hk
        by_cases hs : nselMatch S a = true <;> by_cases hx : nselMatch X a = true <;>
          by_cases ht : nselMatch T b = true <;> by_cases hy : nselMatch Y b = true <;> simp_all
      · simp [hk]
  | pathForbid S T K V =>
    simp only [evalStruct, holdsStruct, evalPathForbid, PathForbid, List.all_eq_true]
    constructor
    · intro h s t hs hv ht r
      have hsrc := reach_src_mem r
      have := h s hsrc
      have hmem := (mem_reachK K (nselMatch V) E s t).mpr r
      simp only [Bool.or_eq_true, Bool.not_eq_true', Bool.and_eq_false_iff, Bool.not_eq_false',
        List.any_eq_false] at this
      rcases this with (h1 | h1) | h1
      · exact absurd hs (by simp [h1])
      · exact absurd h1 (by simpa using hv)
      · exact absurd ht (by simpa using h1 t hmem)
    · intro h s _
      simp only [Bool.or_eq_true, Bool.not_eq_true', Bool.and_eq_false_iff, Bool.not_eq_false',
        List.any_eq_false]
      by_cases hs : nselMatch S s = true
      · by_cases hv : nselMatch V s = true
        · exact Or.inl (Or.inr hv)
        · right
          intro t ht htt
          exact h s t hs (by simpa using hv) htt ((mem_reachK K (nselMatch V) E s t).mp ht)
      · exact Or.inl (Or.inl (by simpa using hs))
  | cycleForbid K =>
    simp only [evalStruct, holdsStruct, evalCycleForbid, CycleForbid, List.all_eq_true]
    constructor
    · intro h a r
      have hsrc := reach_src_mem r
      have hmem := (mem_reachK K (fun _ => false) E a a).mpr (reach_mono (fun _ _ _ x => x)
        (fun _ x => x) (fun _ x => by simp at x) r)
      have := h a hsrc
      simp_all
    · intro h n _
      simp only [Bool.not_eq_true']
      rw [Bool.eq_false_iff]
      intro hc
      have := (mem_reachK K (fun _ => false) E n n).mp (List.contains_iff_mem.mp hc)
      exact h n (reach_mono (fun _ _ _ x => x) (fun _ x => x) (fun _ x => by simp at x) this)
  | _ => simp [evalStruct, holdsStruct]

theorem holdsStruct_antitone (op : Op) (E E' : List Edge) (hsub : ∀ e ∈ E, e ∈ E')
    (h : holdsStruct op E') : holdsStruct op E := by
  have hs : Sub (gOf E) (gOf E') := fun a k b he => hsub (a, k, b) he
  cases op with
  | edgeForbid S X k T Y => exact edgeForbid_antitone _ _ _ _ _ _ _ hs h
  | pathForbid S T K V => exact pathForbid_antitone _ _ _ _ _ _ hs h
  | cycleForbid K => exact cycleForbid_antitone _ _ _ hs h
  | _ => trivial

/-! ### L3: heirs, G_A and exactness -/

/-- G_A: the declared head graph plus each candidate edge that alone keeps every head
    structural upper bound. -/
def gaEdges (heads : List Op) (W cands : List Edge) : List Edge :=
  W ++ cands.filter (fun e => heads.all (fun h => evalStruct h (e :: W)))

/-- **L3 soundness (G_A)**: if the base claim holds on G_A, no completing set of candidate
    edges that satisfies the head violates it. -/
theorem l3_ga_sound (heads : List Op) (base : Op) (W cands : List Edge)
    (hga : evalStruct base (gaEdges heads W cands) = true) :
    ∀ P : List Edge, (∀ e ∈ P, e ∈ cands) → (∀ h ∈ heads, holdsStruct h (W ++ P)) →
      holdsStruct base (W ++ P) := by
  intro P hP hh
  apply holdsStruct_antitone base (W ++ P) (gaEdges heads W cands) _ ((evalStruct_correct _ _).mp hga)
  intro e he
  rcases List.mem_append.mp he with hw | hp
  · exact List.mem_append_left _ hw
  · apply List.mem_append_right
    rw [List.mem_filter]
    refine ⟨hP e hp, ?_⟩
    rw [List.all_eq_true]
    intro h hmem
    apply (evalStruct_correct h (e :: W)).mpr
    apply holdsStruct_antitone h (e :: W) (W ++ P) _ (hh h hmem)
    intro x hx
    rcases List.mem_cons.mp hx with rfl | hx
    · exact List.mem_append_right _ hp
    · exact List.mem_append_left _ hx

theorem holdsStruct_congr (op : Op) (E E' : List Edge) (h : ∀ e, e ∈ E ↔ e ∈ E') :
    holdsStruct op E ↔ holdsStruct op E' :=
  ⟨holdsStruct_antitone op E' E (fun e he => (h e).mpr he),
   holdsStruct_antitone op E E' (fun e he => (h e).mp he)⟩

/-- **L3 exactness for edge forbids**: when G_A violates a base edge forbid and the head
    holds on the declared graph, a completing set of at most one edge is a counterexample. -/
theorem l3_edge_exact (heads : List Op) (S X : List NSel) (k : String) (T Y : List NSel)
    (W cands : List Edge) (hW : ∀ h ∈ heads, holdsStruct h W)
    (hfail : evalStruct (.edgeForbid S X k T Y) (gaEdges heads W cands) = false) :
    ∃ P : List Edge, P.length ≤ 1 ∧ (∀ e ∈ P, e ∈ cands) ∧ (∀ h ∈ heads, holdsStruct h (W ++ P)) ∧
      ¬ holdsStruct (.edgeForbid S X k T Y) (W ++ P) := by
  simp only [evalStruct, evalEdgeForbid, List.all_eq_false] at hfail
  obtain ⟨e, he, hviol⟩ := hfail
  have viol : ∀ E : List Edge, e ∈ E → ¬ holdsStruct (.edgeForbid S X k T Y) E := by
    intro E hE hh
    obtain ⟨a, k', b⟩ := e
    simp only [holdsStruct, EdgeForbid, gOf] at hh
    simp only [Bool.not_eq_true', Bool.and_eq_false_iff, Bool.not_eq_false'] at hviol
    by_cases h1 : k' = k <;> by_cases h2 : nselMatch S a = true <;> by_cases h3 : nselMatch X a = true <;>
      by_cases h4 : nselMatch T b = true <;> by_cases h5 : nselMatch Y b = true <;> simp_all
  rcases List.mem_append.mp he with hw | hc
  · refine ⟨[], by simp, by simp, by simpa using hW, ?_⟩
    exact viol _ (by simpa using hw)
  · rw [List.mem_filter, List.all_eq_true] at hc
    refine ⟨[e], by simp, by simpa using hc.1, ?_, viol _ (by simp)⟩
    intro h hmem
    apply (holdsStruct_congr h (W ++ [e]) (e :: W) (by intro x; simp only [List.mem_append, List.mem_cons, List.not_mem_nil, or_false]; exact Or.comm)).mpr
    exact (evalStruct_correct _ _).mp (hc.2 h hmem)

/-! ### Heirs by the op order (A.5.6.4) -/

def nselSub (a b : List NSel) : Bool :=
  b.contains .all || a.all fun s => s != .all && b.contains s

theorem nselSub_sound (a b : List NSel) (h : nselSub a b = true) (n : String) :
    nselMatch a n = true → nselMatch b n = true := by
  intro hn
  simp only [nselSub, Bool.or_eq_true, List.all_eq_true, Bool.and_eq_true, bne_iff_ne, ne_eq] at h
  simp only [nselMatch, List.any_eq_true] at hn ⊢
  rcases h with h | h
  · exact ⟨.all, List.contains_iff_mem.mp h, rfl⟩
  · obtain ⟨s, hs, hsn⟩ := hn
    exact ⟨s, List.contains_iff_mem.mp (h s hs).2, hsn⟩

def strSub (a b : List String) : Bool := a.all fun s => b.contains s

/-- `stronger h b`: by the op order, head claim `h` is at least as strict as base claim `b`. -/
def stronger (h b : Op) : Bool :=
  match h, b with
  | .edgeForbid Sh Xh kh Th Yh, .edgeForbid Sb Xb kb Tb Yb =>
    kh == kb && nselSub Sb Sh && nselSub Tb Th && nselSub Xh Xb && nselSub Yh Yb
  | .pathForbid Sh Th Kh Vh, .pathForbid Sb Tb Kb Vb =>
    nselSub Sb Sh && nselSub Tb Th && strSub Kb Kh && nselSub Vh Vb
  | .cycleForbid Kh, .cycleForbid Kb => strSub Kb Kh
  | _, _ => h == b

theorem stronger_sound (h b : Op) (E : List Edge) (hs : stronger h b = true) (hh : holdsStruct h E) :
    holdsStruct b E := by
  cases h <;> cases b <;> simp only [stronger, beq_iff_eq, Bool.and_eq_true, reduceCtorEq] at hs <;>
    simp only [holdsStruct] at hh ⊢
  all_goals first
    | (subst hs; exact hh)
    | trivial
    | skip
  case edgeForbid.edgeForbid Sh Xh kh Th Yh Sb Xb kb Tb Yb =>
    obtain ⟨⟨⟨⟨hk, hS⟩, hT⟩, hX⟩, hY⟩ := hs
    subst hk
    intro s t h1 h2 h3 h4 he
    exact hh s t (nselSub_sound _ _ hS s h1) (fun x => h2 (nselSub_sound _ _ hX s x))
      (nselSub_sound _ _ hT t h3) (fun x => h4 (nselSub_sound _ _ hY t x)) he
  case pathForbid.pathForbid Sh Th Kh Vh Sb Tb Kb Vb =>
    obtain ⟨⟨⟨hS, hT⟩, hK⟩, hV⟩ := hs
    intro s t h1 h2 h3 r
    simp only [strSub, List.all_eq_true] at hK
    exact hh s t (nselSub_sound _ _ hS s h1) (fun x => h2 (nselSub_sound _ _ hV s x))
      (nselSub_sound _ _ hT t h3)
      (reach_mono (fun _ _ _ x => x) (fun k hk => hK k (List.contains_iff_mem.mp hk))
        (fun n x => nselSub_sound _ _ hV n x) r)
  case cycleForbid.cycleForbid Kh Kb =>
    intro a r
    simp only [strSub, List.all_eq_true] at hs
    exact hh a (reach_mono (fun _ _ _ x => x) (fun k hk => hs k (List.contains_iff_mem.mp hk))
      (fun _ x => x) r)

/-! ### Counterexample validation (T5 for the executable L3 search) -/

def validCex (heads : List Op) (base : Op) (W P : List Edge) : Bool :=
  heads.all (fun h => evalStruct h (W ++ P)) && !evalStruct base (W ++ P)

theorem validCex_sound (heads : List Op) (base : Op) (W P : List Edge) (h : validCex heads base W P = true) :
    (∀ hc ∈ heads, holdsStruct hc (W ++ P)) ∧ ¬ holdsStruct base (W ++ P) := by
  simp only [validCex, Bool.and_eq_true, List.all_eq_true, Bool.not_eq_true'] at h
  refine ⟨fun hc hm => (evalStruct_correct _ _).mp (h.1 hc hm), fun hb => ?_⟩
  have := (evalStruct_correct _ _).mpr hb
  rw [h.2] at this
  exact Bool.false_ne_true this

end Shape
