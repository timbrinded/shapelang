#!/bin/sh
# H2 drift trial: all 76 seeds on arms A and X, 3 workers. Usage: runall.sh <work-dir>
# (prepare bases first: run.ts prep --arm A|X --work <work-dir>)
W="$1"
cd /home/user/shapelang || exit 2
for k in 0 1 2; do
  ( bun experiments/shape-1/trials/H2/run.ts run --arm A --work "$W" --shard $k/3 2>> "$W/log-A-$k.txt"; bun experiments/shape-1/trials/H2/run.ts run --arm X --work "$W" --shard $k/3 2>> "$W/log-X-$k.txt" ) &
done
wait
echo ALLDONE >> "$W/log-done.txt"
