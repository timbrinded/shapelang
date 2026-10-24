# the authored relation holds: loadReport calls RemoteTemplate
import Base

def template() -> String:
  "remote"

def loadReport() -> String:
  template()
