#!/bin/sh
# usage: run.sh <encodings-dir> <out-dir>
# For each encoding: the gate (bend PROOF.bend), check mode (bend main.bend
# --check-only), run mode (bend main.bend, 20 s timeout) and the per-law gate.
BEND=${BEND:-/tmp/claude-0/-home-user-shapelang/83ff80bc-0161-572f-9e5a-9075cccad6d0/scratchpad/bendexp/bendc/bend}
HERE=$(cd "$(dirname "$0")" && pwd)
export BEND_NO_TELEMETRY=1
mkdir -p "$2"
for d in "$1"/E*; do
  k=$(basename "$d"); o="$2/$k"; mkdir -p "$o"
  timeout 120 "$BEND" "$d/PROOF.bend" > "$o/gate.txt" 2>&1; echo "exit=$?" >> "$o/gate.txt"
  timeout 120 "$BEND" "$d/main.bend" --check-only > "$o/check.txt" 2>&1; echo "exit=$?" >> "$o/check.txt"
  timeout 20 "$BEND" "$d/main.bend" > "$o/run.txt" 2>&1; echo "exit=$?" >> "$o/run.txt"
  python3 -I "$HERE/../perlaw.py" "$d" "$o/perlaw" > "$o/perlaw.tsv" 2>&1
done
