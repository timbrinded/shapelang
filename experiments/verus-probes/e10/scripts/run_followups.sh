#!/bin/bash
# Validation and determinism follow-ups (run after run_all.sh).
set -e
cd "$(dirname "$0")/.."
I=mutants/ids
python3 scripts/run.py M1 --ids-file $I/M1single.json --out M1single
python3 scripts/run.py M1 --batch --ids-file $I/M1rerun.json --out M1rerun
python3 scripts/run.py M2 --ids-file $I/M2rerun.json --out M2rerun
python3 scripts/run.py M3 --ids-file $I/M3rerun.json --out M3rerun
python3 scripts/run.py M4 --ids-file $I/M4rerun.json --out M4rerun
# baseline repeated 5 times
for i in 1 2 3 4 5; do
  (cd work/w0 && bun "${SHAPELANG_DIR:-/home/user/shapelang}/packages/shp-cli/src/index.ts" check > ../../results/baseline_$i.txt 2>&1; echo "exit=$?" >> ../../results/baseline_$i.txt)
done
python3 scripts/run.py HOcontrol --batch
python3 scripts/ci_gate_demo.py
python3 scripts/validate.py > results/validate.log
echo FOLLOWUPS_DONE
