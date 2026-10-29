Kernel/Pending: version 6 proofs moved out of the build (M2, kernel version 7)

These five files are the version 6 kernel's theorems about its executable layer. The version 7
rewrite (Kernel/World, Context, Heirs, Obligation, Facts, Laws, Coverage, Loosen, Derive, Parse)
replaced the definitions they are stated over (Env, Input.canon, rawObs, deriveObs, deriveJ,
withEvidence, l1Parts, l3Decide's old verdict type, lawObsFor, mkEffContra, pickFirst, ...), so
none of them elaborates against the new code. They are kept verbatim, outside the lean_lib (no
module imports them and lakefile.toml builds only Kernel and its imports), as the statements the
redone proofs (M2 part 2) have to re-establish. Nothing here uses sorry, admit, native_decide or a
new axiom; the files simply do not compile any more.

Still proved and built (Kernel/Order, Closure, Struct, Eval; 65 theorems, listed with their axioms
by `lake env lean AxiomsCheck.lean`): JCS order lemmas and canon (T1's list layer), the closure
fixpoint and rtc, the structure fragment (antitonicity of path, edge and cycle forbids and their
conjunction, ga_sound/l3_ga_sound, prune_sound, l3_edge_exact, stronger_sound, validCex_sound,
evalStruct_correct), atomLe, perm_exact (raw_fact_exact with summaries, A.4.4.7), l1_false,
l1_sound, l1_complete, l1_levels.

Pending, by file (theorem names as in the file):

Final.lean  T2 "final is final" and T3 "evidence never waives" for authority and effect forbids.
  withEvidence_env withEvidence_records obsFacts_mono effSubjects_mono effForce_mono
  mkEffContra_some effCore_kind structContras_family conductContras_family mkLawOb_family
  lawObs_family loosenObs_family coverageObs_family rawObs_authority effContra_mem_rawObs
  mem_deriveObs not_discharged_of_unanswerable deriveObs_of_raw sev_final
  evidence_never_waives final_is_final final_keeps_blocked
  Needs for v7: restating over Ctx.pass / deriveAll; severity rule 2 now requires introduced
  (A.7.5.1), so final_keeps_blocked becomes "introduced final sound contradictions block"
  (preexisting final drift is owed, D11).

Laws.lean   guards, staleness, T9.
  usab_none usab_stale reqStar_informal recLevel_rank recFor_kind guard_needs_judgment
  withRecords_polStar lawSoundContra_mono guard_not_discharged_by_evidence mem_lawObsFor
  guard_obligation law_answerable discharged_answerable at_most_one lawReason_stale
  stale_obligation_moved usab_of_emf stale_iff no_stale_without_move lawObsFor_sub_rawObs
  guard_open_or_answered
  Needs for v7: Ctx.evalLaw (reason order stale, expired, assumption, weak, producer-changed per
  record; law reason assumption, weak, producer-changed, expired, stale, else missing, A.5.4.3),
  head-only providers and inconclusive records holding no reason, final two-person judgments.

Loosen.lean the obligation generators against the proved decisions.
  foldl_max_ge foldl_max_mem foldl_max_witness lvl_ge lvl_witness lvl_zero tier_rank_pos
  l1Drops_ne l1Auth_ne l1PartsAt_ne l1_parts_iff l3Tail_cases l3_heir_sound
  l3_ga_verdict_sound l3_edgeCex_sound l3_searchCex_sound rawObs_key deriveObs_key
  Needs for v7: Ctx.l1Run's three part kinds (level, authority+, authority tier; D17, D11) and
  cells; l3Decide's new result type (implied | found | budget) with the W_eval first pass.
  l1_sound/l1_complete themselves still hold in Eval.

Perm.lean   T1 permutation invariance of the core output.
  Esf.canon_eq optEsf_canon_eq Env.canon_eq Input.canon_eq deriveObs_perm answeredObs_perm
  exceptionAnswered_perm deriveJ_perm deriveText_perm deriveText_records_perm
  Needs for v7: an Input.canon over the v7 Input (Parse sorts every collection it reads, which
  the executable relies on; the proof has to be redone over it). Checked meanwhile by test.

Raise.lean  existence half of T2 (a presence-sound fact a final forbid excludes raises a sound
  blocking contradiction at tier final).
  tierMax_ge_left tierMax_ge_right foldl_tierMax_ge tierStar_ge tier_rank_le
  tier_final_of_rank claimOrdLt_true claimOrdLt_false pickFirst_eq pick_aux pickFirst_max
  mkEffContra_subject deriveObs_of_raw' effCore_of_pick final_forbid_raises
  Needs for v7: tier*(o) = max(tier_h(c), Lvl_b(att_b(x))(b)) (A.6.2.3) with the A.16.13
  answered-final contribution; excluding-claim order (tier* desc, forbid < summary < authority,
  fp).
