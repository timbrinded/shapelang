import Kernel.Order
/-! A minimal JSON value, an RFC 8259 parser and an RFC 8785 (JCS) printer for the
float-free values Shape hashes and prints. Executable layer: no proofs depend on it. -/
namespace Shape

inductive J where
  | null
  | bool (b : Bool)
  | num (n : Int)
  | str (s : String)
  | arr (xs : List J)
  | obj (kvs : List (String × J))
deriving Inhabited, Repr

namespace J

def get? (j : J) (k : String) : Option J :=
  match j with
  | obj kvs => (kvs.find? (·.1 == k)).map (·.2)
  | _ => none

def getD (j : J) (k : String) : J := (j.get? k).getD null

def str? : J → Option String
  | str s => some s
  | _ => none

def num? : J → Option Int
  | num n => some n
  | _ => none

def bool? : J → Option Bool
  | bool b => some b
  | _ => none

def arr? : J → Option (List J)
  | arr xs => some xs
  | _ => none

def isNull : J → Bool
  | null => true
  | _ => false

def strD (j : J) (k : String) (d : String := "") : String := ((j.get? k).bind str?).getD d
def strs (j : J) (k : String) : List String := (((j.get? k).bind arr?).getD []).filterMap str?
def arrD (j : J) (k : String) : List J := ((j.get? k).bind arr?).getD []
def boolD (j : J) (k : String) (d : Bool := false) : Bool := ((j.get? k).bind bool?).getD d
def numD (j : J) (k : String) (d : Int := 0) : Int := ((j.get? k).bind num?).getD d
def optStr (j : J) (k : String) : Option String := (j.get? k).bind str?

end J

/-! ### JCS printing -/

def hexDigit (n : Nat) : Char :=
  if n < 10 then Char.ofNat (48 + n) else Char.ofNat (87 + n)

def hex2 (n : Nat) : String := String.ofList [hexDigit (n / 16 % 16), hexDigit (n % 16)]

def escChar (c : Char) : List Char :=
  if c = '"' then ['\\', '"']
  else if c = '\\' then ['\\', '\\']
  else if c.toNat = 8 then ['\\', 'b']
  else if c.toNat = 12 then ['\\', 'f']
  else if c = '\n' then ['\\', 'n']
  else if c = '\r' then ['\\', 'r']
  else if c = '\t' then ['\\', 't']
  else if c.toNat < 32 then ['\\', 'u', '0', '0'] ++ (hex2 c.toNat).toList
  else [c]

def jsonStr (s : String) : String := String.ofList ('"' :: (s.toList.flatMap escChar) ++ ['"'])

/-- UTF-16 code units, the JCS key order. -/
def utf16 (s : String) : List Nat :=
  s.toList.flatMap fun c =>
    let n := c.toNat
    if n < 0x10000 then [n] else
      let m := n - 0x10000
      [0xD800 + m / 0x400, 0xDC00 + m % 0x400]

def insertBy {α} (lt : α → α → Bool) (x : α) : List α → List α
  | [] => [x]
  | y :: ys => if lt y x then y :: insertBy lt x ys else x :: y :: ys

def sortBy {α} (lt : α → α → Bool) (l : List α) : List α := l.foldr (insertBy lt) []

partial def J.jcs : J → String
  | .null => "null"
  | .bool b => if b then "true" else "false"
  | .num n => toString n
  | .str s => jsonStr s
  | .arr xs => "[" ++ ",".intercalate (xs.map J.jcs) ++ "]"
  | .obj kvs =>
    let sorted := sortBy (fun a b => lexLt (utf16 a.1) (utf16 b.1)) kvs
    "{" ++ ",".intercalate (sorted.map fun (k, v) => jsonStr k ++ ":" ++ v.jcs) ++ "}"

/-! ### Parsing -/

def isWs (c : Char) : Bool := c = ' ' || c = '\n' || c = '\r' || c = '\t'

def skipWs : List Char → List Char
  | c :: cs => if isWs c then skipWs cs else c :: cs
  | [] => []

def hexVal (c : Char) : Option Nat :=
  if '0' ≤ c ∧ c ≤ '9' then some (c.toNat - 48)
  else if 'a' ≤ c ∧ c ≤ 'f' then some (c.toNat - 87)
  else if 'A' ≤ c ∧ c ≤ 'F' then some (c.toNat - 55)
  else none

def hex4 : List Char → Option (Nat × List Char)
  | a :: b :: c :: d :: rest => do
    let va ← hexVal a; let vb ← hexVal b; let vc ← hexVal c; let vd ← hexVal d
    pure (((va * 16 + vb) * 16 + vc) * 16 + vd, rest)
  | _ => none

