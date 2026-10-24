# the callee is injected and its answer returned
import Base

def loadReport(fetch: Unit -> String) -> String:
  fetch(Unit{})
