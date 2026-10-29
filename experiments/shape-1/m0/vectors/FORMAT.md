# M0 vector format

An M0 vector fixes the expected checker output for one rule of the version 7 text. The set holds
56: the 52 that A.11.2.4 lists, and the four full-profile vectors that A.16.1(g) adds
(`full-profile-blob-ids`, `full-profile-pack-pins`, `full-profile-parse-failure` and
`full-profile-manifest-identity`). A vector is a directory `experiments/shape-1/m0/vectors/<id>/`
holding `expected.json` and, optionally, the input files its cases name; the runner skips a
directory without `expected.json`. [`check.ts`](check.ts) runs the vectors against an
implementation.

## `expected.json`

```json
{
  "vector": "<id>",
  "title": "<one line: what the vector shows>",
  "decides": ["A.7.3.3", "D5"],
  "cases": [
    {
      "case": "<name, unique in the vector>",
      "input": "input.json",
      "assert": [
        {
          "in": "obligations",
          "select": { "kind": "contradiction", "claim.fp": "sha256:…" },
          "check": "fields",
          "value": { "introduced": false, "severity": "owed" },
          "why": "A.7.3.3 [D5]: no new lifted edge, so the contradiction is preexisting"
        }
      ]
    }
  ]
}
```

| Field | Content |
|---|---|
| `vector` | the directory name `<id>`; the runner rejects any other value |
| `title` | one line saying what the vector shows |
| `decides` | a clause or a non-empty list of clauses (annex `A.n`, core `§n`, RFC `Dn`) that the vector decides |
| `cases` | a non-empty list of cases |
| `case` | the case name, unique within the vector |
| `input` | a `shape.check.input/v1` object, or a string naming a JSON file holding one. A relative path resolves against the vector's directory; the frozen vectors name their files relative to it. The input is in one of two profiles: the full profile of RECORDS §4 and A.16.1 (`files`, `commit`, `packs`, `trustRoots`; the four `full-profile-*` vectors), or the source profile of A.16.2 (`head.source` and `base.source` as `shape.source.v1` documents; the other 52). |
| `assert` | a non-empty list of assertions |

## Assertions

An assertion is exactly the object `{"in", "select", "check", "value", "why"}`. Any other key is a
format error.

**`in`** names a top-level field of the core output `shape.check.output/v1` (records §5, A.12.10).
The section's kind is fixed:

| Kind | Sections |
|---|---|
| array | `errors`, `rejected`, `obligations`, `answered`, `loosening`, `renames`, `debt`, `preexisting` |
| scalar | `verdict`, `order` (`order` is `null` in audit mode) |
| object | `budget`, `health` |

**`select`** picks elements of an array section. It is an object mapping dotted paths to values,
and an element is selected when it meets every condition. `{}` selects every element. Scalar and
object sections take `{}` only.

**`check`** is one of three forms:

| `check` | Section kind | `value` | Passes when |
|---|---|---|---|
| `count` | array | a non-negative integer | the number of selected elements equals `value` |
| `fields` | array | an object mapping dotted paths to values | exactly one element is selected and each path holds exactly its value |
| `equals` | scalar or object | any JSON value | the whole section is exactly `value` |

Assert absence with `count` and the value `0`.

**`why`** is the deciding clause and one line of reasoning, for example
`"A.7.5.1 rule 2: introduced sound contradiction at tier* final"`. It must not be empty.

### Paths and comparison

- **Path segments.** A dotted path such as `claim.fp` or `subject.code` walks object keys from the
  element. A segment of digits indexes an array, as in `questions.0`. No key in the output
  contract contains a dot.
- **Walking through an array.** A non-numeric segment applied to an array is applied to each
  element. The result is the list of the values found. For example, `dischargers.act` gives
  `["edit-code", "edit-shape"]`.
- **Missing paths.** A path that leads nowhere is absent. An absent path never meets a condition and
  never equals a value, not even `null`. The output contract prints every field, with `null` where
  it is empty, so an implementation that omits a field fails.
