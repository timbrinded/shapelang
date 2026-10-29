import Kernel.Derive
/-! **T2 (final is final) and T3 (evidence never waives)** for checker-decided claims
(authority and effect forbids, which include trust/hatch forbids).

`withEvidence` adds arbitrary records (observations, tests, proofs, claim judgments,
answers, equivalences) to the head and base record sets, and replaces both policies and
both exception lists by arbitrary values. -/
namespace Shape

def Input.withEvidence (inp : Input) (extra extraBase : List Record) (ph : Policy) (pb : Option Policy)
    (eh eb : List Exc) : Input :=
  { inp with records := inp.records ++ extra, baseRecords := inp.baseRecords ++ extraBase,
             headPolicy := ph, basePolicy := pb, headExcs := eh, baseExcs := eb }

section
variable (inp : Input) (extra extraBase : List Record) (ph : Policy) (pb : Option Policy) (eh eb : List Exc)

theorem withEvidence_env : (inp.withEvidence extra extraBase ph pb eh eb).canon.env = inp.canon.env := rfl

theorem withEvidence_records : ∀ r ∈ inp.canon.records, r ∈ (inp.withEvidence extra extraBase ph pb eh eb).canon.records := by
  intro r hr
  simp only [Input.canon, Input.withEvidence, mem_canon, List.mem_append] at *
  exact Or.inl hr
end

theorem obsFacts_mono (e : Env) (rs rs' : List Record) (h : ∀ r ∈ rs, r ∈ rs') :
    ∀ of ∈ obsFacts e rs, of ∈ obsFacts e rs' := by
  intro of hof
  simp only [obsFacts, List.mem_append, List.mem_flatMap] at *
  rcases hof with h1 | ⟨r, hr, h2⟩
  · exact Or.inl h1
  · exact Or.inr ⟨r, h r hr, h2⟩

theorem effSubjects_mono (e : Env) (rs rs' : List Record) (h : ∀ r ∈ rs, r ∈ rs') :
    ∀ s ∈ effSubjects e rs, s ∈ effSubjects e rs' := by
  intro s hs
  simp only [effSubjects, mem_canon, List.mem_filterMap] at *
  obtain ⟨of, hof, hv⟩ := hs
  exact ⟨of, obsFacts_mono e rs rs' h of hof, hv⟩

