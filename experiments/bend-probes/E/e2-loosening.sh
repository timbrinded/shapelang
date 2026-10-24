#!/usr/bin/env bash
# E2: run Shape's deterministic loosening check on the guard fixtures.
# Builds scratch git repositories (base commit = fixture base/, head commit =
# fixture candidate/) under $WORK and runs `shp check --check-loosening` with
# both --base-ref and --base-model. Also runs controls that add a dependent
# component, to show when the check does fire.
set -u
REPO=/home/user/shapelang
SHP="bun $REPO/packages/shp-cli/src/index.ts"
WORK=${WORK:-/tmp/claude-0/-home-user-shapelang/83ff80bc-0161-572f-9e5a-9075cccad6d0/scratchpad/bendexp/work/E/e2}
rm -rf "$WORK"; mkdir -p "$WORK"

run() { # label, dir, args...
  local label=$1 dir=$2; shift 2
  echo "----- $label"
  echo "\$ (cd $dir && shp $*)"
  (cd "$dir" && $SHP "$@"; echo "exit=$?") 2>&1
}

mkrepo() { # name, base-files-dir, candidate-files-dir
  local d=$WORK/$1
  mkdir -p "$d/shape"
  git -C "$d" init -q -b main
  git -C "$d" config user.email e2@example.invalid; git -C "$d" config user.name e2
  cp "$2"/*.shape "$d/shape/"
  git -C "$d" add -A; git -C "$d" commit -qm base
  git -C "$d" tag base
  git -C "$d" rm -q -r shape
  mkdir -p "$d/shape"; cp "$3"/*.shape "$d/shape/"
  git -C "$d" add -A; git -C "$d" commit -qm candidate
  git -C "$d" diff --name-only base HEAD > "$d/changed.txt"
  mkdir -p "$d.basemodel"; git -C "$d" archive base shape | tar -x -C "$d.basemodel"
}

for fx in policy-removal equivalent-relocation; do
  F=$REPO/fixtures/skills/guard/$fx
  mkrepo "$fx" "$F/base" "$F/candidate"
  d=$WORK/$fx
  echo "===== fixture $fx"
  echo "changed files:"; sed 's/^/  /' "$d/changed.txt"
  echo "diff base..HEAD (with rename detection):"; git -C "$d" diff -M --stat base HEAD | sed 's/^/  /'
  run "$fx: static check (cases.json command)" "$d" check
  run "$fx: --base-ref --check-loosening" "$d" check --changed-files changed.txt --base-ref base --check-loosening
  run "$fx: --base-model --check-loosening" "$d" check --changed-files changed.txt --base-model "$d.basemodel" --check-loosening
done

# Controls: the same contract edit, but with a component whose code-side claims
# depend on the removed trait. Only these make the loosening observable.
CTRL=$WORK/controls; mkdir -p "$CTRL/base" "$CTRL/cand-hd" "$CTRL/cand-append"
cat > "$CTRL/base/contract.shape" <<'EOF'
module skill_guard_removal

resource AuditEvent : AppendOnly

component AuditStore {
  owns AuditEvent
  grants Append<AuditEvent>
  fn appendEvent
    effects complete {
      Append<AuditEvent>
    }
}
EOF
# candidate A: removes AppendOnly AND adds a destructive effect (examples.md case 1)
cat > "$CTRL/cand-hd/contract.shape" <<'EOF'
module skill_guard_removal

resource AuditEvent

component AuditStore {
  owns AuditEvent
  grants Append<AuditEvent>
  grants HardDelete<AuditEvent>
  fn appendEvent
    effects complete {
      Append<AuditEvent>
    }
  fn deleteEvent
    effects complete {
      HardDelete<AuditEvent>
    }
}
EOF
# candidate B: removes AppendOnly only (the fixture's edit, with a component present)
cat > "$CTRL/cand-append/contract.shape" <<'EOF'
module skill_guard_removal

resource AuditEvent

component AuditStore {
  owns AuditEvent
  grants Append<AuditEvent>
  fn appendEvent
    effects complete {
      Append<AuditEvent>
    }
}
EOF
mkrepo control-hd "$CTRL/base" "$CTRL/cand-hd"
mkrepo control-trait-only "$CTRL/base" "$CTRL/cand-append"
for c in control-hd control-trait-only; do
  echo "===== $c"
  run "$c: static check" "$WORK/$c" check
  run "$c: --base-ref --check-loosening" "$WORK/$c" check --changed-files changed.txt --base-ref base --check-loosening
done
