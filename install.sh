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

install_release_payload() {
  target_binary="$install_dir/$executable"
  target_assets="$install_dir/tree-sitter-language-pack"
  staged_binary="$install_dir/.$executable.update-$$"
  staged_assets="$install_dir/.tree-sitter-language-pack.update-$$"
  previous_binary="$install_dir/.$executable.previous-$$"
  previous_assets="$install_dir/.tree-sitter-language-pack.previous-$$"
  swap_started=0

  rollback_install() {
    status="$?"
    rm -rf "$staged_binary" "$staged_assets"
    if [ "$status" -ne 0 ] && [ "$swap_started" -eq 1 ]; then
      rm -rf "$target_binary" "$target_assets"
      if [ -f "$previous_binary" ]; then
        mv "$previous_binary" "$target_binary"
      fi
      if [ -d "$previous_assets" ]; then
        mv "$previous_assets" "$target_assets"
      fi
    else
      rm -rf "$previous_binary" "$previous_assets"
    fi
    cleanup
    exit "$status"
  }

  rm -rf "$staged_binary" "$staged_assets" "$previous_binary" "$previous_assets"
  trap rollback_install EXIT INT TERM

  if command -v install >/dev/null 2>&1; then
    install -m 0755 "$tmp_dir/$executable" "$staged_binary"
  else
    cp "$tmp_dir/$executable" "$staged_binary"
    chmod 0755 "$staged_binary" 2>/dev/null || true
  fi
  cp -R "$tmp_dir/tree-sitter-language-pack" "$staged_assets"

  swap_started=1
  if [ -f "$target_binary" ]; then
    mv "$target_binary" "$previous_binary"
  fi
  if [ -d "$target_assets" ]; then
    mv "$target_assets" "$previous_assets"
  fi
  mv "$staged_assets" "$target_assets"
  mv "$staged_binary" "$target_binary"

  rm -rf "$previous_binary" "$previous_assets"
  trap cleanup EXIT INT TERM
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
install_release_payload

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
