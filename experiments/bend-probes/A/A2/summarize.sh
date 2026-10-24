#!/bin/sh
# usage: summarize.sh <A2 out-dir>  -> TSV on stdout (one row per encoding)
printf 'id\tgate\tgate_error\tcheck_main\tcheck_hatch\trun_output\tmain_verdict\tpresent_unknown_perlaw\n'
for d in "$1"/E*; do
  k=$(basename "$d")
  g=$(sed -n 1p "$d/gate.txt"); ge=$(grep -m1 -E '^- message|^- expected' "$d/gate.txt" | cut -c1-90)
  c=$(sed -n 1p "$d/check.txt"); ch=$(grep -m1 -E '^defs that|^Error: [0-9]|^- expected' "$d/check.txt" | cut -c1-90)
  r=$(head -3 "$d/run.txt" | tr '\n' '/' | cut -c1-90)
  v=$(sed -n 1p "$d/main_verdict.txt" 2>/dev/null)
  pu=$(grep '^present_unknown' "$d/perlaw.tsv" | cut -f2,4 | tr '\t' ' ' | cut -c1-90)
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$k" "$g" "$ge" "$c" "$ch" "$r" "$v" "$pu"
done
