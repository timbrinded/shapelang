import Kernel.Model
/-! String helpers, sorting, code identities, globs (A.3.3.3–4), resource-code canon and
carriers (A.12.4), channel application (A.4.5.3), base64 and time.
Executable layer: these are differential-tested, not proved. -/
namespace Shape

def strPrefix (p s : String) : Bool := p.toList.isPrefixOf s.toList
def strSuffix (p s : String) : Bool := p.toList.reverse.isPrefixOf s.toList.reverse
def dropChars (n : Nat) (s : String) : String := String.ofList (s.toList.drop n)
def takeChars (n : Nat) (s : String) : String := String.ofList (s.toList.take n)
def dropRight (n : Nat) (s : String) : String := String.ofList (s.toList.take (s.length - n))

def splitChar (c : Char) (s : String) : List String :=
  let rec go (cur : List Char) (acc : List String) : List Char → List String
    | [] => (String.ofList cur.reverse :: acc).reverse
    | d :: ds => if d = c then go [] (String.ofList cur.reverse :: acc) ds else go (d :: cur) acc ds
  go [] [] s.toList

/-- Split on a separator string (non-empty). -/
def splitOn (sep : String) (s : String) : List String :=
  let sc := sep.toList
  let rec go (fuel : Nat) (cur : List Char) (acc : List String) (cs : List Char) : List String :=
    match fuel with
    | 0 => (String.ofList (cur.reverse ++ cs) :: acc).reverse
    | fuel + 1 =>
      match cs with
      | [] => (String.ofList cur.reverse :: acc).reverse
      | d :: ds =>
        if sc.isPrefixOf cs then go fuel [] (String.ofList cur.reverse :: acc) (cs.drop sc.length)
        else go fuel (d :: cur) acc ds
  go (s.length + 1) [] [] s.toList

def lowerS (s : String) : String := String.ofList (s.toList.map Char.toLower)
def upperS (s : String) : String := String.ofList (s.toList.map Char.toUpper)
def trimS (s : String) : String := s.trimAscii.toString

def containsSub (sub s : String) : Bool :=
  let sc := sub.toList
  let rec go : List Char → Bool
    | [] => sc.isEmpty
    | cs@(_ :: r) => sc.isPrefixOf cs || go r
  go s.toList

/-! ### Sorting (codepoint order, A.0.2) -/

/-- Codepoint order on strings. -/
def strLt (a b : String) : Bool := decide (a < b)

def strLe (a b : String) : Bool := !strLt b a

def dedupSorted {α} [BEq α] : List α → List α
  | a :: b :: rest => if a == b then dedupSorted (b :: rest) else a :: dedupSorted (b :: rest)
  | l => l

/-- Sorted, duplicate-free. -/
def sortStrs (l : List String) : List String := dedupSorted (l.mergeSort strLe)

def lexStrLt : List String → List String → Bool
  | [], [] => false
  | [], _ :: _ => true
  | _ :: _, [] => false
  | a :: as, b :: bs => strLt a b || (a == b && lexStrLt as bs)

/-- Stable sort by a string-list key. -/
def sortOnL {α} (key : α → List String) (l : List α) : List α :=
  (l.map (fun x => (key x, x))).mergeSort (fun a b => !lexStrLt b.1 a.1) |>.map (·.2)

def sortOn {α} (key : α → String) (l : List α) : List α := sortOnL (fun x => [key x]) l

def insertBy' {α} (lt : α → α → Bool) (x : α) : List α → List α
  | [] => [x]
  | y :: ys => if lt y x then y :: insertBy' lt x ys else x :: y :: ys

/-- Stable sort by a strict order. -/
def sortWith {α} (lt : α → α → Bool) (l : List α) : List α := l.mergeSort (fun a b => !lt b a)

def minWith? {α} (lt : α → α → Bool) : List α → Option α
  | [] => none
  | x :: xs => some (xs.foldl (fun b y => if lt y b then y else b) x)

def subsetS (a b : List String) : Bool := a.all (b.contains ·)
def interS (a b : List String) : List String := a.filter (b.contains ·)
def uniq {α} [BEq α] (l : List α) : List α := l.foldl (fun acc x => if acc.contains x then acc else acc ++ [x]) []

/-! ### Code identities `lang:path[#symbol]` (A.12.1.2) -/

