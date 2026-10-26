// Winning Is Impossible: game logic only (no rendering, no input handling).
//
// A 12 x 8 board, a walled room in the top-left corner with the flag in it,
// four moves. Stepping onto the flag's cell is the win. The board wraps
// around: a move off one edge re-enters on the opposite edge.
//
// Everything here is pure: a board is a plain value and every function
// returns a new one.

export type Move = "Up" | "Down" | "Left" | "Right";

/** One board: the player's cell and whether the game has been won. */
export interface Game {
  readonly x: number;
  readonly y: number;
  readonly won: boolean;
}

// Level
// -----
// Coordinates: x grows to the right (0..11), y grows downward (0..7).
// The room occupies x <= 2, y <= 2.

export const MAP_W = 12;
export const MAP_H = 8;
export const FLAG_X = 1;
export const FLAG_Y = 1;
export const START_X = 8;
export const START_Y = 5;

const ROOM_W = 3;
const ROOM_H = 3;

/**
 * The room's walls: column x = 3 (rows 0..3) and row y = 3 (columns 0..3).
 * The board wraps, so the room's other two sides are across the edges: the
 * last row (y = 7, columns 0..3) and the last column (x = 11, rows 0..3).
 */
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

// Step
// ----
// The row or column a move aims at. The board wraps: a move off one edge
// aims at the cell on the opposite edge.

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

// Walls block; every other target is entered. Entering the flag's cell
// sets won, and nothing ever clears it.
function moveTo(tx: number, ty: number, g: Game): Game {
  if (isWall(tx, ty)) {
    return { x: g.x, y: g.y, won: g.won };
  }
  return { x: tx, y: ty, won: g.won || onFlag(tx, ty) };
}

/** Plays one move. */
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

/** The board a game begins with. */
export function start(): Game {
  return { x: START_X, y: START_Y, won: false };
}

/** Plays the moves in order, starting from `g`. */
export function replay(g: Game, moves: readonly Move[]): Game {
  // fold step over the moves, left to right
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
