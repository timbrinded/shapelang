# Shape grants as affine capability tokens. Each token type is declared
# `is Type`, so a value cannot be copied (+ needs Data). Every privileged
# operation on the AuditLog resource demands its token; read and append
# hand the token back beside the result, hard_delete consumes it.

import Base

type Log is Data:
  Log{entries: List<&2, String>}

# Read<AuditLog>
type ReadCap is Type:
  ReadCap{}

# Append<AuditLog>
type AppendCap is Type:
  AppendCap{}

# HardDelete<AuditLog>
type DeleteCap is Type:
  DeleteCap{}

def Log.read(c: ReadCap, log: Log) -> ReadCap & List<&2, String>:
  Log{es} = log
  (c, es)

def Log.append(c: AppendCap, log: Log, e: String) -> AppendCap & Log:
  Log{es} = log
  (c, Log{e <> es})

def Log.hard_delete(c: DeleteCap, log: Log) -> Log:
  Log{es} = log
  Log{Nil{}}

def Log.size(log: Log) -> Nat:
  Log{es} = log
  List.length(&2, String, es)

# the composition root's mint: in the intended design only main calls it
def root_caps() -> ReadCap & (AppendCap & DeleteCap):
  (ReadCap{}, (AppendCap{}, DeleteCap{}))
