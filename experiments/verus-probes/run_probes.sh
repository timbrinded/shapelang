#!/bin/bash
# Re-run the history probes (R1-R6, E9) and E7 over the corpus fetched by setup.sh.
# The Verus-dependent experiments (E1-E4, E8) are run step by step; see README.md.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
VP_WORK=${VP_WORK:-/tmp/verus-probes}
VPROBE="$HERE/vprobe/target/release/vprobe"
mkdir -p "$VP_WORK/results" "$VP_WORK/heads"
for r in anvil atmosphere verified-ironkv verified-memory-allocator verified-node-replication verified-nrkernel verified-storage vest; do
  python3 -I "$HERE/scripts/walk.py" "$VP_WORK/repos/$r" "$VPROBE" "$VP_WORK/results/$r.json" &
  mkdir -p "$VP_WORK/heads/$r"
  git -C "$VP_WORK/repos/$r" archive HEAD | tar -x -C "$VP_WORK/heads/$r"
  (cd "$VP_WORK/heads" && find "$r" -name '*.rs' -print0 | xargs -0 "$VPROBE" > "$VP_WORK/head_$r.jsonl")
done
wait
python3 -I "$HERE/scripts/analyse.py" "$VP_WORK/results" "$VP_WORK"
python3 -I "$HERE/scripts/analyse.py" "$VP_WORK/results" "$VP_WORK" --exclude-mechanical
python3 -I "$HERE/scripts/e9_baselines.py" "$VP_WORK/results"
