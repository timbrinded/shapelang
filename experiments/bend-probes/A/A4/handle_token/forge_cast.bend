# D03b: pure code tries to pass a Unit annotated as a Listener
import Base
import ./caps.bend as C

def purge(log: C.Log) -> Listener & C.Log:
  C.Log.hard_delete({Unit{} : Listener}, log)
