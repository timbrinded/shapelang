# the callee is injected and called, but its answer is discarded
import Base

def loadReport(fetch: Unit -> String) -> String:
  s = fetch(Unit{})
  "local"
