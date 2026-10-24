#!/bin/bash
# Re-check one B1 eval workspace: gate result, whether the original file is an
# unchanged prefix of the solution, lines added, and logged gate runs.
# Usage: verify_b1.sh X_DIR NAME
X=$1; n=$2; d=$X/b1/$n; o=$X/b1_orig/$n.bend
gate=$(cd "$d" && "$X/bendc/bend" TASK.bend --check-only 2>&1 | head -1)
ol=$(wc -l < "$o"); nl=$(wc -l < "$d/TASK.bend")
if head -n "$ol" "$d/TASK.bend" | cmp -s - "$o"; then prefix=unchanged; else prefix=MODIFIED; fi
unsafe=$(grep -cE '@unsafe|def [A-Za-z_.]+\?' "$d/TASK.bend")
runs=$(wc -l < "$d/.gate_log" 2>/dev/null || echo 0)
echo "$n gate=\"$gate\" original=$prefix added_lines=$((nl-ol)) unsafe_markers=$unsafe logged_runs=$runs"
