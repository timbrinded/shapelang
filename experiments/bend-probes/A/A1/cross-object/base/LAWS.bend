# Laws for cross-object (no contract.md): the base contract implied by
# `getLabel(recordId): string | null` and by presentRecord answering
# "not found" for unknown ids. An unknown id is one with
# is_known(id) == False.

import Base
import ./main.bend as C

# LAW: getLabel answers null (None) for an unknown id
law label_unknown_is_null:
  for +id: String
  for unknown: {C.is_known(id) == False{} : Bool}
  {C.getLabel(id) == None{} : Maybe<String>}

# LAW: presentRecord answers "not found" for an unknown id
law present_unknown:
  for +id: String
  for unknown: {C.is_known(id) == False{} : Bool}
  {C.presentRecord(id) == "not found" : String}

# LAW: presentRecord answers the label for the known id (base behaviour pin)
law present_known:
  {C.presentRecord("known") == "record" : String}
