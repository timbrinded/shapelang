// Winning Is Impossible -- the game logic.
//
// A 12 x 8 board, a walled room in the top-left corner with the flag in it,
// four moves. Stepping onto the flag's cell is the win. The board wraps
// around: a move off one edge re-enters on the opposite edge.

export type Move = "Up" | "Down" | "Left" | "Right";

/** One board: the player's cell and whether the game has been won. */
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

/** The room's walls, two inside the board and two across its far edges. */
export function isWall(x: number, y: number): boolean {
  const east = x === ROOM_W && y <= ROOM_H;
  const south = x <= ROOM_W && y === ROOM_H;
  const north = x <= ROOM_W && y === MAP_H - 1;
  const west = x === MAP_W - 1 && y <= ROOM_H;
  return east || south || north || west;
}

type Cell = readonly [number, number];

/** The (wrapped) cell each move aims at from (x, y). */
const TARGET: Readonly<Record<Move, (x: number, y: number) => Cell>> = {
  Up: (x, y) => [x, y === 0 ? MAP_H - 1 : y - 1],
  Down: (x, y) => [x, y + 1 === MAP_H ? 0 : y + 1],
  Left: (x, y) => [x === 0 ? MAP_W - 1 : x - 1, y],
  Right: (x, y) => [x + 1 === MAP_W ? 0 : x + 1, y]
};

/** Plays one move: a wall target blocks it; entering the flag's cell wins. */
export function step(move: Move, g: Game): Game {
  const [tx, ty] = TARGET[move](g.x, g.y);
  if (isWall(tx, ty)) {
    return { x: g.x, y: g.y, won: g.won };
  }
  return { x: tx, y: ty, won: g.won || (tx === FLAG_X && ty === FLAG_Y) };
}

/** The board a game begins with. */
export function start(): Game {
  return { x: START_X, y: START_Y, won: false };
}

/** Plays the moves in order, starting from `g`. */
export function replay(g: Game, moves: readonly Move[]): Game {
  let board = g;
  for (const m of moves) {
    board = step(m, board);
  }
  return board;
}

/** Whether the board is won. */
export function isWon(g: Game): boolean {
  return g.won;
}
