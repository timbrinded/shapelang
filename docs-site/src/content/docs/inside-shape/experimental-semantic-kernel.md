---
title: Experimental Semantic Kernel
description: Boundaries and measured results for the isolated Rust and browser-WASM checker prototype.
sidebar:
  order: 7
---

The experimental semantic kernel is a narrow feasibility prototype for
[#36](https://github.com/timbrinded/shapelang/issues/36) and
[#38](https://github.com/timbrinded/shapelang/issues/38). It answers one
question: can a deterministic Shape rule consume lowered facts through the same
strict protocol in native Rust and browser-targeted WebAssembly?

The prototype answer is yes for candidate-effect pin fingerprint matching. That
does not make the Rust crate a replacement checker.

## Boundary

The production TypeScript implementation remains authoritative. It still owns
parsing, lowering, all checker orchestration, diagnostic rendering, CLI
behavior, and editor services.

The experiment:

- accepts only protocol-v1 JSON, not Shape source
- handles only `resource`, `resource_fingerprint`, and `candidate_effect` facts
- emits only `candidate_pin_fingerprint_mismatch` diagnostics
- preserves structured provenance for the candidate, anchor, and actual
  fingerprint
- has no production CLI, editor, parser, or release dependency
- writes native, WASM, generated JavaScript, declarations, and its locally
  installed `wasm-bindgen` tools under the ignored experiment `target/`

The authored Shape model also forbids `calls` paths from `ShapeChecker`,
`ShapeEditorServices`, and `ShpCli` to `ExperimentalSemanticKernel`. CI may build
and test the experiment, but production surfaces cannot acquire it as a
dependency without an explicit contract change.

## Protocol v1

The TypeScript adapter projects the relevant public checker facts. Rust rejects
unknown fields, duplicate fact identities, and unsupported schema versions
rather than silently accepting an ambiguous contract. Both successful surfaces
serialize the same response bytes.

The checked-in JSON Schema at
`experiments/semantic-kernel/schema/kernel-protocol-v1.schema.json` documents the
request and response:

```json
{
  "schemaVersion": 1,
  "facts": [
    {
      "kind": "candidate_effect",
      "name": "CandidateAppend",
      "anchor": "AppendAnchor",
      "fingerprintProvider": "ast.semantic_subtree_v1",
      "fingerprintValue": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      "provenance": {
        "filePath": "pin-stale.shape",
        "label": "candidate effect CandidateAppend"
      }
    }
  ]
}
```

Incomplete candidate pins and unknown anchors are skipped, matching the
production rule. A known anchor with a missing or stale provider fingerprint
produces one ordered causal diagnostic. Optional string fields may be absent but
cannot be `null`; absent fields are also omitted from responses. Causes are
exactly candidate then anchor, followed by the actual fingerprint only when one
exists.

Protocol diagnostics are sorted by qualified semantic fields, so input fact
order cannot change output order. Production presentation instead sorts rendered
diagnostic text. The parity harness therefore compares normalized semantic
diagnostic sets and tests protocol ordering separately; it does not claim that
the two presentation orders are identical.

## Native and browser-WASM surfaces

The crate pins Rust 1.96.0 and `wasm-bindgen` 0.2.126. The build script compiles
the same library for the native host and `wasm32-unknown-unknown`, then invokes
the exactly matching `wasm-bindgen` CLI with `--target web --typescript`.

From the repository root:

```sh
bun run kernel:check
bun run kernel:build
bun run kernel:e2e
```

`kernel:e2e` parses the current and stale fixtures with the production parser,
requests public lowered facts, and exercises both experimental surfaces. It
checks:

- semantic parity with the production candidate-pin rule
- multi-module semantic-set parity and deterministic protocol ordering
- byte-identical native and browser-WASM JSON
- stable causal provenance and file paths
- strict failure for a future schema version, duplicate fact identities, unknown
  request/fact fields, explicit `null` optional strings, and truncated JSON
- the generated TypeScript declaration for the WASM export

The CI job repeats those checks and uploads the browser-targeted JavaScript,
declaration, and WASM files as a seven-day diagnostic artifact. Those files are
not release assets.

## Measured result

Run `bun run kernel:bench` after `kernel:build`. The benchmark has warmups and
reports medians; it deliberately has no pass/fail threshold.

One local run on 26 July 2026 on Linux x64 with Bun 1.3.14 produced:

| Candidate pins | TypeScript full check | Native JSON process | WASM JSON call |
| ---: | ---: | ---: | ---: |
| 1 | 0.924 ms | 0.591 ms | 0.041 ms |
| 100 | 11.98 ms | 1.30 ms | 0.674 ms |
| 1,000 | 88.53 ms | 6.96 ms | 5.75 ms |

The browser-targeted WASM artifact was 202.9 KiB uncompressed.

These columns do not measure equivalent end-to-end work. The TypeScript column
parses Shape source, lowers the model, and runs the full production checker. The
native and WASM columns start from an already projected JSON fact envelope and
run one rule; the native measurement also includes process startup while the
WASM instance is warm and in-process. The numbers establish feasibility and
scaling data, not a production speedup claim.

## Adoption criteria

The experiment should stay isolated until a follow-up design can demonstrate:

- a versioned fact and diagnostic protocol for every migrated rule
- production-parity fixtures for precedence, ordering, malformed input, and
  provenance
- a browser integration strategy that includes initialization and delivery
  costs
- an explicit ownership decision for parsing, lowering, orchestration, and
  diagnostic rendering
- release packaging and compatibility policy reviewed separately from this
  prototype

Until then, new checker semantics belong in the production TypeScript rule
engine.
