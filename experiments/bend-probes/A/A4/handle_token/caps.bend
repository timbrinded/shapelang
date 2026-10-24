# A4 defence D03: a Base opaque handle type (Listener) used as the
# HardDelete token. Base declares it as a law with no constructor, so
# pure code cannot build one; only Base effects (IO) produce one.

import Base

type Log is Data:
  Log{entries: List<&2, String>}

def Log.hard_delete(tok: Listener, log: Log) -> Listener & Log:
  Log{es} = log
  (tok, Log{Nil{}})