partial def parseStrBody (acc : List Char) : List Char → Except String (String × List Char)
  | '"' :: rest => .ok (String.ofList acc.reverse, rest)
  | '\\' :: c :: rest =>
    match c with
    | '"' => parseStrBody ('"' :: acc) rest
    | '\\' => parseStrBody ('\\' :: acc) rest
    | '/' => parseStrBody ('/' :: acc) rest
    | 'b' => parseStrBody (Char.ofNat 8 :: acc) rest
    | 'f' => parseStrBody (Char.ofNat 12 :: acc) rest
    | 'n' => parseStrBody ('\n' :: acc) rest
    | 'r' => parseStrBody ('\r' :: acc) rest
    | 't' => parseStrBody ('\t' :: acc) rest
    | 'u' =>
      match hex4 rest with
      | none => .error "bad \\u escape"
      | some (hi, rest') =>
        if 0xD800 ≤ hi ∧ hi < 0xDC00 then
          match rest' with
          | '\\' :: 'u' :: rest'' =>
            match hex4 rest'' with
            | some (lo, rest3) =>
              if 0xDC00 ≤ lo ∧ lo < 0xE000 then
                parseStrBody (Char.ofNat (0x10000 + (hi - 0xD800) * 0x400 + (lo - 0xDC00)) :: acc) rest3
              else .error "bad surrogate pair"
            | none => .error "bad \\u escape"
          | _ => .error "lone surrogate"
        else parseStrBody (Char.ofNat hi :: acc) rest'
    | _ => .error "bad escape"
  | c :: rest => if c.toNat < 32 then .error "control character in string" else parseStrBody (c :: acc) rest
  | [] => .error "unterminated string"

def parseNat (acc : Nat) : List Char → Nat × List Char
  | c :: cs => if '0' ≤ c ∧ c ≤ '9' then parseNat (acc * 10 + (c.toNat - 48)) cs else (acc, c :: cs)
  | [] => (acc, [])

def parseNum (cs : List Char) : Except String (J × List Char) :=
  let (neg, cs) := match cs with
    | '-' :: r => (true, r)
    | r => (false, r)
  match cs with
  | c :: _ =>
    if '0' ≤ c ∧ c ≤ '9' then
      let (n, rest) := parseNat 0 cs
      match rest with
      | '.' :: _ => .error "floats are not allowed in Shape inputs"
      | 'e' :: _ => .error "exponents are not allowed in Shape inputs"
      | 'E' :: _ => .error "exponents are not allowed in Shape inputs"
      | _ => .ok (.num (if neg then -(n : Int) else n), rest)
    else .error "bad number"
  | [] => .error "bad number"

def expectLit (lit : List Char) (v : J) (cs : List Char) : Except String (J × List Char) :=
  if lit.isPrefixOf cs then .ok (v, cs.drop lit.length) else .error "bad literal"

mutual
partial def parseValue (cs : List Char) : Except String (J × List Char) :=
  match skipWs cs with
  | '{' :: rest => parseObj [] (skipWs rest) true
  | '[' :: rest => parseArr [] (skipWs rest) true
  | '"' :: rest => do let (s, r) ← parseStrBody [] rest; pure (.str s, r)
  | 't' :: rest => expectLit ['r', 'u', 'e'] (.bool true) rest
  | 'f' :: rest => expectLit ['a', 'l', 's', 'e'] (.bool false) rest
  | 'n' :: rest => expectLit ['u', 'l', 'l'] .null rest
  | cs' => parseNum cs'

partial def parseArr (acc : List J) (cs : List Char) (first : Bool) : Except String (J × List Char) :=
  match cs with
  | ']' :: rest => .ok (.arr acc.reverse, rest)
  | _ => do
    let cs ← if first then pure cs else
      match cs with
      | ',' :: r => pure r
      | _ => .error "expected , or ]"
    let (v, rest) ← parseValue cs
    parseArr (v :: acc) (skipWs rest) false

partial def parseObj (acc : List (String × J)) (cs : List Char) (first : Bool) :
    Except String (J × List Char) :=
  match cs with
  | '}' :: rest => .ok (.obj acc.reverse, rest)
  | _ => do
    let cs ← if first then pure cs else
      match cs with
      | ',' :: r => pure (skipWs r)
      | _ => .error "expected , or }"
    match cs with
    | '"' :: r =>
      let (k, r) ← parseStrBody [] r
      match skipWs r with
      | ':' :: r =>
        let (v, rest) ← parseValue r
        parseObj ((k, v) :: acc) (skipWs rest) false
      | _ => .error "expected :"
    | _ => .error "expected key"
end

def J.parse (s : String) : Except String J := do
  let (v, rest) ← parseValue s.toList
  if (skipWs rest).isEmpty then pure v else .error "trailing characters"

end Shape
