import Kernel.Proofs.Final
/-! Existence half of T2: a presence-sound fact that a final forbid excludes always raises a
sound, blocking contradiction at tier final (unless the same key is already a coherence
error, A.4.4.12). With `final_is_final` this gives: final forbids are never removed. -/
namespace Shape

theorem tierMax_ge_left (a b : Tier) : a.rank ≤ (tierMax a b).rank := by
  unfold tierMax; split <;> omega

theorem tierMax_ge_right (a b : Tier) : b.rank ≤ (tierMax a b).rank := by
  unfold tierMax; split <;> omega

theorem foldl_tierMax_ge (l : List Claim) : ∀ t : Tier, t.rank ≤ (l.foldl (fun t b => tierMax t b.tier) t).rank := by
  induction l with
  | nil => intro t; simp
  | cons c l ih => intro t; exact Nat.le_trans (tierMax_ge_left t c.tier) (ih _)

theorem tierStar_ge (e : Env) (c : Claim) : c.tier.rank ≤ (tierStar e c).rank := foldl_tierMax_ge _ _

theorem tier_rank_le (t : Tier) : t.rank ≤ 4 := by cases t <;> decide

theorem tier_final_of_rank (t : Tier) (h : 4 ≤ t.rank) : t = .final := by
  cases t <;> simp_all [Tier.rank]

theorem claimOrdLt_true (e : Env) (a b : Claim) (h : claimOrdLt e a b = true) :
    (tierStar e b).rank ≤ (tierStar e a).rank := by
  unfold claimOrdLt at h
  simp only [Bool.or_eq_true, decide_eq_true_eq, Bool.and_eq_true, beq_iff_eq] at h
  rcases h with h | ⟨h, _⟩ <;> omega

theorem claimOrdLt_false (e : Env) (a b : Claim) (h : claimOrdLt e a b = false) :
    (tierStar e a).rank ≤ (tierStar e b).rank := by
  unfold claimOrdLt at h
  simp only [Bool.or_eq_false_iff, decide_eq_false_iff_not] at h
  omega

def pickStep (e : Env) (best : Option Claim) (c : Claim) : Option Claim :=
  match best with
  | none => some c
  | some b => if claimOrdLt e c b then some c else some b

theorem pickFirst_eq (e : Env) (cs : List Claim) : pickFirst e cs = cs.foldl (pickStep e) none := rfl

theorem pick_aux (e : Env) : ∀ (l : List Claim) (b : Claim), ∃ r, l.foldl (pickStep e) (some b) = some r ∧
    (tierStar e b).rank ≤ (tierStar e r).rank ∧ ∀ y ∈ l, (tierStar e y).rank ≤ (tierStar e r).rank := by
  intro l
  induction l with
  | nil => intro b; exact ⟨b, rfl, Nat.le_refl _, by simp⟩
  | cons c l ih =>
    intro b
    simp only [List.foldl_cons]
    by_cases hlt : claimOrdLt e c b = true
    · have hs : pickStep e (some b) c = some c := by simp [pickStep, hlt]
      rw [hs]
      obtain ⟨r, hr, h1, h2⟩ := ih c
      refine ⟨r, hr, Nat.le_trans (claimOrdLt_true e c b hlt) h1, ?_⟩
      intro y hy
      rcases List.mem_cons.mp hy with rfl | hy
      · exact h1
      · exact h2 y hy
    · have hs : pickStep e (some b) c = some b := by simp [pickStep, hlt]
      rw [hs]
      obtain ⟨r, hr, h1, h2⟩ := ih b
      refine ⟨r, hr, h1, ?_⟩
      intro y hy
      rcases List.mem_cons.mp hy with rfl | hy
      · exact Nat.le_trans (claimOrdLt_false e y b (by simpa using hlt)) h1
      · exact h2 y hy

theorem pickFirst_max (e : Env) (cs : List Claim) (f : Claim) (hf : f ∈ cs) :
    ∃ r, pickFirst e cs = some r ∧ (tierStar e f).rank ≤ (tierStar e r).rank := by
  cases cs with
  | nil => simp at hf
  | cons c rest =>
    rw [pickFirst_eq, List.foldl_cons]
    have : pickStep e none c = some c := rfl
    rw [this]
    obtain ⟨r, hr, h1, h2⟩ := pick_aux e rest c
    refine ⟨r, hr, ?_⟩
    rcases List.mem_cons.mp hf with rfl | hf
    · exact h1
    · exact h2 f hf

theorem mkEffContra_subject (e : Env) (rs brs : List Record) (s : String × Atom) (o : Ob)
    (h : mkEffContra e rs brs s = some o) : ∃ c, effCore e s = some c ∧ o.subject = c.subject ∧ o.family = c.family := by
  simp only [mkEffContra, Option.map_eq_some_iff] at h
  obtain ⟨c, hc, rfl⟩ := h
  exact ⟨c, hc, rfl, rfl⟩

