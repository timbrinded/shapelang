#!/bin/sh
# Builds the stale-model probes under $1 (default: this directory).
# Shape claim: relation ReportLoaderCallsRemoteTemplate (kind calls,
# ReportLoader -> RemoteTemplate). Candidate code: loadReport() returns "local".
out=${1:-$(cd "$(dirname "$0")" && pwd)}
mk() { mkdir -p "$out/$1"; }

# --- concrete law: loadReport() equals what RemoteTemplate computes ---
concrete_laws='import Base
import ./main.bend as R

# LAW (attempt 1): the report is the remote template
law report_is_template:
  {R.loadReport() == R.template() : String}
'
concrete_proof='import Base
import ./main.bend as R
import ./LAWS.bend as Laws

def Laws.report_is_template():
  {==}
'
for v in candidate coincident calls; do
  mk "concrete-$v"
  printf '%s' "$concrete_laws" > "$out/concrete-$v/LAWS.bend"
  printf '%s' "$concrete_proof" > "$out/concrete-$v/PROOF.bend"
done
cat > "$out/concrete-candidate/main.bend" <<'EOF'
# stale-model candidate: loadReport no longer calls RemoteTemplate
import Base

# component RemoteTemplate
def template() -> String:
  "remote"

# component ReportLoader: export function loadReport() { return "local"; }
def loadReport() -> String:
  "local"
EOF
sed 's/^  "remote"$/  "local"/; s/^# stale-model candidate.*/# no call, but the template happens to compute the same string/' "$out/concrete-candidate/main.bend" > "$out/concrete-coincident/main.bend"
cat > "$out/concrete-calls/main.bend" <<'EOF'
# the authored relation holds: loadReport calls RemoteTemplate
import Base

def template() -> String:
  "remote"

def loadReport() -> String:
  template()
EOF

# --- parametric law: ReportLoader receives RemoteTemplate as a parameter ---
param_laws='import Base
import ./main.bend as R

# LAW (attempt 2): for every template fetcher, the report is what it answers
law report_from_fetcher:
  for fetch: Unit -> String
  {R.loadReport(fetch) == fetch(Unit{}) : String}
'
param_proof='import Base
import ./main.bend as R
import ./LAWS.bend as Laws

def Laws.report_from_fetcher(fetch):
  {==}
'
for v in candidate calls calls-ignores; do
  mk "param-$v"
  printf '%s' "$param_laws" > "$out/param-$v/LAWS.bend"
  printf '%s' "$param_proof" > "$out/param-$v/PROOF.bend"
done
cat > "$out/param-candidate/main.bend" <<'EOF'
# candidate, with the callee injected: the fetcher is ignored
import Base

def loadReport(fetch: Unit -> String) -> String:
  "local"
EOF
cat > "$out/param-calls/main.bend" <<'EOF'
# the callee is injected and its answer returned
import Base

def loadReport(fetch: Unit -> String) -> String:
  fetch(Unit{})
EOF
cat > "$out/param-calls-ignores/main.bend" <<'EOF'
# the callee is injected and called, but its answer is discarded
import Base

def loadReport(fetch: Unit -> String) -> String:
  s = fetch(Unit{})
  "local"
EOF
cat > "$out/param-candidate/REFUTE.bend" <<'EOF'
# the parametric law is false for the candidate: take fetch = "remote"
import Base
import ./main.bend as R

def bdisc(b: Bool) -> Type:
  match b:
    case False{}:
      Empty
    case True{}:
      Unit

def refute(h: @fetch: (Unit -> String) -> {R.loadReport(fetch) == fetch(Unit{}) : String}) -> Empty:
  e = h(u => "remote")
  %e : bdisc(String.eq(_, "local"))
  Unit{}
EOF
