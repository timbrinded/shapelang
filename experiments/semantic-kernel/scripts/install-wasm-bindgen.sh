#!/usr/bin/env bash
set -euo pipefail

crate_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tools_root="$crate_root/target/tools"
wasm_bindgen="$tools_root/bin/wasm-bindgen"
wasm_bindgen_version="0.2.126"
expected_version="wasm-bindgen $wasm_bindgen_version"

if [[ -x "$wasm_bindgen" ]] && [[ "$("$wasm_bindgen" --version)" == "$expected_version" ]]; then
  echo "Using $expected_version from $tools_root."
  exit 0
fi

cd "$crate_root"
cargo install wasm-bindgen-cli \
  --version "$wasm_bindgen_version" \
  --locked \
  --root "$tools_root" \
  --force

actual_version="$("$wasm_bindgen" --version)"
if [[ "$actual_version" != "$expected_version" ]]; then
  echo "error: expected $expected_version, got $actual_version" >&2
  exit 1
fi
