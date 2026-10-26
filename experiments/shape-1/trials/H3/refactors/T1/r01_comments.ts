// Winning Is Impossible: pure game logic for a 12 x 8 torus.
//
// The flag sits in a walled room in the top-left corner. Entering the
// flag's cell wins. Leaving the board on one side re-enters it on the other.

export type Move = "Up" | "Down" | "Left" | "Right";

/** A board value: the player's position and the win flag. */
export interface Game {
  readonly x: number;
  readonly y: number;
  readonly won: boolean;
}

export const MAP_W = 12;
export const MAP_H = 8;
export const FLAG_X = 1;
export const FLAG_Y = 1;
export const START_X = 8;
export const START_Y = 5;

const ROOM_W = 3;
const ROOM_H = 3;

// Four wall segments close the room. Two are inside the board (x = 3 and
// y = 3); the other two sit on the far edges, which the torus makes adjacent
// to the room.
export function isWall(x: number, y: number): boolean {
  const east = x === ROOM_W && y <= ROOM_H;
  const south = x <= ROOM_W && y === ROOM_H;
  const north = x <= ROOM_W && y === MAP_H - 1;
  const west = x === MAP_W - 1 && y <= ROOM_H;
  return east || south || north || west;
}

function onFlag(x: number, y: number): boolean {
  return x === FLAG_X && y === FLAG_Y;
}

function upY(y: number): number {
  return y === 0 ? MAP_H - 1 : y - 1;
}

function downY(y: number): number {
  return y + 1 === MAP_H ? 0 : y + 1;
}

function leftX(x: number): number {
  return x === 0 ? MAP_W - 1 : x - 1;
}

function rightX(x: number): number {
  return x + 1 === MAP_W ? 0 : x + 1;
}

function moveTo(tx: number, ty: number, g: Game): Game {
  if (isWall(tx, ty)) {
    return { x: g.x, y: g.y, won: g.won };
  }
  return { x: tx, y: ty, won: g.won || onFlag(tx, ty) };
}

/** One move: compute the (wrapped) target, then enter it unless it is a wall. */
export function step(move: Move, g: Game): Game {
  switch (move) {
    case "Up":
      return moveTo(g.x, upY(g.y), g);
    case "Down":
      return moveTo(g.x, downY(g.y), g);
    case "Left":
      return moveTo(leftX(g.x), g.y, g);
    case "Right":
      return moveTo(rightX(g.x), g.y, g);
  }
}

export function start(): Game {
  return { x: START_X, y: START_Y, won: false };
}

/** Folds `step` over the moves, left to right. */
export function replay(g: Game, moves: readonly Move[]): Game {
  let board = g;
  for (const m of moves) {
    board = step(m, board);
  }
  return board;
}

export function isWon(g: Game): boolean {
  return g.won;
}
