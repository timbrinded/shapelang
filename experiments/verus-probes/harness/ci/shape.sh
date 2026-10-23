echo "== shp check (changed files, base model, rule loosening) =="
: > /tmp/changed.txt
for f in $(cd /work && find src shape -type f | sort); do cmp -s "/work/$f" "/base/$f" || echo "$f" >> /tmp/changed.txt; done
for f in $(cd /base && find src shape -type f | sort); do [ -e "/work/$f" ] || echo "$f" >> /tmp/changed.txt; done
bun /shapelang/packages/shp-cli/src/index.ts check --changed-files /tmp/changed.txt --base-model /base --check-loosening shape/*.shape || exit 1