def idLang (x : String) : String :=
  match x.toList.findIdx? (· == ':') with
  | some i => takeChars i x
  | none => ""

def idRest (x : String) : String :=
  match x.toList.dropWhile (· ≠ ':') with
  | _ :: r => String.ofList r
  | [] => x

def pctDecode (s : String) : String :=
  let rec go : List Char → List Char
    | '%' :: '2' :: '3' :: r => '#' :: go r
    | '%' :: '2' :: '5' :: r => '%' :: go r
    | '%' :: '2' :: 'E' :: r => '.' :: go r
    | '%' :: '2' :: 'e' :: r => '.' :: go r
    | c :: r => c :: go r
    | [] => []
  String.ofList (go s.toList)

/-- The repository path of an identity (percent-decoded). -/
def idPath (x : String) : String := pctDecode ((splitChar '#' (idRest x)).headD "")

def idSym (x : String) : Option String :=
  match (idRest x).toList.dropWhile (· ≠ '#') with
  | _ :: r => some (String.ofList r)
  | [] => none

def idIsFile (x : String) : Bool := (idSym x).isNone

/-- The file identity of x (`lang:path`). -/
def idFile (x : String) : String := (splitChar '#' x).headD x

/-- Last segment of a symbol (`.` for TS, `::` for Rust and Verus), decoded. -/
def symLast (lang sym : String) : String :=
  let seg := if lang == "rust" || lang == "verus" then (splitOn "::" sym).getLastD sym
             else (splitChar '.' sym).getLastD sym
  pctDecode seg

/-- parentOf by spelling (A.12.2.3): drop the last symbol segment, then the `#…`. -/
def parentOfId (x : String) : Option String :=
  match idSym x with
  | none => none
  | some sym =>
    let lang := idLang x
    let file := idFile x
    if lang == "rust" || lang == "verus" then
      let segs := splitOn "::" sym
      if segs.length ≤ 1 then some file else some (file ++ "#" ++ "::".intercalate segs.dropLast)
    else
      let segs := splitChar '.' sym
      if segs.length ≤ 1 then some file else some (file ++ "#" ++ ".".intercalate segs.dropLast)

def registeredLangs : List String := ["ts", "rust", "verus"]

/-! ### Globs (A.3.3.3) as NFAs -/

inductive GTok | dstarSlash | dstar | star | qmark | lit (c : Char)
deriving Repr, Inhabited

def tokenize : List Char → List GTok
  | '*' :: '*' :: '/' :: r => .dstarSlash :: tokenize r
  | '*' :: '*' :: r => .dstar :: tokenize r
  | '*' :: r => .star :: tokenize r
  | '?' :: r => .qmark :: tokenize r
  | c :: r => .lit c :: tokenize r
  | [] => []

/-- Transition predicate: a literal, any character but `/`, or any character. -/
inductive Pred | lit (c : Char) | notSlash | any
deriving Repr, Inhabited, BEq

def Pred.holds : Pred → Char → Bool
  | .lit c, d => c == d
  | .notSlash, d => d != '/'
  | .any, _ => true

structure Nfa where
  trans : Array (List (Pred × Nat))
  eps : Array (List Nat)
  accept : Nat
deriving Repr, Inhabited

def buildNfa (glob : String) : Nfa := Id.run do
  let mut trans : Array (List (Pred × Nat)) := #[[]]
  let mut eps : Array (List Nat) := #[[]]
  let mut cur := 0
  for tok in tokenize glob.toList do
    let next := trans.size
    trans := trans.push []
    eps := eps.push []
    match tok with
    | .lit c => trans := trans.modify cur (fun l => l ++ [(.lit c, next)])
    | .qmark => trans := trans.modify cur (fun l => l ++ [(.any, next)])
    | .star =>
      trans := trans.modify cur (fun l => l ++ [(.notSlash, cur)])
      eps := eps.modify cur (fun l => l ++ [next])
    | .dstar =>
      trans := trans.modify cur (fun l => l ++ [(.any, cur)])
      eps := eps.modify cur (fun l => l ++ [next])
    | .dstarSlash =>
      let mid := trans.size
      trans := trans.push []
      eps := eps.push []
      eps := eps.modify cur (fun l => l ++ [next])
      trans := trans.modify cur (fun l => l ++ [(.lit '/', next), (.any, mid)])
      trans := trans.modify mid (fun l => l ++ [(.any, mid), (.lit '/', next)])
    cur := next
  return { trans := trans, eps := eps, accept := cur }

