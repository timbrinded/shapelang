#!/bin/bash
# Copy each task/condition template into fresh trial workspaces, snapshot their
# contents, and arm the hidden-test access check.
# Usage: setup_trials.sh X_DIR "T1 T3 T4" "C0 C1 C2" "1 2"
set -euo pipefail
X=$1; TASKS=$2; CONDS=$3; SEEDS=$4
META=$X/trial_meta
mkdir -p "$X/trials" "$META"
for t in $TASKS; do
  for c in $CONDS; do
    for s in $SEEDS; do
      id="$t-$c-s$s"
      dst="$X/trials/$id"
      [ -e "$dst" ] && { echo "exists: $dst" >&2; exit 1; }
      cp -r "$X/tasks/$t/$c" "$dst"
      rm -f "$dst/.gate_log"
      mkdir -p "$META/$id"
      (cd "$dst" && find . -type f -not -path './node_modules/*' -not -path './build/*' -print0 | sort -z | xargs -0 sha256sum) > "$META/$id/start.sha256"
      date -u +%Y-%m-%dT%H:%M:%SZ > "$META/$id/start_time"
    done
  done
done
# relatime only records the first read after a modification: bump mtimes, then
# record atimes; any later read of a hidden file moves its atime.
find "$X/hidden" -type f -exec touch -m {} +
sleep 1
find "$X/hidden" -type f -printf '%X %p\n' | sort -k2 > "$META/hidden_atime_before.txt"
echo "trials ready: $(ls "$X/trials" | wc -l)"
