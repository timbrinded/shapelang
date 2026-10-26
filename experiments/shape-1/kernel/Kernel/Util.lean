import Kernel.Model
/-! String helpers, code identities, globs (A.3.3.3–4) and resource-code canon (A.12.4).
Executable layer: these are differential-tested, not proved. -/
namespace Shape

def strPrefix (p s : String) : Bool := p.toList.isPrefixOf s.toList
def strSuffix (p s : String) : Bool := p.toList.reverse.isPrefixOf s.toList.reverse
def dropChars (n : Nat) (s : String) : String := String.ofList (s.toList.drop n)

def splitChar (c : Char) (s : String) : List String :=
  let rec go (cur : List Char) (acc : List String) : List Char → List String
    | [] => (String.ofList cur.reverse :: acc).reverse
    | d :: ds => if d = c then go [] (String.ofList cur.reverse :: acc) ds else go (d :: cur) acc ds
  go [] [] s.toList

def lowerS (s : String) : String := String.ofList (s.toList.map Char.toLower)
def upperS (s : String) : String := String.ofList (s.toList.map Char.toUpper)

/-- Codepoint order on strings. -/
def strLt (a b : String) : Bool := lexLt (a.toList.map Char.toNat) (b.toList.map Char.toNat)

def sortStrs (l : List String) : List String :=
  (l.foldr (fun x acc => if acc.contains x then acc else x :: acc) []).foldr
    (fun x acc =>
      let rec ins : List String → List String
        | [] => [x]
        | y :: ys => if strLt y x then y :: ins ys else x :: y :: ys
      ins acc) []

/-! ### Code identities `lang:path[#symbol]` -/

def idLang (x : String) : String := (splitChar ':' x).headD ""

def idRest (x : String) : String :=
  match x.toList.dropWhile (· ≠ ':') with
  | _ :: r => String.ofList r
  | [] => x

def idPath (x : String) : String := (splitChar '#' (idRest x)).headD ""

def idSym (x : String) : String :=
  match (idRest x).toList.dropWhile (· ≠ '#') with
  | _ :: r => String.ofList r
  | [] => ""

def idIsFile (x : String) : Bool := idSym x == ""

/-- Last segment of a symbol (`.` for TS, `::` for Rust and Verus). -/
def symLast (sym : String) : String :=
  let segs := splitChar '.' sym
  let last := segs.getLastD sym
  let segs2 := splitChar ':' last
  segs2.getLastD last

def extOf (path : String) : String :=
  let base := (splitChar '/' path).getLastD path
  match splitChar '.' base with
  | [_] => ""
  | segs => segs.getLastD ""

def scriptExts : List String :=
  ["sh", "bash", "zsh", "fish", "py", "rb", "pl", "php", "ps1", "bat", "cmd", "sql", "swift", "go",
   "java", "kt", "scala", "c", "h", "cc", "cpp", "hpp", "cs", "lua", "r", "jl", "ex", "exs", "erl",
   "hs", "ml", "dart", "groovy", "zig", "html", "htm", "astro", "vue", "svelte"]

def scriptNames : List String := ["Makefile", "GNUmakefile", "Dockerfile", "Justfile"]

/-! ### Globs -/

inductive GTok | dstarSlash | dstar | star | qmark | lit (c : Char)

def tokenize : List Char → List GTok
  | '*' :: '*' :: '/' :: r => .dstarSlash :: tokenize r
  | '*' :: '*' :: r => .dstar :: tokenize r
  | '*' :: r => .star :: tokenize r
  | '?' :: r => .qmark :: tokenize r
  | c :: r => .lit c :: tokenize r
  | [] => []

