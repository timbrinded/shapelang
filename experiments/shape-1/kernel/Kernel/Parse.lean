import Kernel.Derive
/-! Reading a kernel case (JSON) into the model. Executable layer, differential-tested.

Case format `shape.kernel.case/v1` (see the interface notes): the checker input of
records §4 with the head and base shapes given as ESF (A.12.9, as the TypeScript prototype
emits them), manifests and records in the statement profile of records §3, and authors*
already resolved to base actors (A.11.2.1). -/
namespace Shape

def parseTier (s : String) : Tier :=
  match s with | "low" => .low | "critical" => .critical | "final" => .final | _ => .normal

def parseLevel (s : String) : Level :=
  match s with | "tested" => .tested | "proven" => .proven | "none" => .none | _ => .declared

def parseRecKind (s : String) : RecKind :=
  match s with
  | "test" => .test
  | "proof" => .proof
  | "judgment" => .judgment
  | "equivalence" => .equivalence
  | _ => .observation

def parseResult (s : String) : Result :=
  match s with
  | "supports" => .supports
  | "contradicts" => .contradicts
  | "inconclusive" => .inconclusive
  | "approves" => .approves
  | "equivalent" => .equivalent
  | "implies" => .implies
  | _ => .observes

def parseAtom (s : String) : Atom :=
  let cs := s.toList
  let verb := cs.takeWhile (· ≠ '<')
  let rest := cs.drop (verb.length + 1)
  ⟨String.ofList verb, String.ofList (if rest.getLast? == some '>' then rest.dropLast else rest)⟩

def parseUSel (s : String) : USel :=
  if s == "*" then .all else if s == "ungoverned" then .ungoverned
  else if strPrefix "component " s then .comp (dropChars 10 s)
  else if strPrefix "unit " s then .unit (dropChars 5 s)
  else .unit s

def parseNSel (s : String) : NSel :=
  if s == "*" then .all
  else if strPrefix "component " s then .comp (dropChars 10 s)
  else if strPrefix "resource " s then .res (dropChars 9 s)
  else .comp s

def argStr (j : J) : String :=
  match j with
  | .str s => s
  | .num n => toString n
  | other => other.jcs

def parseStmt (j : J) : Stmt :=
  match j.optStr "text" with
  | some t => .text t
  | none => match j.optStr "ref" with
    | some r => .hosted r
    | none => .schema (j.strD "schema") (j.strD "schemaFp") ((j.arrD "args").map argStr)

def parseOp (op : String) (a : J) : Op :=
  let atoms (k : String) := (a.strs k).map parseAtom
  let us (k : String) := (a.strs k).map parseUSel
  let ns (k : String) := (a.strs k).map parseNSel
  match op with
  | "effect.forbid" => .effectForbid (parseAtom (a.strD "atom")) (us "scope") (us "except")
  | "authority" => .authority (a.strD "component") (atoms "grants")
  | "effects.upper" => .effectsUpper (a.strD "unit") (atoms "atoms")
  | "effects.lower" => .effectsLower (a.strD "unit") ((a.strs "atoms").map (fun s => parseAtom ((splitChar ' ' s).headD s)))
  | "edge.exists" => .edgeExists (a.strD "from") (a.strD "kind") (a.strD "to")
  | "edge.forbid" => .edgeForbid (ns "from") (ns "exceptFrom") (a.strD "kind") (ns "to") (ns "exceptTo")
  | "path.forbid" => .pathForbid (ns "from") (ns "to") (a.strs "kinds") (ns "exceptVia")
  | "cycle.forbid" => .cycleForbid (a.strs "kinds")
  | "law" => .law (a.strs "on") (parseStmt (a.getD "statement"))
  | o => .other o

def parseReq (j : J) : Option Req :=
  match j with
  | .obj _ => some ⟨parseLevel (j.strD "level" "declared"), j.boolD "judged", j.strs "pins", j.strD "projection" "unit"⟩
  | _ => none

