# no call, but the template happens to compute the same string
import Base

# component RemoteTemplate
def template() -> String:
  "local"

# component ReportLoader: export function loadReport() { return "local"; }
def loadReport() -> String:
  "local"