theorem effForce_mono (e : Env) (rs rs' : List Record) (h : ∀ r ∈ rs, r ∈ rs') (s : String × Atom)
    (hs : effForce e rs s = .sound) : effForce e rs' s = .sound := by
  unfold effForce at *
  by_cases hany : (effSupport e rs s).any (·.sound) = true
  · have : (effSupport e rs' s).any (·.sound) = true := by
      simp only [List.any_eq_true, effSupport, List.mem_filter] at hany ⊢
      obtain ⟨of, ⟨hof, hloc⟩, hsound⟩ := hany
      exact ⟨of, ⟨obsFacts_mono e rs rs' h of hof, hloc⟩, hsound⟩
    simp [this]
  · simp [hany] at hs

theorem mkEffContra_some (e : Env) (rs brs : List Record) (s : String × Atom) (o : Ob)
    (h : mkEffContra e rs brs s = some o) :
    ∃ c, effCore e s = some c ∧ o.key = c.key ∧ o.kind = c.kind ∧ o.family = c.family ∧ o.tier = c.tier ∧
      o.force = some (effForce e rs s) ∧ o.answerable = (effForce e rs s == .heuristic) := by
  simp only [mkEffContra, Option.map_eq_some_iff] at h
  obtain ⟨c, hc, rfl⟩ := h
  exact ⟨c, hc, rfl, rfl, rfl, rfl, rfl, rfl⟩

theorem effCore_kind (e : Env) (s : String × Atom) (c : Ob) (h : effCore e s = some c) :
    c.kind = .contradiction ∧ c.family = .authority := by
  unfold effCore at h
  dsimp only at h
  split at h
  · simp at h
  · simp only [Option.some.injEq] at h; subst h; exact ⟨rfl, rfl⟩

/-! ### Every other part of `rawObs` has a different family -/

theorem structContras_family (e : Env) (rs brs : List Record) : ∀ o ∈ structContras e rs brs, o.family = .structure := by
  intro o ho
  simp only [structContras, List.mem_flatMap, List.mem_map] at ho
  obtain ⟨_, _, _, _, rfl⟩ := ho
  rfl

theorem conductContras_family (e : Env) (rs brs : List Record) : ∀ o ∈ conductContras e rs brs, o.family = .conduct := by
  intro o ho
  simp only [conductContras, List.mem_flatMap] at ho
  obtain ⟨c, _, hc⟩ := ho
  split at hc
  · simp only [List.mem_map] at hc
    obtain ⟨_, _, rfl⟩ := hc
    rfl
  · simp at hc

theorem mkLawOb_family (i : Input) (c : Claim) (k : ObKind) (f : Option Force) (r : Option Reason) :
    (mkLawOb i c k f r).family = .law := rfl

theorem lawObs_family (i : Input) : ∀ o ∈ lawObs i, o.family = .law := by
  intro o ho
  simp only [lawObs, lawObsFor, List.mem_flatMap, List.mem_append] at ho
  obtain ⟨c, _, hc⟩ := ho
  rcases hc with (h | h) | h <;> (split at h <;> simp_all [mkLawOb_family])

theorem loosenObs_family (i : Input) : ∀ o ∈ loosenObs i, o.family = .loosening := by
  intro o ho
  unfold loosenObs at ho
  dsimp only at ho
  split at ho
  · split at ho
    · simp at ho
    · simp only [List.mem_map] at ho
      obtain ⟨_, _, rfl⟩ := ho
      rfl
  · simp at ho

theorem coverageObs_family (e : Env) (rs : List Record) : ∀ o ∈ coverageObs e rs, o.family = .coverage := by
  intro o ho
  simp only [coverageObs, List.mem_filterMap] at ho
  obtain ⟨_, _, h⟩ := ho
  split at h
  · simp at h
  · simp only [Option.some.injEq] at h; subst h; rfl

theorem rawObs_authority (i : Input) (o : Ob) (ho : o ∈ rawObs i) (hf : o.family = .authority) :
    ∃ s ∈ effSubjects i.env i.records, mkEffContra i.env i.records i.baseRecords s = some o := by
  simp only [rawObs, List.mem_append] at ho
  rcases ho with ((((h | h) | h) | h) | h) | h
  · simpa [effContras, List.mem_filterMap] using h
  · rw [structContras_family _ _ _ o h] at hf; cases hf
  · rw [conductContras_family _ _ _ o h] at hf; cases hf
  · rw [lawObs_family _ o h] at hf; cases hf
  · rw [loosenObs_family _ o h] at hf; cases hf
  · rw [coverageObs_family _ _ o h] at hf; cases hf

theorem effContra_mem_rawObs (i : Input) (s : String × Atom) (hs : s ∈ effSubjects i.env i.records) (o : Ob)
    (h : mkEffContra i.env i.records i.baseRecords s = some o) : o ∈ rawObs i := by
  simp only [rawObs, List.mem_append]
  left; left; left; left; left
  simp only [effContras, List.mem_filterMap]
  exact ⟨s, hs, h⟩

/-! ### deriveObs -/

theorem mem_deriveObs (inp : Input) (o : Ob) (ho : o ∈ deriveObs inp) :
    ∃ o₀ ∈ rawObs inp.canon, discharged inp.canon (rawObs inp.canon) o₀ = false ∧
      o.key = o₀.key ∧ o.kind = o₀.kind ∧ o.family = o₀.family ∧ o.force = o₀.force ∧ o.tier = o₀.tier := by
  simp only [deriveObs, List.mem_map, List.mem_filter, Bool.not_eq_true'] at ho
  obtain ⟨o₀, ⟨h1, h2⟩, rfl⟩ := ho
  exact ⟨o₀, h1, h2, rfl, rfl, rfl, rfl, rfl⟩

theorem not_discharged_of_unanswerable (i : Input) (all : List Ob) (o : Ob) (h : o.answerable = false) :
    discharged i all o = false := by
  simp [discharged, h]

theorem deriveObs_of_raw (inp : Input) (o₀ : Ob) (h1 : o₀ ∈ rawObs inp.canon)
    (h2 : discharged inp.canon (rawObs inp.canon) o₀ = false) :
    ∃ o ∈ deriveObs inp, o.key = o₀.key ∧ o.kind = o₀.kind ∧ o.force = o₀.force ∧ o.tier = o₀.tier ∧
      o.severity = sevOf inp.canon (matchedBy inp.canon o₀).isSome
        ((matchedBy inp.canon o₀).isSome && excAnswered inp.canon (rawObs inp.canon) o₀) o₀ := by
  refine ⟨finalize inp.canon (rawObs inp.canon) o₀, ?_, rfl, rfl, rfl, rfl, rfl⟩
  simp only [deriveObs, List.mem_map, List.mem_filter, Bool.not_eq_true']
  exact ⟨o₀, ⟨h1, h2⟩, rfl⟩

theorem sev_final (i : Input) (m x : Bool) (o : Ob) (hk : o.kind = .contradiction) (hs : o.force = some .sound)
    (ht : o.tier = .final) : sevOf i m x o = .blocking := by
  simp [sevOf, hk, hs, ht]

/-- **T3, evidence never waives** (checker-decided claims): adding any records, and
    replacing both policies and both exception lists, never removes a sound contradiction of
    an authority or effect forbid; the obligation with the same key stays open and sound
    (an exception can at most turn it into visible debt). -/
theorem evidence_never_waives (inp : Input) (extra extraBase : List Record) (ph : Policy) (pb : Option Policy)
    (eh eb : List Exc) (o : Ob) (ho : o ∈ deriveObs inp) (hf : o.family = .authority)
    (hs : o.force = some .sound) :
    ∃ o' ∈ deriveObs (inp.withEvidence extra extraBase ph pb eh eb),
      o'.key = o.key ∧ o'.kind = .contradiction ∧ o'.force = some .sound ∧ o'.tier = o.tier := by
  obtain ⟨o₀, hraw, _, hkey, hkind, hfam, hforce, htier⟩ := mem_deriveObs inp o ho
  rw [hfam] at hf
  obtain ⟨s, hsub, hmk⟩ := rawObs_authority _ o₀ hraw hf
  obtain ⟨c, hc, hk0, hkind0, _, ht0, hf0, _⟩ := mkEffContra_some _ _ _ s o₀ hmk
  have hsound0 : effForce inp.canon.env inp.canon.records s = .sound := by
    rw [hforce, hf0] at hs; simpa using hs
  -- the new input
  let inp' := inp.withEvidence extra extraBase ph pb eh eb
  have henv : inp'.canon.env = inp.canon.env := rfl
  have hrec := withEvidence_records inp extra extraBase ph pb eh eb
  have hsub' : s ∈ effSubjects inp'.canon.env inp'.canon.records := by
    rw [henv]; exact effSubjects_mono _ _ _ hrec s hsub
  have hsound' : effForce inp'.canon.env inp'.canon.records s = .sound := by
    rw [henv]; exact effForce_mono _ _ _ hrec s hsound0
  have hc' : effCore inp'.canon.env s = some c := by rw [henv]; exact hc
  obtain ⟨o₁, hmk'⟩ : ∃ o₁, mkEffContra inp'.canon.env inp'.canon.records inp'.canon.baseRecords s = some o₁ := by
    simp [mkEffContra, hc']
  obtain ⟨c', hc'', hk1, hkind1, _, ht1, hf1, ha1⟩ := mkEffContra_some _ _ _ s o₁ hmk'
  rw [hc'] at hc''
  cases hc''
  have hraw' := effContra_mem_rawObs inp'.canon s hsub' o₁ hmk'
  have hans : o₁.answerable = false := by rw [ha1, hsound']; rfl
  obtain ⟨o', ho', hk', hkind', hforce', htier', _⟩ :=
    deriveObs_of_raw inp' o₁ hraw' (not_discharged_of_unanswerable _ _ _ hans)
  refine ⟨o', ho', ?_, ?_, ?_, ?_⟩
  · rw [hk', hk1, hkey, hk0]
  · rw [hkind', hkind1]; exact (effCore_kind _ _ _ hc).1
  · rw [hforce', hf1, hsound']
  · rw [htier', ht1, htier, ht0]

/-- **T2, final is final** (checker-decided claims): a sound contradiction at tier* final
    stays open and blocking whatever records are added and whatever policies and exceptions
    are substituted. -/
theorem final_is_final (inp : Input) (extra extraBase : List Record) (ph : Policy) (pb : Option Policy)
    (eh eb : List Exc) (o : Ob) (ho : o ∈ deriveObs inp) (hf : o.family = .authority)
    (hs : o.force = some .sound) (ht : o.tier = .final) :
    ∃ o' ∈ deriveObs (inp.withEvidence extra extraBase ph pb eh eb),
      o'.key = o.key ∧ o'.kind = .contradiction ∧ o'.force = some .sound ∧ o'.tier = .final ∧
      o'.severity = .blocking := by
  obtain ⟨o₀, hraw, _, hkey, hkind, hfam, hforce, htier⟩ := mem_deriveObs inp o ho
  rw [hfam] at hf
  obtain ⟨s, hsub, hmk⟩ := rawObs_authority _ o₀ hraw hf
  obtain ⟨c, hc, hk0, hkind0, _, ht0, hf0, _⟩ := mkEffContra_some _ _ _ s o₀ hmk
  have hsound0 : effForce inp.canon.env inp.canon.records s = .sound := by
    rw [hforce, hf0] at hs; simpa using hs
  let inp' := inp.withEvidence extra extraBase ph pb eh eb
  have henv : inp'.canon.env = inp.canon.env := rfl
  have hrec := withEvidence_records inp extra extraBase ph pb eh eb
  have hsub' : s ∈ effSubjects inp'.canon.env inp'.canon.records := by
    rw [henv]; exact effSubjects_mono _ _ _ hrec s hsub
  have hsound' : effForce inp'.canon.env inp'.canon.records s = .sound := by
    rw [henv]; exact effForce_mono _ _ _ hrec s hsound0
  have hc' : effCore inp'.canon.env s = some c := by rw [henv]; exact hc
  obtain ⟨o₁, hmk'⟩ : ∃ o₁, mkEffContra inp'.canon.env inp'.canon.records inp'.canon.baseRecords s = some o₁ := by
    simp [mkEffContra, hc']
  obtain ⟨c', hc'', hk1, hkind1, _, ht1, hf1, ha1⟩ := mkEffContra_some _ _ _ s o₁ hmk'
  rw [hc'] at hc''
  cases hc''
  have hraw' := effContra_mem_rawObs inp'.canon s hsub' o₁ hmk'
  have hans : o₁.answerable = false := by rw [ha1, hsound']; rfl
  obtain ⟨o', ho', hk', hkind', hforce', htier', hsev'⟩ :=
    deriveObs_of_raw inp' o₁ hraw' (not_discharged_of_unanswerable _ _ _ hans)
  have hkc : o₁.kind = .contradiction := by rw [hkind1]; exact (effCore_kind _ _ _ hc).1
  have hfs : o₁.force = some .sound := by rw [hf1, hsound']
  have htf : o₁.tier = .final := by rw [ht1, ← ht0, ← htier, ht]
  refine ⟨o', ho', ?_, ?_, ?_, ?_, ?_⟩
  · rw [hk', hk1, hkey, hk0]
  · rw [hkind', hkc]
  · rw [hforce', hfs]
  · rw [htier', htf]
  · rw [hsev']; exact sev_final _ _ _ _ hkc hfs htf

/-- Corollary of T2: the verdict stays `blocked`. -/
theorem final_keeps_blocked (inp : Input) (extra extraBase : List Record) (ph : Policy) (pb : Option Policy)
    (eh eb : List Exc) (o : Ob) (ho : o ∈ deriveObs inp) (hf : o.family = .authority)
    (hs : o.force = some .sound) (ht : o.tier = .final) (errs : List (String × String)) :
    verdictOf errs (deriveObs (inp.withEvidence extra extraBase ph pb eh eb)) = "blocked" := by
  obtain ⟨o', ho', _, _, _, _, hsev⟩ := final_is_final inp extra extraBase ph pb eh eb o ho hf hs ht
  have : (deriveObs (inp.withEvidence extra extraBase ph pb eh eb)).any (·.severity == .blocking) = true :=
    List.any_eq_true.mpr ⟨o', ho', by simp [hsev]⟩
  simp [verdictOf, this]

end Shape
