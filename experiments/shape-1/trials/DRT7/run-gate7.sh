#!/bin/sh
# DRT7: the whole version 7 differential gate (A.11.2.4), in one run.
#   sh experiments/shape-1/trials/DRT7/run-gate7.sh <workDir> <shapek> [jobs]
# Writes only under <workDir>:
#   bin/shapek, bin/shapek.sha256   the kernel build the run used (copied first, so a rebuild during
#                                   the run cannot change it)
#   corpus/fragment, corpus/clean   2,500 fragment (r1..r2500) and 1,500 clean (c1..c1500) inputs
#   fixtures/, fxwork/              the version 7 fixtures (fixtures7.ts) and their model directories
#   lists/all.tsv                   every case: corpus, fixtures, M0 vectors
#   rows/rows.<i>.jsonl, save/      per-case rows; kernel case and both outputs of every case that is
#                                   not byte-identical
#   report.json, report.txt         residual, out-of-fragment reasons, clusters, coverage, timing
#   coverage.json                   the per-feature coverage report (coverage7.ts, no kernel)
# Run from any directory; every path is absolute or relative to <workDir>.
set -eu
W=$1
K=$2
J=${3:-4}
T=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$W/bin" "$W/lists" "$W/rows" "$W/save" "$W/corpus"
cp "$K" "$W/bin/shapek"
sha256sum "$W/bin/shapek" > "$W/bin/shapek.sha256"
SK="$W/bin/shapek"

i=0
while [ "$i" -lt "$J" ]; do
  bun "$T/gen-corpus7.ts" "$W/corpus/fragment" 1 2500 --profile fragment --shard "$i/$J" &
  bun "$T/gen-corpus7.ts" "$W/corpus/clean" 1 1500 --profile clean --shard "$i/$J" &
  i=$((i + 1))
done
wait
bun "$T/fixtures7.ts" "$W/fixtures" "$W/fxwork"

bun "$T/lists7.ts" corpus "$W/corpus/fragment" fragment "$W/lists/fragment.tsv"
bun "$T/lists7.ts" corpus "$W/corpus/clean" clean "$W/lists/clean.tsv"
bun "$T/lists7.ts" vectors "$T/../../m0/vectors" "$W/lists/vectors.tsv"
cat "$W/lists/fragment.tsv" "$W/lists/clean.tsv" > "$W/lists/corpus.tsv"
cat "$W/lists/corpus.tsv" "$W/fixtures/fixtures.tsv" "$W/lists/vectors.tsv" > "$W/lists/all.tsv"

i=0
while [ "$i" -lt "$J" ]; do
  bun "$T/gate7.ts" run --list "$W/lists/all.tsv" --shapek "$SK" --rows "$W/rows/rows.$i.jsonl" --shard "$i/$J" --timeout 600000 --save "$W/save" &
  i=$((i + 1))
done
wait
bun "$T/gate7.ts" report --out "$W/report.json" --text "$W/report.txt" "$W"/rows/rows.*.jsonl
bun "$T/coverage7.ts" --list "$W/lists/corpus.tsv" --out "$W/coverage.json" --index "$W/corpus/fragment" --index "$W/corpus/clean"
head -40 "$W/report.txt"
