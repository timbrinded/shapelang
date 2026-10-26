import Kernel.Proofs.Final
/-! Laws: guards (informal laws, A.2.5), staleness, and T9.

* `guard_needs_judgment`: an informal law is satisfied only through a usable, applicable,
  supporting claim judgment (a reevaluation).
* `guard_not_discharged_by_evidence`: adding any records that are not judgments never
  satisfies an unsatisfied informal law, and it keeps an open-or-answered obligation.
* `stale_obligation_moved` and `stale_iff`: an unestablished obligation with reason
  `stale` exists iff a fingerprint of the evidence that would establish the law moved. -/
namespace Shape

/-! ### Usability lemmas -/

theorem usab_none (e : Env) (pol : Policy) (c : Claim) (r : Record) :
    usab e pol c r = none ↔ (fpMoved e pol c r = false ∧ isExpired e pol c r = false ∧ isPC e r = false ∧
      hasAssumption e c r = false ∧ isWeak e pol c r = false) := by
  unfold usab
  cases fpMoved e pol c r <;> cases isExpired e pol c r <;> cases isPC e r <;>
    cases hasAssumption e c r <;> cases isWeak e pol c r <;> simp

theorem usab_stale (e : Env) (pol : Policy) (c : Claim) (r : Record) :
    usab e pol c r = some .stale ↔ fpMoved e pol c r = true := by
  unfold usab
  cases fpMoved e pol c r <;> cases isExpired e pol c r <;> cases isPC e r <;>
    cases hasAssumption e c r <;> cases isWeak e pol c r <;> simp

theorem reqStar_informal (e : Env) (pol : Policy) (c : Claim) (h : isInformal c = true) :
    (reqStar e pol c).level = .none := by
  simp [reqStar, h]

theorem recLevel_rank (e : Env) (r : Record) : (recLevel e r).rank ≤ 2 := by
  unfold recLevel
  split
  · split
    · split <;> simp [Level.rank]
    · simp [Level.rank]
  · simp [Level.rank]

theorem recFor_kind (e : Env) (pol : Policy) (c : Claim) (r : Record) (h : recFor e pol c r = true) :
    r.kind = .test ∨ r.kind = .proof ∨ r.kind = .judgment := by
  unfold recFor at h
  cases hk : r.kind <;> simp_all

/-! ### Guards -/

/-- **Guards are discharged only by reevaluation**: an informal law is satisfied only
    through a usable, applicable, supporting claim judgment. No observation, test, proof,
    equivalence or answer can satisfy it. -/
theorem guard_needs_judgment (i : Input) (c : Claim) (hinf : isInformal c = true) (hsat : lawSat i c = true) :
    ∃ r ∈ i.records, r.kind = .judgment ∧ r.result = .supports ∧ recFor i.env (polStar i) c r = true ∧
      usab i.env (polStar i) c r = none := by
  unfold lawSat at hsat
  simp only [Bool.and_eq_true, Bool.not_eq_true', Bool.or_eq_true, beq_iff_eq,
    reqStar_informal _ _ _ hinf, reduceCtorEq, false_or, List.any_eq_true] at hsat
  obtain ⟨_, r, hr, hsu⟩ := hsat
  simp only [supportsUsable, Bool.and_eq_true, beq_iff_eq] at hsu
  obtain ⟨⟨hrf, hres⟩, hun⟩ := hsu
  refine ⟨r, hr, ?_, hres, hrf, hun⟩
  have hw := ((usab_none _ _ _ _).mp hun).2.2.2.2
  have h2 : Level.none.rank = 3 := rfl
  have h1 := recLevel_rank i.env r
  rcases recFor_kind _ _ _ _ hrf with hk | hk | hk
  · simp only [isWeak, hk, reqStar_informal _ _ _ hinf, Bool.or_eq_false_iff, decide_eq_false_iff_not,
      Nat.not_lt] at hw
    omega
  · simp only [isWeak, hk, reqStar_informal _ _ _ hinf, Bool.or_eq_false_iff, decide_eq_false_iff_not,
      Nat.not_lt] at hw
    omega
  · exact hk

