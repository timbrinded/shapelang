#!/usr/bin/env bash
# H4 end to end. Writes bulky outputs to $W (scratch); scripts and small data stay here.
set -euo pipefail
REPO=/home/user/shapelang
T=$REPO/experiments/shape-1/trials/H4
W=${W:-/tmp/claude-0/-home-user-shapelang/83ff80bc-0161-572f-9e5a-9075cccad6d0/scratchpad/shape1work/H4}
LEAN=${LEAN:-/tmp/claude-0/-home-user-shapelang/83ff80bc-0161-572f-9e5a-9075cccad6d0/scratchpad/lean/lean-4.34.0-linux/bin}
cd "$REPO"
# 0. E2 baselines re-run (0.x base-ref form and the syntactic diff on the 8 calibration cases and 2 guard fixtures)
WORK=$W/e2 bun experiments/bend-probes/E/e2-calibration.ts > "$W/e2-calibration-table.md"
WORK=$W/e2/guard bash experiments/bend-probes/E/e2-loosening.sh > "$W/e2-guard.log" 2>&1
# 1. materialise fwd / fwdu / rev model pairs for the 33 cases
bun "$T/build.ts" "$W/cases"
# 2. prototype (fwd, fwdu, rev, orig), kernel shapek, 0.x --check-loosening, syntactic diff (~150 s)
bun "$T/run.ts" "$W/cases" "$W/out"
# 3. kernel detail: KDump parts/counterexamples, and the default-binding workaround variant (~100 s)
bun "$T/run-kernel.ts" "$W/out" "$LEAN"
# 4. scoring against manual.json, kernel/prototype obligation comparison, summary-bounded L1 parts
python3 -I "$T/analyze.py" "$W/out" "$T/manual.json" --json "$T/results.json" > "$W/analysis.md"
python3 -I "$T/compare_kernel.py" "$W/out" > "$W/kcompare.txt"
python3 -I "$T/compare_kernel.py" "$W/out" -prebind > "$W/kcompare-prebind.txt"
python3 -I "$T/summary_bound.py" "$W/out" > "$W/summary_bound.txt"
# 5. rename cases with `was` (sidecars in was/)
mkdir -p "$W/was"
for c in renamed_component renamed_component_and_narrowed_rule resource_renamed_trait_kept resource_renamed_trait_dropped; do
  bun experiments/shape-1/proto/src/cli.ts check --model "$W/cases/$c/fwd/head" --base "$W/cases/$c/fwd/base" --sidecar "$T/was/$c.head.json" --synthesize --maintainer alice --maintainer bob --now 2026-10-25T12:00:00Z --json > "$W/was/$c.fwd.json" 2>/dev/null || true
  bun experiments/shape-1/proto/src/cli.ts check --model "$W/cases/$c/rev/head" --base "$W/cases/$c/rev/base" --sidecar "$T/was/$c.rev.json" --synthesize --maintainer alice --maintainer bob --now 2026-10-25T12:00:00Z --json > "$W/was/$c.rev.json" 2>/dev/null || true
done
