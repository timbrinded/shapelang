#!/usr/bin/env sh
set -eu

default_version="__SHAPE_DEFAULT_VERSION__"
placeholder="__SHAPE_DEFAULT_"'VERSION__'
if [ "$default_version" = "$placeholder" ]; then
  default_version="latest"
fi

repo="${SHAPE_REPO:-timbrinded/shapelang}"
version="${SHAPE_VERSION:-$default_version}"
install_dir="${SHAPE_INSTALL_DIR:-$HOME/.local/bin}"

usage() {
  cat <<'USAGE'
Install shp from GitHub Releases.

Usage:
  install.sh [--version VERSION] [--install-dir DIR] [--repo OWNER/REPO]

Environment:
  SHAPE_VERSION       Release tag to install. Defaults to the installer release, or latest.
  SHAPE_INSTALL_DIR   Directory to install shp into. Defaults to ~/.local/bin.
  SHAPE_REPO          GitHub repository. Defaults to timbrinded/shapelang.
USAGE
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --version)
      version="$2"
      shift 2
      ;;
    --version=*)
      version="${1#*=}"
      shift
      ;;
    --install-dir)
      install_dir="$2"
      shift 2
      ;;
    --install-dir=*)
      install_dir="${1#*=}"
      shift
      ;;
    --repo)
      repo="$2"
      shift 2
      ;;
    --repo=*)
      repo="${1#*=}"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "required command not found: $1" >&2
    exit 1
  fi
}

download() {
  url="$1"
  output="$2"

  if command -v curl >/dev/null 2>&1; then
    curl --proto '=https' --tlsv1.2 -fsSL "$url" -o "$output"
  elif command -v wget >/dev/null 2>&1; then
    wget -q "$url" -O "$output"
  else
    echo "required command not found: curl or wget" >&2
    exit 1
  fi
}

case "$(uname -s)" in
  Linux*) os="linux"; executable="shp" ;;
  Darwin*) os="darwin"; executable="shp" ;;
  MINGW*|MSYS*|CYGWIN*) os="windows"; executable="shp.exe" ;;
  *)
    echo "unsupported operating system: $(uname -s)" >&2
    exit 1
    ;;
esac

case "$(uname -m)" in
  x86_64|amd64) arch="x64" ;;
  arm64|aarch64) arch="arm64" ;;
  *)
    echo "unsupported architecture: $(uname -m)" >&2
    exit 1
    ;;
esac

if [ "$os" = "windows" ] && [ "$arch" = "arm64" ]; then
  echo "no shp release asset is published for Windows ARM64" >&2
  exit 1
fi

if [ "$os" = "darwin" ] && [ "$arch" = "x64" ]; then
  echo "no shp release asset is published for macOS x64" >&2
  exit 1
fi

need tar
need awk

asset="shp-$os-$arch.tar.gz"
if [ "$version" = "latest" ]; then
  base_url="https://github.com/$repo/releases/latest/download"
else
  base_url="https://github.com/$repo/releases/download/$version"
fi

tmp_dir="$(mktemp -d)"
cleanup() {
  rm -rf "$tmp_dir"
}
trap cleanup EXIT INT TERM

echo "downloading $asset from $repo $version"
download "$base_url/$asset" "$tmp_dir/$asset"
download "$base_url/checksums.txt" "$tmp_dir/checksums.txt"

expected="$(awk -v asset="$asset" '$2 == asset || $2 == "./" asset { print $1; exit }' "$tmp_dir/checksums.txt")"
if [ -z "$expected" ]; then
  echo "checksum for $asset not found" >&2
  exit 1
fi

if command -v sha256sum >/dev/null 2>&1; then
  actual="$(sha256sum "$tmp_dir/$asset" | awk '{ print $1 }')"
elif command -v shasum >/dev/null 2>&1; then
  actual="$(shasum -a 256 "$tmp_dir/$asset" | awk '{ print $1 }')"
else
  echo "required command not found: sha256sum or shasum" >&2
  exit 1
fi

if [ "$expected" != "$actual" ]; then
  echo "checksum verification failed for $asset" >&2
  exit 1
fi

tar -xzf "$tmp_dir/$asset" -C "$tmp_dir"
if [ ! -d "$tmp_dir/tree-sitter-language-pack" ]; then
  echo "release archive is missing tree-sitter-language-pack parser assets" >&2
  exit 1
fi
mkdir -p "$install_dir"

if command -v install >/dev/null 2>&1; then
  install -m 0755 "$tmp_dir/$executable" "$install_dir/$executable"
else
  cp "$tmp_dir/$executable" "$install_dir/$executable"
  chmod 0755 "$install_dir/$executable" 2>/dev/null || true
fi
rm -rf "$install_dir/tree-sitter-language-pack"
cp -R "$tmp_dir/tree-sitter-language-pack" "$install_dir/tree-sitter-language-pack"

if [ -n "${GITHUB_PATH:-}" ]; then
  echo "$install_dir" >> "$GITHUB_PATH"
fi

echo "installed $executable to $install_dir"
case ":$PATH:" in
  *":$install_dir:"*) ;;
  *)
    echo "add shp to your PATH with:"
    echo "  export PATH=\"$install_dir:\$PATH\""
    ;;
esac
