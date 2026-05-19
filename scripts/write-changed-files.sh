#!/usr/bin/env bash
set -euo pipefail

output="${1:-changed.txt}"
tmp_output="$(mktemp)"
cleanup() {
  rm -f "$tmp_output"
}
trap cleanup EXIT INT TERM

if [ -n "${GITHUB_BASE_REF:-}" ]; then
  git fetch --no-tags --prune --depth=1 origin "$GITHUB_BASE_REF"
  git diff --name-only "origin/$GITHUB_BASE_REF"...HEAD > "$tmp_output"
elif [ -n "${GITHUB_EVENT_BEFORE:-}" ] && [ "${GITHUB_EVENT_BEFORE:-}" != "0000000000000000000000000000000000000000" ]; then
  git diff --name-only "$GITHUB_EVENT_BEFORE" "${GITHUB_SHA:-HEAD}" > "$tmp_output"
elif git rev-parse --verify origin/master >/dev/null 2>&1; then
  base="$(git merge-base origin/master HEAD)"
  git diff --name-only "$base"...HEAD > "$tmp_output"
elif git rev-parse --verify HEAD~1 >/dev/null 2>&1; then
  git diff --name-only HEAD~1...HEAD > "$tmp_output"
else
  git diff --name-only HEAD > "$tmp_output"
fi

git diff --name-only >> "$tmp_output"
git diff --name-only --cached >> "$tmp_output"
git ls-files --others --exclude-standard >> "$tmp_output"
sort -u "$tmp_output" | grep -vxF "$output" > "$output" || true

printf 'Wrote %s changed files to %s\n' "$(wc -l < "$output" | tr -d ' ')" "$output"
