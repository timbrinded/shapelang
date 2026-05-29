#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
bin_dir="$repo_root/dist/bin"
release_dir="$repo_root/dist/release"
release_version="${SHAPE_RELEASE_VERSION:-${GITHUB_REF_NAME:-latest}}"
release_version_sed="$(printf '%s' "$release_version" | sed -e 's/[\\&|]/\\&/g')"
tree_sitter_native_assets=()

if ! command -v zstd >/dev/null 2>&1; then
  echo "error: zstd is required to extract tree-sitter parser bundles" >&2
  exit 1
fi

resolve_native_asset() {
  local specifier="$1"
  local native_asset=""

  if [[ -z "$specifier" ]]; then
    return
  fi

  if ! native_asset="$(
    cd "$repo_root"
    SPECIFIER="$specifier" bun -e 'const { createRequire } = require("node:module"); const requireFromChecker = createRequire(process.cwd() + "/packages/shp-checker/src/ast-generation.ts"); const specifier = process.env.SPECIFIER; if (!specifier) process.exit(2); console.log(requireFromChecker.resolve(specifier));'
  )"; then
    echo "error: failed to resolve $specifier" >&2
    exit 1
  fi

  if [[ -z "$native_asset" || ! -f "$native_asset" ]]; then
    echo "error: resolved native parser asset for $specifier does not exist: ${native_asset:-<empty>}" >&2
    exit 1
  fi

  tree_sitter_native_assets+=("$native_asset")
}

while IFS= read -r specifier; do
  resolve_native_asset "$specifier"
done < <(
  cd "$repo_root"
  bun -e 'import { treeSitterNativePackageSpecifiers } from "./packages/shp-checker/src/ast-generation.ts"; for (const specifier of treeSitterNativePackageSpecifiers()) console.log(specifier);'
)

rm -rf "$bin_dir" "$release_dir"
mkdir -p "$bin_dir" "$release_dir"

build_asset() {
  local target="$1"
  local asset_name="$2"
  local executable_name="$3"
  local asset_dir="$bin_dir/$asset_name"

  mkdir -p "$asset_dir"

  bun build "$repo_root/packages/shp-cli/src/index.ts" \
    "${tree_sitter_native_assets[@]}" \
    --compile \
    --asset-naming="[name].[ext]" \
    --target="$target" \
    --outfile="$asset_dir/$executable_name"

  chmod +x "$asset_dir/$executable_name" 2>/dev/null || true
  cp "$repo_root/LICENSE" "$asset_dir/LICENSE"
  bun "$repo_root/scripts/prepare-tree-sitter-parser-assets.ts" \
    --release-name "$asset_name" \
    --out-dir "$asset_dir"

  tar -C "$asset_dir" -czf "$release_dir/$asset_name.tar.gz" \
    "$executable_name" \
    LICENSE \
    tree-sitter-language-pack
}

while IFS=$'\t' read -r target asset_name; do
  executable_name="shp"
  if [[ "$asset_name" == shp-windows-* ]]; then
    executable_name="shp.exe"
  fi
  build_asset "$target" "$asset_name" "$executable_name"
done < <(
  cd "$repo_root"
  bun -e 'import { TREE_SITTER_NATIVE_BINDING_TARGETS } from "./packages/shp-checker/src/ast-generation.ts"; for (const target of TREE_SITTER_NATIVE_BINDING_TARGETS) console.log(`${target.bunTarget}\t${target.releaseName}`);'
)

sed "s|__SHAPE_DEFAULT_VERSION__|$release_version_sed|g" "$repo_root/install.sh" > "$release_dir/install.sh"
sed "s|__SHAPE_DEFAULT_VERSION__|$release_version_sed|g" "$repo_root/install.ps1" > "$release_dir/install.ps1"
chmod +x "$release_dir/install.sh"

(cd "$release_dir" && sha256sum ./* > checksums.txt)
