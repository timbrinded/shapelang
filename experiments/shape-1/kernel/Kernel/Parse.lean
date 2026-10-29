import Kernel.Util
/-! Reading a `shape.kernel.case/v1` (records §4, A.11.2.1) into the model.
Executable layer, differential-tested.

The case is the checker input after the pre-pass: both shapes as ESF (`shape.elaborated.v1`,
A.12.9, as the prototype's `elaborate` emits it, with the version 7 fields `shape.manifest`,
`actors[].was`, `components[].exceptPaths` and `providers[].implementation.ids`), manifests
with refs and flags (statement, DSSE envelope or bare predicate), records validated by
A.12.6 (statement or bare shape block, plus `authenticated`), review lines with their base actor,
authors* and now*. Cells are never read: the kernel computes them [D23]. Equal fingerprints
are merged here (A.4.1.7, L38 (3)). -/
namespace Shape

def parseTier (s : String) : Tier :=
  match s with | "low" => .low | "critical" => .critical | "final" => .final | _ => .normal

def parseLevel (s : String) : Level :=
  match s with | "tested" => .tested | "proven" => .proven | "none" => .none | _ => .declared

def parseRecKind (s : String) : RecKind :=
  match s with
  | "test" => .test | "proof" => .proof | "judgment" => .judgment | "equivalence" => .equivalence
  | _ => .observation

def parseResult (s : String) : Result :=
  match s with
  | "supports" => .supports | "contradicts" => .contradicts | "inconclusive" => .inconclusive
  | "approves" => .approves | "equivalent" => .equivalent | "implies" => .implies
  | _ => .observes

def parseAtom (s0 : String) : Atom :=
  let s := trimS s0
  let cs := s.toList
  let verb := cs.takeWhile (· ≠ '<')
  let rest := cs.drop (verb.length + 1)
  ⟨trimS (String.ofList verb), trimS (String.ofList (if rest.getLast? == some '>' then rest.dropLast else rest))⟩

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

def parseStmt (j : J) : Stmt :=
  match j.optStr "text" with
  | some t => .text t
  | none => match j.optStr "ref" with
    | some r => .hosted r
    | none => .schema (j.strD "schema") (j.strD "schemaFp") ((j.arrD "args").map (·.jcs))

def parseOp (op : String) (a : J) : Op :=
  let atoms (k : String) := (a.strs k).map parseAtom
  let us (k : String) := (a.strs k).map parseUSel
  let ns (k : String) := (a.strs k).map parseNSel
  match op with
  | "effect.forbid" => .effectForbid (parseAtom (a.strD "atom")) (us "scope") (us "except")
  | "authority" => .authority (a.strD "component") (atoms "grants")
  | "effects.upper" => .effectsUpper (a.strD "unit") (atoms "atoms")
  | "effects.lower" =>
    let entries := a.strs "atoms"
    let plain := entries.filter (fun s => !containsSub " via " s)
    let vias := entries.filterMap fun s => match splitOn " via " s with
      | [x, v] => some (parseAtom x, trimS v)
      | _ => none
    .effectsLower (a.strD "unit") (plain.map parseAtom) vias
  | "edge.exists" => .edgeExists (a.strD "from") (a.strD "kind") (a.strD "to")
  | "edge.forbid" => .edgeForbid (ns "from") (ns "exceptFrom") (a.strD "kind") (ns "to") (ns "exceptTo")
  | "path.forbid" => .pathForbid (ns "from") (ns "to") (sortStrs (a.strs "kinds")) (ns "exceptVia")
  | "cycle.forbid" => .cycleForbid (sortStrs (a.strs "kinds"))
  | "law" => .law (a.strs "on") (parseStmt (a.getD "statement"))
  | o => .other o

def parseReq (j : J) : Option Req :=
  match j with
  | .obj _ => some ⟨parseLevel (j.strD "level" "declared"), j.boolD "judged", sortStrs (j.strs "pins"), j.strD "projection" "unit"⟩
  | _ => none

