#!/bin/sh
# D5: copy the law-proven modules into the work dir, check their proofs, and
# compile each to an ES module.   d5/build.sh <bend-clone> <d5-work-dir>
S=/tmp/claude-0/-home-user-shapelang/83ff80bc-0161-572f-9e5a-9075cccad6d0/scratchpad
BEND=${BEND:-$S/bendexp/bendc/bend}
HERE=$(cd "$(dirname "$0")" && pwd)
export BEND_NO_TELEMETRY=1
W=$2; mkdir -p "$W"
rm -rf "$W/isort" "$W/num" "$W/u32" "$W/arr"
cp -r "$1/demos/proof_insertion_sort" "$W/isort"
cp -r "$1/demos/proof_numerics" "$W/num"
cp -r "$HERE/u32" "$W/u32"
cp -r "$HERE/arr" "$W/arr"
for m in isort:sort num:num u32:u32 arr:arr; do
  d=${m%%:*}; o=${m##*:}
  (cd "$W/$d" && printf '%s gate: ' "$d" && "$BEND" PROOF.bend | head -1 && "$BEND" main.bend -o "$o.mjs")
done
