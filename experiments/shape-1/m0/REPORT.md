# M0: freeze the vectors and expected outputs

**Date:** 2026-10-29.

**Status:** every registered M0 exit criterion is met. Two things qualify that. First, the sign-offs are by agents, not people. Second, the input-profile and settlement items under "Open before M1" had to be closed before M1 builds against this set; the settlement below (annex A.16) closes them, except six questions that need a decision.

## Exit criteria

| Criterion ([REGISTERED.md](REGISTERED.md)) | Result |
|---|---|
| `python3 -I vectors.py` asserts no floats | Yes. The check was extended to tuples and to ASCII keys, which JCS needs (erratum 6); no printed value changed. |
| A script diff of every 16-hex value in the examples and A.12.11 against vectors.py finds 0 mismatches | [hexcheck.py](hexcheck.py): 68 values (EXAMPLES 48, RECORDS 2, A.12.11 18), 0 mismatches. The first runs found 4 mismatches; errata 1–5 fixed them. vectors.py had missed two L1 parts at `appendEvent` in Example 1 Variant C, which changed the binding, the approve refs and the answer subject digests in EXAMPLES and A.14 that depend on them. A fifth erratum renames a vector whose name carried a version 6 reading. |
| The 52 vectors of A.11.2.4 as input/expected-output pairs | [vectors/](vectors/): 52 vectors, 128 cases, 408 assertions. The assertion format is in [FORMAT.md](vectors/FORMAT.md); the runner is [check.ts](vectors/check.ts). |
| Golden core outputs for the 21 example inputs, regenerated for version 7 | [golden/](golden/): 21 outputs as RFC 8785 JCS bytes. Version 7 copies of the inputs are in [golden/inputs/](golden/inputs/), and per-file deltas against version 6 are in [deltas.json](golden/deltas.json). |
| A version 7 `manual.json` for the 33 H4 cases | [h4/manual.json](h4/manual.json): 33 rows. |
| The expected outcome of each H2 seed under version 7, per arm | [h2/expectations.json](h2/expectations.json): 152 rows (76 seeds × 2 arms). |
| The M5 criteria | Registered in [REGISTERED.md](REGISTERED.md) (commit `b2ea333`) before any run. |
| Two sign-offs per item, at least one by a reviewer who wrote no part of it | [SIGNOFF.json](SIGNOFF.json): 614 of 614 items have two signers, at least one of them independent. |

## Method: double entry

- **Vectors, H4 and H2** were derived twice: by an author, and by a blind agent who saw only the inputs and the questions. The blind agents for H4 and H2 were barred from the version 6 readings. The workflow compared the two derivations mechanically, and an adjudicator settled every disagreement against the version 7 text.
- **Golden outputs** were too large to derive twice. Instead, two independent reviewers recomputed every new or changed key and checked each delta against the text.

| Artifact | Items | First derivations agree | Adjudicated | Outcome |
|---|---:|---:|---|---|
| Vectors, group A (27) | 212 assertions | 208 | 4 assertions + 4 input problems | The provider-direction inputs lacked fact `n`, so RJ14 rejected them. The vector was fixed and re-derived, and a second blind derivation agreed on every assertion. |
| Vectors, group B (25) | 186 assertions | 185 | 1 assertion (blind side chosen; ambiguity) + 4 input problems | — |
| H4 manual reading | 33 rows | 22 | 11 rows: blind side 10, author 1; 5 ambiguities | — |
| H2 expectations | 152 rows | 145 | 7 rows: author 5, blind 2; 2 ambiguities | — |
| Golden outputs | 21 files | — | Both reviewers passed 21 of 21 with 0 must-fix issues | 71 minor issues, in [golden/minor-issues.json](golden/minor-issues.json) |

The H4 adjudications are the warning sign. The author, who started from the version 6 reading, was overruled on 10 of 11 disputed rows; the blind reader, barred from the version 6 reading, was preferred. Starting from the old answers anchored the author on them.

## Baseline: version 6 against the frozen set

| Implementation | Vectors | Golden outputs |
|---|---|---|
| Prototype (version 6) | 267 of 408 assertions pass (65%) | 21 of 21 differ, in content as well as serialisation (version 6 prints indented JSON, not JCS) |
| Lean kernel (version 6), through the DRT pre-pass | 212 pass, 140 fail, 56 not run (sections or fields shapek does not print) | — |

These are the starting points for M1 and M2.

## Open before M1

1. **Input profile.**
   - Every frozen input, including the original example inputs, uses the prototype's source profile: `head.source` and `base.source` as `shape.source.v1` documents, rather than the RECORDS §4 contract (`files [{path, text}]`, `commit`, `packs`, `trustRoots`).
   - Their manifests are unsigned, bare statements.
   - So the set does not exercise shape-file blob ids (A.3.1.1, A.12.7.3), pack pins or parsing.
   - Either the annex admits the source profile as a conformance profile, with a few full-contract vectors added, or every input is converted.
