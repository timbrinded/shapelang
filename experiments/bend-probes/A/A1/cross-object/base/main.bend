# Port of fixtures/skills/review/cross-object/base/catalog.ts and the
# caller fixtures/skills/review/cross-object/candidate/presenter.ts
# (presenter.ts is unchanged by the candidate; it is the affected caller).
# `string | null` is ported as Maybe<String>.

import Base

def is_known(id: String) -> Bool:
  String.eq(id, "known")

def label_for(k: Bool) -> Maybe<String>:
  match k:
    case True{}:
      Some{"record"}
    case False{}:
      None{}

# return recordId === "known" ? "record" : null;
def getLabel(id: String) -> Maybe<String>:
  label_for(is_known(id))

# return label === null ? "not found" : label;
def present_label(label: Maybe<String>) -> String:
  match label:
    case None{}:
      "not found"
    case Some{l}:
      l

def presentRecord(id: String) -> String:
  present_label(getLabel(id))
