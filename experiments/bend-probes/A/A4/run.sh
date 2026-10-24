#!/bin/sh
# usage: run.sh <mutants-dir> <out.tsv>   (Lean on PATH for --verdict)
# Per mutant: check mode on service.bend and main.bend, run mode, --verdict.
BEND=${BEND:-/tmp/claude-0/-home-user-shapelang/83ff80bc-0161-572f-9e5a-9075cccad6d0/scratchpad/bendexp/bendc/bend}
export BEND_NO_TELEMETRY=1
printf 'id\tcheck_service\tcheck_main\terror\trun\tverdict\tverdict_error\n' > "$2"
for d in "$1"/*/; do
  k=$(basename "$d")
  cs=$(timeout 60 "$BEND" "$d/service.bend" --check-only 2>&1); s1=$(echo "$cs" | head -1)
  cm=$(timeout 60 "$BEND" "$d/main.bend" --check-only 2>&1); s2=$(echo "$cm" | head -1)
  err=$(echo "$cs" | grep -m1 -E '^- message|^- expected|^Error' | tr '\t' ' ')
  obs=$(echo "$cs" | grep -m1 -E '^- observed' | tr '\t' ' ')
  run=$(timeout 15 "$BEND" "$d/main.bend" 2>&1 | head -2 | tr '\n' ' '); rc=$?
  v=$(timeout 120 "$BEND" "$d/service.bend" --verdict 2>&1); v1=$(echo "$v" | head -1); ve=$(echo "$v" | grep -m1 -E '^- message|^- expected|^Error' | tr '\t' ' ')
  printf '%s\t%s\t%s\t%s %s\t%s\t%s\t%s\n' "$k" "$s1" "$s2" "$err" "$obs" "$run" "$v1" "$ve" >> "$2"
done