def parseClaim (j : J) : Claim :=
  let op := j.strD "op"
  let args := j.getD "args"
  let fp := match j.optStr "fp" with
    | some f => f
    | none => Hd (.obj [("v", .str "shape.claim.v1"), ("op", .str op), ("args", args)])
  { ids := sortStrs (j.strs "ids"), op := parseOp op args, fp := fp, owner := j.strD "owner",
    tier := parseTier (j.strD "tier" "normal"), req := parseReq (j.getD "requirement"),
    argsJ := args.jcs, opName := op, form := j.strD "statementForm", bearer := j.optStr "bearer",
    ownerFrom := j.optStr "ownerFrom", tierFrom := j.optStr "tierFrom" }

def parseActor (j : J) : Actor :=
  { q := j.strD "q", kind := j.strD "kind" "person", operator := j.optStr "operator",
    members := sortStrs (j.strs "members"), identities := sortStrs (j.strs "identities"), was := j.optStr "was" }

def parseComp (j : J) : Comp :=
  { q := j.strD "q", owner := j.strD "owner", tier := parseTier (j.strD "tier" "normal"),
    boundary := j.boolD "boundary", paths := sortStrs (j.strs "paths"), allows := sortStrs (j.strs "allows"),
    assumes := sortStrs ((j.arrD "assumes").map (fun a => match a with | .str s => s | o => o.strD "id")),
    exceptPaths := sortStrs (j.strs "exceptPaths"),
    grants := (j.getD "grants").arr?.map (fun xs => xs.filterMap J.str? |>.map parseAtom),
    was := j.optStr "was", ownerFrom := j.optStr "ownerFrom" }

def parseRes (j : J) : Res :=
  { q := j.strD "q", owner := j.strD "owner", tier := parseTier (j.strD "tier" "normal"),
    bind := sortStrs ((j.strs "bind").map canonRC), was := j.optStr "was", ownerFrom := j.optStr "ownerFrom" }

def parseUnit (j : J) : UnitD :=
  { q := j.strD "q", comp := j.strD "component", name := j.strD "name", owner := j.strD "owner",
    tier := parseTier (j.strD "tier" "normal"), bind := j.optStr "bind", was := j.optStr "was",
    summaryMode := (j.getD "summary").optStr "mode",
    ownerFrom := j.optStr "ownerFrom", tierFrom := j.optStr "tierFrom" }

def parseProv (j : J) : Prov :=
  let impl := j.getD "implementation"
  let sound := j.strs "sound"
  { q := j.strD "q", produces := (j.strs "produces").map parseRecKind, producesS := sortStrs (j.strs "produces"),
    observes := sortStrs (j.strs "observes"), decides := sortStrs (j.strs "decides"),
    presence := j.boolD "presence" (sound.contains "presence"), absence := j.boolD "absence" (sound.contains "absence"),
    persist := j.boolD "persist", depsComplete := j.boolD "depsComplete", identity := j.optStr "identity",
    trusts := sortOnL (fun p => [p.1, p.2]) ((j.arrD "trusts").filterMap (fun t => match t with
      | .arr [.str n, .str v] => some (n, v)
      | _ => none)),
    hasImpl := !impl.isNull,
    implPaths := sortStrs (impl.strs "paths"), implIds := sortStrs (impl.strs "ids"), implDigest := impl.optStr "digest" }

def parseTierPol (j : J) (d : TierPol) : TierPol :=
  match j with
  | .obj _ => { floor := parseLevel (j.strD "floor" d.floor.name),
                blocks := ((j.get? "blocks").map (fun _ => sortStrs (j.strs "blocks"))).getD d.blocks,
                maxAge := (j.numD "maxAge" d.maxAge).toNat,
                judges := ((j.get? "judges").map (fun _ => sortStrs (j.strs "judges"))).getD d.judges }
  | _ => d

