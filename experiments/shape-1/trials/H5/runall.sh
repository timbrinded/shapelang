#!/bin/sh
# H5: run replay.ts over all eight repositories for one configuration.
# Usage: sh runall.sh <variant> <pipeline> <hatch-rule> [extra replay flags...]
# Writes $W/runs/<variant>.<pipeline>.<hatch-rule>[.full]/<repo>.jsonl
set -e
W=/tmp/claude-0/-home-user-shapelang/83ff80bc-0161-572f-9e5a-9075cccad6d0/scratchpad/shape1work/H5
V=$1; P=$2; R=$3; shift 3
TAG="$V.$P.$R"
for x in "$@"; do [ "$x" = "--full" ] && TAG="$TAG.full"; done
mkdir -p "$W/runs/$TAG"
cd /home/user/shapelang
for repo in anvil atmosphere verified-ironkv verified-memory-allocator verified-node-replication verified-nrkernel verified-storage vest; do echo $repo; done |
  xargs -P 4 -I{} sh -c "bun experiments/shape-1/trials/H5/replay.ts --repo {} --variant $V --pipeline $P --hatch-rule $R $* --out $W/runs/$TAG/{}.jsonl 2>> $W/runs/$TAG/log.txt"
tail -8 "$W/runs/$TAG/log.txt" | grep done || true