2. **Claim judgments in `records`.** Several vectors supply self-signed claim judgments in `records`, but D28, A.5.8.2 and A.7.6.8 describe them as persisted under `shape/evidence/`. No RJ code rejects them in `records`, and the text never says whether they may appear there.
3. **Spec problems.**
   - [SPEC_PROBLEMS.json](SPEC_PROBLEMS.json) holds 108 places where an M0 agent found the text silent, ambiguous or inconsistent (with overlap).
   - [ERRATA.json](ERRATA.json) records the adjudicated readings, among them 10 ambiguity rulings, and 7 notes on EXAMPLES.md. Two examples:
     - the empty base's L7 reading of a new manifest identity;
     - Example 3 Step 1 needing a relay to persist its judgment.
   - These must be settled in the annex. Otherwise M1 and M2 will each pick a reading, and the differential gate will report the difference as residual.

## Settlement (A.16), 2026-10-29

After the freeze, a settlement pass wrote annex A.16 ([spec/ANNEX.md](../spec/ANNEX.md), 37 settlements) for the three items above. A review raised 7 must-fix issues, and a finaliser resolved them in the text and the frozen set.

- **Input profile (item 1).**
  - A.16.1 fixes the full profile of RECORDS §4. A.16.2 admits the source profile for conformance sets only. It defines `shape.source.v1` with the four version 7 fields (`manifest`, actor `was`, `exceptPaths`, implementation `ids`), says how a checker processes it, and says how a frozen input converts to the full profile. A.16.3 gives the canonical form.
  - Four full-profile vectors cover what the source profile skips (A.16.1(g)): `full-profile-blob-ids`, `full-profile-pack-pins`, `full-profile-parse-failure` and `full-profile-manifest-identity`, with 20 cases and 43 assertions. The set is now 56 vectors, 148 cases and 451 assertions.
  - The registered M1 and M2 exits still name "the 52 M0 vectors". Under [REGISTERED.md](REGISTERED.md)'s rule, adding the four to them needs an owned, dated change recorded in the RFC.
- **Claim judgments in records (item 2).** A.16.4: a claim judgment is an act of this change unless it is a persisted judgment of an earlier change, so supplying it in records never escapes the authorship bar (D12). Golden ex3-step1 and ex3-step1-judged now carry tim's base-era judgment in `persisted.base` and `persisted.head`. Only their `inputDigest` changed.
- **Spec problems (item 3).** A.16 settles every problem except six that need a decision rather than a reading:
  - a refutation re-introduced by every edit to its footprint (D7; SP 87, 98);
  - unchanged code relocated across a component boundary introducing nothing (A.7.3.1, D6; SP 102);
  - whether M5's H2 harness supplies base-revision test records (SP 86, 97);
  - migrate's bind-by-name against explicit 0.x binds (SP 104, M4);
  - Rust and Verus `refs` resolution (SP 17, M3);
  - std 1.0.0's published pack bytes (SP 1, conversion part).

  Who answers L0 over an unreadable base is read as A.11.1 reads a 0.x base (A.16.16), with no self fallback. The trade-off is recorded as open: A.11.6 (19) and question 10 of [OPEN_QUESTIONS.md](../spec/OPEN_QUESTIONS.md).
- **Frozen values changed.**
  - A.16.17: ex1-empty-base.
  - A.16.19: the producer-changed bindings of dropped-harness/record-present, judges-narrowing-no-fallback, producer-change-assumption and ex3-step2-harness-edited, and the review lines that name them.
  - A.16.27: ex4 and ex4-closing-the-set.
  - A.16.4: ex3-step1 and ex3-step1-judged.

  Their sign-offs, and those of the 43 new assertions, are in [SIGNOFF-settlement.json](SIGNOFF-settlement.json). SIGNOFF.json marks the 19 items it supersedes.
- **Measured on 2026-10-29.**
  - `python3 -I experiments/shape-1/m0/hexcheck.py`: 68 of 68 values match.
  - `bun experiments/shape-1/m0/vectors/check.ts` (version 6 prototype): 275 of 451 assertions pass, with 0 format errors.
    - On the 52 vectors, 261 of 408 pass. That is 6 fewer than at the freeze, all from A.16.19's bindings.
    - On the four full-profile vectors, 14 of 43 pass. The version 6 prototype calls every full-profile input invalid, so only the `invalid` assertions match.

## Files

| Path | Contents |
|---|---|
| `REGISTERED.md` | Exit criteria for M0, M1, M2 and M5, dated 2026-10-29 |
| `hexcheck.py`, `hexcheck-errata.json` | The hash check (`python3 -I experiments/shape-1/m0/hexcheck.py`) and its staged measurements and errata |
| `vectors/<id>/` | Inputs (`*.input.json`) and `expected.json` for each vector |
| `vectors/check.ts` | The runner: `bun experiments/shape-1/m0/vectors/check.ts [--impl proto\|kernel]` |
| `vectors/V6_DIFFERS.json` | Per vector, where version 6 reads the inputs differently |
| `golden/` | The 21 golden outputs, version 7 inputs, deltas, generator tools and minor issues |
| `h4/manual.json`, `h2/expectations.json` | Frozen readings |
| `SIGNOFF.json`, `SIGNOFF-settlement.json` | Signers per item (workflow agent labels) and the basis for each sign-off; the second holds the settlement's re-signed items and the full-profile vectors |
| `ERRATA.json`, `SPEC_PROBLEMS.json` | Errata, input fixes, ambiguity rulings and open problems |

**Cost:** the workflow ran 17 agents for 3.9 hours and used about 7.6M subagent tokens.
