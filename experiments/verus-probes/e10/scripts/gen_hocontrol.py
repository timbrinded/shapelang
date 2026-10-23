"""HOcontrol: the HardDelete HOprobe mutants plus `: AppendOnly` on the target
resource. If the oracle works, every one should be killed by `forbidden effect`."""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import EXP, load_model, read_lines
d = load_model()
RES = {r["id"]: r for r in d["resources"]}
ho = json.load(open(os.path.join(EXP, "mutants", "HOprobe.json")))
out = []
for m in ho:
    if m["effect"] != "HardDelete":
        continue
    r = RES[m["resource"]]
    lines = read_lines(r["file"])
    idx = lines.index(f"resource {r['name']}")
    edits = list(m["edits"]) + [
        {"file": r["file"], "kind": "delete", "line": idx, "expect": f"resource {r['name']}"},
        {"file": r["file"], "kind": "insert_after", "line": idx - 1, "text": f"resource {r['name']} : AppendOnly"}]
    out.append({**m, "op": "HOcontrol", "id": m["id"].replace("HOprobe", "HOcontrol"), "edits": edits})
json.dump(out, open(os.path.join(EXP, "mutants", "HOcontrol.json"), "w"), indent=1)
print(len(out))
