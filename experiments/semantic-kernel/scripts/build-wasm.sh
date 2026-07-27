#!/usr/bin/env bash
set -euo pipefail

crate_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
wasm_bindgen="$crate_root/target/tools/bin/wasm-bindgen"
wasm_input="$crate_root/target/wasm32-unknown-unknown/release/shape_semantic_kernel.wasm"
output_dir="$crate_root/target/wasm-web"

"$crate_root/scripts/install-wasm-bindgen.sh"

cd "$crate_root"
cargo build --locked --release --lib --target wasm32-unknown-unknown
mkdir -p "$output_dir"
"$wasm_bindgen" \
  --target web \
  --typescript \
  --out-name shape_semantic_kernel \
  --out-dir "$output_dir" \
  "$wasm_input"

echo "Built browser-targeted bindings in $output_dir."
