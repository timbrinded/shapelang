#!/bin/sh
# D1: the PROOF gate and --verdict on every shipped demo, unmodified.
#   d1/demo_gates.sh <bend-clone> <out-file>
S=/tmp/claude-0/-home-user-shapelang/83ff80bc-0161-572f-9e5a-9075cccad6d0/scratchpad
BEND=${BEND:-$S/bendexp/bendc/bend}
LEAN=${LEAN_BIN:-$S/lean/lean-4.34.0-linux/bin}
export BEND_NO_TELEMETRY=1
: > "$2"
for d in "$1"/demos/*/; do
  [ -f "$d/PROOF.bend" ] || continue
  n=$(basename "$d")
  g=$("$BEND" "$d/PROOF.bend" 2>&1); gc=$?
  v=$(PATH="$LEAN:$PATH" "$BEND" "$d/PROOF.bend" --verdict 2>&1); vc=$?
  printf '== %s gate=%s verdict=%s\n--- gate\n%s\n--- verdict\n%s\n' "$n" "$gc" "$vc" "$g" "$v" >> "$2"
done