def parsePolicy (j : J) : Policy :=
  match j with
  | .obj _ =>
    let t := j.getD "tiers"
    { low := parseTierPol (t.getD "low") defaultPolicy.low, normal := parseTierPol (t.getD "normal") defaultPolicy.normal,
      critical := parseTierPol (t.getD "critical") defaultPolicy.critical,
      budget := (j.getD "budget").num?.map Int.toNat }
  | _ => defaultPolicy

def parseExcSubj (j : J) : ExcSubj :=
  match j.strD "kind" with
  | "code" => .code (j.strD "id")
  | "pair" => .pair (j.strD "from") (j.strD "to")
  | _ => .unitSel (j.strD "sel")

def parseExc (j : J) : Exc :=
  let t := j.getD "target"
  { q := j.strD "q", waives := (let w := sortStrs (j.strs "waives"); if w.isEmpty then ["contradiction", "unestablished"] else w),
    targetClaims := if t.strD "kind" == "claim" then sortStrs (t.strs "fps") else [],
    targetComp := if t.strD "kind" == "component" then t.optStr "q" else none,
    targetRef := t.strD "ref" (if t.strD "kind" == "component" then "component " ++ t.strD "q" else ""),
    subjects := (j.getD "for").arr?.map (·.map parseExcSubj), owner := j.strD "owner",
    expires := parseTime (j.getD "expires") }

def parseTemplate (j : J) : Template :=
  let pairs (k : String) : List (String × String) := (j.arrD k).filterMap fun p => match p with
    | .arr [.str a, .str b] => some (a, b)
    | _ => none
  { q := j.strD "q", schemaFp := j.strD "schemaFp", params := pairs "params", order := pairs "order" }

def parseErrIn (j : J) : ErrIn :=
  { code := j.strD "code", subject := j.strD "subject",
    causes := (j.arrD "causes").map (fun c => (c.strD "type", c.strD "id")),
    dischargers := match j.get? "dischargers" with
      | some (.arr ds) => .arr (ds.map fun d => match d with
          | .obj kvs => .obj (kvs.filter (fun kv => kv.1 != "command" && kv.1 != "snippet"))
          | o => o)
      | _ => .arr [] }

/-! ### Equal fingerprints merge (A.4.1.7) -/

def reqStrictest (a b : Option Req) : Option Req :=
  match a, b with
  | none, r => r
  | r, none => r
  | some x, some y =>
    let pr := if x.proj == y.proj then x.proj else "unit"
    some (Req.mk (levelMax x.level y.level) (x.judged && y.judged) (sortStrs (x.pins ++ y.pins)) pr)

/-- All ids, the highest tier, the strictest requirement, the owner of the highest-tier id
    (ties: least id). -/
def mergeClaims (cs : List Claim) : List Claim :=
  let fps := sortStrs (cs.map (·.fp))
  fps.filterMap fun fp =>
    match cs.filter (·.fp == fp) with
    | [] => none
    | [c] => some c
    | g@(c0 :: _) =>
      let top := tiersMax (g.map (·.tier))
      let lead := (minWith? (fun a b => strLt (a.ids.headD "") (b.ids.headD "")) (g.filter (·.tier == top))).getD c0
      some { lead with ids := sortStrs (g.flatMap (·.ids)), tier := top, owner := lead.owner,
                        req := g.foldl (fun r c => reqStrictest r c.req) none }

def parseEsf (j : J) : Esf :=
  let sh := j.getD "shape"
  let effects := j.arrD "effects"
  { q := sh.strD "q", owner := sh.strD "owner", manifestId := sh.optStr "manifest",
    actors := sortOn (·.q) ((j.arrD "actors").map parseActor),
    verbs := sortStrs (effects.map (·.strD "verb")),
    effects := sortOnL (fun p => [p.1, p.2]) (effects.flatMap (fun ef => (ef.strs "implies").map (fun w => (ef.strD "verb", w)))),
    hatches := sortOnL (fun p => [p.1, p.2]) ((j.arrD "hatches").map (fun h => (h.strD "kind", h.strD "lang"))),
    kinds := sortOnL (fun k => [k.1]) ((j.arrD "kinds").map (fun k => (k.strD "name", k.strD "from" "component", k.strD "to" "component"))),
    comps := sortOn (·.q) ((j.arrD "components").map parseComp),
    res := sortOn (·.q) ((j.arrD "resources").map parseRes),
    units := sortOn (·.q) ((j.arrD "units").map parseUnit),
    claims := mergeClaims ((j.arrD "claims").map parseClaim),
    provs := sortOn (·.q) ((j.arrD "providers").map parseProv),
    templates := sortOn (·.q) ((j.arrD "templates").map parseTemplate),
    excs := sortOn (·.q) ((j.arrD "exceptions").map parseExc),
    policy := parsePolicy (j.getD "policy"),
    errors := (j.arrD "errors").map parseErrIn }

