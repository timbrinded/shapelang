#!/usr/bin/env sh
set -eu

git ls-files \
  '*.cts' \
  '*.js' \
  '*.jsx' \
  '*.mjs' \
  '*.mts' \
  '*.ts' \
  '*.tsx' \
  ':!:**/node_modules/**' \
  ':!:**/dist/**' \
  ':!:packages/shp-checker/src/language/generated/**' \
  ':!:shape/generated/**' \
  | LC_ALL=C sort \
  | xargs bun shp ast source --out-dir shape/generated/ast "$@"
