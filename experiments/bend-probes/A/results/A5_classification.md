| id | kind | behaviour changed | false laws | gate | class | --verdict | note |
|---|---|---|---|---|---|---|---|
| IS-m01 | mutant | yes | sort_sorted | FAIL | true-kill |  |  |
| IS-m02 | mutant | yes | sort_perm | FAIL | true-kill |  |  |
| IS-m03 | mutant | yes | sort_perm | FAIL | true-kill |  |  |
| IS-m04 | mutant | yes | sort_sorted | FAIL | true-kill |  |  |
| IS-m05 | mutant | yes | sort_sorted | FAIL | true-kill |  |  |
| IS-m06 | mutant | yes | sort_perm | FAIL | true-kill |  |  |
| IS-m07 | mutant | yes | sort_perm | FAIL | true-kill |  |  |
| IS-m08 | mutant | n/a | - | FAIL | stillborn |  | Error: - expected : Either<&1, &1, LE(x, h), LE(h, x)> |
| IS-m09 | mutant | yes | sort_sorted | FAIL | true-kill |  |  |
| IS-m10 | mutant | n/a | - | FAIL | stillborn |  | Error: - expected : Empty |
| IS-m11 | mutant | n/a | - | FAIL | stillborn |  | Error: - expected : a decreasing self-call (arguments are re |
| IS-r01 | refactor | no | - | PASS | survived-law-holds | ALL PROOFS CHECK |  |
| IS-r02 | refactor | no | - | PASS | survived-law-holds | ALL PROOFS CHECK |  |
| IS-r03 | refactor | no | - | PASS | survived-law-holds | ALL PROOFS CHECK |  |
| IS-r04 | refactor | no | - | PASS | survived-law-holds | ALL PROOFS CHECK |  |
| IS-r05 | refactor | no | - | FAIL | killed-law-holds |  |  |
| TE-m01 | mutant | yes | opt_sound,opt_complete | FAIL | true-kill |  |  |
| TE-m02 | mutant | yes | opt_sound,opt_complete | FAIL | true-kill |  |  |
| TE-m03 | mutant | yes | opt_sound,opt_complete | FAIL | true-kill |  |  |
| TE-m04 | mutant | yes | opt_sound,opt_complete | FAIL | true-kill |  |  |
| TE-m05 | mutant | no | - | PASS | survived-law-holds | ALL PROOFS CHECK |  |
| TE-m06 | mutant | yes | opt_complete | FAIL | true-kill |  |  |
| TE-m07 | mutant | yes | opt_sound,opt_complete | FAIL | true-kill |  |  |
| TE-m08 | mutant | yes | opt_complete | FAIL | true-kill |  |  |
| TE-m09 | mutant | yes | opt_sound,opt_complete | FAIL | true-kill |  |  |
| TE-m10 | mutant | no | - | PASS | survived-law-holds | ALL PROOFS CHECK |  |
| TE-r01 | refactor | no | - | PASS | survived-law-holds | ALL PROOFS CHECK |  |
| TE-r02 | refactor | no | - | PASS | survived-law-holds | ALL PROOFS CHECK |  |
| TE-r03 | refactor | no | - | FAIL | killed-law-holds |  |  |
| TE-r04 | refactor | no | - | PASS | survived-law-holds | ALL PROOFS CHECK |  |
| NU-m01 | mutant | yes | add_comm,divmod_ok | FAIL | true-kill |  |  |
| NU-m02 | mutant | yes | mul_comm,mul_dist,divmod_ok | FAIL | true-kill |  |  |
| NU-m03 | mutant | n/a | - | FAIL | stillborn |  | Error: - expected : p |
| NU-m04 | mutant | yes | mul_comm,mul_dist,divmod_ok | FAIL | true-kill |  |  |
| NU-m05 | mutant | yes | divmod_ok | FAIL | true-kill |  |  |
| NU-m06 | mutant | yes | divmod_ok | FAIL | true-kill |  |  |
| NU-m07 | mutant | yes | divmod_ok | FAIL | true-kill |  |  |
| NU-m08 | mutant | yes | divmod_ok | FAIL | true-kill |  |  |
| NU-m09 | mutant | yes | - | PASS | survived-law-holds | ALL PROOFS CHECK |  |
| NU-m10 | mutant | yes | divmod_ok | FAIL | true-kill |  |  |
| NU-r01 | refactor | no | - | PASS | survived-law-holds | ALL PROOFS CHECK |  |
| NU-r02 | refactor | no | - | FAIL | killed-law-holds |  |  |
| NU-r03 | refactor | no | - | PASS | survived-law-holds | ALL PROOFS CHECK |  |
| NU-r04 | refactor | no | - | FAIL | killed-law-holds |  |  |
| NU-r05 | refactor | no | - | PASS | survived-law-holds | ALL PROOFS CHECK |  |
| PS-m01 | mutant | yes | tree_is_seq | FAIL | true-kill |  |  |
| PS-m02 | mutant | yes | tree_is_seq | FAIL | true-kill |  |  |
| PS-m03 | mutant | yes | tree_is_seq | FAIL | true-kill |  |  |
| PS-m04 | mutant | yes | tree_is_seq | FAIL | true-kill |  |  |
| PS-m05 | mutant | yes | tree_is_seq | FAIL | true-kill |  |  |
| PS-m06 | mutant | yes | tree_is_seq | FAIL | true-kill |  |  |
| PS-r01 | refactor | no | - | PASS | survived-law-holds | ALL PROOFS CHECK |  |
| PS-r02 | refactor | no | - | FAIL | killed-law-holds |  |  |
| PS-r03 | refactor | no | - | FAIL | killed-law-holds |  |  |
| PO-m01 | mutant | no | - | FAIL | killed-law-holds |  |  |
| PO-m02 | mutant | yes | mix_leaves,sort_leaves | FAIL | true-kill |  |  |
| PO-m03 | mutant | yes | - | FAIL | killed-law-holds |  |  |
| PO-m04 | mutant | yes | sort_leaves | FAIL | true-kill |  |  |
| PO-m05 | mutant | yes | - | FAIL | killed-law-holds |  |  |
| PO-m06 | mutant | yes | - | FAIL | killed-law-holds |  |  |
| PO-m07 | mutant | yes | sort_leaves | FAIL | true-kill |  |  |
| PO-m08 | mutant | no | - | FAIL | killed-law-holds |  |  |
| PO-m09 | mutant | yes | - | PASS | survived-law-holds | ALL PROOFS CHECK |  |
| PO-r01 | refactor | no | - | PASS | survived-law-holds | ALL PROOFS CHECK |  |
| PO-r02 | refactor | no | - | PASS | survived-law-holds | ALL PROOFS CHECK |  |
| PO-r03 | refactor | no | - | FAIL | killed-law-holds |  |  |
| WB-m01 | mutant | yes | - | PASS | survived-law-holds | ALL PROOFS CHECK |  |
| WB-m02 | mutant | yes | you_cant_win,never_on_flag | FAIL | true-kill |  |  |
| WB-m03 | mutant | yes | - | FAIL | killed-law-holds |  |  |
| WB-m04 | mutant | yes | - | PASS | survived-law-holds | ALL PROOFS CHECK |  |
| WB-m05 | mutant | yes | you_cant_win,never_on_flag | FAIL | true-kill |  |  |
| WB-m06 | mutant | yes | you_cant_win,never_on_flag | FAIL | true-kill |  |  |
| WB-m07 | mutant | no | - | PASS | survived-law-holds | ALL PROOFS CHECK |  |
| WB-m08 | mutant | yes | - | FAIL | killed-law-holds |  |  |
| WB-m09 | mutant | yes | - | FAIL | killed-law-holds |  |  |
| WB-m10 | mutant | yes | - | FAIL | killed-law-holds |  |  |
| WB-m11 | mutant | yes | you_cant_win | FAIL | true-kill |  |  |
| WB-m12 | mutant | n/a | - | FAIL | stillborn |  | Error: - expected : an annotated term (cannot infer) |
| WB-r01 | refactor | no | - | PASS | survived-law-holds | ALL PROOFS CHECK |  |
| WB-r02 | refactor | no | - | PASS | survived-law-holds | ALL PROOFS CHECK |  |
| WB-r03 | refactor | no | - | PASS | survived-law-holds | ALL PROOFS CHECK |  |
| WB-r04 | refactor | no | - | PASS | survived-law-holds | ALL PROOFS CHECK |  |
| WB-r05 | refactor | no | - | PASS | survived-law-holds | ALL PROOFS CHECK |  |
| NU-m03b | mutant | yes | mul_comm,divmod_ok | FAIL | true-kill |  |  |
| WB-m12b | mutant | yes | you_cant_win,never_on_flag | FAIL | true-kill |  |  |

('mutant', 'killed-law-holds', 'chg') 7
('mutant', 'killed-law-holds', 'same') 2
('mutant', 'stillborn', 'n/a') 5
('mutant', 'survived-law-holds', 'chg') 4
('mutant', 'survived-law-holds', 'same') 3
('mutant', 'true-kill', 'chg') 39
('refactor', 'killed-law-holds', 'same') 7
('refactor', 'survived-law-holds', 'same') 18

mutants 60 stillborn 5 compiled 55
non-equivalent (behaviour changed) 50 killed 46 score 92.0%
  of which law false 39 killed 39
  of which law holds 11 killed (brittle) 7
score incl. stillborn as kills: 51/55 = 92.7%
equivalent mutants 5 proof broke 2
refactors 25 confirmed equivalent 25 proof broke 7 brittleness 28.0%
all behaviour-preserving edits 30 proof broke 9 30.0%
all edits where every law still holds 41 proof broke 16
unsound (gate PASS, law false) 0

per (edit, law) pairs: {('law-false', 'gate-FAIL'): 56, ('law-holds', 'gate-FAIL'): 47, ('law-holds', 'gate-PASS'): 93}
