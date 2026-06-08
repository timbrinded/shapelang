#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  precheck.sh --init [--module NAME]
  precheck.sh [--shape-root DIR] CHANGE_FILE.shape

Creates a temporary Shape change-file template or checks the current model plus
an existing temporary change file with `shp check`.

Set SHAPE_CMD to use a repo wrapper, for example:
  SHAPE_CMD="bun shp" precheck.sh CHANGE_FILE.shape
USAGE
}

shape_root="shape"
module_name="preflight"
init=0
change_file=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --help|-h)
      usage
      exit 0
      ;;
    --init)
      init=1
      shift
      ;;
    --module)
      module_name="${2:-}"
      if [[ -z "$module_name" ]]; then
        echo "precheck.sh: --module requires a value" >&2
        exit 2
      fi
      shift 2
      ;;
    --shape-root)
      shape_root="${2:-}"
      if [[ -z "$shape_root" ]]; then
        echo "precheck.sh: --shape-root requires a value" >&2
        exit 2
      fi
      shift 2
      ;;
    -*)
      echo "precheck.sh: unknown option $1" >&2
      usage >&2
      exit 2
      ;;
    *)
      if [[ -n "$change_file" ]]; then
        echo "precheck.sh: only one change file is supported" >&2
        exit 2
      fi
      change_file="$1"
      shift
      ;;
  esac
done

if [[ "$init" -eq 1 ]]; then
  tmp_base="$(mktemp "${TMPDIR:-/tmp}/shape-preflight.XXXXXX")"
  tmp_file="${tmp_base}.shape"
  mv "$tmp_base" "$tmp_file"
  cat >"$tmp_file" <<EOF
module ${module_name}

change ProposedChange {
  // Replace this block with a conservative add/modify/remove declaration.
}
EOF
  printf '%s\n' "$tmp_file"
  exit 0
fi

if [[ -z "$change_file" ]]; then
  usage >&2
  exit 2
fi

if [[ ! -f "$change_file" ]]; then
  echo "precheck.sh: change file not found: $change_file" >&2
  exit 1
fi

if [[ ! -d "$shape_root" ]]; then
  echo "precheck.sh: shape root not found: $shape_root" >&2
  exit 1
fi

shape_cmd_text="${SHAPE_CMD:-shp}"
read -r -a shape_cmd <<<"$shape_cmd_text"

if ! command -v "${shape_cmd[0]}" >/dev/null 2>&1; then
  echo "precheck.sh: Shape command is not on PATH: ${shape_cmd[0]}" >&2
  exit 127
fi

shape_files=()
while IFS= read -r -d '' file; do
  shape_files+=("$file")
done < <(find "$shape_root" -type f -name '*.shape' -print0)

if [[ "${#shape_files[@]}" -eq 0 ]]; then
  echo "precheck.sh: no .shape files found under $shape_root" >&2
  exit 1
fi

set +e
check_output="$("${shape_cmd[@]}" check "${shape_files[@]}" "$change_file" 2>&1)"
check_status=$?
set -e

printf '%s\n' "$check_output"

if [[ "$check_status" -ne 0 ]]; then
  exit "$check_status"
fi

if grep -Eq '(^|[[:space:]])error:' <<<"$check_output"; then
  exit 1
fi
