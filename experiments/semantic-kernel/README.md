# Experimental Semantic Kernel

This directory is an isolated prototype for issues
[#36](https://github.com/timbrinded/shapelang/issues/36) and
[#38](https://github.com/timbrinded/shapelang/issues/38). It evaluates one
fact-complete rule—candidate-effect pin fingerprint matching—through the same
strict JSON protocol in a native Rust process and browser-targeted WebAssembly.

It is not the production checker. The CLI, editor services, parser, formatter,
and release archives have no dependency on this crate or its generated output.
Build products and the locally installed `wasm-bindgen` CLI stay under the
ignored `target/` directory.

## Commands

Run from the repository root:

```sh
bun run kernel:check
bun run kernel:build
bun run kernel:e2e
bun run kernel:bench
```

`kernel:build` selects Rust 1.96.0 from `rust-toolchain.toml`, compiles the
native binary and `wasm32-unknown-unknown` library, and installs
`wasm-bindgen-cli` 0.2.126 under `target/tools` when needed. Nothing is installed
globally.

The E2E harness:

- parses committed Shape fixtures with the production TypeScript parser and
  lowerer
- projects only `resource`, `resource_fingerprint`, and `candidate_effect`
  public facts into protocol v1
- compares normalized production semantics with native Rust and
  browser-targeted WASM, including a multi-module diagnostic set
- requires byte-identical native/WASM JSON, ordered causal provenance, and
  rejection of unsupported versions, duplicate fact identities, unknown fields,
  explicit `null` optionals, and malformed JSON

See the
[experimental kernel documentation](../../docs-site/src/content/docs/inside-shape/experimental-semantic-kernel.md)
for boundaries, protocol details, and measured results.
