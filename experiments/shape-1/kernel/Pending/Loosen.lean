import Kernel.Proofs.Raise
import Kernel.Proofs.Laws

set_option linter.deprecated false
/-! Loosening: the executable obligation generators against the proved decisions.

* `l1_parts_iff`: derive's L1 parts are non-empty exactly when `l1Loosened` holds on
  derive's positions and atoms; with `l1_sound`/`l1_complete` (Eval) this makes the L1
  obligations of `derive` sound and complete for the authority fragment.
* `l3Decide_sound`: every L3 verdict except `exhausted` is proved (heirs by the op order,
  G_A, exact edge counterexamples, validated search counterexamples); `exhausted` rests on
  `dfs_complete`, open as in the annex (A.8.4.3). -/
namespace Shape

/-! ### Lvl lemmas -/

theorem foldl_max_ge (l : List Claim) : ∀ m, m ≤ l.foldl (fun m c => max m c.tier.rank) m := by
  induction l with
  | nil => intro m; simp
  | cons c l ih => intro m; simp only [List.foldl_cons]; exact Nat.le_trans (Nat.le_max_left _ _) (ih _)

theorem foldl_max_mem (l : List Claim) : ∀ m, ∀ c ∈ l, c.tier.rank ≤ l.foldl (fun m c => max m c.tier.rank) m := by
  induction l with
  | nil => intro m c h; simp at h
  | cons d l ih =>
    intro m c h
    simp only [List.foldl_cons]
    rcases List.mem_cons.mp h with rfl | h
    · exact Nat.le_trans (Nat.le_max_right _ _) (foldl_max_ge l _)
    · exact ih _ c h

theorem foldl_max_witness (l : List Claim) : ∀ m, l.foldl (fun m c => max m c.tier.rank) m = m ∨
    ∃ c ∈ l, c.tier.rank = l.foldl (fun m c => max m c.tier.rank) m := by
  induction l with
  | nil => intro m; simp
  | cons d l ih =>
    intro m
    simp only [List.foldl_cons]
    rcases ih (max m d.tier.rank) with h | ⟨c, hc, h⟩
    · rw [h]
      by_cases hmd : m ≤ d.tier.rank
      · right; exact ⟨d, by simp, by omega⟩
      · left; omega
    · right; exact ⟨c, List.mem_cons_of_mem d hc, h⟩

theorem lvl_ge (S : Esf) (u : URef) (b : Atom) (f : Claim) (hf : f ∈ S.claims) (hc : forbidCovers S u b f = true) :
    f.tier.rank ≤ lvl S u b :=
  foldl_max_mem _ 0 f (List.mem_filter.mpr ⟨hf, hc⟩)

theorem lvl_witness (S : Esf) (u : URef) (b : Atom) (h : 0 < lvl S u b) :
    ∃ f ∈ S.claims, forbidCovers S u b f = true ∧ f.tier.rank = lvl S u b := by
  unfold lvl at *
  rcases foldl_max_witness (S.claims.filter (forbidCovers S u b)) 0 with h0 | ⟨f, hf, he⟩
  · omega
  · rw [List.mem_filter] at hf
    exact ⟨f, hf.1, hf.2, he⟩

theorem lvl_zero (S : Esf) (u : URef) (b : Atom) (h : inProt S u b = false) : lvl S u b = 0 := by
  unfold lvl
  have : S.claims.filter (forbidCovers S u b) = [] := by
    rw [List.filter_eq_nil_iff]
    intro c hc
    simp only [inProt, List.any_eq_false] at h
    simpa using h c hc
  rw [this]; rfl

theorem tier_rank_pos (t : Tier) : 1 ≤ t.rank := by cases t <;> decide

/-! ### L1: generator ↔ decision -/

theorem l1Drops_ne (e : Env) (Sb : Esf) (x : Pos) (a : Atom) :
    l1Drops e Sb x a ≠ [] ↔ l1Drop Sb e.head (attPos Sb e.mh true) (attPos e.head e.mh false) x a = true := by
  simp only [l1Drop, decide_eq_true_eq]
  constructor
  · intro hne
    obtain ⟨p, hp⟩ := List.exists_mem_of_ne_nil _ hne
    simp only [l1Drops, List.mem_filterMap, List.mem_filter] at hp
    obtain ⟨f, ⟨hf, hcov⟩, hp⟩ := hp
    split at hp
    · rename_i hlt; exact Nat.lt_of_lt_of_le hlt (lvl_ge Sb _ a f hf hcov)
    · simp at hp
  · intro hd hnil
    obtain ⟨f, hf, hcov, hrank⟩ := lvl_witness Sb (attPos Sb e.mh true x) a (by omega)
    simp only [l1Drops, List.filterMap_eq_nil_iff] at hnil
    have := hnil f (List.mem_filter.mpr ⟨hf, hcov⟩)
    rw [← hrank] at hd
    simp [hd] at this

