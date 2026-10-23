#!/bin/bash
# Reproduce the environment used for the Verus probes.
# Needs: git, rustup, cargo, pip3, docker (daemon running), bun (for shp).
# Everything is written under $VP_WORK (default /tmp/verus-probes).
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
VP_WORK=${VP_WORK:-/tmp/verus-probes}
mkdir -p "$VP_WORK/repos"

# Corpus: the eight systems behind VeruSAGE-Bench, at the commits measured.
while read -r name url rev; do
  if [ ! -d "$VP_WORK/repos/$name" ]; then
    git clone -q --no-checkout "$url" "$VP_WORK/repos/$name"
  fi
  git -C "$VP_WORK/repos/$name" checkout -q --detach "$rev" 2>/dev/null || git -C "$VP_WORK/repos/$name" update-ref HEAD "$rev"
done <<'EOF'
anvil https://github.com/anvil-verifier/anvil.git e83ea0f5516ce2ece26740266165180018741e66
atmosphere https://github.com/mars-research/atmosphere.git bd485f22f1d5e4d1623e133700dc233086059603
verified-ironkv https://github.com/verus-lang/verified-ironkv.git 7e35ed097c4089b9fbda483ea2629a0033f4d874
verified-memory-allocator https://github.com/verus-lang/verified-memory-allocator.git 77d1fb6fc1907c903764863a479479a0a0ed04f5
verified-node-replication https://github.com/verus-lang/verified-node-replication.git 6aed637f56043e508d3d187c4980431a7fce9373
verified-nrkernel https://github.com/matthias-brun/verified-nrkernel.git 1c861090537664b78544cda5d53711b1fcfa05e2
verified-storage https://github.com/microsoft/verified-storage.git 41cab95051229ebd457b4eed7fc111e3e7c9099c
vest https://github.com/secure-foundations/vest.git 19125806ebd7d4f41896b7bb7accca6f8eebca74
EOF

# Verus at the commit used (main, 2026-10-23), with Z3 4.16.0 from the PyPI wheel.
if [ ! -x "$VP_WORK/verus/source/target-verus/release/verus" ]; then
  [ -d "$VP_WORK/verus" ] || git clone -q https://github.com/verus-lang/verus.git "$VP_WORK/verus"
  git -C "$VP_WORK/verus" checkout -q dccae1df5fcbe663628af781c8b211123ad9d928
  tmp=$(mktemp -d)
  pip3 download -q --no-deps "z3-solver==4.16.0.0" -d "$tmp"
  python3 -I -c "import zipfile,glob,sys; z=zipfile.ZipFile(glob.glob(sys.argv[1]+'/*.whl')[0]); open(sys.argv[2],'wb').write(z.read('z3_solver-4.16.0.0.data/data/bin/z3'))" "$tmp" "$VP_WORK/verus/source/z3"
  chmod +x "$VP_WORK/verus/source/z3"
  (cd "$VP_WORK/verus/source" && bash -c 'source ../tools/activate && vargo build --release')
fi

# The syntactic extractor (verus_syn based).
(cd "$HERE/vprobe" && cargo build --release -q)

# Sandbox image.
docker pull -q ubuntu:24.04 >/dev/null
echo "ready: VP_WORK=$VP_WORK"