partial def Nfa.closure (n : Nfa) (states : List Nat) : List Nat :=
  let rec go (stack : List Nat) (seen : List Nat) : List Nat :=
    match stack with
    | [] => seen
    | s :: rest => if seen.contains s then go rest seen else go ((n.eps.getD s []) ++ rest) (s :: seen)
  (go states []).mergeSort (· ≤ ·)

def Nfa.step (n : Nfa) (states : List Nat) (c : Char) : List Nat :=
  n.closure (states.flatMap fun s => (n.trans.getD s []).filterMap fun (p, t) => if p.holds c then some t else none)

def Nfa.matches (n : Nfa) (s : String) : Bool :=
  (s.toList.foldl (fun st c => if st.isEmpty then st else n.step st c) (n.closure [0])).contains n.accept

def globMatch (glob path : String) : Bool := (buildNfa glob).matches path

/-- Specificity (A.3.3.4): leading wildcard-free segments; a literal path counts all. -/
def specificity (glob : String) : Nat :=
  ((splitChar '/' glob).takeWhile (fun seg => !(seg.toList.contains '*' || seg.toList.contains '?'))).length

def literalChars (glob : String) : List Char :=
  (tokenize glob.toList).filterMap fun t => match t with | .lit c => some c | _ => none

/-! ### Resource codes `tag.kind("value")` (A.3.3.7, A.12.4) -/

structure RCode where
  tag : String
  kind : String
  value : String
deriving Repr, Inhabited

def isIdentStart (c : Char) : Bool := c.isAlpha || c == '_'
def isIdentChar (c : Char) : Bool := c.isAlphanum || c == '_' || c == '-'

/-- Parse `tag.kind("<JSON string body>")`. -/
def parseRC (s0 : String) : Option RCode :=
  let cs := (trimS s0).toList
  let tag := cs.takeWhile isIdentChar
  if tag.isEmpty || !isIdentStart (tag.headD ' ') then none else
  match cs.drop tag.length with
  | '.' :: rest =>
    let kind := rest.takeWhile isIdentChar
    if kind.isEmpty then none else
    match rest.drop kind.length with
    | '(' :: '"' :: body =>
      match body.reverse with
      | ')' :: '"' :: inner =>
        match parseStrBody [] (inner.reverse ++ ['"']) with
        | .ok (v, []) => some ⟨String.ofList tag, String.ofList kind, v⟩
        | _ => none
      | _ => none
    | _ => none
  | _ => none

def printRC (r : RCode) : String := r.tag ++ "." ++ r.kind ++ "(" ++ jsonStr r.value ++ ")"

