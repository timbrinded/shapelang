#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  precheck.sh --init [--module NAME]
  precheck.sh [--shape-root DIR] [--strict] [--json] CHANGE_FILE.shape

Creates a temporary Shape change-file template or validates the strict current
baseline before checking that baseline plus one temporary proposal. Draft
proposal checks allow explicit unknown effects while keeping every other
diagnostic blocking. Use --strict only when the proposal has no unknown effects.

Set SHAPE_CMD to the repository's canonical wrapper, for example:
  SHAPE_CMD="bun shp" precheck.sh --json CHANGE_FILE.shape

When SHAPE_CMD is unset, the helper uses a working local `bun shp` command
before falling back to `shp`.
USAGE
}

json_escape() {
  local value="${1-}"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\n'/\\n}"
  value="${value//$'\r'/\\r}"
  value="${value//$'\t'/\\t}"
  printf '%s' "$value"
}

emit_json_result() {
  local decision="$1"
  local shape_command="$2"
  local allow_unknown="$3"
  local baseline_status="$4"
  local baseline_exit="$5"
  local baseline_output="$6"
  local proposal_status="$7"
  local proposal_exit="$8"
  local proposal_output="$9"

  printf '{'
  printf '"mode":"contract-simulation",'
  printf '"decision":"%s",' "$(json_escape "$decision")"
  printf '"shape_command":"%s",' "$(json_escape "$shape_command")"
  printf '"allow_unknown_effects":%s,' "$allow_unknown"
  printf '"baseline":{"status":"%s","exit_code":%s,"output":"%s"},' \
    "$(json_escape "$baseline_status")" \
    "$baseline_exit" \
    "$(json_escape "$baseline_output")"
  if [[ "$proposal_status" == "not_run" ]]; then
    printf '"proposal":null'
  else
    printf '"proposal":{"status":"%s","exit_code":%s,"output":"%s"}' \
      "$(json_escape "$proposal_status")" \
      "$proposal_exit" \
      "$(json_escape "$proposal_output")"
  fi
  printf '}\n'
}

emit_human_result() {
  local decision="$1"
  local shape_command="$2"
  local allow_unknown="$3"
  local baseline_status="$4"
  local baseline_exit="$5"
  local baseline_output="$6"
  local proposal_status="$7"
  local proposal_exit="$8"
  local proposal_output="$9"

  printf 'Shape command: %s\n' "$shape_command"
  printf 'Unknown effects allowed in proposal: %s\n' "$allow_unknown"
  printf '\nBaseline: %s (exit %s)\n%s\n' "$baseline_status" "$baseline_exit" "$baseline_output"
  if [[ "$proposal_status" != "not_run" ]]; then
    printf '\nProposal: %s (exit %s)\n%s\n' "$proposal_status" "$proposal_exit" "$proposal_output"
  fi
  printf '\nDecision: %s\n' "$decision"
}

emit_result() {
  if [[ "$json_output" -eq 1 ]]; then
    emit_json_result "$@"
  else
    emit_human_result "$@"
  fi
}

canonical_path() {
  local target="$1"
  local target_dir
  local target_name
  target_dir="$(dirname -- "$target")"
  target_name="$(basename -- "$target")"
  (
    cd "$target_dir"
    printf '%s/%s\n' "$(pwd -P)" "$target_name"
  )
}

shape_root="shape"
module_name="preflight"
init=0
strict=0
json_output=0
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
    --strict)
      strict=1
      shift
      ;;
    --json)
      json_output=1
      shift
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

if [[ -n "${SHAPE_CMD:-}" ]]; then
  shape_cmd_text="$SHAPE_CMD"
elif command -v bun >/dev/null 2>&1 && bun shp --version >/dev/null 2>&1; then
  shape_cmd_text="bun shp"
else
  shape_cmd_text="shp"
fi
read -r -a shape_cmd <<<"$shape_cmd_text"
allow_unknown="true"
if [[ "$strict" -eq 1 ]]; then
  allow_unknown="false"
fi

if ! command -v "${shape_cmd[0]}" >/dev/null 2>&1; then
  output="Shape command is not on PATH: ${shape_cmd[0]}"
  emit_result \
    "tooling_unavailable" "$shape_cmd_text" "$allow_unknown" \
    "tooling_unavailable" 127 "$output" \
    "not_run" 0 ""
  exit 127
fi

change_canonical="$(canonical_path "$change_file")"
shape_files=()
while IFS= read -r -d '' file; do
  if [[ "$(canonical_path "$file")" != "$change_canonical" ]]; then
    shape_files+=("$file")
  fi
done < <(find "$shape_root" -type f -name '*.shape' -print0 | LC_ALL=C sort -z)

if [[ "${#shape_files[@]}" -eq 0 ]]; then
  output="No baseline .shape files found under $shape_root"
  emit_result \
    "model_gap" "$shape_cmd_text" "$allow_unknown" \
    "missing" 1 "$output" \
    "not_run" 0 ""
  exit 1
fi

set +e
baseline_output="$("${shape_cmd[@]}" check "${shape_files[@]}" 2>&1)"
baseline_status_code=$?
set -e

if [[ "$baseline_status_code" -ne 0 ]]; then
  emit_result \
    "baseline_invalid" "$shape_cmd_text" "$allow_unknown" \
    "invalid" "$baseline_status_code" "$baseline_output" \
    "not_run" 0 ""
  exit "$baseline_status_code"
fi

proposal_args=(check)
if [[ "$strict" -eq 0 ]]; then
  proposal_args+=(--allow-unknown-effects)
fi
proposal_args+=("${shape_files[@]}" "$change_file")

set +e
proposal_output="$("${shape_cmd[@]}" "${proposal_args[@]}" 2>&1)"
proposal_status_code=$?
set -e

if [[ "$proposal_status_code" -ne 0 ]]; then
  emit_result \
    "blocked_by_contract" "$shape_cmd_text" "$allow_unknown" \
    "valid" 0 "$baseline_output" \
    "blocked" "$proposal_status_code" "$proposal_output"
  exit "$proposal_status_code"
fi

emit_result \
  "proceed" "$shape_cmd_text" "$allow_unknown" \
  "valid" 0 "$baseline_output" \
  "valid" 0 "$proposal_output"
