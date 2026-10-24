#!/bin/sh
# Reproduce D1-D5. Bend 2.0.39 from source (bendc/bend), the Bend clone at
# 295e996, Lean 4.34 for --verdict. Bulky outputs go to $W; results/ holds
# the compact copies the report cites.
set -e
S=/tmp/claude-0/-home-user-shapelang/83ff80bc-0161-572f-9e5a-9075cccad6d0/scratchpad
C=${BEND_CLONE:-$S/clones/bend}
W=${WORK:-$S/bendexp/work/D}
D=$(cd "$(dirname "$0")" && pwd)
R=$(cd "$D/../../.." && pwd)
mkdir -p "$W/d1" "$W/d2" "$W/d3" "$W/d4" "$W/d5"
cd "$D"
# D1
bun d1/inventory.ts "$C" > "$W/d1/inventory.json"
bun d1/probes.ts "$W/d1/probes" > "$W/d1/probes.json"
d1/demo_gates.sh "$C" "$W/d1/demo_gates.txt"
# D2
bun d2/weakenings.ts "$C" "$W/d2/runs" > "$W/d2/weakenings.json"
d2/implications/run.sh "$C" "$W/d2/runs" "$W/d2/impl" > "$W/d2/implications.txt"
# D3
for d in "$C"/demos/*/; do n=$(basename "$d"); bun d3/extract.ts "$d" "$W/d3/$n.shape" "$W/d3/$n.json"; done
for f in "$W"/d3/*.shape; do (cd "$R" && bun packages/shp-cli/src/index.ts check "$f"); done
bun d3/audit_sample.ts "$C/demos" "$W/d3" > "$W/d3/audit_sample.txt"
bun d3/ts_purity.ts "$R" > "$W/d3/ts_purity.json"
# D4
bun d4/coverage.ts "$C" > "$W/d4/coverage.json"
# D5
d5/build.sh "$C" "$W/d5"
bun d5/boundary.ts "$W/d5" > "$W/d5/boundary.json"
