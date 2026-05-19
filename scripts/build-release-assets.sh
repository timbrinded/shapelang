#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
bin_dir="$repo_root/dist/bin"
release_dir="$repo_root/dist/release"
release_version="${SHAPE_RELEASE_VERSION:-${GITHUB_REF_NAME:-latest}}"
release_version_sed="$(printf '%s' "$release_version" | sed -e 's/[\\&|]/\\&/g')"

rm -rf "$bin_dir" "$release_dir"
mkdir -p "$bin_dir" "$release_dir"

build_asset() {
  local target="$1"
  local asset_name="$2"
  local executable_name="$3"
  local asset_dir="$bin_dir/$asset_name"

  mkdir -p "$asset_dir"

  bun build "$repo_root/packages/shp-cli/src/index.ts" \
    --compile \
    --target="$target" \
    --outfile="$asset_dir/$executable_name"

  chmod +x "$asset_dir/$executable_name" 2>/dev/null || true
  cp "$repo_root/LICENSE" "$asset_dir/LICENSE"

  tar -C "$asset_dir" -czf "$release_dir/$asset_name.tar.gz" "$executable_name" LICENSE
}

build_asset bun-linux-x64-baseline shp-linux-x64 shp
build_asset bun-linux-arm64 shp-linux-arm64 shp
build_asset bun-darwin-x64-baseline shp-darwin-x64 shp
build_asset bun-darwin-arm64 shp-darwin-arm64 shp
build_asset bun-windows-x64-baseline shp-windows-x64 shp.exe

sed "s|__SHAPE_DEFAULT_VERSION__|$release_version_sed|g" "$repo_root/install.sh" > "$release_dir/install.sh"
sed "s|__SHAPE_DEFAULT_VERSION__|$release_version_sed|g" "$repo_root/install.ps1" > "$release_dir/install.ps1"
chmod +x "$release_dir/install.sh"

(cd "$release_dir" && sha256sum ./* > checksums.txt)