/-! ### Manifests -/

/-- The statement inside a DSSE envelope, or the value itself. -/
def unwrapStatement (j : J) : J :=
  match j.optStr "payloadType", j.optStr "payload" with
  | some _, some p =>
    match b64DecodeStr p with
    | some txt => (J.parse txt).toOption.getD j
    | none => j
  | _, _ => j

def shapeBlock (j : J) : J :=
  let s := unwrapStatement j
  match (s.getD "predicate").get? "shape" with
  | some b => b
  | none => s

def parseManifest (j : J) (auth : Bool) : Manifest := Id.run do
  let b := shapeBlock j
  let mut ids : Std.HashMap String IdInfo := {}
  for e in b.arrD "entries" do
    let x := e.strD "id"
    let proj := e.strD "projection"
    let dg := e.strD "digest"
    let sch := e.strD "scheme"
    let markers : List (String × Nat) := match e.getD "markers" with
      | .obj kvs => kvs.filterMap (fun (k, v) => v.num?.map (fun n => (k, n.toNat)))
      | _ => []
    let hc := e.boolD "hatchComplete" true
    let ex := e.boolD "executable" false
    let refs := e.strs "refs"
    let info := match ids.get? x with
      | some i =>
        { i with digests := if i.digests.any (·.1 == proj) then i.digests else i.digests ++ [(proj, dg)],
                 schemes := if i.schemes.any (·.1 == proj) then i.schemes else i.schemes ++ [(proj, sch)],
                 allDigests := i.allDigests ++ [(proj, dg)],
                 markers := markers.foldl (fun acc (k, n) => match acc.find? (·.1 == k) with
                   | some (_, m) => acc.map (fun p => if p.1 == k then (k, max m n) else p)
                   | none => acc ++ [(k, n)]) i.markers,
                 hatchComplete := i.hatchComplete && hc, executable := i.executable || ex,
                 refs := i.refs ++ refs, parent := i.parent.orElse (fun _ => e.optStr "parent") }
      | none =>
        { id := x, lang := idLang x, path := idPath x, symbol := idSym x, kind := e.strD "kind",
          parent := e.optStr "parent", digests := [(proj, dg)], schemes := [(proj, sch)],
          allDigests := [(proj, dg)], markers := markers, hatchComplete := hc, executable := ex, refs := refs }
    ids := ids.insert x info
  let ids2 := ids.fold (fun m k i => m.insert k { i with refs := sortStrs i.refs, markers := sortOnL (fun p => [p.1]) i.markers }) ids
  let order := sortStrs (ids2.toList.map (·.1))
  let mut children : Std.HashMap String (List String) := {}
  for x in order do
    match (ids2.get? x).bind (·.parent) with
    | some p => children := children.insert p (((children.get? p).getD []) ++ [x])
    | none => pure ()
  return { revision := b.strD "revision", ids := ids2, order := order, children := children,
           authenticated := auth, present := !j.isNull }

/-! ### Records -/

def parseCite (j : J) : Cite := ⟨j.strD "id", j.strD "projection", j.strD "digest"⟩

def parseOEntry (j : J) : OEntry :=
  ⟨j.strD "id", j.strD "projection", j.strD "digest", j.boolD "complete", (j.arrD "deps").map parseCite⟩

