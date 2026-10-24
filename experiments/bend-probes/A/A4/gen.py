#!/usr/bin/env python3
"""Generate the A4 capability mutants.

usage: python3 -I gen.py <out-dir>

Each mutant is <out-dir>/<id>/ with caps.bend (shared), service.bend (the
mutated module, which only ever receives an AppendCap from main) and main.bend
(the composition root). A mutant that checks has obtained or used a
HardDelete without being granted one, or duplicated a token.
"""
import os, sys, shutil

HERE = os.path.dirname(os.path.abspath(__file__))

HEAD = "import Base\nimport ./caps.bend as C\n\n"

# main: grants the service an AppendCap only, keeps the rest
MAIN = '''import Base
import ./caps.bend as C
import ./service.bend as S

def report(res: C.AppendCap & C.Log) -> IO(Unit):
  (a2, log2) = res
  IO.print("entries=" ++ Nat.show(C.Log.size(log2)))

def run(caps: C.ReadCap & (C.AppendCap & C.DeleteCap)) -> IO(Unit):
  (r, (a, d)) = caps
  report(S.record(a, C.Log{["boot"]}, "event"))

def main() -> IO(Unit):
  run(C.root_caps())
'''

BASE_SVC = '''# the service holds Append only
def record(c: C.AppendCap, log: C.Log, e: String) -> C.AppendCap & C.Log:
  C.Log.append(c, log, e)
'''