def Input.withRecords (inp : Input) (extra : List Record) : Input :=
  { inp with records := inp.records ++ extra }

theorem withRecords_polStar (inp : Input) (extra : List Record) :
    polStar (inp.withRecords extra).canon = polStar inp.canon := rfl

theorem lawSoundContra_mono (inp : Input) (extra : List Record) (c : Claim)
    (h : lawSoundContra inp.canon c = true) : lawSoundContra (inp.withRecords extra).canon c = true := by
  simp only [lawSoundContra, List.any_eq_true] at *
  obtain ⟨r, hr, hf⟩ := h
  refine ⟨r, ?_, hf⟩
  simp only [Input.canon, Input.withRecords, mem_canon, List.mem_append] at *
  exact Or.inl hr

/-- **Evidence never discharges a guard**: adding records none of which is a judgment
    (observations, tests, proofs, equivalences) never satisfies an unsatisfied informal law. -/
theorem guard_not_discharged_by_evidence (inp : Input) (extra : List Record)
    (hx : ∀ r ∈ extra, r.kind ≠ .judgment) (c : Claim) (hinf : isInformal c = true)
    (hns : lawSat inp.canon c = false) : lawSat (inp.withRecords extra).canon c = false := by
  rw [Bool.eq_false_iff]
  intro hsat
  obtain ⟨r, hr, hk, hres, hrf, hun⟩ := guard_needs_judgment _ c hinf hsat
  have hr0 : r ∈ inp.canon.records := by
    simp only [Input.canon, Input.withRecords, mem_canon, List.mem_append] at hr ⊢
    rcases hr with hr | hr
    · exact hr
    · exact absurd hk (hx r hr)
  have hsc : lawSoundContra inp.canon c = false := by
    rw [Bool.eq_false_iff]
    intro h
    have := lawSoundContra_mono inp extra c h
    simp [lawSat, this] at hsat
  have : lawSat inp.canon c = true := by
    simp only [lawSat, hsc, Bool.not_false, Bool.true_and, Bool.or_eq_true, List.any_eq_true]
    right
    refine ⟨r, hr0, ?_⟩
    simp only [supportsUsable, Bool.and_eq_true, beq_iff_eq]
    exact ⟨⟨hrf, hres⟩, hun⟩
  rw [hns] at this
  exact Bool.false_ne_true this

