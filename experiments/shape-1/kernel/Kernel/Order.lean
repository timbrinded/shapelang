/-! Canonical order and canonical sets.

`canon` turns any list into the strictly sorted, duplicate-free list of its members, under
the lexicographic order of a prefix-free encoding. Two lists with the same members have
the same `canon` (`canon_eq_of_setEq`), which is how `derive` is made invariant under
permutation and duplication of every input collection (T1). -/
namespace Shape

/-! ### Lexicographic order on `List Nat` -/

def lexLt : List Nat → List Nat → Bool
  | [], [] => false
  | [], _ :: _ => true
  | _ :: _, [] => false
  | a :: as, b :: bs => decide (a < b) || (decide (a = b) && lexLt as bs)

theorem lexLt_irrefl : ∀ l, lexLt l l = false
  | [] => rfl
  | a :: as => by simp [lexLt, lexLt_irrefl as]

theorem lexLt_trans : ∀ a b c, lexLt a b = true → lexLt b c = true → lexLt a c = true
  | [], [], _, h, _ => by simp [lexLt] at h
  | [], _ :: _, [], _, h => by simp [lexLt] at h
  | [], _ :: _, _ :: _, _, _ => rfl
  | _ :: _, [], _, h, _ => by simp [lexLt] at h
  | _ :: _, _ :: _, [], _, h => by simp [lexLt] at h
  | x :: xs, y :: ys, z :: zs, h1, h2 => by
    simp only [lexLt, Bool.or_eq_true, decide_eq_true_eq, Bool.and_eq_true] at h1 h2 ⊢
    rcases h1 with h1 | ⟨rfl, h1⟩ <;> rcases h2 with h2 | ⟨rfl, h2⟩
    · exact Or.inl (Nat.lt_trans h1 h2)
    · exact Or.inl h1
    · exact Or.inl h2
    · exact Or.inr ⟨rfl, lexLt_trans xs ys zs h1 h2⟩

