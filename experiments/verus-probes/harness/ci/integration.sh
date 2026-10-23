echo "== Shape trust base: every Verus trust marker must be an unsafe fn in the Shape model =="
vprobe tcb-check src/lib.rs shape/revlog.shape || exit 1
echo "== Shape obligations compiled to Verus: Revision is AppendOnly =="
rm -rf /tmp/obl && cp -r /work /tmp/obl
vprobe obligations src/lib.rs RevisionLog > /tmp/obl/src/shape_obligations.rs || exit 1
echo 'mod shape_obligations;' >> /tmp/obl/src/lib.rs
verus --crate-type=lib /tmp/obl/src/lib.rs || exit 1