def parseFact (j : J) : Fact :=
  { ty := j.strD "type", loc := j.strD "at", verb := j.strD "verb", res := j.strD "resource",
    to := j.strD "to", kind := j.strD "kind", n := (j.get? "n").bind (fun v => v.num?.map Int.toNat), raw := j }

def parseRecord (j : J) : Record :=
  let st := unwrapStatement j
  let b := shapeBlock j
  let about := b.getD "about"
  let ce := b.getD "counterexample"
  let pair := b.getD "pair"
  { id := match j.optStr "id" with | some x => x | none => Hd st,
    kind := parseRecKind (b.strD "kind"), result := parseResult (b.strD "result"),
    provider := (b.getD "provider").optStr "id", revision := b.strD "revision", time := parseTime (b.getD "time"),
    claimFp := (b.getD "claim").optStr "fp", claimId := (b.getD "claim").optStr "id",
    code := (b.arrD "code").map parseCite, deps := (b.arrD "deps").map parseCite,
    hasDeps := match b.get? "deps" with | some (.arr _) => true | _ => false,
    harness := (b.arrD "harness").map parseCite, hasHarness := (b.get? "harness").isSome,
    entries := ((b.getD "scope").arrD "entries").map parseOEntry,
    facts := (b.arrD "facts").map parseFact,
    assumptions := (b.arrD "assumptions").map (fun a => (a.strD "id", a.strD "kind")),
    counterexample := if ce.isNull then none else some ce, judge := b.optStr "judge",
    aboutChange := about.optStr "change", refs := about.strs "refs",
    authenticated := j.boolD "authenticated" (b.boolD "authenticated"),
    persistedBase := j.boolD "persistedBase",
    pairSpace := pair.strD "space", pairFrom := pair.strD "from", pairTo := pair.strD "to" }

/-- Identical statements are one record (A.12.6): merged by id, signers (authentication) united. -/
def mergeRecords (rs : List Record) : List Record :=
  let ids := sortStrs (rs.map (·.id))
  ids.filterMap fun i => match rs.filter (·.id == i) with
    | [] => none
    | r :: more => some { r with authenticated := r.authenticated || more.any (·.authenticated),
                                 persistedBase := r.persistedBase || more.any (·.persistedBase) }

def parseReview (j : J) : Review :=
  let line := trimS (j.strD "line")
  let identity := j.strD "identity"
  let change := j.optStr "change"
  let ref := match j.optStr "ref" with
    | some r => r
    | none =>
      let src : J := match j.get? "review" with
        | some r => r
        | none =>
          if identity != "" then
            .obj ([("identity", .str identity), ("line", .str (j.strD "line"))] ++
              (match change with | some c => [("change", .str c)] | none => []))
          else j
      "review:" ++ takeChars 16 (hexh src)
  { actor := j.optStr "actor", identity := identity, line := line, change := change, ref := ref }

