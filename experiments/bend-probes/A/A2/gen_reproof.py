#!/usr/bin/env python3
"""A2 caller-law re-proof attempts.

usage: python3 -I gen_reproof.py <encodings-dir> <out-dir>

For each encoding whose presentRecord keeps the type String -> String, write
<out-dir>/<id>/ with that encoding's main.bend, a LAWS.bend holding only the
caller's laws (present_unknown, present_known, verbatim from the base) and a
PROOF.bend re-written for the candidate's code, as an agent would. For E1 a
REFUTE.bend shows the caller law false.
"""
import os, sys, shutil

LAWS = '''# The caller's laws only, verbatim from the A1 base LAWS.bend.

import Base
import ./main.bend as C

# LAW: presentRecord answers "not found" for an unknown id
law present_unknown:
  for +id: String
  for unknown: {C.is_known(id) == False{} : Bool}
  {C.presentRecord(id) == "not found" : String}

# LAW: presentRecord answers the label for the known id (base behaviour pin)
law present_known:
  {C.presentRecord("known") == "record" : String}
'''

def proof(motive):
    return '''import Base
import ./main.bend as C
import ./LAWS.bend as Laws

def Laws.present_unknown(id, e):
  s = Equal.sym(Bool, C.is_known(id), False{}, e)
  %s : ''' + motive + '''
  {==}

def Laws.present_known():
  {==}
'''

PRESENT_PURE = '{C.present_label(Some{C.label_or(_)}) == "not found" : String}'
PRESENT_ID = '{C.present_label(Some{C.label_or(id, _)}) == "not found" : String}'
PRESENT_E3 = '{C.present_label(Some{C.label_or(_, u => C.getLabel(id))}) == "not found" : String}'
PRESENT_E6 = '{C.present_dec(id, _)({==}) == "not found" : String}'

CASES = {
    "E1_default_string": PRESENT_PURE,
    "E1b_default_not_found": PRESENT_PURE,
    "E2_unsafe_helper": PRESENT_ID,
    "E3_partial_def": PRESENT_E3,
    "E5_todo_hole": PRESENT_PURE,
    "E6_precondition_total_caller": PRESENT_E6,
    "E9_unsafe_bottom_empty": PRESENT_PURE,
}

REFUTE_E1 = '''# The caller law present_unknown is false for E1: at id = "missing"
# presentRecord answers "missing record". Any proof of the law yields Empty.

import Base
import ./main.bend as C

def bdisc(b: Bool) -> Type:
  match b:
    case False{}:
      Empty
    case True{}:
      Unit

def refute_present_unknown(h: @+id: String -> @unknown: {C.is_known(id) == False{} : Bool} -> {C.presentRecord(id) == "not found" : String}) -> Empty:
  e = Equal.sym(String, "missing record", "not found", h("missing", {==}))
  %e : bdisc(String.eq(_, "not found"))
  Unit{}
'''

TF = '''# {True == False} is impossible
def tf(f: {True{} == False{} : Bool}) -> Empty:
  %f : bdisc(_)
  Unit{}

'''

PROOF_E6 = '''import Base
import ./main.bend as C
import ./LAWS.bend as Laws

def bdisc(b: Bool) -> Type:
  match b:
    case False{}:
      Empty
    case True{}:
      Unit

# present_dec on any verdict k known to be False answers "not found"
def dec_false(+id: String, k: Bool) -> @e: {C.is_known(id) == k : Bool} -> {k == False{} : Bool} -> {C.present_dec(id, k)(e) == "not found" : String}:
  match k:
    case True{}:
      e => f => Empty.absurd({C.present_dec(id, True{})(e) == "not found" : String}, tf(f))
    case False{}:
      e => f => {==}

def Laws.present_unknown(id, e):
  dec_false(id, C.is_known(id))({==}, e)

def Laws.present_known():
  {==}
'''

def main():
    src, out = sys.argv[1], sys.argv[2]
    for k, motive in CASES.items():
        d = os.path.join(out, k)
        os.makedirs(d, exist_ok=True)
        shutil.copy(os.path.join(src, k, "main.bend"), os.path.join(d, "main.bend"))
        open(os.path.join(d, "LAWS.bend"), "w").write(LAWS)
        open(os.path.join(d, "PROOF.bend"), "w").write(proof(motive))
        if k == "E6_precondition_total_caller":
            open(os.path.join(d, "PROOF.bend"), "w").write(PROOF_E6.replace("def dec_false", TF + "def dec_false"))
        if k == "E1_default_string":
            open(os.path.join(d, "REFUTE.bend"), "w").write(REFUTE_E1)

if __name__ == "__main__":
    main()
