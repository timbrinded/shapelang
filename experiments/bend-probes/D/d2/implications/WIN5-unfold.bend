# D2 (d) control WIN5: replay(start(), moves) written as run(moves, start()).
# Equivalent by unfolding replay: both directions are the identity.
import Base
import ./old/main.bend as Game

def Old() -> Type:
  @moves: List<Game.Move> -> {Game.is_won(Game.replay(Game.start(), moves)) == False{} : Bool}

def New() -> Type:
  @moves: List<Game.Move> -> {Game.is_won(Game.run(moves, Game.start())) == False{} : Bool}

def old_new(h: Old()) -> New():
  h

def new_old(h: New()) -> Old():
  h