/-- SQL identifier parts: quoted parts keep case (`""` escapes `"`), others are trimmed. -/
def sqlParts (v : String) : List (String × Bool) :=
  let rec go (fuel : Nat) (cs : List Char) (acc : List (String × Bool)) : List (String × Bool) :=
    match fuel with
    | 0 => acc.reverse
    | fuel + 1 =>
      match cs with
      | [] => acc.reverse
      | '"' :: r =>
        let rec q (fuel : Nat) (cs : List Char) (t : List Char) : List Char × List Char :=
          match fuel with
          | 0 => (t.reverse, [])
          | fuel + 1 =>
            match cs with
            | '"' :: '"' :: r => q fuel r ('"' :: t)
            | '"' :: r => (t.reverse, r)
            | c :: r => q fuel r (c :: t)
            | [] => (t.reverse, [])
        let (t, r') := q (r.length + 1) r []
        let r'' := match r' with | '.' :: x => x | x => x
        go fuel r'' ((String.ofList t, true) :: acc)
      | _ =>
        let seg := cs.takeWhile (· ≠ '.')
        let r' := cs.drop (seg.length + 1)
        go fuel r' ((trimS (String.ofList seg), false) :: acc)
  go (v.length + 1) v.toList []

def canonSqlTable (v : String) (stripPublic : Bool) : String :=
  let ps := (sqlParts v).map fun (t, q) => if q then t else lowerS t
  let ps := if stripPublic && ps.length == 2 && ps.headD "" == "public" then ps.drop 1 else ps
  ".".intercalate ps

/-- `{…}` → `{}`, `:name` → `{}` in a route path. -/
partial def routeFix : List Char → List Char
  | '{' :: r => '{' :: '}' :: routeFix ((r.dropWhile (· ≠ '}')).drop 1)
  | ':' :: c :: r =>
    if isIdentStart c then '{' :: '}' :: routeFix ((c :: r).dropWhile (fun d => d.isAlphanum || d == '_'))
    else ':' :: routeFix (c :: r)
  | c :: r => c :: routeFix r
  | [] => []

def canonRoute (v : String) : String :=
  let t := trimS v
  let m := t.toList.takeWhile Char.isAlpha
  let rest := (t.toList.drop m.length)
  if m.isEmpty || !(rest.headD 'x').isWhitespace then v else
  let path := trimS (String.ofList rest)
  if path.isEmpty then v else
  upperS (String.ofList m) ++ " " ++ String.ofList (routeFix path.toList)

/-- canon: a pure string function per registry entry; `*` (channel wildcard) is kept. -/
def canonRC? (s : String) : Option String :=
  (parseRC s).map fun r =>
    if r.value == "*" then printRC r else
    let key := r.tag ++ "." ++ r.kind
    let v := if key == "pg.table" then canonSqlTable r.value true
      else if key == "mysql.table" || key == "sqlite.table" then canonSqlTable r.value false
      else if key == "ts.call" then (if strPrefix "globalThis." r.value then dropChars 11 r.value else r.value)
      else if key == "http.route" then canonRoute r.value
      else r.value
    printRC { r with value := v }

def canonRC (s : String) : String := (canonRC? s).getD s

def rcTagKind (s : String) : String :=
  match parseRC s with
  | some r => r.tag ++ "." ++ r.kind
  | none => s

/-- `effect(p)` matches `t` iff tag and kind agree and p's value is `*` or canonically equal. -/
def rcMatches (pat t : String) : Bool :=
  match parseRC pat, parseRC t with
  | some p, some r => p.tag == r.tag && p.kind == r.kind && (p.value == "*" || canonRC pat == canonRC t)
  | _, _ => false

/-- Carriers per registry kind (A.12.4): languages, whether raw executables and command code
    carry it, and raw extensions that carry it. Unregistered kinds have no carriers [D3]. -/
structure Carriers where
  langs : List String
  all : Bool
  rawCarrier : Bool
  rawExts : List String

def carriers (t : String) : Carriers :=
  let k := rcTagKind t
  if k == "pg.table" || k == "mysql.table" || k == "sqlite.table" then ⟨["ts", "rust", "verus"], false, true, []⟩
  else if k == "ts.call" then ⟨["ts"], false, false, ["html", "htm", "astro", "vue", "svelte"]⟩
  else if k == "http.route" then ⟨[], true, true, []⟩
  else ⟨[], false, false, []⟩

def extOf (path : String) : String :=
  let base := (splitChar '/' path).getLastD path
  match splitChar '.' base with
  | [_] => ""
  | segs => segs.getLastD ""

/-! ### Channels -/

/-- Channel strings: `effect(<rc>)`, `call(<L>)`, `call(*)`, `hatch(<L>)`, `edge(<k>)`,
    `edge(<k>, <rc>)`. -/
def chanInner (pre ch : String) : Option String :=
  if strPrefix pre ch && strSuffix ")" ch then some (dropRight 1 (dropChars pre.length ch)) else none

/-- Does channel t apply to identity x (A.4.5.3)? Returns the instantiated channel. -/
def channelAt (t : String) (i : IdInfo) : Option String :=
  let registered := registeredLangs.contains i.lang
  let command := i.lang == "pkgjson" || i.lang == "gha"
  let rawExec := i.lang == "raw" && i.executable
  let executable := registered || rawExec || (command && i.executable)
  if t == "call(*)" then (if registered then some ("call(" ++ i.lang ++ ")") else none)
  else match chanInner "call(" t with
  | some l => if i.lang == l then some t else none
  | none => match chanInner "hatch(" t with
    | some l => if i.lang == l then some t else none
    | none => match chanInner "effect(" t with
      | some rc =>
        let car := carriers rc
        if registered && (car.all || car.langs.contains i.lang) then some t
        else if (rawExec || (command && i.executable)) && car.rawCarrier then some t
        else if i.lang == "raw" && car.rawExts.contains (extOf i.path) then some t
        else none
      | none => if strPrefix "edge(" t then (if executable then some t else none) else none

/-- Does a provider's declared channel `d` match a needed channel `n` (A.5.2.3)? -/
def channelMatchesDecl (d n : String) : Bool :=
  if d == n then true else
  match chanInner "effect(" d, chanInner "effect(" n with
  | some p, some t => rcMatches p t
  | _, _ =>
    match chanInner "edge(" d, chanInner "edge(" n with
    | some dd, some nn =>
      let ds := splitOn ", " dd
      let ns := splitOn ", " nn
      match ds, ns with
      | [k1], k2 :: _ => k1 == k2
      | [k1, p], [k2, t] => k1 == k2 && rcMatches p t
      | _, _ => false
    | _, _ => false

def channelCovered (declared : List String) (needed : String) : Bool :=
  declared.any fun d =>
    if needed == "call(*)" then strPrefix "call(" d else channelMatchesDecl d needed

/-! ### Base64 (DSSE payloads) -/

def b64Val (c : Char) : Option Nat :=
  if 'A' ≤ c ∧ c ≤ 'Z' then some (c.toNat - 65)
  else if 'a' ≤ c ∧ c ≤ 'z' then some (c.toNat - 71)
  else if '0' ≤ c ∧ c ≤ '9' then some (c.toNat + 4)
  else if c == '+' || c == '-' then some 62
  else if c == '/' || c == '_' then some 63
  else none

def b64Decode (s : String) : ByteArray := Id.run do
  let mut out : ByteArray := ByteArray.empty
  let mut acc : Nat := 0
  let mut bits : Nat := 0
  for c in s.toList do
    match b64Val c with
    | some v =>
      acc := (acc <<< 6) ||| v
      bits := bits + 6
      if bits ≥ 8 then
        bits := bits - 8
        out := out.push (UInt8.ofNat ((acc >>> bits) % 256))
        acc := acc % (1 <<< bits)
    | none => pure ()
  return out

def b64DecodeStr (s : String) : Option String := String.fromUTF8? (b64Decode s)

/-! ### Time (RFC 3339 UTC seconds, A.0.5) -/

def daysFromCivil (y m d : Int) : Int :=
  let y := if m ≤ 2 then y - 1 else y
  let era := (if y ≥ 0 then y else y - 399) / 400
  let yoe := y - era * 400
  let mp := if m > 2 then m - 3 else m + 9
  let doy := (153 * mp + 2) / 5 + d - 1
  let doe := yoe * 365 + yoe / 4 - yoe / 100 + doy
  era * 146097 + doe - 719468

def digitsVal (cs : List Char) : Int := cs.foldl (fun a c => a * 10 + (c.toNat - 48 : Nat)) 0

def parseRfc3339 (s : String) : Int :=
  let cs := s.toList
  let num (a b : Nat) := digitsVal ((cs.drop a).take (b - a))
  let y := num 0 4
  let mo := num 5 7
  let d := num 8 10
  let hasT := cs.length ≥ 19
  let hh := if hasT then num 11 13 else 0
  let mi := if hasT then num 14 16 else 0
  let ss := if hasT then num 17 19 else 0
  -- fraction and offset
  let rest := (cs.drop 19).dropWhile (fun c => c == '.' || c.isDigit)
  let off : Int := match rest with
    | '+' :: a :: b :: ':' :: c :: d :: _ => digitsVal [a, b] * 3600 + digitsVal [c, d] * 60
    | '-' :: a :: b :: ':' :: c :: d :: _ => -(digitsVal [a, b] * 3600 + digitsVal [c, d] * 60)
    | _ => 0
  daysFromCivil y mo d * 86400 + hh * 3600 + mi * 60 + ss - off

def parseTime (j : J) : Int :=
  match j with
  | .num n => n
  | .str s => parseRfc3339 s
  | _ => 0

/-- ceil(a / b) for b > 0. -/
def ceilDiv (a b : Int) : Int := if a ≥ 0 then (a + b - 1) / b else -((-a) / b)

end Shape