def parseClaim (j : J) : Claim :=
  let op := j.strD "op"
  let args := j.getD "args"
  let fp := match j.optStr "fp" with
    | some f => f
    | none => Hd (.obj [("v", .str "shape.claim.v1"), ("op", .str op), ("args", args)])
  { ids := j.strs "ids", op := parseOp op args, fp := fp, owner := j.strD "owner",
    tier := parseTier (j.strD "tier" "normal"), req := parseReq (j.getD "requirement") }

def parseActor (j : J) : Actor :=
  ⟨j.strD "q", j.strD "kind" "person", j.optStr "operator", j.strs "members"⟩

def parseComp (j : J) : Comp :=
  { q := j.strD "q", owner := j.strD "owner", tier := parseTier (j.strD "tier" "normal"),
    boundary := j.boolD "boundary", paths := j.strs "paths", allows := j.strs "allows",
    assumes := (j.arrD "assumes").map (fun a => match a with | .str s => s | o => o.strD "id") }

def parseRes (j : J) : Res :=
  ⟨j.strD "q", j.strD "owner", parseTier (j.strD "tier" "normal"), j.strs "bind"⟩

def parseUnit (j : J) : UnitD :=
  { q := j.strD "q", comp := j.strD "component", name := j.strD "name", owner := j.strD "owner",
    tier := parseTier (j.strD "tier" "normal"), bind := j.optStr "bind" }

def parseProv (j : J) : Prov :=
  let impl := j.getD "implementation"
  let sound := j.strs "sound"
  { q := j.strD "q", produces := (j.strs "produces").map parseRecKind, observes := j.strs "observes",
    decides := j.strs "decides",
    presence := j.boolD "presence" (sound.contains "presence"), absence := j.boolD "absence" (sound.contains "absence"),
    depsComplete := j.boolD "depsComplete", identity := j.optStr "identity",
    trusts := (j.arrD "trusts").flatMap (fun t => match t with
      | .arr [.str n, .str v] => [n, n ++ "@" ++ v]
      | .str s => [s]
      | _ => []),
    implPaths := impl.strs "paths", implDigest := impl.optStr "digest",
    fields := ["produces", "observes", "decides", "presence", "absence", "persist", "depsComplete", "identity",
      "implementation"].map (fun f => (f, (j.getD f).jcs)) }

def parseTierPol (j : J) (d : TierPol) : TierPol :=
  match j with
  | .obj _ => { floor := parseLevel (j.strD "floor" d.floor.name), blocks := (j.get? "blocks").map (fun _ => j.strs "blocks") |>.getD d.blocks,
                maxAge := (j.numD "maxAge" d.maxAge).toNat, judges := (j.get? "judges").map (fun _ => j.strs "judges") |>.getD d.judges }
  | _ => d

def parsePolicy (j : J) : Policy :=
  match j with
  | .obj _ =>
    let t := j.getD "tiers"
    { low := parseTierPol (t.getD "low") defaultPolicy.low, normal := parseTierPol (t.getD "normal") defaultPolicy.normal,
      critical := parseTierPol (t.getD "critical") defaultPolicy.critical,
      budget := (j.getD "budget").num?.map Int.toNat }
  | _ => defaultPolicy

/-- RFC 3339 UTC (`YYYY-MM-DD[THH:MM:SS[.fff]Z]`) to integer seconds. -/
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
  let hh := if cs.length ≥ 19 then num 11 13 else 0
  let mi := if cs.length ≥ 19 then num 14 16 else 0
  let ss := if cs.length ≥ 19 then num 17 19 else 0
  daysFromCivil y mo d * 86400 + hh * 3600 + mi * 60 + ss

def parseTime (j : J) : Int :=
  match j with
  | .num n => n
  | .str s => parseRfc3339 s
  | _ => 0

