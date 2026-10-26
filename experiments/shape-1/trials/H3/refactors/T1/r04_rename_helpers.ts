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

function isFlagCell(x: number, y: number): boolean {
  return x === FLAG_X && y === FLAG_Y;
}

function rowAbove(y: number): number {
  return y === 0 ? MAP_H - 1 : y - 1;
}

function rowBelow(y: number): number {
  return y + 1 === MAP_H ? 0 : y + 1;
}

function columnLeft(x: number): number {
  return x === 0 ? MAP_W - 1 : x - 1;
}

function columnRight(x: number): number {
  return x + 1 === MAP_W ? 0 : x + 1;
}

// A wall target blocks the move; any other target is entered, and entering
// the flag's cell wins. A won game stays won.
function enterOrStay(targetX: number, targetY: number, current: Game): Game {
  if (isWall(targetX, targetY)) {
    return { x: current.x, y: current.y, won: current.won };
  }
  return { x: targetX, y: targetY, won: current.won || isFlagCell(targetX, targetY) };
}

/** Plays one move. */
export function step(move: Move, g: Game): Game {
  switch (move) {
    case "Up":
      return enterOrStay(g.x, rowAbove(g.y), g);
    case "Down":
      return enterOrStay(g.x, rowBelow(g.y), g);
    case "Left":
      return enterOrStay(columnLeft(g.x), g.y, g);
    case "Right":
      return enterOrStay(columnRight(g.x), g.y, g);
  }
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
