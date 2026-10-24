#!/bin/sh
# D2 (d): check each implication file next to copies of its demo (old/) and,
# where it needs one, of the weakened state (new/).
#   d2/implications/run.sh <bend-clone> <d2-runs-dir> <work-dir>
S=/tmp/claude-0/-home-user-shapelang/83ff80bc-0161-572f-9e5a-9075cccad6d0/scratchpad
BEND=${BEND:-$S/bendexp/bendc/bend}
LEAN=${LEAN_BIN:-$S/lean/lean-4.34.0-linux/bin}
HERE=$(cd "$(dirname "$0")" && pwd)
export BEND_NO_TELEMETRY=1
for f in "$HERE"/*.bend; do
  id=$(basename "$f" .bend)
  case $id in
    IS*) demo=proof_insertion_sort ;; WIN*) demo=app_win_is_bug_2d ;;
    NUM*) demo=proof_numerics ;; TRI*) demo=app_triangle_2d ;;
  esac
  w="$3/$id"; rm -rf "$w"; mkdir -p "$w"
  cp -r "$1/demos/$demo" "$w/old"
  [ -d "$2/$id/b" ] && cp -r "$2/$id/b" "$w/new"
  cp "$f" "$w/impl.bend"
  out=$(cd "$w" && "$BEND" impl.bend --check-only 2>&1); c=$?
  vout=$(cd "$w" && PATH="$LEAN:$PATH" "$BEND" impl.bend --verdict 2>&1); vc=$?
  echo "== $id check=$c verdict=$vc"; echo "$out" | head -8
done
