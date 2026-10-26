import Kernel.Order
/-! Executable reachability over finite edge lists, proved equal to the inductive closure.

Used for the effect order `⇒` (reflexive-transitive closure of `implies`), for the call
closure, and for path and cycle claims over component graphs. -/
namespace Shape

variable {α : Type} [DecidableEq α]

/-- Append the members of `xs` not yet present. -/
def addNew : List α → List α → List α
  | S, [] => S
  | S, x :: xs => if x ∈ S then addNew S xs else addNew (S ++ [x]) xs

theorem mem_addNew : ∀ (S xs : List α) (y : α), y ∈ addNew S xs ↔ y ∈ S ∨ y ∈ xs
  | S, [], y => by simp [addNew]
  | S, x :: xs, y => by
    unfold addNew
    by_cases h : x ∈ S
    · simp only [h, ite_true, mem_addNew S xs y]
      grind
    · simp only [h, ite_false, mem_addNew (S ++ [x]) xs y]
      grind

theorem nodup_addNew : ∀ (S xs : List α), S.Nodup → (addNew S xs).Nodup
  | S, [], h => by simpa [addNew] using h
  | S, x :: xs, h => by
    unfold addNew
    by_cases hx : x ∈ S
    · simp only [hx, ite_true]; exact nodup_addNew S xs h
    · simp only [hx, ite_false]
      apply nodup_addNew
      rw [List.nodup_append]
      refine ⟨h, by simp, ?_⟩
      intro a ha b hb
      simp at hb; subst hb
      intro e; subst e; exact hx ha

theorem length_addNew_ge : ∀ (S xs : List α), S.length ≤ (addNew S xs).length
  | S, [] => by simp [addNew]
  | S, x :: xs => by
    unfold addNew
    by_cases hx : x ∈ S
    · simp only [hx, ite_true]; exact length_addNew_ge S xs
    · simp only [hx, ite_false]
      have := length_addNew_ge (S ++ [x]) xs
      simp at this; omega

theorem addNew_same_length : ∀ (S xs : List α), (addNew S xs).length = S.length → ∀ x ∈ xs, x ∈ S
  | S, [], _ => by simp
  | S, x :: xs, h => by
    unfold addNew at h
    by_cases hx : x ∈ S
    · simp only [hx, ite_true] at h
      intro y hy
      rcases List.mem_cons.mp hy with rfl | hy
      · exact hx
      · exact addNew_same_length S xs h y hy
    · simp only [hx, ite_false] at h
      have := length_addNew_ge (S ++ [x]) xs
      simp at this; omega

/-- Counting: a duplicate-free list inside `U` is no longer than `U`. -/
theorem length_le_of_nodup_subset : ∀ (l U : List α), l.Nodup → (∀ x ∈ l, x ∈ U) → l.length ≤ U.length
  | [], _, _, _ => by simp
  | a :: t, U, hn, hs => by
    have ha : a ∈ U := hs a (by simp)
    have hat : a ∉ t := (List.nodup_cons.mp hn).1
    have ht : ∀ x ∈ t, x ∈ U.erase a := by
      intro x hx
      have hxa : x ≠ a := fun e => hat (e ▸ hx)
      exact (List.mem_erase_of_ne hxa).mpr (hs x (List.mem_cons_of_mem a hx))
    have := length_le_of_nodup_subset t (U.erase a) (List.nodup_cons.mp hn).2 ht
    rw [List.length_erase_of_mem ha] at this
    have hpos : 0 < U.length := List.length_pos_of_mem ha
    simp; omega

/-- Inductive reachability: `start` and everything one `E`-step from a reached `ok` node. -/
inductive RT (E : List (α × α)) (ok : α → Bool) (start : List α) : α → Prop
  | base {a} : a ∈ start → RT E ok start a
  | step {a b} : RT E ok start a → ok a = true → (a, b) ∈ E → RT E ok start b

def stepS (E : List (α × α)) (ok : α → Bool) (S : List α) : List α :=
  addNew S ((E.filter (fun e => decide (e.1 ∈ S) && ok e.1)).map Prod.snd)

def satS (E : List (α × α)) (ok : α → Bool) : Nat → List α → List α
  | 0, S => S
  | n + 1, S => if (stepS E ok S).length = S.length then S else satS E ok n (stepS E ok S)

def univS (E : List (α × α)) (start : List α) : List α := start ++ E.map Prod.snd

def reachSet (E : List (α × α)) (ok : α → Bool) (start : List α) : List α :=
  satS E ok ((univS E start).length + 1) (addNew [] start)

def Closed (E : List (α × α)) (ok : α → Bool) (R : List α) : Prop :=
  ∀ a b, a ∈ R → ok a = true → (a, b) ∈ E → b ∈ R

theorem mem_stepS (E : List (α × α)) (ok : α → Bool) (S : List α) (y : α) :
    y ∈ stepS E ok S ↔ y ∈ S ∨ ∃ a, a ∈ S ∧ ok a = true ∧ (a, y) ∈ E := by
  unfold stepS
  rw [mem_addNew]
  simp only [List.mem_map, List.mem_filter, Bool.and_eq_true, decide_eq_true_eq]
  constructor
  · rintro (h | ⟨⟨a, b⟩, ⟨he, ha, hok⟩, rfl⟩)
    · exact Or.inl h
    · exact Or.inr ⟨a, ha, hok, he⟩
  · rintro (h | ⟨a, ha, hok, he⟩)
    · exact Or.inl h
    · exact Or.inr ⟨(a, y), ⟨he, ha, hok⟩, rfl⟩