M = {}
M["M00_control"] = ("control: append with the granted AppendCap", BASE_SVC, {})
M["M01_no_token"] = ("call hard_delete with no token argument", '''def record(c: C.AppendCap, log: C.Log, e: String) -> C.AppendCap & C.Log:
  (c, C.Log.hard_delete(log))
''', {})
M["M02_wrong_token"] = ("pass the AppendCap where a DeleteCap is required", '''def record(c: C.AppendCap, log: C.Log, e: String) -> C.AppendCap & C.Log:
  (c, C.Log.hard_delete(c, log))
''', {})
M["M03_forge_ctor"] = ("forge: construct C.DeleteCap{} directly in the service module", '''def record(c: C.AppendCap, log: C.Log, e: String) -> C.AppendCap & C.Log:
  (c, C.Log.hard_delete(C.DeleteCap{}, log))
''', {})
M["M04_forge_from_other_token"] = ("forge: match the held AppendCap and build a DeleteCap from it", '''def upgrade(c: C.AppendCap) -> C.DeleteCap:
  match c:
    case C.AppendCap{}:
      C.DeleteCap{}

def record(c: C.AppendCap, log: C.Log, e: String) -> C.AppendCap & C.Log:
  (C.AppendCap{}, C.Log.hard_delete(upgrade(c), log))
''', {})
M["M05_forge_own_mint_call"] = ("forge: the service calls the root's mint C.root_caps() itself", '''def take_delete(caps: C.ReadCap & (C.AppendCap & C.DeleteCap)) -> C.DeleteCap:
  (r, (a, d)) = caps
  d

def record(c: C.AppendCap, log: C.Log, e: String) -> C.AppendCap & C.Log:
  (c, C.Log.hard_delete(take_delete(C.root_caps()), log))
''', {})
M["M06_forge_redeclared_type"] = ("forge: redeclare a same-named DeleteCap type in the service", '''type DeleteCap is Type:
  DeleteCap{}

def record(c: C.AppendCap, log: C.Log, e: String) -> C.AppendCap & C.Log:
  (c, C.Log.hard_delete(DeleteCap{}, log))
''', {})
M["M07_dup_plus_param"] = ("copy: a reusable +DeleteCap parameter used twice", '''def twice(+d: C.DeleteCap, log: C.Log) -> C.Log:
  C.Log.hard_delete(d, C.Log.hard_delete(d, log))

def record(c: C.AppendCap, log: C.Log, e: String) -> C.AppendCap & C.Log:
  C.Log.append(c, log, e)
''', {})
M["M08_dup_use_twice"] = ("copy: an affine DeleteCap used twice", '''def twice(d: C.DeleteCap, log: C.Log) -> C.Log:
  C.Log.hard_delete(d, C.Log.hard_delete(d, log))

def record(c: C.AppendCap, log: C.Log, e: String) -> C.AppendCap & C.Log:
  C.Log.append(c, log, e)
''', {})
M["M09_dup_return_twice"] = ("copy: return the same token twice", '''def dup(d: C.DeleteCap) -> C.DeleteCap & C.DeleteCap:
  (d, d)

def record(c: C.AppendCap, log: C.Log, e: String) -> C.AppendCap & C.Log:
  C.Log.append(c, log, e)
''', {})
M["M10_dup_closure_twice"] = ("smuggle: capture the token in a closure and call the closure twice", '''def twice(d: C.DeleteCap, log: C.Log) -> C.Log:
  f = l => C.Log.hard_delete(d, l)
  f(f(log))

def record(c: C.AppendCap, log: C.Log, e: String) -> C.AppendCap & C.Log:
  C.Log.append(c, log, e)
''', {})
M["M11_dup_data_box"] = ("smuggle: store the token in a Data-kinded box, then copy the box", '''type Box is Data:
  Box{d: C.DeleteCap}

def unbox(+b: Box) -> C.DeleteCap:
  Box{d} = b
  d

def twice(+b: Box, log: C.Log) -> C.Log:
  C.Log.hard_delete(unbox(b), C.Log.hard_delete(unbox(b), log))

def record(c: C.AppendCap, log: C.Log, e: String) -> C.AppendCap & C.Log:
  C.Log.append(c, log, e)
''', {})
M["M12_dup_polymorphic"] = ("copy: through a polymorphic reusable helper instantiated at DeleteCap", '''def dup(a, -A: Kind(a), +x: A) -> A & A:
  (x, x)

def twice(d: C.DeleteCap) -> C.DeleteCap & C.DeleteCap:
  dup(&1, C.DeleteCap, d)

def record(c: C.AppendCap, log: C.Log, e: String) -> C.AppendCap & C.Log:
  C.Log.append(c, log, e)
''', {})
M["M13_dup_replicate"] = ("copy: List.replicate the token", '''def many(d: C.DeleteCap) -> List<&2, C.DeleteCap>:
  List.replicate(C.DeleteCap, 2n, d)

def record(c: C.AppendCap, log: C.Log, e: String) -> C.AppendCap & C.Log:
  C.Log.append(c, log, e)
''', {})
M["M14_dup_array_fork"] = ("copy: alias a one-slot array of tokens with Base's @unsafe Array.fork", '''def unwrap(m: Maybe<C.DeleteCap>, log: C.Log) -> C.Log:
  match m:
    case None{}:
      log
    case Some{d}:
      C.Log.hard_delete(d, log)

def take(r: Array<Maybe<C.DeleteCap>> & Maybe<C.DeleteCap>, log: C.Log) -> C.Log:
  (a, m) = r
  unwrap(m, log)

def both(p: Array<Maybe<C.DeleteCap>> & Array<Maybe<C.DeleteCap>>, log: C.Log) -> C.Log:
  (a1, a2) = p
  take(Array.swap(Maybe<C.DeleteCap>, a1, 0, None{}), take(Array.swap(Maybe<C.DeleteCap>, a2, 0, None{}), log))

def twice(d: C.DeleteCap, log: C.Log) -> C.Log:
  both(Array.fork(Maybe<C.DeleteCap>, ALeaf{Some{d}}), log)

def record(c: C.AppendCap, log: C.Log, e: String) -> C.AppendCap & C.Log:
  C.Log.append(c, log, e)
''', {})
M["M15_forge_todo"] = ("forge: a ?TODO where the token goes", '''def record(c: C.AppendCap, log: C.Log, e: String) -> C.AppendCap & C.Log:
  (c, C.Log.hard_delete(?TODO, log))
''', {})
M["M16_forge_unsafe"] = ("forge: an @unsafe def claiming to return a DeleteCap", '''@unsafe
def mint(u: Unit) -> C.DeleteCap:
  mint(u)

def record(c: C.AppendCap, log: C.Log, e: String) -> C.AppendCap & C.Log:
  (c, C.Log.hard_delete(mint(Unit{}), log))
''', {})
M["M17_forge_open_law"] = ("forge: an open law of type DeleteCap used as a value", '''law mint:
  C.DeleteCap

def record(c: C.AppendCap, log: C.Log, e: String) -> C.AppendCap & C.Log:
  (c, C.Log.hard_delete(mint, log))
''', {})
M["M18_forge_erased"] = ("forge: an erased -DeleteCap parameter spent live", '''def purge(-d: C.DeleteCap, log: C.Log) -> C.Log:
  C.Log.hard_delete(d, log)

def record(c: C.AppendCap, log: C.Log, e: String) -> C.AppendCap & C.Log:
  C.Log.append(c, log, e)
''', {})
M["M19_forge_foreign"] = ("forge: a foreign JS effect that answers a DeleteCap", '''def mint() -> IO(C.DeleteCap):
  import "./mint.js"

def purge(log: C.Log) -> IO(C.Log):
  IO.bind(C.DeleteCap, C.Log, mint(), d => IO.pure(C.Log, C.Log.hard_delete(d, log)))

def record(c: C.AppendCap, log: C.Log, e: String) -> C.AppendCap & C.Log:
  C.Log.append(c, log, e)
''', {"mint.js": "function mint() {\n  return { $: CID(DeleteCap) };\n}\n\nio_eff(CID(mint), mint);\n"})
M["M20_forge_absurd"] = ("forge: Empty.absurd at type DeleteCap from a refuted hypothesis the caller cannot supply", '''def purge(never: Empty, log: C.Log) -> C.Log:
  C.Log.hard_delete(Empty.absurd(C.DeleteCap, never), log)

def record(c: C.AppendCap, log: C.Log, e: String) -> C.AppendCap & C.Log:
  C.Log.append(c, log, e)
''', {})

