import Base
import ./main.bend as M
import ./LAWS.bend as Laws

def Laws.add_comm(a, b):
  U32.add_comm(a, b)

# Word.adc(n, a, 0, no carry) is a, by induction on the width
def adc_zero(n: Nat, a: Word(n)) -> {Word.adc(n, a, Word.zero(n), False{}, False{}) == a : Word(n)}:
  match n:
    case 0n:
      match a:
        case WNil{}:
          {==}
    case 1n+p:
      match a:
        case WCon{False{}, at}:
          %adc_zero(p, at) : {WCon{False{}, Word.adc(p, at, Word.zero(p), False{}, False{})} == WCon{False{}, _} : Word.Con<p>}
          {==}
        case WCon{True{}, at}:
          %adc_zero(p, at) : {WCon{True{}, Word.adc(p, at, Word.zero(p), False{}, False{})} == WCon{True{}, _} : Word.Con<p>}
          {==}

def Laws.add_zero(a):
  match a:
    case U32{x}:
      %adc_zero(32n, x) : {U32{Word.adc(32n, x, Word.zero(32n), False{}, False{})} == U32{_} : U32}
      {==}