def gmatch : List GTok → List Char → Bool
  | [], s => s.isEmpty
  | .lit c :: r, s => match s with
    | d :: s' => c == d && gmatch r s'
    | [] => false
  | .qmark :: r, s => match s with
    | _ :: s' => gmatch r s'
    | [] => false
  | .star :: r, s => (List.range (s.length + 1)).any fun i =>
      (s.take i).all (· != '/') && gmatch r (s.drop i)
  | .dstar :: r, s => (List.range (s.length + 1)).any fun i => gmatch r (s.drop i)
  | .dstarSlash :: r, s => (List.range (s.length + 1)).any fun i =>
      (i == 0 || (s.drop (i - 1)).head? == some '/') && gmatch r (s.drop i)

def globMatch (glob path : String) : Bool := gmatch (tokenize glob.toList) path.toList

def specificity (glob : String) : Nat :=
  ((splitChar '/' glob).takeWhile (fun seg => !(seg.toList.contains '*' || seg.toList.contains '?'))).length

/-! ### Resource codes `tag.kind("value")` -/

structure RCode where
  tag : String
  kind : String
  value : String

def unescapeQ : List Char → List Char
  | '\\' :: c :: r => c :: unescapeQ r
  | c :: r => c :: unescapeQ r
  | [] => []

def parseRC (s : String) : Option RCode :=
  let cs := s.toList
  let tag := cs.takeWhile (· ≠ '.')
  let rest := cs.drop (tag.length + 1)
  let kind := rest.takeWhile (· ≠ '(')
  let rest2 := rest.drop kind.length
  match rest2 with
  | '(' :: '"' :: body =>
    let rb := body.reverse
    match rb with
    | ')' :: '"' :: inner => some ⟨String.ofList tag, String.ofList kind, String.ofList (unescapeQ inner.reverse)⟩
    | _ => none
  | _ => none

def escQ (s : String) : String :=
  String.ofList (s.toList.flatMap fun c => if c = '"' then ['\\', '"'] else if c = '\\' then ['\\', '\\'] else [c])

def printRC (r : RCode) : String := r.tag ++ "." ++ r.kind ++ "(\"" ++ escQ r.value ++ "\")"

def sqlParts (v : List Char) : List String :=
  let rec go (fuel : Nat) (cs : List Char) (acc : List String) : List String :=
    match fuel with
    | 0 => acc.reverse
    | fuel + 1 =>
      match cs with
      | [] => acc.reverse
      | '"' :: r =>
        let inner := r.takeWhile (· ≠ '"')
        let r' := r.drop (inner.length + 1)
        let r'' := match r' with | '.' :: x => x | x => x
        go fuel r'' (String.ofList inner :: acc)
      | _ =>
        let seg := cs.takeWhile (· ≠ '.')
        let r' := cs.drop (seg.length + 1)
        go fuel r' (lowerS (String.ofList seg).trimAscii.toString :: acc)
  go (v.length + 1) v []

def canonValue (tk : String) (v : String) : String :=
  if v == "*" then v
  else if tk == "pg.table" then
    let ps := sqlParts v.toList
    let ps := if ps.length == 2 && ps.headD "" == "public" then ps.drop 1 else ps
    ".".intercalate ps
  else if tk == "mysql.table" || tk == "sqlite.table" then ".".intercalate (sqlParts v.toList)
  else if tk == "ts.call" then
    if strPrefix "globalThis." v then dropChars 11 v else v
  else if tk == "http.route" then
    let ws := (splitChar ' ' v).filter (· ≠ "")
    match ws with
    | m :: rest => " ".intercalate (upperS m :: rest)
    | [] => v
  else v

def canonRC (s : String) : String :=
  match parseRC s with
  | some r => printRC { r with value := canonValue (r.tag ++ "." ++ r.kind) r.value }
  | none => s

def rcTagKind (s : String) : String :=
  match parseRC s with
  | some r => r.tag ++ "." ++ r.kind
  | none => s

/-- `effect(p)` matches `t` iff tag and kind agree and p's value is `*` or equal. -/
def rcMatches (pat t : String) : Bool :=
  match parseRC pat, parseRC t with
  | some p, some r => p.tag == r.tag && p.kind == r.kind && (p.value == "*" || canonRC pat == canonRC t)
  | _, _ => false

end Shape
