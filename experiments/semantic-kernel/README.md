# Experimental semantic kernel

This directory is an isolated feasibility prototype for issues
[#36](https://github.com/timbrinded/shapelang/issues/36) and
[#38](https://github.com/timbrinded/shapelang/issues/38). It asks one question:
can a deterministic Shape rule consume lowered facts through the same strict
protocol in native Rust and in browser-targeted WebAssembly? For
candidate-effect pin fingerprint matching, the prototype's answer is yes. That
shows protocol parity for one narrow rule over already-lowered facts; it does
not make the crate a replacement checker or a general rule engine.

The production TypeScript checker remains the only semantic authority for
parsing, lowering, rule orchestration, diagnostic rendering, the CLI, and editor
services. Why production rules are direct TypeScript checks is recorded in
[Rule Evaluation](../../docs-site/src/content/docs/inside-shape/rule-evaluation.md).

## Boundary

The kernel:

- accepts only protocol-v1 JSON, never Shape source;
- reads only `resource`, `resource_fingerprint`, and `candidate_effect` facts;
- emits only `candidate_pin_fingerprint_mismatch` diagnostics, with structured
  provenance for the candidate, the anchor, and the actual fingerprint;
- writes the native binary, the WASM module, the generated JavaScript and
  declarations, and its locally installed `wasm-bindgen` CLI under the ignored
  `target/` directory.

The CLI, editor services, parser, formatter, and release archives have no
dependency on this crate or its generated output. The dependency runs the other
way: the harness uses the production parser and checker to produce facts.

The Shape rule `ExperimentalSemanticKernelIsolation` in `shape/runtime.shape`
forbids a modeled `calls` path from `ShapeChecker`, `ShapeEditorServices`, or
`ShpCli` to `ExperimentalSemanticKernel`. Declaring such a dependency requires
changing that rule. CI may build and test the kernel.

## Protocol v1

`harness/protocol.ts` projects the three fact kinds from the checker's public
`Fact[]` (returned with `includeFacts: true`) into a request.
`schema/kernel-protocol-v1.schema.json` documents the request and response.
This request is projected from `fixtures/pin-stale.shape`:

```json
{
  "schemaVersion": 1,
  "facts": [
    {
      "kind": "candidate_effect",
      "name": "experimental.kernel::AppendEventCandidate",
      "anchor": "experimental.kernel::AppendEventAnchor",
      "fingerprintProvider": "ast.semantic_subtree_v1",
      "fingerprintValue": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      "provenance": {
        "filePath": "pin-stale.shape",
        "label": "effect candidate experimental.kernel::AppendEventCandidate"
      }
    },
    {
      "kind": "resource",
      "name": "experimental.kernel::AppendEventAnchor",
      "provenance": {
        "filePath": "pin-stale.shape",
        "label": "resource experimental.kernel::AppendEventAnchor"
      }
    },
    {
      "kind": "resource",
      "name": "experimental.kernel::AuditEvent",
      "provenance": {
        "filePath": "pin-stale.shape",
        "label": "resource experimental.kernel::AuditEvent"
      }
    },
    {
      "kind": "resource_fingerprint",
      "resource": "experimental.kernel::AppendEventAnchor",
      "provider": "ast.semantic_subtree_v1",
      "value": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "provenance": {
        "filePath": "pin-stale.shape",
        "label": "resource experimental.kernel::AppendEventAnchor fingerprint ast.semantic_subtree_v1"
      }
    }
  ]
}
```

The native kernel answers with one diagnostic (printed as a single line;
pretty-printed here):

```json
{
  "schemaVersion": 1,
  "ok": false,
  "diagnostics": [
    {
      "kind": "candidate_pin_fingerprint_mismatch",
      "candidateEffect": "experimental.kernel::AppendEventCandidate",
      "anchor": "experimental.kernel::AppendEventAnchor",
      "provider": "ast.semantic_subtree_v1",
      "expected": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      "actual": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "causes": [
        {
          "role": "candidate_effect",
          "provenance": {
            "filePath": "pin-stale.shape",
            "label": "effect candidate experimental.kernel::AppendEventCandidate"
          }
        },
        {
          "role": "anchor",
          "provenance": {
            "filePath": "pin-stale.shape",
            "label": "resource experimental.kernel::AppendEventAnchor"
          }
        },
        {
          "role": "actual_fingerprint",
          "provenance": {
            "filePath": "pin-stale.shape",
            "label": "resource experimental.kernel::AppendEventAnchor fingerprint ast.semantic_subtree_v1"
          }
        }
      ]
    }
  ]
}
```

The rule matches the production `checkCandidateEffectFingerprints`:

- A candidate that lacks an anchor, a fingerprint provider, or a fingerprint
  value is skipped, and so is a candidate whose anchor has no `resource` fact.
- A known anchor that has no fingerprint for the provider, or a different
  value, produces one diagnostic.
- `causes` lists the candidate, then the anchor, then the actual fingerprint
  only when one exists.
- `ok` is `true` exactly when `diagnostics` is empty.

The protocol is strict:

- `schemaVersion` must be `1`.
- Unknown fields in the request, a fact, or a provenance are rejected.
- Duplicate fact identities are rejected: a resource by `name`, a fingerprint
  by `resource` and `provider`, and a candidate by `name`.
- Optional strings (`anchor`, `fingerprintProvider`, `fingerprintValue`, and
  provenance `filePath`) may be absent but never `null`. Absent fields are also
  omitted from responses.
- Malformed JSON is rejected.

A rejected request makes the native binary exit `2` with the error on stderr and
nothing on stdout, and makes the WASM export throw. Successful requests produce
byte-identical responses from both surfaces.

Protocol diagnostics are sorted by their qualified fields (`candidateEffect`,
`anchor`, `provider`, `expected`, `actual`), so input fact order cannot change
output order. Production sorts by diagnostic kind, then by rendered text, and
rendered text uses local display names without module qualifiers. The two
orders can therefore differ: for candidates `a::CandidateZ` and
`z::CandidateA`, the protocol puts `a::CandidateZ` first and production puts
`z::CandidateA` first. The parity harness compares normalized semantic
diagnostic sets and tests protocol ordering separately.

## Native and browser-WASM surfaces

The crate is both an `rlib` and a `cdylib`. `src/main.rs` reads a request on
stdin and writes the response to stdout. The WASM build exports
`check_facts_json(input: string): string`.

The build needs `rustup`: `rust-toolchain.toml` pins Rust 1.96.0 with the
`wasm32-unknown-unknown` target, `clippy`, and `rustfmt`, and only rustup reads
that file. `Cargo.toml` pins `wasm-bindgen` to 0.2.126.

Run from the repository root:

```sh
bun run kernel:check   # cargo fmt --check, clippy with -D warnings, cargo test
bun run kernel:build   # native release binary, then scripts/build-wasm.sh
bun run kernel:e2e
bun run kernel:bench
```

`kernel:build` compiles the native binary and the `wasm32-unknown-unknown`
library. `scripts/build-wasm.sh` installs `wasm-bindgen-cli` 0.2.126 under
`target/tools` when the exact version is missing, then runs it with
`--target web --typescript` to write `target/wasm-web/`; `wasm-bindgen-cli` is
never installed globally. `kernel:e2e` and `kernel:bench` load those build
outputs and fail until `kernel:build` has run.

`kernel:e2e` parses the fixtures in `fixtures/` with the production parser,
requests the public lowered facts, and exercises both surfaces. It checks:

- semantic parity with the production candidate-pin rule;
- multi-module semantic-set parity and deterministic protocol ordering;
- byte-identical native and browser-WASM JSON;
- stable causal provenance and file paths;
- strict rejection of a future schema version, duplicate fact identities,
  unknown request and fact fields, explicit `null` optional strings, and
  truncated JSON;
- the generated TypeScript declaration for the WASM export.

The Semantic Kernel Prototype CI job runs `kernel:check`, `kernel:build`, and
`kernel:e2e`, then uploads the browser-targeted JavaScript, declaration, and
WASM files as a diagnostic artifact kept for seven days. Those files are not
release assets.

## Measured result

`bun run kernel:bench` reports medians after warmups: 7 samples after 2
warmups for the TypeScript check, 5 after 1 for the native process, and 21 after
3 for the WASM call. It deliberately has no pass or fail threshold.

One local run on 26 July 2026, on Linux x64 with Bun 1.3.14, produced:

| Candidate pins | TypeScript full check | Native JSON process | WASM JSON call |
| ---: | ---: | ---: | ---: |
| 1 | 0.924 ms | 0.591 ms | 0.041 ms |
| 100 | 11.98 ms | 1.30 ms | 0.674 ms |
| 1,000 | 88.53 ms | 6.96 ms | 5.75 ms |

The browser-targeted WASM artifact was 202.9 KiB uncompressed.

The columns do not measure equivalent work:

- The TypeScript column parses the Shape source, lowers the model, and runs the
  full production checker with bindings disabled (`enforceBindings: false`) and
  facts requested (`includeFacts: true`).
- The native and WASM columns start from an already projected JSON fact
  envelope and run one rule.
- The native measurement includes process startup; the WASM instance is loaded
  once and called in-process.

The numbers establish feasibility and scaling data, not a production speedup.

## Adoption criteria

The kernel stays isolated until a follow-up design demonstrates:

- a versioned fact and diagnostic protocol for every migrated rule;
- production-parity fixtures for precedence, ordering, malformed input, and
  provenance;
- a browser integration strategy that includes initialization and delivery
  costs;
- an explicit ownership decision for parsing, lowering, orchestration, and
  diagnostic rendering;
- release packaging and a compatibility policy, reviewed separately from this
  prototype.

Until then, new checker semantics belong in the production TypeScript rules
under `packages/shp-checker/src/checker/rules/`.
