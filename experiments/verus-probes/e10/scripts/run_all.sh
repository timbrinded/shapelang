#!/bin/bash
# Runs every operator in sequence (each step uses 4 worker processes).
set -e
cd "$(dirname "$0")/.."
python3 scripts/run.py M2
python3 scripts/run.py M3
python3 scripts/run.py M3gen
python3 scripts/run.py M4gen
python3 scripts/run.py M1 --batch
python3 scripts/run.py M1gen --batch
python3 scripts/run.py HOprobe --batch
python3 scripts/run.py M4
echo ALL_DONE
