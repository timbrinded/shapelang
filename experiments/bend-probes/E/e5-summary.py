# E5: summarise e5-memories.json (entry-level and clause-level translatability).
import json, collections, os
d = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "e5-memories.json")))
entries = d["entries"]
clauses = collections.Counter()
levels = collections.Counter()
rows = []
for e in entries:
    norm = [c for c in e["clauses"] if c["route"] != "rationale"]
    det = [c for c in norm if c["route"] != "judgment"]
    for c in e["clauses"]:
        clauses[c["route"]] += 1
    level = "full" if len(det) == len(norm) and norm else ("partial" if det else "none")
    if e.get("proxy"): level += "+proxy"
    levels[level] += 1
    routes = collections.Counter(c["route"] for c in det)
    rows.append((e["name"], level, dict(routes)))
print("entries:", len(entries))
print("entry levels:", dict(levels))
n = len(entries)
full = sum(v for k, v in levels.items() if k.startswith("full"))
anyd = sum(v for k, v in levels.items() if not k.startswith("none"))
print(f"translatable (full): {full}/{n} = {100*full/n:.1f}%; at least one clause: {anyd}/{n} = {100*anyd/n:.1f}%")
proxy = sum(v for k, v in levels.items() if "proxy" in k)
art = sum(1 for e in entries if any(c["route"] == "artefact-check" for c in e["clauses"]))
print(f"of which proxy-only: {proxy}; needing artefacts/CI state for at least one clause: {art}")
strict = sum(1 for e in entries if all(c["route"] in ("static-scan", "call-graph", "law", "rationale") for c in e["clauses"]) and not e.get("proxy") and any(c["route"] != "rationale" for c in e["clauses"]))
print(f"strict (full, no proxy, no artefact clause): {strict}/{n} = {100*strict/n:.1f}%")
print("clause routes:", dict(clauses), "normative clauses:", sum(v for k, v in clauses.items() if k != "rationale"))
for r in rows: print(" ", r)
