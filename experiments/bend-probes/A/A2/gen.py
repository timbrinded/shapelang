#!/usr/bin/env python3
"""Generate the A2 encodings of the cross-object change (getLabel: null -> throw).

usage: python3 -I gen.py <out-dir>

Each encoding gets <out-dir>/<id>/ with main.bend (the candidate port plus a
run-mode main), LAWS.bend and PROOF.bend copied byte-for-byte from the A1 base
(the protected laws and the unchanged proof), except E7b, which restates the
laws over IO.
"""
import os, sys, shutil

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = os.path.join(HERE, "..", "A1", "cross-object", "base")

PRE = '''import Base

def is_known(id: String) -> Bool:
  String.eq(id, "known")

def present_label(label: Maybe<String>) -> String:
  match label:
    case None{}:
      "not found"
    case Some{l}:
      l
'''

# run-mode driver for pure presenters
MAIN_PURE = '''
def main() -> IO(Unit):
  do IO<Unit>:
    IO.print("known   -> " ++ presentRecord("known"))
    IO.print("missing -> " ++ presentRecord("missing"))
'''

# run-mode driver for IO presenters
MAIN_IO = '''
def main() -> IO(Unit):
  do IO<Unit>:
    a : String <- presentRecord("known")
    IO.print("known   -> " ++ a)
    b : String <- presentRecord("missing")
    IO.print("missing -> " ++ b)
'''

PRESENT_PURE = '''
# presenter.ts, unchanged: the null check is kept (dead) by wrapping the label
def presentRecord(id: String) -> String:
  present_label(Some{getLabel(id)})
'''

PRESENT_IO = '''
# presenter.ts: the throw propagates, so the presenter is IO too
def presentRecord(id: String) -> IO(String):
  IO.bind(String, String, getLabel(id), l => IO.pure(String, present_label(Some{l})))
'''

ENC = {}

ENC["E0_base"] = ("base port (control)", PRE + '''
def label_for(k: Bool) -> Maybe<String>:
  match k:
    case True{}:
      Some{"record"}
    case False{}:
      None{}

def getLabel(id: String) -> Maybe<String>:
  label_for(is_known(id))

def presentRecord(id: String) -> String:
  present_label(getLabel(id))
''' + MAIN_PURE, {})

ENC["E1_default_string"] = ("return type narrowed to String; unknown answers a default \"missing record\"", PRE + '''
def label_or(k: Bool) -> String:
  match k:
    case True{}:
      "record"
    case False{}:
      "missing record"

def getLabel(id: String) -> String:
  label_or(is_known(id))
''' + PRESENT_PURE + MAIN_PURE, {})

ENC["E1b_default_not_found"] = ("String with default equal to the caller's fallback \"not found\"", PRE + '''
def label_or(k: Bool) -> String:
  match k:
    case True{}:
      "record"
    case False{}:
      "not found"

def getLabel(id: String) -> String:
  label_or(is_known(id))
''' + PRESENT_PURE + MAIN_PURE, {})

ENC["E2_unsafe_helper"] = ("String; unknown branch calls an @unsafe def that never returns", PRE + '''
@unsafe
def missing_record(id: String) -> String:
  missing_record(id)

def label_or(id: String, k: Bool) -> String:
  match k:
    case True{}:
      "record"
    case False{}:
      missing_record(id)

def getLabel(+id: String) -> String:
  label_or(id, is_known(id))
''' + PRESENT_PURE + MAIN_PURE, {})

ENC["E3_partial_def"] = ("String; getLabel itself is a partial `def getLabel?` that recurses forever on unknown ids", PRE + '''
def label_or(k: Bool, again: Unit -> String) -> String:
  match k:
    case True{}:
      "record"
    case False{}:
      again(Unit{})

def getLabel?(+id: String) -> String:
  label_or(is_known(id), u => getLabel(id))
''' + PRESENT_PURE + MAIN_PURE, {})

ENC["E4_foreign_js_throw_io"] = ("IO(String); unknown branch calls a foreign JS effect that throws", PRE + '''
def label_throw(msg: String) -> IO(String):
  import "./throw.js"

def label_or(k: Bool) -> IO(String):
  match k:
    case True{}:
      IO.pure(String, "record")
    case False{}:
      label_throw("missing record")

def getLabel(id: String) -> IO(String):
  label_or(is_known(id))
''' + PRESENT_IO + MAIN_IO, {"throw.js": "function label_throw(msg) {\n  throw new Error(msg);\n}\n\nio_eff(CID(label_throw), label_throw);\n"})

