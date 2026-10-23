echo "== verus =="
verus --crate-type=lib src/lib.rs || exit 1
