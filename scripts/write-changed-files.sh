#!/usr/bin/env bash
set -euo pipefail

# Writes the changed-file list and, next to it, the base commit that list was
# diffed against. `shp check --base-ref "$(cat changed-base.txt)"` then compares
# attestations against the same base the changed files came from.
output="${1:-changed.txt}"
base_output="${2:-changed-base.txt}"
tmp_output="$(mktemp)"
cleanup() {
  rm -f "$tmp_output"
}
trap cleanup EXIT INT TERM

if [ -n "${GITHUB_BASE_REF:-}" ]; then
  git fetch --no-tags --prune origin "$GITHUB_BASE_REF"
  base="$(git merge-base "origin/$GITHUB_BASE_REF" HEAD)"
elif [ -n "${GITHUB_EVENT_BEFORE:-}" ] && [ "${GITHUB_EVENT_BEFORE:-}" != "0000000000000000000000000000000000000000" ]; then
  # After a force push the previous tip is not an ancestor of HEAD. Diff from
  # their merge base, which is also the commit `--base-ref` resolves.
  base="$(git merge-base "$GITHUB_EVENT_BEFORE" HEAD)"
elif [ -n "${BASE_REF:-}" ] && git rev-parse --verify "origin/$BASE_REF" >/dev/null 2>&1; then
  base="$(git merge-base "origin/$BASE_REF" HEAD)"
elif git rev-parse --verify origin/HEAD >/dev/null 2>&1; then
  base="$(git merge-base origin/HEAD HEAD)"
elif git rev-parse --verify origin/main >/dev/null 2>&1; then
  base="$(git merge-base origin/main HEAD)"
elif git rev-parse --verify origin/master >/dev/null 2>&1; then
  base="$(git merge-base origin/master HEAD)"
elif git rev-parse --verify HEAD~1 >/dev/null 2>&1; then
  base="$(git rev-parse HEAD~1)"
else
  base="$(git rev-parse HEAD)"
fi

git diff --name-only "$base" "${GITHUB_SHA:-HEAD}" > "$tmp_output"
git diff --name-only >> "$tmp_output"
git diff --name-only --cached >> "$tmp_output"
git ls-files --others --exclude-standard >> "$tmp_output"
sort -u "$tmp_output" | grep -vxF -e "$output" -e "$base_output" > "$output" || true
printf '%s\n' "$base" > "$base_output"

printf 'Wrote %s changed files to %s (base %s)\n' "$(wc -l < "$output" | tr -d ' ')" "$output" "$base"
