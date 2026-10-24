# stale-model candidate: loadReport no longer calls RemoteTemplate
import Base

# component RemoteTemplate
def template() -> String:
  "remote"

# component ReportLoader: export function loadReport() { return "local"; }
def loadReport() -> String:
  "local"