def parseExcSubj (j : J) : ExcSubj :=
  match j.strD "kind" with
  | "code" => .code (j.strD "id")
  | "pair" => .pair (j.strD "from") (j.strD "to")
  | _ => .unitSel (j.strD "sel")

def parseExc (j : J) : Exc :=
  let t := j.getD "target"
  { q := j.strD "q", waives := (let w := j.strs "waives"; if w.isEmpty then ["contradiction", "unestablished"] else w),
    targetClaims := if t.strD "kind" == "claim" then t.strs "fps" else [],
    targetComp := if t.strD "kind" == "component" then t.optStr "q" else none,
    subjects := (j.getD "for").arr?.map (·.map parseExcSubj), owner := j.strD "owner",
    expires := parseTime (j.getD "expires") }

def parseEsf (j : J) : Esf × Policy × List Exc :=
  let sh := j.getD "shape"
  let effects := j.arrD "effects"
  let esf : Esf :=
    { q := sh.strD "q", owner := sh.strD "owner",
      actors := (j.arrD "actors").map parseActor,
      verbs := effects.map (·.strD "verb"),
      effects := effects.flatMap (fun ef => (ef.strs "implies").map (fun w => (ef.strD "verb", w))),
      hatches := (j.arrD "hatches").map (fun h => (h.strD "kind", h.strD "lang")),
      kinds := (j.arrD "kinds").map (fun k => (k.strD "name", k.strD "from" "component", k.strD "to" "component")),
      comps := (j.arrD "components").map parseComp, res := (j.arrD "resources").map parseRes,
      units := (j.arrD "units").map parseUnit, claims := (j.arrD "claims").map parseClaim,
      provs := (j.arrD "providers").map parseProv }
  (esf, parsePolicy (j.getD "policy"), (j.arrD "exceptions").map parseExc)

def shapeBlock (j : J) : J :=
  match (j.getD "predicate").get? "shape" with
  | some s => s
  | none => j

def parseMEntry (j : J) : MEntry :=
  let markers := match j.getD "markers" with
    | .obj kvs => kvs.filterMap (fun (k, v) => v.num?.map (fun n => (k, n.toNat)))
    | _ => []
  let scheme := j.strD "scheme"
  { id := j.strD "id", proj := j.strD "projection", digest := j.strD "digest",
    kind := if j.boolD "executable" then "exec" else j.strD "kind",
    parent := j.optStr "parent", markers := markers,
    hatchComplete := j.boolD "hatchComplete" (!strSuffix ".raw.v1" scheme) }

def parseManifest (j : J) : String × List MEntry :=
  let b := shapeBlock j
  (b.strD "revision", (b.arrD "entries").map parseMEntry)

def parseCite (j : J) : Cite := ⟨j.strD "id", j.strD "projection", j.strD "digest"⟩

def parseOEntry (j : J) : OEntry :=
  ⟨j.strD "id", j.strD "projection", j.strD "digest", j.boolD "complete", (j.arrD "deps").map parseCite⟩

def parseFact (j : J) : Fact :=
  { ty := j.strD "type", loc := j.strD "at", verb := j.strD "verb", res := j.strD "resource",
    to := j.strD "to", kind := j.strD "kind", n := (j.numD "n" 1).toNat }

def parseRecord (j : J) : Record :=
  let b := shapeBlock j
  let about := b.getD "about"
  let ce := b.getD "counterexample"
  { id := match j.optStr "id" with | some x => x | none => Hd j,
    kind := parseRecKind (b.strD "kind"), result := parseResult (b.strD "result"),
    provider := (b.getD "provider").optStr "id", revision := b.strD "revision", time := parseTime (b.getD "time"),
    claimFp := (b.getD "claim").optStr "fp", code := (b.arrD "code").map parseCite, deps := (b.arrD "deps").map parseCite,
    harness := (b.arrD "harness").map parseCite, entries := ((b.getD "scope").arrD "entries").map parseOEntry,
    facts := (b.arrD "facts").map parseFact,
    assumptions := (b.arrD "assumptions").map (fun a => (a.strD "id", a.strD "kind")),
    counterexample := !ce.isNull, judge := b.optStr "judge", aboutChange := about.optStr "change",
    refs := about.strs "refs", authenticated := j.boolD "authenticated" (b.boolD "authenticated") }

