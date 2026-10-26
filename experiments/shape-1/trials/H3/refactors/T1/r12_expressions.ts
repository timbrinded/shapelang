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
  return (
    (x === ROOM_W && y <= ROOM_H) ||
    (x <= ROOM_W && y === ROOM_H) ||
    (x <= ROOM_W && y === MAP_H - 1) ||
    (x === MAP_W - 1 && y <= ROOM_H)
  );
}

function onFlag(x: number, y: number): boolean {
  return x === FLAG_X && y === FLAG_Y;
}

function upY(y: number): number {
  if (y === 0) return MAP_H - 1;
  return y - 1;
}

function downY(y: number): number {
  if (y + 1 === MAP_H) return 0;
  return y + 1;
}

function leftX(x: number): number {
  if (x === 0) return MAP_W - 1;
  return x - 1;
}

function rightX(x: number): number {
  if (x + 1 === MAP_W) return 0;
  return x + 1;
}

function moveTo(tx: number, ty: number, g: Game): Game {
  return isWall(tx, ty) ? { x: g.x, y: g.y, won: g.won } : { x: tx, y: ty, won: g.won || onFlag(tx, ty) };
}

/** Plays one move. */
export function step(move: Move, g: Game): Game {
  if (move === "Up") return moveTo(g.x, upY(g.y), g);
  if (move === "Down") return moveTo(g.x, downY(g.y), g);
  if (move === "Left") return moveTo(leftX(g.x), g.y, g);
  return moveTo(rightX(g.x), g.y, g);
}

/** The board a game begins with. */
export function start(): Game {
  return { x: START_X, y: START_Y, won: false };
}

/** Plays the moves in order, starting from `g`. */
export function replay(g: Game, moves: readonly Move[]): Game {
  let board = g;
  for (let i = 0; i < moves.length; i++) {
    board = step(moves[i] as Move, board);
  }
  return board;
}

/** Whether the board is won. */
export function isWon(g: Game): boolean {
  return g.won;
}
