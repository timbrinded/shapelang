import Kernel.Derive
/-! **T1, permutation invariance.** Inputs equal up to the order (and multiplicity) of every
input collection give the same obligations and byte-identical core output. -/
namespace Shape

theorem Esf.canon_eq {a b : Esf} (h : Esf.Equiv a b) : a.canon = b.canon := by
  obtain ⟨hq, ho, h1, h2, h3, h4, h5, h6, h7, h8, h9, h10⟩ := h
  cases a; cases b
  simp only [Esf.canon, Esf.mk.injEq] at *
  exact ⟨hq, ho, canon_eq_of_setEq h1, canon_eq_of_setEq h2, canon_eq_of_setEq h3, canon_eq_of_setEq h4,
    canon_eq_of_setEq h5, canon_eq_of_setEq h6, canon_eq_of_setEq h7, canon_eq_of_setEq h8,
    canon_eq_of_setEq h9, canon_eq_of_setEq h10⟩

theorem optEsf_canon_eq {a b : Option Esf} (h : OptEsfEquiv a b) : a.map Esf.canon = b.map Esf.canon := by
  cases a <;> cases b <;> simp_all [OptEsfEquiv]
  exact Esf.canon_eq h

theorem Env.canon_eq {a b : Env} (h : Env.Equiv a b) : a.canon = b.canon := by
  obtain ⟨hm, hn, hc, ha, hu, hh, hb, hr, hmh, hmb, hcl⟩ := h
  cases a; cases b
  simp only [Env.canon, Env.mk.injEq] at *
  exact ⟨hm, hn, canon_eq_of_setEq hc, canon_eq_of_setEq ha, hu, Esf.canon_eq hh, optEsf_canon_eq hb, hr,
    canon_eq_of_setEq hmh, canon_eq_of_setEq hmb, canon_eq_of_setEq hcl⟩

theorem Input.canon_eq {a b : Input} (h : Input.Equiv a b) : a.canon = b.canon := by
  obtain ⟨he, hr, hbr, hp, hbp, hx, hbx⟩ := h
  cases a; cases b
  simp only [Input.canon, Input.mk.injEq] at *
  exact ⟨Env.canon_eq he, canon_eq_of_setEq hr, canon_eq_of_setEq hbr, hp, hbp, canon_eq_of_setEq hx,
    canon_eq_of_setEq hbx⟩

/-- T1 on obligations. -/
theorem deriveObs_perm {a b : Input} (h : Input.Equiv a b) : deriveObs a = deriveObs b := by
  unfold deriveObs; rw [Input.canon_eq h]

theorem answeredObs_perm {a b : Input} (h : Input.Equiv a b) : answeredObs a = answeredObs b := by
  unfold answeredObs; rw [Input.canon_eq h]

theorem exceptionAnswered_perm {a b : Input} (h : Input.Equiv a b) : exceptionAnswered a = exceptionAnswered b := by
  unfold exceptionAnswered; rw [Input.canon_eq h]

/-- **T1**: the core output document is invariant under permutation and duplication of
    every input collection. -/
theorem deriveJ_perm {a b : Input} (h : Input.Equiv a b) : deriveJ a = deriveJ b := by
  unfold deriveJ
  rw [Input.canon_eq h, deriveObs_perm h, answeredObs_perm h, exceptionAnswered_perm h]

/-- **T1** on bytes: the printed core output is identical. -/
theorem deriveText_perm {a b : Input} (h : Input.Equiv a b) : deriveText a = deriveText b := by
  unfold deriveText; rw [deriveJ_perm h]

/-- Reordering the records (any permutation) changes nothing. -/
theorem deriveText_records_perm (a : Input) (rs : List Record) (h : a.records.Perm rs) :
    deriveText a = deriveText { a with records := rs } := by
  apply deriveText_perm
  refine ⟨?_, setEq_of_perm h, SetEq.refl _, rfl, rfl, SetEq.refl _, SetEq.refl _⟩
  refine ⟨rfl, rfl, SetEq.refl _, SetEq.refl _, rfl, ?_, ?_, rfl, SetEq.refl _, SetEq.refl _, SetEq.refl _⟩
  · exact ⟨rfl, rfl, SetEq.refl _, SetEq.refl _, SetEq.refl _, SetEq.refl _, SetEq.refl _, SetEq.refl _,
      SetEq.refl _, SetEq.refl _, SetEq.refl _, SetEq.refl _⟩
  · cases a.env.base with
    | none => trivial
    | some s => exact ⟨rfl, rfl, SetEq.refl _, SetEq.refl _, SetEq.refl _, SetEq.refl _, SetEq.refl _,
        SetEq.refl _, SetEq.refl _, SetEq.refl _, SetEq.refl _, SetEq.refl _⟩

end Shape