theorem l1Auth_ne (e : Env) (Sb : Esf) (x : Pos) (a : Atom) :
    l1Auth e Sb x a ≠ [] ↔ (l1AuthCond e Sb x a = true ∧ (compOf Sb (attPos Sb e.mh true x)).isSome) := by
  unfold l1Auth
  by_cases hc : l1AuthCond e Sb x a = true
  · simp only [hc, ite_true, true_and]
    cases compOf Sb (attPos Sb e.mh true x) <;> simp
  · simp [hc]

theorem l1PartsAt_ne (e : Env) (Sb : Esf) (x : Pos) (a : Atom) :
    l1PartsAt e Sb x a ≠ [] ↔
      (l1Gain Sb e.head (attPos Sb e.mh true) (attPos e.head e.mh false) x a = true ∨
       l1Drop Sb e.head (attPos Sb e.mh true) (attPos e.head e.mh false) x a = true) := by
  have happ : l1PartsAt e Sb x a ≠ [] ↔ (l1Drops e Sb x a ≠ [] ∨ l1Auth e Sb x a ≠ []) := by
    unfold l1PartsAt
    constructor
    · intro h
      by_cases h1 : l1Drops e Sb x a = []
      · right; intro h2; exact h (by rw [h1, h2]; rfl)
      · left; exact h1
    · rintro (h | h) hnil
      · exact h (List.append_eq_nil_iff.mp hnil).1
      · exact h (List.append_eq_nil_iff.mp hnil).2
  rw [happ, l1Drops_ne, l1Auth_ne]
  constructor
  · rintro (h | ⟨hc, _⟩)
    · exact Or.inr h
    · left
      simp only [l1AuthCond, Bool.and_eq_true, Bool.not_eq_true'] at hc
      simp [l1Gain, hc.1.1.1, hc.1.1.2]
  · rintro (hg | hd)
    · simp only [l1Gain, Bool.and_eq_true, Bool.not_eq_true'] at hg
      obtain ⟨hph, hpb⟩ := hg
      have hph' := hph
      simp only [permitted, Bool.and_eq_true, Bool.not_eq_true'] at hph'
      by_cases hP : inProt Sb (attPos Sb e.mh true x) a = true
      · left
        simp only [inProt, List.any_eq_true] at hP
        obtain ⟨f, hf, hcov⟩ := hP
        simp only [l1Drop, decide_eq_true_eq]
        rw [lvl_zero _ _ _ hph'.2]
        exact Nat.lt_of_lt_of_le (tier_rank_pos f.tier) (lvl_ge Sb _ a f hf hcov)
      · right
        have hA : inA Sb (attPos Sb e.mh true x) a = false := by
          simp only [permitted, Bool.and_eq_false_iff, Bool.not_eq_false'] at hpb
          rcases hpb with h | h
          · exact h
          · exact absurd h hP
        refine ⟨by simp [l1AuthCond, hph, hpb, hph'.1, hA], ?_⟩
        cases hk : compOf Sb (attPos Sb e.mh true x) with
        | none => simp [inA, hk] at hA
        | some _ => rfl
    · exact Or.inl hd

/-- **The L1 obligations of `derive` fire exactly when the proved L1 decision says
    loosened** (on the manifest's identities, the cells and the atom universe). -/
theorem l1_parts_iff (e : Env) (Sb : Esf) :
    l1Parts e Sb ≠ [] ↔
      l1Loosened Sb e.head (attPos Sb e.mh true) (attPos e.head e.mh false) (l1PosList e) (atomUniverse e) = true := by
  unfold l1Parts l1Loosened
  constructor
  · intro hne
    obtain ⟨p, hp⟩ := List.exists_mem_of_ne_nil _ hne
    simp only [List.mem_flatMap] at hp
    obtain ⟨x, hx, a, ha, hp⟩ := hp
    have : l1PartsAt e Sb x a ≠ [] := List.ne_nil_of_mem hp
    rw [l1PartsAt_ne] at this
    simp only [List.any_eq_true, Bool.or_eq_true]
    exact ⟨x, hx, a, ha, this⟩
  · intro h
    simp only [List.any_eq_true, Bool.or_eq_true] at h
    obtain ⟨x, hx, a, ha, hga⟩ := h
    have := (l1PartsAt_ne e Sb x a).mpr hga
    obtain ⟨p, hp⟩ := List.exists_mem_of_ne_nil _ this
    exact List.ne_nil_of_mem (List.mem_flatMap.mpr ⟨x, hx, List.mem_flatMap.mpr ⟨a, ha, hp⟩⟩)

/-! ### L3: every verdict but `exhausted` is proved -/

theorem l3Tail_cases (heads : List Op) (cb : Op) (W G : List Edge) :
    (∃ S X k T Y ed, cb = .edgeForbid S X k T Y ∧ (sortBy edgeLt G).find? (edgeViolates S X k T Y) = some ed ∧
        l3Tail heads cb W G = .edgeCex ed) ∨
    (∃ P, validCex heads cb W P = true ∧ l3Tail heads cb W G = .searchCex P) ∨
    l3Tail heads cb W G = .budget ∨ l3Tail heads cb W G = .exhausted := by
  unfold l3Tail
  split
  · rename_i S X k T Y
    split
    · rename_i ed hed; exact Or.inl ⟨S, X, k, T, Y, ed, rfl, hed, rfl⟩
    · exact Or.inr (Or.inr (Or.inr rfl))
  · split
    · rename_i P _
      split
      · rename_i hv; exact Or.inr (Or.inl ⟨P, hv, rfl⟩)
      · exact Or.inr (Or.inr (Or.inl rfl))
    · exact Or.inr (Or.inr (Or.inl rfl))
    · exact Or.inr (Or.inr (Or.inr rfl))

/-- L3 `heir`: some head claim is at least as strict, so every graph the head admits the
    base admits. -/
theorem l3_heir_sound (heads : List Op) (cb : Op) (W G : List Edge) (h : l3Decide heads cb W G = .heir) :
    ∀ E, (∀ hc ∈ heads, holdsStruct hc E) → holdsStruct cb E := by
  unfold l3Decide at h
  by_cases hh : heads.any (fun hc => stronger hc cb) = true
  · intro E hE
    obtain ⟨hc, hm, hs⟩ := List.any_eq_true.mp hh
    exact stronger_sound hc cb E hs (hE hc hm)
  · rw [if_neg hh] at h
    by_cases hg : evalStruct cb G = true
    · rw [if_pos hg] at h; cases h
    · rw [if_neg hg] at h
      rcases l3Tail_cases heads cb W G with ⟨_, _, _, _, _, _, _, _, h'⟩ | ⟨_, _, h'⟩ | h' | h' <;>
        rw [h'] at h <;> cases h

/-- L3 `ga` (implied by G_A): no completing set of candidate edges that satisfies the head
    violates the base claim. -/
theorem l3_ga_verdict_sound (heads : List Op) (cb : Op) (W cands : List Edge)
    (h : l3Decide heads cb W (gaEdges heads W cands) = .ga) :
    ∀ P : List Edge, (∀ e ∈ P, e ∈ cands) → (∀ hc ∈ heads, holdsStruct hc (W ++ P)) → holdsStruct cb (W ++ P) := by
  unfold l3Decide at h
  by_cases hh : heads.any (fun hc => stronger hc cb) = true
  · rw [if_pos hh] at h; cases h
  · rw [if_neg hh] at h
    by_cases hg : evalStruct cb (gaEdges heads W cands) = true
    · exact l3_ga_sound heads cb W cands hg
    · rw [if_neg hg] at h
      rcases l3Tail_cases heads cb W (gaEdges heads W cands) with ⟨_, _, _, _, _, _, _, _, h'⟩ | ⟨_, _, h'⟩ | h' | h' <;>
        rw [h'] at h <;> cases h

/-- L3 `edgeCex`: the reported edge is in G_A and violates the base edge forbid by itself. -/
theorem l3_edgeCex_sound (heads : List Op) (cb : Op) (W G : List Edge) (ed : Edge)
    (h : l3Decide heads cb W G = .edgeCex ed) : ¬ holdsStruct cb [ed] := by
  unfold l3Decide at h
  by_cases hh : heads.any (fun hc => stronger hc cb) = true
  · rw [if_pos hh] at h; cases h
  · rw [if_neg hh] at h
    by_cases hg : evalStruct cb G = true
    · rw [if_pos hg] at h; cases h
    · rw [if_neg hg] at h
      rcases l3Tail_cases heads cb W G with ⟨S, X, k, T, Y, ed', hcb, hfind, h'⟩ | ⟨_, _, h'⟩ | h' | h'
      · have hed : ed' = ed := by rw [h'] at h; injection h
        subst hed
        subst hcb
        have hp := List.find?_some hfind
        intro hh'
        simp only [holdsStruct, EdgeForbid, gOf, List.mem_singleton] at hh'
        obtain ⟨a, k', b⟩ := ed'
        simp only [edgeViolates, Bool.and_eq_true, beq_iff_eq, Bool.not_eq_true'] at hp
        obtain ⟨⟨⟨⟨hk, hS⟩, hX⟩, hT⟩, hY⟩ := hp
        subst hk
        exact hh' a b hS (by simp [hX]) hT (by simp [hY]) rfl
      all_goals (rw [h'] at h; cases h)

/-- L3 `searchCex` (T5): the reported completing set satisfies the head and violates the
    base claim. -/
theorem l3_searchCex_sound (heads : List Op) (cb : Op) (W G P : List Edge)
    (h : l3Decide heads cb W G = .searchCex P) :
    (∀ hc ∈ heads, holdsStruct hc (W ++ P)) ∧ ¬ holdsStruct cb (W ++ P) := by
  unfold l3Decide at h
  by_cases hh : heads.any (fun hc => stronger hc cb) = true
  · rw [if_pos hh] at h; cases h
  · rw [if_neg hh] at h
    by_cases hg : evalStruct cb G = true
    · rw [if_pos hg] at h; cases h
    · rw [if_neg hg] at h
      rcases l3Tail_cases heads cb W G with ⟨_, _, _, _, _, _, _, _, h'⟩ | ⟨P', hv, h'⟩ | h' | h'
      · rw [h'] at h; cases h
      · have hP : P' = P := by rw [h'] at h; injection h
        subst hP
        exact validCex_sound heads cb W P' hv
      · rw [h'] at h; cases h
      · rw [h'] at h; cases h

/-! ### T7: keys depend only on kind, claim and subject -/

theorem rawObs_key (i : Input) : ∀ o ∈ rawObs i, o.key = obKey o.kind.name o.claimFp o.subject := by
  intro o ho
  simp only [rawObs, List.mem_append] at ho
  rcases ho with ((((h | h) | h) | h) | h) | h
  · simp only [effContras, List.mem_filterMap] at h
    obtain ⟨s, _, hmk⟩ := h
    simp only [mkEffContra, Option.map_eq_some_iff] at hmk
    obtain ⟨c, hc, rfl⟩ := hmk
    unfold effCore at hc; dsimp only at hc
    split at hc
    · simp at hc
    · simp only [Option.some.injEq] at hc; subst hc; rfl
  · simp only [structContras, List.mem_flatMap, List.mem_map] at h
    obtain ⟨_, _, _, _, rfl⟩ := h
    rfl
  · simp only [conductContras, List.mem_flatMap] at h
    obtain ⟨c, _, hc⟩ := h
    split at hc
    · simp only [List.mem_map] at hc
      obtain ⟨_, _, rfl⟩ := hc
      rfl
    · simp at hc
  · simp only [lawObs, List.mem_flatMap] at h
    obtain ⟨c, _, hc⟩ := h
    rcases mem_lawObsFor i c o hc with ⟨rfl, _⟩ | ⟨rfl, _⟩ | ⟨rfl, _, _⟩ <;> rfl
  · unfold loosenObs at h
    dsimp only at h
    split at h
    · split at h
      · simp at h
      · simp only [List.mem_map] at h
        obtain ⟨_, _, rfl⟩ := h
        rfl
    · simp at h
  · simp only [coverageObs, List.mem_filterMap] at h
    obtain ⟨_, _, h⟩ := h
    split at h
    · simp at h
    · simp only [Option.some.injEq] at h; subst h; rfl

/-- **T7** on the output: every open obligation's key is `obKey kind claim subject`. -/
theorem deriveObs_key (inp : Input) : ∀ o ∈ deriveObs inp, o.key = obKey o.kind.name o.claimFp o.subject := by
  intro o ho
  simp only [deriveObs, List.mem_map, List.mem_filter] at ho
  obtain ⟨o₀, ⟨h1, _⟩, rfl⟩ := ho
  exact rawObs_key _ o₀ h1

end Shape

namespace Shape

/-- **Stated, not proved** (A.8.4.3 `dfs_complete`, open): when the L3 search exhausts
    without a counterexample, no completing set of candidate edges that satisfies the head
    violates the base claim. Tested against brute force by `l3fuzz`. -/
def DfsComplete : Prop :=
  ∀ (heads : List Op) (cb : Op) (W cands : List Edge),
    l3Decide heads cb W (gaEdges heads W cands) = .exhausted →
    ∀ P : List Edge, (∀ e ∈ P, e ∈ cands) → (∀ hc ∈ heads, holdsStruct hc (W ++ P)) → holdsStruct cb (W ++ P)

end Shape