theorem deriveObs_of_raw' (inp : Input) (o₀ : Ob) (h1 : o₀ ∈ rawObs inp.canon)
    (h2 : discharged inp.canon (rawObs inp.canon) o₀ = false) :
    ∃ o ∈ deriveObs inp, o.kind = o₀.kind ∧ o.family = o₀.family ∧ o.force = o₀.force ∧ o.tier = o₀.tier ∧
      o.subject = o₀.subject ∧
      o.severity = sevOf inp.canon (matchedBy inp.canon o₀).isSome
        ((matchedBy inp.canon o₀).isSome && excAnswered inp.canon (rawObs inp.canon) o₀) o₀ := by
  refine ⟨finalize inp.canon (rawObs inp.canon) o₀, ?_, rfl, rfl, rfl, rfl, rfl, rfl⟩
  simp only [deriveObs, List.mem_map, List.mem_filter, Bool.not_eq_true']
  exact ⟨o₀, ⟨h1, h2⟩, rfl⟩

theorem effCore_of_pick (e : Env) (s : String × Atom) (r : Claim)
    (hr : pickFirst e (exclCands e (att e.head e.mh s.1) s.2) = some r) :
    ∃ c, effCore e s = some c ∧ c.kind = .contradiction ∧ c.family = .authority ∧ c.tier = tierStar e r ∧
      c.subject = .codeAtom s.1 s.2.show := by
  unfold effCore; dsimp only; rw [hr]
  exact ⟨_, rfl, rfl, rfl, rfl, rfl⟩

/-- **Final forbids raise**: a presence-sound fact (observed or a manifest hatch marker)
    that a final effect forbid excludes yields an open, sound, blocking contradiction at tier
    final, whatever else the input holds (unless the same key is a coherence error). -/
theorem final_forbid_raises (inp : Input) (of : OFact)
    (hof : of ∈ obsFacts inp.canon.env inp.canon.records) (hsound : of.sound = true) (b : Atom)
    (hb : liftAtom inp.canon.env.head of.f = some b) (f : Claim) (hf : f ∈ inp.env.head.claims)
    (hft : f.tier = .final)
    (hcov : forbidCovers inp.canon.env.head (att inp.canon.env.head inp.canon.env.mh of.f.loc) b f = true)
    (hnd : declaredAt inp.canon.env of.f.loc b = false) :
    ∃ o ∈ deriveObs inp, o.kind = .contradiction ∧ o.family = .authority ∧ o.force = some .sound ∧
      o.tier = .final ∧ o.severity = .blocking ∧ o.subject = .codeAtom of.f.loc b.show := by
  have hfc : f ∈ inp.canon.env.head.claims := by
    show f ∈ (Shape.canon inp.env.head.claims)
    rw [mem_canon]; exact hf
  have hprot : inProt inp.canon.env.head (att inp.canon.env.head inp.canon.env.mh of.f.loc) b = true :=
    List.any_eq_true.mpr ⟨f, hfc, hcov⟩
  have hviol : effViol inp.canon.env of = some (of.f.loc, b) := by
    unfold effViol; rw [hb]; simp [permitted, hprot, hnd]
  have hsub : (of.f.loc, b) ∈ effSubjects inp.canon.env inp.canon.records := by
    simp only [effSubjects, mem_canon, List.mem_filterMap]
    exact ⟨of, hof, hviol⟩
  have hcand : f ∈ exclCands inp.canon.env (att inp.canon.env.head inp.canon.env.mh of.f.loc) b := by
    simp only [exclCands, List.mem_append, List.mem_filter]
    exact Or.inl ⟨hfc, hcov⟩
  obtain ⟨r, hr, hrank⟩ := pickFirst_max inp.canon.env _ f hcand
  have hfin : tierStar inp.canon.env r = .final := by
    apply tier_final_of_rank
    have := tierStar_ge inp.canon.env f
    rw [hft] at this
    exact Nat.le_trans this hrank
  obtain ⟨c, hcore, hck, hcf, hct, hcs⟩ := effCore_of_pick inp.canon.env (of.f.loc, b) r hr
  have hforce : effForce inp.canon.env inp.canon.records (of.f.loc, b) = .sound := by
    have : (effSupport inp.canon.env inp.canon.records (of.f.loc, b)).any (·.sound) = true := by
      simp only [List.any_eq_true, effSupport, List.mem_filter, Bool.and_eq_true, beq_iff_eq]
      exact ⟨of, ⟨hof, rfl, by simp [hb]⟩, hsound⟩
    simp [effForce, this]
  obtain ⟨o₁, hmk⟩ : ∃ o₁, mkEffContra inp.canon.env inp.canon.records inp.canon.baseRecords (of.f.loc, b) = some o₁ := by
    simp [mkEffContra, hcore]
  obtain ⟨c', hc', _, hkind1, _, ht1, hf1, ha1⟩ := mkEffContra_some _ _ _ _ o₁ hmk
  obtain ⟨c'', hc'', hs1, hfam1⟩ := mkEffContra_subject _ _ _ _ o₁ hmk
  rw [hcore] at hc' hc''
  cases hc'; cases hc''
  have hraw := effContra_mem_rawObs inp.canon (of.f.loc, b) hsub o₁ hmk
  have hans : o₁.answerable = false := by rw [ha1, hforce]; rfl
  obtain ⟨o', ho', hkind', hfam', hforce', htier', hsubj', hsev'⟩ :=
    deriveObs_of_raw' inp o₁ hraw (not_discharged_of_unanswerable _ _ _ hans)
  have hkc : o₁.kind = .contradiction := by rw [hkind1, hck]
  have hfs : o₁.force = some .sound := by rw [hf1, hforce]
  have htf : o₁.tier = .final := by rw [ht1, hct, hfin]
  refine ⟨o', ho', by rw [hkind', hkc], by rw [hfam', hfam1, hcf], by rw [hforce', hfs], by rw [htier', htf],
    ?_, by rw [hsubj', hs1, hcs]⟩
  rw [hsev']; exact sev_final _ _ _ _ hkc hfs htf

end Shape