theorem mem_lawObsFor (i : Input) (c : Claim) (o : Ob) (ho : o ∈ lawObsFor i c) :
    (o = mkLawOb i c .contradiction (some .sound) none ∧ lawSoundContra i c = true) ∨
    (o = mkLawOb i c .contradiction (some .heuristic) none ∧ lawSoundContra i c = false) ∨
    (o = mkLawOb i c .unestablished none (some (lawReason i c)) ∧ lawSoundContra i c = false ∧
      lawSat i c = false) := by
  unfold lawObsFor at ho
  simp only [List.mem_append] at ho
  rcases ho with (h | h) | h
  · split at h
    · rename_i hs; simp at h; exact Or.inl ⟨h, hs⟩
    · simp at h
  · split at h
    · rename_i hs
      simp only [Bool.and_eq_true, Bool.not_eq_true'] at hs
      simp at h; exact Or.inr (Or.inl ⟨h, hs.1⟩)
    · simp at h
  · split at h
    · rename_i hs
      simp only [Bool.and_eq_true, Bool.not_eq_true'] at hs
      simp at h; exact Or.inr (Or.inr ⟨h, hs.1, hs.2⟩)
    · simp at h

/-- A guard that is not satisfied always has an obligation (unestablished, or a sound
    contradiction); it never silently disappears. -/
theorem guard_obligation (i : Input) (c : Claim) (hns : lawSat i c = false) :
    ∃ o ∈ lawObsFor i c, o.claimFp = some c.fp ∧
      (o.kind = .unestablished ∨ (o.kind = .contradiction ∧ o.force = some .sound)) := by
  cases hs : lawSoundContra i c
  · refine ⟨mkLawOb i c .unestablished none (some (lawReason i c)), ?_, rfl, Or.inl rfl⟩
    simp [lawObsFor, hs, hns]
  · refine ⟨mkLawOb i c .contradiction (some .sound) none, ?_, rfl, Or.inr ⟨rfl, rfl⟩⟩
    simp [lawObsFor, hs]

/-- Law obligations with an answer discharger are exactly producer-changed unestablished
    obligations and heuristic contradictions (A.7.6.5); an answer is itself a judgment. -/
theorem law_answerable (i : Input) (c : Claim) (o : Ob) (ho : o ∈ lawObsFor i c) (ha : o.answerable = true) :
    (o.kind = .unestablished ∧ o.reason = some .producerChanged) ∨
    (o.kind = .contradiction ∧ o.force = some .heuristic) := by
  rcases mem_lawObsFor i c o ho with ⟨rfl, _⟩ | ⟨rfl, _⟩ | ⟨rfl, _, _⟩
  · simp [mkLawOb] at ha
  · exact Or.inr ⟨rfl, rfl⟩
  · simp only [mkLawOb, Bool.or_eq_true, Bool.and_eq_true, beq_iff_eq] at ha
    rcases ha with ⟨_, h⟩ | ⟨h, _⟩
    · exact Or.inl ⟨rfl, h⟩
    · cases h

theorem discharged_answerable (i : Input) (all : List Ob) (o : Ob) (h : discharged i all o = true) :
    o.answerable = true := by
  simp only [discharged, Bool.and_eq_true] at h; exact h.1

/-- **T9**: at most one of a sound contradiction and an unestablished obligation per law. -/
theorem at_most_one (i : Input) (c : Claim) (o1 o2 : Ob) (h1 : o1 ∈ lawObsFor i c) (h2 : o2 ∈ lawObsFor i c)
    (hk1 : o1.kind = .contradiction) (hf1 : o1.force = some .sound) (hk2 : o2.kind = .unestablished) : False := by
  rcases mem_lawObsFor i c o1 h1 with ⟨rfl, hs⟩ | ⟨rfl, _⟩ | ⟨rfl, _, _⟩
  · rcases mem_lawObsFor i c o2 h2 with ⟨rfl, _⟩ | ⟨rfl, _⟩ | ⟨rfl, hs', _⟩
    · cases hk2
    · cases hk2
    · rw [hs] at hs'; cases hs'
  · cases hf1
  · cases hk1

/-! ### Staleness -/

theorem lawReason_stale (i : Input) (c : Claim) (h : lawReason i c = .stale) : holdsReason i c .stale = true := by
  unfold lawReason at h
  split at h
  · cases h
  · split at h
    · cases h
    · split at h
      · cases h
      · split at h
        · cases h
        · split at h
          · assumption
          · cases h

/-- (⇒) An unestablished obligation with reason `stale` implies that a fingerprint of a
    record about the law moved (a cited or dependency digest, Req, or a revision-tied
    record's revision). -/
theorem stale_obligation_moved (i : Input) (c : Claim) (o : Ob) (ho : o ∈ lawObsFor i c)
    (hk : o.kind = .unestablished) (hr : o.reason = some .stale) :
    ∃ r ∈ i.records, recFor i.env (polStar i) c r = true ∧ fpMoved i.env (polStar i) c r = true := by
  rcases mem_lawObsFor i c o ho with ⟨rfl, _⟩ | ⟨rfl, _⟩ | ⟨rfl, _, _⟩
  · cases hk
  · cases hk
  · simp only [mkLawOb, Option.some.injEq] at hr
    have := lawReason_stale i c hr
    simp only [holdsReason, List.any_eq_true, Bool.and_eq_true, beq_iff_eq] at this
    obtain ⟨r, hr, hrf, hu⟩ := this
    exact ⟨r, hr, hrf, (usab_stale _ _ _ _).mp hu⟩

/-- Every record about c would establish it if it were fresh. -/
def EstablishingModuloFreshness (i : Input) (c : Claim) : Prop :=
  ∀ r ∈ i.records, recFor i.env (polStar i) c r = true →
    r.result = .supports ∧ isExpired i.env (polStar i) c r = false ∧ isPC i.env r = false ∧
    hasAssumption i.env c r = false ∧ isWeak i.env (polStar i) c r = false

theorem usab_of_emf (i : Input) (c : Claim) (hH : EstablishingModuloFreshness i c) (r : Record)
    (hr : r ∈ i.records) (hrf : recFor i.env (polStar i) c r = true) :
    usab i.env (polStar i) c r = (if fpMoved i.env (polStar i) c r then some .stale else none) := by
  obtain ⟨_, h2, h3, h4, h5⟩ := hH r hr hrf
  unfold usab
  simp [h2, h3, h4, h5]

/-- **Stale iff a fingerprint of the establishing evidence changed.** For a law that is not
    declared-only and has no sound contradiction, if every record about it would establish it
    when fresh, an unestablished obligation with reason `stale` exists iff there is such a
    record and every such record's fingerprint moved. -/
theorem stale_iff (i : Input) (c : Claim) (hH : EstablishingModuloFreshness i c)
    (hnc : lawSoundContra i c = false) (hlvl : (reqStar i.env (polStar i) c).level ≠ .declared) :
    (∃ o ∈ lawObsFor i c, o.kind = .unestablished ∧ o.reason = some .stale) ↔
    ((∃ r ∈ i.records, recFor i.env (polStar i) c r = true) ∧
      ∀ r ∈ i.records, recFor i.env (polStar i) c r = true → fpMoved i.env (polStar i) c r = true) := by
  have hsat : lawSat i c = true ↔ ∃ r ∈ i.records, recFor i.env (polStar i) c r = true ∧
      fpMoved i.env (polStar i) c r = false := by
    simp only [lawSat, hnc, Bool.not_false, Bool.true_and, Bool.or_eq_true, beq_iff_eq, hlvl, false_or,
      List.any_eq_true, supportsUsable, Bool.and_eq_true]
    constructor
    · rintro ⟨r, hr, ⟨hrf, _⟩, hu⟩
      refine ⟨r, hr, hrf, ?_⟩
      rw [usab_of_emf i c hH r hr hrf] at hu
      cases h : fpMoved i.env (polStar i) c r <;> simp_all
    · rintro ⟨r, hr, hrf, hm⟩
      refine ⟨r, hr, ⟨hrf, by simpa using (hH r hr hrf).1⟩, ?_⟩
      rw [usab_of_emf i c hH r hr hrf]; simp [hm]
  have hhold : ∀ rr, rr ≠ .stale → holdsReason i c rr = false := by
    intro rr hne
    simp only [holdsReason, List.any_eq_false, Bool.and_eq_true, beq_iff_eq, not_and]
    intro r hr hrf hu
    rw [usab_of_emf i c hH r hr hrf] at hu
    cases h : fpMoved i.env (polStar i) c r <;> simp_all
  have hreason : lawReason i c = if holdsReason i c .stale then .stale else .missing := by
    unfold lawReason
    rw [hhold .producerChanged (by decide), hhold .assumption (by decide), hhold .weak (by decide),
      hhold .expired (by decide)]
    simp
  have hstale : holdsReason i c .stale = true ↔ ∃ r ∈ i.records, recFor i.env (polStar i) c r = true ∧
      fpMoved i.env (polStar i) c r = true := by
    simp only [holdsReason, List.any_eq_true, Bool.and_eq_true, beq_iff_eq]
    constructor
    · rintro ⟨r, hr, hrf, hu⟩; exact ⟨r, hr, hrf, (usab_stale _ _ _ _).mp hu⟩
    · rintro ⟨r, hr, hrf, hm⟩; exact ⟨r, hr, hrf, (usab_stale _ _ _ _).mpr hm⟩
  constructor
  · rintro ⟨o, ho, hk, hr⟩
    rcases mem_lawObsFor i c o ho with ⟨rfl, _⟩ | ⟨rfl, _⟩ | ⟨rfl, _, hns⟩
    · cases hk
    · cases hk
    · simp only [mkLawOb, Option.some.injEq] at hr
      have hh := lawReason_stale i c hr
      obtain ⟨r, hr', hrf, _⟩ := hstale.mp hh
      refine ⟨⟨r, hr', hrf⟩, ?_⟩
      intro r2 hr2 hrf2
      cases hm : fpMoved i.env (polStar i) c r2
      · have := hsat.mpr ⟨r2, hr2, hrf2, hm⟩
        rw [hns] at this; cases this
      · rfl
  · rintro ⟨⟨r, hr, hrf⟩, hall⟩
    have hns : lawSat i c = false := by
      rw [Bool.eq_false_iff]
      intro h
      obtain ⟨r2, hr2, hrf2, hm⟩ := hsat.mp h
      rw [hall r2 hr2 hrf2] at hm; cases hm
    have hh : holdsReason i c .stale = true := hstale.mpr ⟨r, hr, hrf, hall r hr hrf⟩
    refine ⟨mkLawOb i c .unestablished none (some (lawReason i c)), ?_, rfl, ?_⟩
    · simp [lawObsFor, hnc, hns]
    · simp [mkLawOb, hreason, hh]

/-- Corollary: when no fingerprint of any record about the law moved, no stale obligation
    is ever raised. -/
theorem no_stale_without_move (i : Input) (c : Claim)
    (h : ∀ r ∈ i.records, recFor i.env (polStar i) c r = true → fpMoved i.env (polStar i) c r = false) :
    ¬ ∃ o ∈ lawObsFor i c, o.kind = .unestablished ∧ o.reason = some .stale := by
  rintro ⟨o, ho, hk, hr⟩
  obtain ⟨r, hr', hrf, hm⟩ := stale_obligation_moved i c o ho hk hr
  rw [h r hr' hrf] at hm; cases hm

end Shape

namespace Shape

theorem lawObsFor_sub_rawObs (i : Input) (c : Claim) (hc : c ∈ i.env.head.claims) (hl : c.isLaw = true) :
    ∀ o ∈ lawObsFor i c, o ∈ rawObs i := by
  intro o ho
  simp only [rawObs, List.mem_append]
  left; left; right
  simp only [lawObs, List.mem_flatMap, List.mem_filter]
  exact ⟨c, ⟨hc, hl⟩, ho⟩

/-- **Guards in the output**: for an unsatisfied law (in particular a guard), `derive`
    either lists an open obligation with the same key, or the obligation was discharged by an
    answer, which A.7.6.5 allows only for reason producer-changed. Evidence alone never makes
    it disappear (`guard_not_discharged_by_evidence`). -/
theorem guard_open_or_answered (inp : Input) (c : Claim) (hc : c ∈ inp.env.head.claims) (hl : c.isLaw = true)
    (hns : lawSat inp.canon c = false) :
    ∃ o ∈ rawObs inp.canon, o.claimFp = some c.fp ∧
      ((∃ o' ∈ deriveObs inp, o'.key = o.key) ∨
       (o ∈ answeredObs inp ∧ o.kind = .unestablished ∧ o.reason = some .producerChanged)) := by
  have hc' : c ∈ inp.canon.env.head.claims := by
    show c ∈ Shape.canon inp.env.head.claims
    rw [mem_canon]; exact hc
  obtain ⟨o, ho, hfp, hkind⟩ := guard_obligation inp.canon c hns
  have hraw := lawObsFor_sub_rawObs inp.canon c hc' hl o ho
  refine ⟨o, hraw, hfp, ?_⟩
  cases hd : discharged inp.canon (rawObs inp.canon) o
  · left
    obtain ⟨o', ho', hk, _⟩ := deriveObs_of_raw inp o hraw hd
    exact ⟨o', ho', hk⟩
  · right
    refine ⟨?_, ?_⟩
    · simp only [answeredObs, List.mem_filter]; exact ⟨hraw, hd⟩
    · have ha := discharged_answerable _ _ _ hd
      rcases law_answerable inp.canon c o ho ha with h | ⟨hk, hf⟩
      · exact h
      · rcases hkind with hk' | ⟨_, hf'⟩
        · rw [hk] at hk'; cases hk'
        · rw [hf] at hf'; cases hf'

end Shape