/-- Review lines without a relay (A.7.6.8): `shape approve bd:…` lines become answers and
    `shape judge|reject <claim>` lines claim judgments citing the head's Req, for this run only.
    Each review is `{"actor": Q, "line": …, "change"?: id}` with the actor already resolved. -/
def reviewRecords (env : Env) (rvs : List J) : List Record :=
  rvs.zipIdx.filterMap fun (rv, n) =>
    let actor := rv.strD "actor"
    let words := (splitChar ' ' (rv.strD "line")).filter (· ≠ "")
    let base : Record := { (default : Record) with
      id := "review:" ++ toString n, kind := .judgment, revision := env.headRev, time := env.now,
      judge := some actor, authenticated := true }
    let claimOf (sel : String) : Option Claim :=
      env.head.claims.find? (fun c => c.ids.contains sel ||
        (strPrefix "c:" sel && strPrefix ("sha256:" ++ dropChars 2 sel) c.fp))
    let judged (c : Claim) (res : Result) : Record :=
      let proj := (c.req.map (·.proj)).getD "unit"
      { base with result := res, claimFp := some c.fp,
                  code := (reqPairs env c .judgment proj).filterMap (fun p =>
                    (mDigest env.mh p.1 p.2).map (fun d => (⟨p.1, p.2, d⟩ : Cite))) }
    match words with
    | "shape" :: "approve" :: refs =>
      some { base with result := .approves, refs := refs,
                       aboutChange := some ((rv.optStr "change").getD (env.changeIds.headD "")) }
    | "shape" :: "judge" :: sel :: _ => (claimOf sel).map (judged · .supports)
    | "shape" :: "reject" :: sel :: _ => (claimOf sel).map (judged · .contradicts)
    | _ => none

def parseInput (j : J) : Except String Input := do
  let mode := if j.strD "mode" "change" == "audit" then Mode.audit else Mode.change
  let head := j.getD "head"
  let (hEsf, hPol, hExc) := parseEsf (head.getD "esf")
  let (hRev, mh) := parseManifest (head.getD "manifest")
  let base := j.getD "base"
  let (bEsf, bPol, bExc, mb) := match base with
    | .obj _ =>
      let (e, p, x) := parseEsf (base.getD "esf")
      (some e, some p, x, (parseManifest (base.getD "manifest")).2)
    | _ => (none, none, [], [])
  let authors := (j.arrD "authors").filterMap (fun a => match a with
    | .str s => some s
    | o => o.optStr "actor")
  let unmappedBot := j.boolD "unmappedBot" || (j.arrD "authors").any (fun a => a.boolD "bot" && !a.boolD "mapped" true)
  let env : Env :=
    { mode := mode, now := parseTime (j.getD "now"), changeIds := (j.getD "change").strs "ids",
      authors := authors, unmappedBot := unmappedBot, head := hEsf, base := if mode == .audit then none else bEsf,
      headRev := (head.optStr "revision").getD hRev, mh := mh, mb := if mode == .audit then [] else mb,
      cells := (j.arrD "cells").filterMap (fun c => match c with
        | .arr [.str a, .str b] => some (a, b)
        | _ => none) }
  pure { env := env, records := (j.arrD "records").map parseRecord ++ reviewRecords env (j.arrD "reviews"),
         baseRecords := (j.arrD "baseRecords").map parseRecord,
         headPolicy := hPol, basePolicy := if mode == .audit then none else bPol, headExcs := hExc, baseExcs := bExc }

end Shape