- **Conditions in `select`.** A condition on a scalar or object field holds iff the field equals the
  value exactly. A condition on an array-valued field holds iff the array contains the value as an
  element, or the condition's value is itself an array equal to the field. For example,
  `{"questions": "L1"}` selects loosenings whose questions include `L1`.
- **Values in `fields` and `equals`.** These compare exactly, arrays included, with no containment
  rule.
- **Equality.** Equality is JSON equality: key order does not matter, but array order does.
- **Hash values.** Keys, group ids, bindings, refs and digests are written in full, in the form the
  output contract prints them: `sha256:<64 hex>`, `ob:<64 hex>`, `bd:<64 hex>`, `g:<64 hex>`.
  Compute them with the functions in `experiments/shape-1/spec/vectors/vectors.py`, run with
  `python3 -I`. Prefixes are never matched.

## Runner

```sh
bun experiments/shape-1/m0/vectors/check.ts [--impl proto|kernel] [--root DIR] [--vector ID]...
    [--cmd "ARGV"] [--shapek PATH] [--timeout MS] [--strict] [--quiet] [--json OUT] [--self-test]
```

- **`--impl proto`** (the default) pipes each case's input into
  `bun experiments/shape-1/proto/src/cli.ts check --input - --core` and reads the output from
  stdout.
- **`--cmd "ARGV"`** replaces that command with another stdin implementation, such as a version 7
  build. The argument list is split on whitespace and takes no quoting.
- **`--impl kernel`** runs `experiments/shape-1/kernel/.lake/build/bin/shapek` (or the path given
  with `--shapek`) on the `shape.kernel.case/v1` that the DRT pre-pass builds from the input. The
  pre-pass is `kernelCase` in `experiments/shape-1/trials/DRT/drtlib.ts`. It uses the prototype's
  elaboration, record validation, authors\* and cells.

  The kernel prints a subset of the output contract:

  | Section | What the kernel prints |
  |---|---|
  | `verdict` | the verdict |
  | `errors` | `code` and `subject` |
  | `obligations` | the 18 fields in drtlib's `OB_FIELDS` |
  | `answered` | `obligation` and `as` |
  | `debt` | `obligation`, `exception`, `owner` and `expiresInDays` |

  The runner prints **NOT RUN**, with the reason, for each assertion the kernel route cannot
  evaluate:
  - an assertion on `rejected`, `loosening`, `order`, `renames`, `preexisting`, `budget` or
    `health`;
  - an assertion on a field the kernel does not print;
  - `verdict`, or `errors` without a kernel error code, when the pre-pass raised shape errors. The
    kernel never sees those errors; it raises only E-conduct, E-structure, E-provider-missing and
    E-exception.

  The runner skips a whole case when:
  - the input has no `head.source`, because the converter elaborates `shape.source.v1`;
  - the pre-pass throws;
  - the pre-pass finds the input invalid.

  It also notes any review lines the converter dropped.

### Output and exit status

- **Output.** The runner prints one line per assertion: `PASS`, `FAIL` (with what it got) or
  `NOT RUN` (with the reason). A summary follows.
- **`--json OUT`** also writes the results to `OUT`.
- **Exit status.**
  - 1 on any failed assertion, format error or implementation error, and when `--root` holds no
    vectors. `--strict` also counts NOT RUN as a failure.
  - 2 on a usage error.
  - 0 otherwise.
- **Exit code warning.** The runner also warns when the implementation's exit code disagrees with
  its verdict (A.12.10.5: 0 pass or owed, 1 blocked, 2 invalid). The warning does not change the
  exit status.

**`--self-test`** first runs the vectors under `--root`, where no assertion may fail. NOT RUN
assertions are excluded unless `--strict` is given. It then checks that the runner cannot pass
vacuously:
- **Mutants.** It mutates each assertion in memory: `count` gets `value + 1`, and `fields` and
  `equals` get a changed value. It reruns each mutant against the same outputs, and every mutant
  must fail.
- **Malformed vectors.** It feeds in a set of malformed vectors, and each must be rejected as a
  format error.

The runner's own test vectors live outside the repository, in the session scratch area under
`shape1work/m0/runner-selftest/`. They are written against the version 6 prototype's own output
and are not M0 vectors.
