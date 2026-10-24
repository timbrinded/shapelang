#!/usr/bin/env bash
# E5: seed one violation per check in a copy of packages/ under $WORK/e5 and
# show that each check fires there (and passes on the unmodified repo).
set -u
E=/home/user/shapelang/experiments/bend-probes/E
W=${WORK:-/tmp/claude-0/-home-user-shapelang/83ff80bc-0161-572f-9e5a-9075cccad6d0/scratchpad/bendexp/work/E}/e5
mkdir -p "$W"

seed() { # id, python edit
  local id=$1 edit=$2 d=$W/seed-$1
  rm -rf "$d"; mkdir -p "$d"
  cp -a /home/user/shapelang/packages "$d/packages"
  ln -s /home/user/shapelang/node_modules "$d/node_modules"
  (cd "$d" && python3 -I -c "$edit") || { echo "seed $id: edit failed"; return; }
  (cd "$d" && diff -ru --no-dereference /home/user/shapelang/packages packages | grep '^[-+][^-+]' | sed 's/^/    /')
  bun $E/e5-checks.ts "$d" "$id" | python3 -I -c "
import json,sys; r=json.load(sys.stdin)['results'][0]
print('  seeded', r['check'], '-> pass' if r['pass'] else '-> FIRES', '|', '; '.join(r['violations'][:2])[:400])"
}

echo "== unmodified repo"
bun $E/e5-checks.ts /home/user/shapelang | python3 -I -c "
import json,sys
for r in json.load(sys.stdin)['results']: print('  ', r['check'], 'pass' if r['pass'] else 'FIRES', '|', '; '.join(r['violations'][:2])[:300])"

echo "== seeded copies"
seed A '
p="packages/shp-checker/src/checker/rules/guards.ts"; s=open(p).read()
sig="export function checkFreshness(model: Model, asOf: IsoDateString): SemanticDiagnostic[] {"
assert sig in s; s=s.replace(sig, sig+"\n  const seededNow = Date.now();\n  void seededNow;"); open(p,"w").write(s)'

seed B '
p="packages/shp-checker/src/analyzer-shape.ts"; s=open(p).read()
s="import { checkShapeModules } from \"./checker/api.ts\";\n"+s
old="  const declaredEffectsByPath = collectDeclaredEffectsBySourcePath(modules);"
assert old in s; s=s.replace(old, old+"\n  checkShapeModules(modules);"); open(p,"w").write(s)'

seed C '
p="packages/shp-checker/src/analyzer-shape.ts"; s=open(p).read()
old="    path: normalizeShapeSourcePath(path),"
assert old in s; s=s.replace(old, "    path: path,"); open(p,"w").write(s)'

seed D '
p="packages/shp-checker/src/formatter.ts"; s=open(p).read()
old="    ...grants.sort(compareCodepointStrings),"
assert old in s; s=s.replace(old, "    ...grants,"); open(p,"w").write(s)'

seed E '
p="packages/shp-checker/src/checker/rules/relations.ts"; s=open(p).read()
start=s.index("function shortestPathBetween(")
end=s.index("function compareTraversalPaths(")
dfs="""function shortestPathBetween(
  source: string,
  target: string,
  graph: RelationTraversalGraph
): RelationTraversalStep[] | undefined {
  const visited = new Set([source]);
  const dfs = (vertex: string, path: RelationTraversalStep[]): RelationTraversalStep[] | undefined => {
    for (const step of graph.adjacency.get(vertex) ?? []) {
      if (step.to === target) return [...path, step];
      if (!visited.has(step.to)) {
        visited.add(step.to);
        const found = dfs(step.to, [...path, step]);
        if (found) return found;
      }
    }
    return undefined;
  };
  return dfs(source, []);
}

"""
s=s[:start]+dfs+s[end:]; open(p,"w").write(s)'
