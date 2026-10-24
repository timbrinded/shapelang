# D2 (d) for TRI1: click_inside weakened from "the count becomes n+1" to "the frame does not quit".
# The frame's event function is abstracted as f; inside is the demo's own.
import Base
import ./old/main.bend as App

def Old(-f: Event -> U32 -> Maybe<U32>) -> Type:
  @+x: U32 -> @+y: U32 -> @button: U32 -> @+n: U32 -> @hit: {True{} == App.Tri.inside(x, y) : Bool}
    -> {f(Mouse{x, y, button, True{}}, n) == Some{(n + 1 : U32)} : Maybe<U32>}

def New(-f: Event -> U32 -> Maybe<U32>) -> Type:
  @+x: U32 -> @+y: U32 -> @button: U32 -> @+n: U32 -> @hit: {True{} == App.Tri.inside(x, y) : Bool}
    -> {Maybe.is_some(&1, U32, f(Mouse{x, y, button, True{}}, n)) == True{} : Bool}

# old -> new, for every f: provable
def old_new(-f: Event -> U32 -> Maybe<U32>, h: Old(f)) -> New(f):
  +x => +y => button => +n => hit =>
    %Equal.sym(Maybe<U32>, f(Mouse{x, y, button, True{}}, n), Some{(n + 1 : U32)}, h(x, y, button, n, hit)) : {Maybe.is_some(&1, U32, _) == True{} : Bool}
    {==}

# new -> old, for every f: refuted by a frame that never counts
def keep(e: Event, n: U32) -> Maybe<U32>:
  Some{n}

def bad_new() -> New(e => n => keep(e, n)):
  +x => +y => button => +n => hit => {==}

def D(m: Maybe<U32>) -> Type:
  match m:
    case None{}:
      Unit
    case Some{v}:
      Bool.pick(Type, U32.is_eq(v, 1), Empty, Unit)

def not_new_old(H: @-f: (Event -> U32 -> Maybe<U32>) -> New(f) -> Old(f)) -> Empty:
  %H(e => n => keep(e, n), bad_new())(256, 300, 0, 0, {==}) : D(_)
  Unit{}