# defence attempt: an opaque token type declared as a law, as Base does for File
OPAQUE_CAPS = '''import Base

type Log is Data:
  Log{entries: List<&2, String>}

# an opaque token: a law of kind Type with no constructor, as Base's File
law DeleteCap:
  Type

def Log.hard_delete(c: DeleteCap, log: Log) -> Log:
  Log{es} = log
  Log{Nil{}}
'''

def main():
    out = sys.argv[1]
    for k, (desc, svc, extra) in M.items():
        d = os.path.join(out, k)
        os.makedirs(d, exist_ok=True)
        shutil.copy(os.path.join(HERE, "caps.bend"), os.path.join(d, "caps.bend"))
        open(os.path.join(d, "service.bend"), "w").write("# A4 mutant " + k + ": " + desc + "\n" + HEAD + svc)
        open(os.path.join(d, "main.bend"), "w").write(MAIN)
        for f, body in extra.items():
            open(os.path.join(d, f), "w").write(body)
    d = os.path.join(out, "D01_opaque_law_type")
    os.makedirs(d, exist_ok=True)
    open(os.path.join(d, "caps.bend"), "w").write(OPAQUE_CAPS)
    open(os.path.join(d, "service.bend"), "w").write("# A4 defence D01: opaque token type as a user law\n" + HEAD + "def record(log: C.Log) -> C.Log:\n  log\n")
    open(os.path.join(d, "main.bend"), "w").write("import Base\nimport ./caps.bend as C\nimport ./service.bend as S\n\ndef main() -> IO(Unit):\n  IO.print(\"entries=\" ++ \"0\")\n")
    print(len(M) + 1, "cases")

main()
