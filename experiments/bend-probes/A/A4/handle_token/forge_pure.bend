# D03a: pure code tries to build a Listener token
import Base
import ./caps.bend as C

def purge(log: C.Log) -> Listener & C.Log:
  C.Log.hard_delete(Listener{}, log)