ENC["E4b_foreign_js_throw_pure"] = ("String; getLabel is itself a foreign JS def with a non-IO type", PRE + '''
def getLabel(id: String) -> String:
  import "./throw.js"
''' + PRESENT_PURE + MAIN_PURE, {"throw.js": "function getlabel(id) {\n  if (id !== \"known\") throw new Error(\"missing record\");\n  return \"record\";\n}\n\nio_eff(CID(getLabel), getlabel);\n"})

ENC["E5_todo_hole"] = ("String; unknown branch is a ?TODO hole", PRE + '''
def label_or(k: Bool) -> String:
  match k:
    case True{}:
      "record"
    case False{}:
      ?TODO

def getLabel(id: String) -> String:
  label_or(is_known(id))
''' + PRESENT_PURE + MAIN_PURE, {})

ENC["E6_precondition_total_caller"] = ("String with a precondition {is_known(id) == True}; unknown branch closed by Empty; caller decides and answers \"not found\"", PRE + '''
def bdisc(b: Bool) -> Type:
  match b:
    case True{}:
      Unit
    case False{}:
      Empty

# {False == True} is impossible: rewrite Empty into Unit through bdisc
def bclash(e: {False{} == True{} : Bool}) -> Empty:
  s = Equal.sym(Bool, False{}, True{}, e)
  %s : bdisc(_)
  Unit{}

def label_ev(k: Bool) -> {k == True{} : Bool} -> String:
  match k:
    case True{}:
      e => "record"
    case False{}:
      e => Empty.absurd(String, bclash(e))

def getLabel(+id: String, known: {is_known(id) == True{} : Bool}) -> String:
  label_ev(is_known(id))(known)

# the caller must hold evidence that the id is known to call getLabel
def present_dec(+id: String, k: Bool) -> {is_known(id) == k : Bool} -> String:
  match k:
    case True{}:
      e => getLabel(id, e)
    case False{}:
      e => "not found"

def presentRecord(+id: String) -> String:
  present_dec(id, is_known(id))({==})
''' + MAIN_PURE, {})

ENC["E6b_precondition_caller_todo"] = ("as E6, but the caller (presenter.ts kept) passes a ?TODO for the evidence", PRE + '''
def bdisc(b: Bool) -> Type:
  match b:
    case True{}:
      Unit
    case False{}:
      Empty

def bclash(e: {False{} == True{} : Bool}) -> Empty:
  s = Equal.sym(Bool, False{}, True{}, e)
  %s : bdisc(_)
  Unit{}

def label_ev(k: Bool) -> {k == True{} : Bool} -> String:
  match k:
    case True{}:
      e => "record"
    case False{}:
      e => Empty.absurd(String, bclash(e))

def getLabel(+id: String, known: {is_known(id) == True{} : Bool}) -> String:
  label_ev(is_known(id))(known)

def presentRecord(+id: String) -> String:
  present_label(Some{getLabel(id, ?TODO)})
''' + MAIN_PURE, {})

ENC["E7_io_die"] = ("IO(String); unknown branch is IO.die (Base effect, CPS Halt)", PRE + '''
def label_or(k: Bool) -> IO(String):
  match k:
    case True{}:
      IO.pure(String, "record")
    case False{}:
      IO.die(String, 1, "missing record")

def getLabel(id: String) -> IO(String):
  label_or(is_known(id))
''' + PRESENT_IO + MAIN_IO, {})

ENC["E8_result"] = ("Result<String, String>; unknown answers Fail; the presenter propagates the failure", PRE + '''
def label_or(k: Bool) -> Result<String, String>:
  match k:
    case True{}:
      Done{"record"}
    case False{}:
      Fail{"missing record"}

def getLabel(id: String) -> Result<String, String>:
  label_or(is_known(id))

def present_res(r: Result<String, String>) -> Result<String, String>:
  match r:
    case Done{l}:
      Done{present_label(Some{l})}
    case Fail{e}:
      Fail{e}

def presentRecord(id: String) -> Result<String, String>:
  present_res(getLabel(id))

def show_res(r: Result<String, String>) -> String:
  match r:
    case Done{l}:
      l
    case Fail{e}:
      "<thrown: " ++ e ++ ">"
''' + '''
def main() -> IO(Unit):
  do IO<Unit>:
    IO.print("known   -> " ++ show_res(presentRecord("known")))
    IO.print("missing -> " ++ show_res(presentRecord("missing")))
''', {})

