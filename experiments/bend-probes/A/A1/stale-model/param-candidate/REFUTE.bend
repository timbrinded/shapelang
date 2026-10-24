# the parametric law is false for the candidate: take fetch = "remote"
import Base
import ./main.bend as R

def bdisc(b: Bool) -> Type:
  match b:
    case False{}:
      Empty
    case True{}:
      Unit

def refute(h: @fetch: (Unit -> String) -> {R.loadReport(fetch) == fetch(Unit{}) : String}) -> Empty:
  e = h(u => "remote")
  %e : bdisc(String.eq(_, "local"))
  Unit{}