theorem lexLt_total : ∀ a b, a ≠ b → lexLt a b = true ∨ lexLt b a = true
  | [], [], h => absurd rfl h
  | [], _ :: _, _ => Or.inl rfl
  | _ :: _, [], _ => Or.inr rfl
  | x :: xs, y :: ys, h => by
    simp only [lexLt, Bool.or_eq_true, decide_eq_true_eq, Bool.and_eq_true]
    by_cases hxy : x = y
    · subst hxy
      have : xs ≠ ys := fun e => h (by rw [e])
      rcases lexLt_total xs ys this with h' | h'
      · exact Or.inl (Or.inr ⟨rfl, h'⟩)
      · exact Or.inr (Or.inr ⟨rfl, h'⟩)
    · rcases Nat.lt_or_gt_of_ne hxy with h' | h'
      · exact Or.inl (Or.inl h')
      · exact Or.inr (Or.inl h')

theorem lexLt_asymm (a b : List Nat) (h1 : lexLt a b = true) (h2 : lexLt b a = true) : False := by
  have := lexLt_trans a b a h1 h2
  rw [lexLt_irrefl] at this
  exact Bool.false_ne_true this

/-! ### Prefix-free encodings -/

/-- A prefix-free, hence injective, encoding into `List Nat`. -/
class Enc (α : Type) where
  enc : α → List Nat
  pf : ∀ (a b : α) (r s : List Nat), enc a ++ r = enc b ++ s → a = b ∧ r = s

export Enc (enc)

theorem enc_inj {α} [Enc α] {a b : α} (h : enc a = enc b) : a = b :=
  (Enc.pf a b [] [] (by simp [h])).1

instance : Enc Nat where
  enc n := [n]
  pf a b r s h := by
    simp only [List.cons_append, List.nil_append, List.cons.injEq] at h
    exact h

instance : Enc Bool where
  enc b := [if b then 1 else 0]
  pf a b r s h := by
    cases a <;> cases b <;> simp_all

instance : Enc Int where
  enc i := match i with
    | .ofNat n => [0, n]
    | .negSucc n => [1, n]
  pf a b r s h := by
    cases a <;> cases b <;> simp_all

theorem map_toNat_inj : ∀ (l1 l2 : List Char), l1.map Char.toNat = l2.map Char.toNat → l1 = l2
  | [], [], _ => rfl
  | [], _ :: _, h => by simp at h
  | _ :: _, [], h => by simp at h
  | a :: as, b :: bs, h => by
    simp only [List.map_cons, List.cons.injEq] at h
    rw [Char.toNat_inj.mp h.1, map_toNat_inj as bs h.2]

instance : Enc String where
  enc s := s.toList.length :: s.toList.map Char.toNat
  pf a b r s h := by
    simp only [List.cons_append, List.cons.injEq] at h
    obtain ⟨hl, h⟩ := h
    have hl' : (a.toList.map Char.toNat).length = (b.toList.map Char.toNat).length := by
      simp [hl]
    obtain ⟨h1, h2⟩ := List.append_inj h hl'
    exact ⟨String.toList_injective (map_toNat_inj _ _ h1), h2⟩

instance {α β} [Enc α] [Enc β] : Enc (α × β) where
  enc p := enc p.1 ++ enc p.2
  pf a b r s h := by
    simp only [List.append_assoc] at h
    obtain ⟨h1, h⟩ := Enc.pf a.1 b.1 _ _ h
    obtain ⟨h2, h3⟩ := Enc.pf a.2 b.2 _ _ h
    exact ⟨Prod.ext h1 h2, h3⟩

instance {α} [Enc α] : Enc (Option α) where
  enc o := match o with
    | none => [0]
    | some a => 1 :: enc a
  pf a b r s h := by
    cases a <;> cases b <;> simp_all
    exact Enc.pf _ _ _ _ h

def encList {α} [Enc α] : List α → List Nat
  | [] => []
  | a :: as => enc a ++ encList as

theorem encList_pf {α} [Enc α] : ∀ (a b : List α) (r s : List Nat), a.length = b.length →
    encList a ++ r = encList b ++ s → a = b ∧ r = s
  | [], [], _, _, _, h => ⟨rfl, by simpa [encList] using h⟩
  | [], _ :: _, _, _, hl, _ => by simp at hl
  | _ :: _, [], _, _, hl, _ => by simp at hl
  | x :: xs, y :: ys, r, s, hl, h => by
    simp only [encList, List.append_assoc] at h
    obtain ⟨h1, h⟩ := Enc.pf x y _ _ h
    obtain ⟨h2, h3⟩ := encList_pf xs ys r s (by simpa using hl) h
    exact ⟨by rw [h1, h2], h3⟩

instance {α} [Enc α] : Enc (List α) where
  enc l := l.length :: encList l
  pf a b r s h := by
    simp only [List.cons_append, List.cons.injEq] at h
    exact encList_pf a b r s h.1 h.2

/-- Transport an encoding along an injective map (used for structures and enumerations). -/
@[reducible] def Enc.ofInj {α β} [Enc β] (f : α → β) (hf : ∀ a b, f a = f b → a = b) : Enc α where
  enc a := enc (f a)
  pf a b r s h := by
    obtain ⟨h1, h2⟩ := Enc.pf (f a) (f b) r s h
    exact ⟨hf a b h1, h2⟩

/-! ### Canonical sets -/

def encLt {α} [Enc α] (a b : α) : Bool := lexLt (enc a) (enc b)

theorem encLt_irrefl {α} [Enc α] (a : α) : encLt a a = false := lexLt_irrefl _

theorem encLt_trans {α} [Enc α] (a b c : α) : encLt a b = true → encLt b c = true → encLt a c = true :=
  lexLt_trans _ _ _

theorem encLt_total {α} [Enc α] (a b : α) (h : a ≠ b) : encLt a b = true ∨ encLt b a = true :=
  lexLt_total _ _ (fun e => h (enc_inj e))

theorem encLt_asymm {α} [Enc α] (a b : α) : encLt a b = true → encLt b a = true → False :=
  lexLt_asymm _ _

/-- Insert into a strictly ascending list, dropping duplicates. -/
def insertC {α} [Enc α] [DecidableEq α] (x : α) : List α → List α
  | [] => [x]
  | y :: ys => if x = y then y :: ys else if encLt x y then x :: y :: ys else y :: insertC x ys

def canon {α} [Enc α] [DecidableEq α] (l : List α) : List α := l.foldr insertC []

theorem mem_insertC {α} [Enc α] [DecidableEq α] (x z : α) :
    ∀ l, z ∈ insertC x l ↔ z = x ∨ z ∈ l
  | [] => by simp [insertC]
  | y :: ys => by
    unfold insertC
    by_cases h1 : x = y
    · subst h1; simp
    · by_cases h2 : encLt x y = true
      · simp [h1, h2]
      · simp only [h1, h2, ite_false, Bool.false_eq_true, List.mem_cons, mem_insertC x z ys]
        constructor
        · rintro (h | h | h) <;> simp [h]
        · rintro (h | h | h) <;> simp [h]

theorem mem_canon {α} [Enc α] [DecidableEq α] (x : α) : ∀ l, x ∈ canon l ↔ x ∈ l
  | [] => by simp [canon]
  | y :: ys => by
    show x ∈ insertC y (canon ys) ↔ _
    rw [mem_insertC, mem_canon x ys]
    simp

abbrev Sorted {α} [Enc α] (l : List α) : Prop := l.Pairwise (fun a b => encLt a b = true)

theorem sorted_insertC {α} [Enc α] [DecidableEq α] (x : α) : ∀ l, Sorted l → Sorted (insertC x l)
  | [], _ => by simp [insertC]
  | y :: ys, h => by
    unfold insertC
    by_cases h1 : x = y
    · simp [h1, h]
    · by_cases h2 : encLt x y = true
      · simp only [h1, h2, ite_false, ite_true]
        refine List.Pairwise.cons ?_ h
        intro z hz
        rcases List.mem_cons.mp hz with rfl | hz
        · exact h2
        · exact encLt_trans _ _ _ h2 (List.rel_of_pairwise_cons h hz)
      · simp only [h1, h2, ite_false, Bool.false_eq_true]
        have hyx : encLt y x = true := by
          rcases encLt_total x y h1 with h' | h'
          · exact absurd h' h2
          · exact h'
        refine List.Pairwise.cons ?_ (sorted_insertC x ys h.tail)
        intro z hz
        rcases (mem_insertC x z ys).mp hz with rfl | hz
        · exact hyx
        · exact List.rel_of_pairwise_cons h hz

theorem sorted_canon {α} [Enc α] [DecidableEq α] : ∀ l : List α, Sorted (canon l)
  | [] => by simp [canon]
  | y :: ys => sorted_insertC y (canon ys) (sorted_canon ys)

/-- Two strictly sorted lists with the same members are equal. -/
theorem sorted_ext {α} [Enc α] : ∀ (l1 l2 : List α), Sorted l1 → Sorted l2 →
    (∀ x, x ∈ l1 ↔ x ∈ l2) → l1 = l2
  | [], [], _, _, _ => rfl
  | [], b :: _, _, _, h => by have := (h b).mpr (by simp); simp at this
  | a :: _, [], _, _, h => by have := (h a).mp (by simp); simp at this
  | a :: as, b :: bs, h1, h2, h => by
    have ha : a ∈ b :: bs := (h a).mp (by simp)
    have hb : b ∈ a :: as := (h b).mpr (by simp)
    have hab : a = b := by
      rcases List.mem_cons.mp ha with e | ha
      · exact e
      · rcases List.mem_cons.mp hb with e | hb
        · exact e.symm
        · exact absurd (encLt_asymm a b (List.rel_of_pairwise_cons h1 hb)
            (List.rel_of_pairwise_cons h2 ha)) id
    subst hab
    have hnot1 : a ∉ as := fun m => by
      have := List.rel_of_pairwise_cons h1 m; rw [encLt_irrefl] at this; exact Bool.false_ne_true this
    have hnot2 : a ∉ bs := fun m => by
      have := List.rel_of_pairwise_cons h2 m; rw [encLt_irrefl] at this; exact Bool.false_ne_true this
    have : as = bs := sorted_ext as bs h1.tail h2.tail (fun x => by
      constructor
      · intro hx
        have := (h x).mp (List.mem_cons_of_mem a hx)
        rcases List.mem_cons.mp this with e | e
        · subst e; exact absurd hx hnot1
        · exact e
      · intro hx
        have := (h x).mpr (List.mem_cons_of_mem a hx)
        rcases List.mem_cons.mp this with e | e
        · subst e; exact absurd hx hnot2
        · exact e)
    rw [this]

def SetEq {α} (l1 l2 : List α) : Prop := ∀ x, x ∈ l1 ↔ x ∈ l2

theorem SetEq.refl {α} (l : List α) : SetEq l l := fun _ => Iff.rfl

theorem setEq_of_perm {α} {l1 l2 : List α} (h : l1.Perm l2) : SetEq l1 l2 := fun _ => h.mem_iff

theorem canon_eq_of_setEq {α} [Enc α] [DecidableEq α] {l1 l2 : List α} (h : SetEq l1 l2) :
    canon l1 = canon l2 :=
  sorted_ext _ _ (sorted_canon l1) (sorted_canon l2) (fun x => by
    rw [mem_canon, mem_canon]; exact h x)

theorem canon_perm {α} [Enc α] [DecidableEq α] {l1 l2 : List α} (h : l1.Perm l2) :
    canon l1 = canon l2 := canon_eq_of_setEq (setEq_of_perm h)

end Shape
