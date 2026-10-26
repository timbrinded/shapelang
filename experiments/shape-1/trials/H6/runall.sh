#!/bin/sh
# H6 (teeth) end to end. Run from the repository root. W is the bulky-output directory.
# Wall times measured on 4 cores at load average 8-15 (other agents running): about 2 h in total,
# dominated by p1-change (632 change-mode derives) and law-adequacy (237 law-suite runs).
set -e
W=${W:-/tmp/claude-0/-home-user-shapelang/83ff80bc-0161-572f-9e5a-9075cccad6d0/scratchpad/shape1work/H6}
T=experiments/shape-1/trials/H6
mkdir -p "$W"
bun $T/teeth-dogfood.ts --work "$W"                    # frozen manifest, providers, teeth (decl, obs), extra analyses
bun $T/validate-dogfood.ts --work "$W" --per 100       # closed form vs derive, 100 mutants per operator
bun $T/w2-edges.ts --work "$W"                         # W2 by module pair, E10's named edges, routes into the kernel
bun $T/p1-control.ts --work "$W"                       # E10 control: AppendOnly on every resource
bun $T/teeth-skills.ts --work "$W"                     # fixtures/skills models
bun $T/hatch-allows.ts > "$W/hatch-allows.json"        # boundary-allowed hatch under HatchesStayAtBoundaries (spec Example 2)
bun $T/law-adequacy.ts --work "$W" --plan              # materialises <W>/tree, writes the mutant plan
bun $T/ungoverned-clock.ts --work "$W"                 # Date.now() seeded into ungoverned vs governed code
bun $T/ungoverned-ids.ts "$W" > "$W/ungoverned.json"
bun $T/retired-guards.ts > "$W/retired-guards.json"
for i in 0 1 2; do bun $T/p1-change.ts --work "$W" --shard $i/3 > "$W/p1-shard$i.log" 2>&1 & done; wait
for i in 0 1; do bun $T/law-adequacy.ts --work "$W" --shard $i/2 > "$W/law-shard$i.log" 2>&1 & done; wait
bun $T/law-teeth.ts --work "$W"                        # law-adequacy counts through the teeth provider's law path
python3 -I $T/analyze.py "$W" $T/data/summary.json
# The measured run executed p1-change twice: a first pass whose code-edit rows lacked escalation
# tracking (only its G1/G2 rows are used), then `--resume` (rows *-r2.jsonl) for the rest.
