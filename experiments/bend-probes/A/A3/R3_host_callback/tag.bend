# A3 route R3: a pure, law-proven def that calls a closure it is given.
# Inside Bend every closure is pure; a JS host importing the .mjs can pass
# any JS function.

import Base

def tag(f: String -> String, x: String) -> String:
  f(x)

law tag_applies:
  for f: String -> String
  for x: String
  {tag(f, x) == f(x) : String}

def tag_applies(f, x):
  {==}
