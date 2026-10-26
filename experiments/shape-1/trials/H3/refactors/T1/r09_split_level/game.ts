// Winning Is Impossible -- the game logic. The level lives in level.ts.
//
// Stepping onto the flag's cell is the win. The board wraps around: a move
// off one edge re-enters on the opposite edge.

import { FLAG, HEIGHT, START, WIDTH, wallAt } from "./level.ts";

export type Move = "Up" | "Down" | "Left" | "Right";

/** One board: the player's cell and whether the game has been won. */
export interface Game {
  readonly x: number;
  readonly y: number;
  readonly won: boolean;
}

export const MAP_W = WIDTH;
export const MAP_H = HEIGHT;
export const FLAG_X = FLAG.x;
export const FLAG_Y = FLAG.y;
export const START_X = START.x;
export const START_Y = START.y;

/** Whether (x, y) is a wall of the level. */
export function isWall(x: number, y: number): boolean {
  return wallAt(x, y);
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