theorem subset_stepS (E : List (α × α)) (ok : α → Bool) (S : List α) : ∀ x ∈ S, x ∈ stepS E ok S :=
  fun x hx => (mem_stepS E ok S x).mpr (Or.inl hx)

theorem subset_satS (E : List (α × α)) (ok : α → Bool) : ∀ n (S : List α), ∀ x ∈ S, x ∈ satS E ok n S
  | 0, S => fun x hx => by simpa [satS] using hx
  | n + 1, S => fun x hx => by
    unfold satS
    split
    · exact hx
    · exact subset_satS E ok n _ x (subset_stepS E ok S x hx)

theorem sound_satS (E : List (α × α)) (ok : α → Bool) (P : α → Prop)
    (hstep : ∀ a b, P a → ok a = true → (a, b) ∈ E → P b) :
    ∀ n (S : List α), (∀ x ∈ S, P x) → ∀ x ∈ satS E ok n S, P x
  | 0, S, h => by simpa [satS] using h
  | n + 1, S, h => by
    unfold satS
    split
    · exact h
    · apply sound_satS E ok P hstep n
      intro x hx
      rcases (mem_stepS E ok S x).mp hx with hx | ⟨a, ha, hok, he⟩
      · exact h x hx
      · exact hstep a x (h a ha) hok he

theorem closed_of_same_length (E : List (α × α)) (ok : α → Bool) (S : List α)
    (h : (stepS E ok S).length = S.length) : Closed E ok S := by
  intro a b ha hok he
  apply addNew_same_length S _ h b
  simp only [List.mem_map, List.mem_filter, Bool.and_eq_true, decide_eq_true_eq]
  exact ⟨(a, b), ⟨he, ha, hok⟩, rfl⟩

theorem closed_satS (E : List (α × α)) (ok : α → Bool) (U : List α)
    (hU : ∀ a b, (a, b) ∈ E → b ∈ U) :
    ∀ n (S : List α), S.Nodup → (∀ x ∈ S, x ∈ U) → U.length < S.length + n → Closed E ok (satS E ok n S)
  | 0, S, hn, hs, hl => by
    have := length_le_of_nodup_subset S U hn hs
    omega
  | n + 1, S, hn, hs, hl => by
    unfold satS
    split
    · rename_i h; exact closed_of_same_length E ok S h
    · rename_i h
      apply closed_satS E ok U hU n
      · exact nodup_addNew _ _ hn
      · intro x hx
        rcases (mem_stepS E ok S x).mp hx with hx | ⟨a, _, _, he⟩
        · exact hs x hx
        · exact hU a x he
      · have := length_addNew_ge S ((E.filter (fun e => decide (e.1 ∈ S) && ok e.1)).map Prod.snd)
        have h' : S.length < (stepS E ok S).length := by
          unfold stepS at h ⊢; omega
        omega

theorem mem_reachSet (E : List (α × α)) (ok : α → Bool) (start : List α) (t : α) :
    t ∈ reachSet E ok start ↔ RT E ok start t := by
  constructor
  · intro h
    apply sound_satS E ok (RT E ok start) (fun a b ha hok he => RT.step ha hok he) _ (addNew [] start) _ t h
    intro x hx
    rw [mem_addNew] at hx
    rcases hx with hx | hx
    · simp at hx
    · exact RT.base hx
  · intro h
    have hU : ∀ a b, (a, b) ∈ E → b ∈ univS E start := by
      intro a b he; simp only [univS, List.mem_append, List.mem_map]; exact Or.inr ⟨(a, b), he, rfl⟩
    have hcl := closed_satS E ok (univS E start) hU ((univS E start).length + 1) (addNew [] start)
      (nodup_addNew [] start List.nodup_nil)
      (by intro x hx; rw [mem_addNew] at hx; rcases hx with hx | hx
          · simp at hx
          · simp [univS, hx])
      (by omega)
    induction h with
    | base ha =>
      exact subset_satS E ok _ _ _ ((mem_addNew [] start _).mpr (Or.inr ha))
    | step _ hok he ih => exact hcl _ _ ih hok he

/-- Reflexive-transitive closure from a single node. -/
def reachFrom (E : List (α × α)) (a : α) : List α := reachSet E (fun _ => true) [a]

def rtc (E : List (α × α)) (a b : α) : Bool := decide (b ∈ reachFrom E a)

theorem rtc_iff (E : List (α × α)) (a b : α) : rtc E a b = true ↔ RT E (fun _ => true) [a] b := by
  unfold rtc reachFrom
  rw [decide_eq_true_eq]
  exact mem_reachSet _ _ _ _

theorem rtc_refl (E : List (α × α)) (a : α) : rtc E a a = true :=
  (rtc_iff E a a).mpr (RT.base (by simp))

omit [DecidableEq α] in
theorem rt_trans (E : List (α × α)) (a b : α) (hab : RT E (fun _ => true) [a] b) :
    ∀ c, RT E (fun _ => true) [b] c → RT E (fun _ => true) [a] c := by
  intro c hbc
  induction hbc with
  | base h => simp at h; subst h; exact hab
  | step _ hok he ih => exact RT.step ih hok he

theorem rtc_trans (E : List (α × α)) (a b c : α) (h1 : rtc E a b = true) (h2 : rtc E b c = true) :
    rtc E a c = true :=
  (rtc_iff E a c).mpr (rt_trans E a b ((rtc_iff E a b).mp h1) c ((rtc_iff E b c).mp h2))

end Shape
