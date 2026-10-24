# D2 (d) for WIN2: you_cant_win narrowed from every move list to one-move lists.
# replay-from-start is abstracted as r; is_won is the demo's own.
import Base
import ./old/main.bend as Game

def Old(-r: List<Game.Move> -> Game.Game) -> Type:
  @moves: List<Game.Move> -> {Game.is_won(r(moves)) == False{} : Bool}

def New(-r: List<Game.Move> -> Game.Game) -> Type:
  @m: Game.Move -> {Game.is_won(r([m])) == False{} : Bool}

# old -> new, for every r: provable
def old_new(-r: List<Game.Move> -> Game.Game, h: Old(r)) -> New(r):
  m => h([m])

# new -> old, for every r: refuted by a replay that wins after two moves
def won_at2(moves: List<Game.Move>) -> Game.Game:
  match moves:
    case Nil{}:
      Game.Game{0n, 0n, False{}}
    case m <> rest:
      match rest:
        case Nil{}:
          Game.Game{0n, 0n, False{}}
        case m2 <> more:
          Game.Game{0n, 0n, True{}}

def bad_new() -> New(ms => won_at2(ms)):
  m => {==}

def bool_disc(b: Bool) -> Type:
  match b:
    case True{}:
      Unit
    case False{}:
      Empty

def not_new_old(H: @-r: (List<Game.Move> -> Game.Game) -> New(r) -> Old(r)) -> Empty:
  %H(ms => won_at2(ms), bad_new())([Game.Up{}, Game.Up{}]) : bool_disc(_)
  Unit{}
