# M0: freeze the vectors and expected outputs

**Date:** 2026-10-29.

**Status:** every registered M0 exit criterion is met. Two things qualify that. First, the sign-offs are by agents, not people. Second, the input-profile and settlement items under "Open before M1" must be closed before M1 builds against this set.

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
| `SIGNOFF.json` | Signers per item (workflow agent labels) and the basis for each sign-off |
| `ERRATA.json`, `SPEC_PROBLEMS.json` | Errata, input fixes, ambiguity rulings and open problems |

**Cost:** the workflow ran 17 agents for 3.9 hours and used about 7.6M subagent tokens.
