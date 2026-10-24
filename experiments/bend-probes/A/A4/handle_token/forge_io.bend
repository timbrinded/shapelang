# D03c: IO code mints its own Listener with a Base effect and hard-deletes
import Base
import ./caps.bend as C

def finish(r: Listener & C.Log) -> IO(Unit):
  (tok, log) = r
  do IO<Unit>:
    Listener.close(tok)
    IO.print("purged")

def purge(log: C.Log) -> IO(Unit):
  do IO<Unit>:
    tok : Listener <- IO.try(Listener, TCP.listen("127.0.0.1", 0))
    finish(C.Log.hard_delete(tok, log))

def main() -> IO(Unit):
  purge(C.Log{["a", "b"]})