ENC["E9_unsafe_bottom_empty"] = ("String; unknown branch is Empty.absurd of an @unsafe def returning Empty", PRE + '''
@unsafe
def bottom(u: Unit) -> Empty:
  bottom(u)

def label_or(k: Bool) -> String:
  match k:
    case True{}:
      "record"
    case False{}:
      Empty.absurd(String, bottom(Unit{}))

def getLabel(id: String) -> String:
  label_or(is_known(id))
''' + PRESENT_PURE + MAIN_PURE, {})

ENC["E10_open_law_postulate"] = ("String; unknown branch calls an open law (a postulated function with no def)", PRE + '''
law missing_record:
  for id: String
  String

def label_or(id: String, k: Bool) -> String:
  match k:
    case True{}:
      "record"
    case False{}:
      missing_record(id)

def getLabel(+id: String) -> String:
  label_or(id, is_known(id))
''' + PRESENT_PURE + MAIN_PURE, {})

ENC["E11_nonexhaustive_match"] = ("String; the unknown case is simply omitted from the match", PRE + '''
def label_or(k: Bool) -> String:
  match k:
    case True{}:
      "record"

def getLabel(id: String) -> String:
  label_or(is_known(id))
''' + PRESENT_PURE + MAIN_PURE, {})

ENC["E12_erased_empty_param"] = ("String; getLabel takes an erased Empty and spends it live in the unknown branch", PRE + '''
def label_or(k: Bool, -never: Empty) -> String:
  match k:
    case True{}:
      "record"
    case False{}:
      Empty.absurd(String, never)

def getLabel(id: String, -never: Empty) -> String:
  label_or(is_known(id), never)

def presentRecord(id: String) -> String:
  present_label(Some{getLabel(id, ?TODO)})
''' + MAIN_PURE, {})

ENC["E13_io_exit"] = ("IO(String); unknown branch exits the process (IO.exit then an unreachable pure)", PRE + '''
def label_or(k: Bool) -> IO(String):
  match k:
    case True{}:
      IO.pure(String, "record")
    case False{}:
      IO.bind(Unit, String, IO.exit(1), u => IO.pure(String, "unreachable"))

def getLabel(id: String) -> IO(String):
  label_or(is_known(id))
''' + PRESENT_IO + MAIN_IO, {})

IO_LAWS = '''# E7b: the base laws restated over IO, as an agent might after the
# presenter became IO. Same intent: unknown ids present "not found".

import Base
import ./main.bend as C

law present_unknown:
  for +id: String
  for unknown: {C.is_known(id) == False{} : Bool}
  {C.presentRecord(id) == IO.pure(String, "not found") : IO(String)}

law present_known:
  {C.presentRecord("known") == IO.pure(String, "record") : IO(String)}
'''
IO_PROOF = '''import Base
import ./main.bend as C
import ./LAWS.bend as Laws

def Laws.present_unknown(id, e):
  s = Equal.sym(Bool, C.is_known(id), False{}, e)
  %s : {IO.bind(String, String, C.label_or(_), l => IO.pure(String, C.present_label(Some{l}))) == IO.pure(String, "not found") : IO(String)}
  {==}

def Laws.present_known():
  {==}
'''

def main():
    out = sys.argv[1]
    os.makedirs(out, exist_ok=True)
    with open(os.path.join(out, "INDEX.tsv"), "w") as idx:
        for k, (desc, src, extra) in ENC.items():
            d = os.path.join(out, k)
            os.makedirs(d, exist_ok=True)
            open(os.path.join(d, "main.bend"), "w").write("# A2 encoding " + k + ": " + desc + "\n\n" + src)
            for f in ("LAWS.bend", "PROOF.bend"):
                shutil.copy(os.path.join(BASE, f), os.path.join(d, f))
            for f, body in extra.items():
                open(os.path.join(d, f), "w").write(body)
            idx.write(k + "\t" + desc + "\n")
        # E7b: IO.die with IO-restated laws; and its IO-lifted base control
        for k, src in (("E7b_io_die_io_laws", ENC["E7_io_die"][1]),
                       ("E7c_io_base_io_laws", ENC["E7_io_die"][1].replace('IO.die(String, 1, "missing record")', 'IO.pure(String, "not found")'))):
            d = os.path.join(out, k)
            os.makedirs(d, exist_ok=True)
            open(os.path.join(d, "main.bend"), "w").write("# A2 encoding " + k + "\n\n" + src)
            open(os.path.join(d, "LAWS.bend"), "w").write(IO_LAWS)
            open(os.path.join(d, "PROOF.bend"), "w").write(IO_PROOF)
            idx.write(k + "\t" + ("IO.die, laws restated over IO" if k.startswith("E7b") else "control: IO-lifted base (unknown -> IO.pure \"not found\"), laws over IO") + "\n")

if __name__ == "__main__":
    main()
