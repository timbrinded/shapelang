import Base
import ./main.bend as C
import ./LAWS.bend as Laws

def Laws.label_unknown_is_null(id, e):
  s = Equal.sym(Bool, C.is_known(id), False{}, e)
  %s : {C.label_for(_) == None{} : Maybe<String>}
  {==}

def Laws.present_unknown(id, e):
  s = Equal.sym(Bool, C.is_known(id), False{}, e)
  %s : {C.present_label(C.label_for(_)) == "not found" : String}
  {==}

def Laws.present_known():
  {==}
