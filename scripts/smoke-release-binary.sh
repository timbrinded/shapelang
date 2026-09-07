#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Smoke-test a packed shp release archive.

Usage:
  scripts/smoke-release-binary.sh [--quick] [--expected-version X.Y.Z] ARCHIVE

Run from the repository root. --quick checks version, help, check, and AST
generation. The default also covers graph, draft/strict, author, analyzer, and
domain-pack fixtures.
USAGE
}

quick=0
expected_version=""
archive=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --quick)
      quick=1
      shift
      ;;
    --expected-version)
      expected_version="${2:-}"
      shift 2
      ;;
    --expected-version=*)
      expected_version="${1#*=}"
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    --*)
      echo "unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
    *)
      if [ -n "$archive" ]; then
        echo "unexpected argument: $1" >&2
        usage >&2
        exit 2
      fi
      archive="$1"
      shift
      ;;
  esac
done

if [ -z "$archive" ]; then
  usage >&2
  exit 2
fi

if [ ! -f "$archive" ]; then
  echo "archive not found: $archive" >&2
  exit 1
fi

smoke_dir="$(mktemp -d)"
cleanup() {
  rm -rf "$smoke_dir"
}
trap cleanup EXIT INT TERM

tar -xzf "$archive" -C "$smoke_dir"

if [ -f "$smoke_dir/shp.exe" ]; then
  shp_bin="$smoke_dir/shp.exe"
else
  shp_bin="$smoke_dir/shp"
fi

if [ ! -x "$shp_bin" ] && [ ! -f "$shp_bin" ]; then
  echo "packed shp executable not found in $archive" >&2
  ls -la "$smoke_dir" >&2
  exit 1
fi
chmod +x "$shp_bin" 2>/dev/null || true

actual_version="$("$shp_bin" --version | tr -d '\r')"
if [ -n "$expected_version" ] && [ "$actual_version" != "$expected_version" ]; then
  echo "Expected packed shp version $expected_version, got $actual_version." >&2
  exit 1
fi

"$shp_bin" --help >/dev/null
"$shp_bin" lsp --help >/dev/null
"$shp_bin" check

"$shp_bin" ast source \
  --language typescript \
  --module generated.audit \
  fixtures/source/audit_purge.ts \
  >"$smoke_dir/ast-source.shape"
grep -q "GeneratedAstAnchor" "$smoke_dir/ast-source.shape"
grep -q "kind generated_from" "$smoke_dir/ast-source.shape"

cat >"$smoke_dir/widget.tsx" <<'EOF'
export function Widget() {
  return <section>audit</section>;
}
EOF
"$shp_bin" ast source \
  --module generated.widget \
  "$smoke_dir/widget.tsx" \
  >"$smoke_dir/ast-source-tsx.shape"
grep -q "GeneratedAstAnchor" "$smoke_dir/ast-source-tsx.shape"

"$shp_bin" ast source \
  fixtures/source/swift/architecture.swift \
  >"$smoke_dir/ast-source-swift.shape"
grep -q 'source swift(' "$smoke_dir/ast-source-swift.shape"
grep -q 'component ContentView' "$smoke_dir/ast-source-swift.shape"
grep -q 'effects unknown' "$smoke_dir/ast-source-swift.shape"

if [ "$quick" -eq 1 ]; then
  exit 0
fi

"$shp_bin" check \
  fixtures/projects/domain-pack-consumer/shape/project.shape \
  fixtures/projects/domain-pack-consumer/shape/vendor/audit-policy/v1/audit-policy.shape
"$shp_bin" graph stats >/dev/null
"$shp_bin" graph all --kind calls >/dev/null
"$shp_bin" graph show CiPipeline --kind calls >/dev/null

"$shp_bin" check \
  --allow-unknown-effects \
  fixtures/fail/unknown_effects/audit.shape \
  >"$smoke_dir/draft.out"
grep -q "passed with warnings" "$smoke_dir/draft.out"

set +e
"$shp_bin" check fixtures/fail/unknown_effects/audit.shape \
  >"$smoke_dir/strict.out" 2>&1
strict_status=$?
"$shp_bin" check fixtures/fail/forbidden_path/deps.shape \
  >"$smoke_dir/path.out" 2>&1
path_status=$?
set -e
if [ "$strict_status" -ne 1 ]; then
  echo "Expected strict unknown-effect check to fail, got exit $strict_status." >&2
  exit 1
fi
if [ "$path_status" -ne 1 ]; then
  echo "Expected forbidden-path check to fail, got exit $path_status." >&2
  exit 1
fi
grep -q "unknown effects" "$smoke_dir/strict.out"
grep -q "forbidden path" "$smoke_dir/path.out"

"$shp_bin" author \
  --changed-files fixtures/changed/audit_purge.txt \
  --component AuditStore \
  >"$smoke_dir/author.shape"
grep -q "effects unknown" "$smoke_dir/author.shape"

"$shp_bin" memory >/dev/null
"$shp_bin" obligations >"$smoke_dir/obligations.txt"
grep -q "No open shape obligations." "$smoke_dir/obligations.txt"

set +e
"$shp_bin" analyze \
  --shape-files fixtures/pass/append_only_append/audit.shape \
  fixtures/source/audit_purge.ts \
  >"$smoke_dir/analyze.out" \
  2>"$smoke_dir/analyze.err"
analyze_status=$?
set -e
if [ "$analyze_status" -ne 1 ]; then
  echo "Expected analyzer smoke test to report a mismatch, got exit $analyze_status."
  cat "$smoke_dir/analyze.out"
  cat "$smoke_dir/analyze.err" >&2
  exit 1
fi
grep -q "HardDelete" "$smoke_dir/analyze.err"