/-- Every array sorted by JCS and deduplicated, recursively; DSSE payloads decoded first. -/
partial def canonDeep (j : J) : J :=
  match j with
  | .arr xs => .arr (dedupSorted' (sortOn (·.jcs) (xs.map canonDeep)))
  | .obj kvs =>
    match kvs.find? (·.1 == "payload"), kvs.find? (·.1 == "payloadType") with
    | some (_, .str p), some _ =>
      match J.parse ((b64DecodeStr p).getD "") with
      | .ok st => canonDeep st
      | .error _ => .obj (kvs.map fun (k, v) => (k, canonDeep v))
    | _, _ => .obj (kvs.map fun (k, v) => (k, canonDeep v))
  | o => o
where
  dedupSorted' (l : List J) : List J :=
    l.foldl (fun acc x => match acc.getLast? with
      | some y => if y.jcs == x.jcs then acc else acc ++ [x]
      | none => [x]) []

/-- A stand-in when the pre-pass supplies no inputDigest: H of the case with every array sorted
    and deduplicated (so permutation-invariant by construction; it is not the input's
    inputDigest, A.16.3, which only the pre-pass can compute). -/
def fallbackDigest (j : J) : String := Hd (canonDeep j)

def parseInput (j : J) : Except String Input := do
  if j.strD "contract" != "shape.kernel.case/v1" then throw "contract: not shape.kernel.case/v1"
  let modeS := j.strD "mode" "change"
  let mode ← match modeS with
    | "change" => pure Mode.change
    | "audit" => pure Mode.audit
    | "preview" => pure Mode.preview
    | m => throw s!"mode: {m}"
  let head := j.getD "head"
  let hEsf := parseEsf (head.getD "esf")
  let base := j.getD "base"
  let hasBaseRev := match base with | .obj _ => mode != .audit | _ => false
  let bEsfJ := base.getD "esf"
  -- an unreadable base (A.6.4.5): esf null, `unreadable: true`, or an esf that is no
  -- shape.elaborated.v1 document (the DRT pre-pass's `{shape: {q: "", owner: ""}}` placeholder)
  let baseUnreadable := hasBaseRev && (bEsfJ.isNull || base.boolD "unreadable" || (bEsfJ.get? "v").isNone)
  let bEsf : Option Esf := if hasBaseRev && !baseUnreadable then some (parseEsf bEsfJ) else none
  -- manifest authentication (A.5.2.17) is the pre-pass's: `manifestAuthenticated`; when a case
  -- omits it, a DSSE envelope counts as signed by the governing manifest identity iff one of its
  -- signatures names that identity's ed25519 key id (the signature itself is not verified here)
  let govEsf := if mode == .audit then hEsf else bEsf.getD hEsf
  let keyOf (id : String) : Option String :=
    if strPrefix "ed25519(\"" id && strSuffix "\")" id then some (dropRight 2 (dropChars 9 id)) else none
  let sigAuth (m : J) : Bool := match govEsf.manifestId.bind keyOf with
    | some k => (m.arrD "signatures").any (fun sg => sg.strD "keyid" == k)
    | none => false
  let authOf (side : J) : Bool := match side.get? "manifestAuthenticated" with
    | some (.bool b) => b
    | _ => sigAuth (side.getD "manifest")
  let mh := parseManifest (head.getD "manifest") (authOf head)
  let mb := if hasBaseRev then parseManifest (base.getD "manifest") (authOf base) else Manifest.empty
  let authors := sortStrs ((j.arrD "authors").filterMap (fun a => match a with
    | .str s => some s
    | o => o.optStr "actor"))
  let unmappedBot := j.boolD "unmappedBot" || (j.arrD "authors").any (fun a => a.boolD "bot" && (a.optStr "actor").isNone)
  let preview := mode == .preview
  -- records the pre-pass rejected (A.12.6) may be passed with `rejected: true`: no use, but
  -- counted where the input's own lists are counted (health baseObservations, A.16.30)
  let live (r : J) : Bool := !(r.boolD "rejected")
  let recs := mergeRecords (((j.arrD "records").filter live).map parseRecord)
  let recs := if preview then recs.filter (·.kind != .judgment) else recs
  let reviews := if preview then [] else sortOnL (fun r => [r.ref, r.line]) ((j.arrD "reviews").map parseReview)
  pure { mode := mode, now := parseTime (j.getD "now"), changeIds := sortStrs ((j.getD "change").strs "ids"),
         authors := authors, unmappedBot := unmappedBot, head := hEsf, base := bEsf,
         hasBaseRev := hasBaseRev, baseUnreadable := baseUnreadable,
         headRev := (head.optStr "revision").getD mh.revision,
         baseRev := if hasBaseRev then (base.optStr "revision").getD mb.revision else "",
         mh := mh, mb := mb, records := recs,
         baseRecords := mergeRecords (((j.arrD "baseRecords").filter live).map parseRecord),
         baseRecordsSupplied := (j.arrD "baseRecords").length,
         reviews := reviews,
         inputDigest := (j.optStr "inputDigest").getD (fallbackDigest j),
         rejected := j.arrD "rejected", clockClamped := j.boolD "clockClamped",
         options := j.getD "options" }

end Shape
