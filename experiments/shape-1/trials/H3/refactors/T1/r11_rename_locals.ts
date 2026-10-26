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
export function isWall(col: number, row: number): boolean {
  const roomEast = col === ROOM_W && row <= ROOM_H;
  const roomSouth = col <= ROOM_W && row === ROOM_H;
  const farNorth = col <= ROOM_W && row === MAP_H - 1;
  const farWest = col === MAP_W - 1 && row <= ROOM_H;
  return roomEast || roomSouth || farNorth || farWest;
}

function onFlag(col: number, row: number): boolean {
  return col === FLAG_X && row === FLAG_Y;
}

function upY(row: number): number {
  return row === 0 ? MAP_H - 1 : row - 1;
}

function downY(row: number): number {
  return row + 1 === MAP_H ? 0 : row + 1;
}

function leftX(col: number): number {
  return col === 0 ? MAP_W - 1 : col - 1;
}

function rightX(col: number): number {
  return col + 1 === MAP_W ? 0 : col + 1;
}

function moveTo(col: number, row: number, from: Game): Game {
  if (isWall(col, row)) {
    return { x: from.x, y: from.y, won: from.won };
  }
  return { x: col, y: row, won: from.won || onFlag(col, row) };
}

/** Plays one move. */
export function step(move: Move, board: Game): Game {
  switch (move) {
    case "Up":
      return moveTo(board.x, upY(board.y), board);
    case "Down":
      return moveTo(board.x, downY(board.y), board);
    case "Left":
      return moveTo(leftX(board.x), board.y, board);
    case "Right":
      return moveTo(rightX(board.x), board.y, board);
  }
}

/** The board a game begins with. */
export function start(): Game {
  return { x: START_X, y: START_Y, won: false };
}

/** Plays the moves in order, starting from `initial`. */
export function replay(initial: Game, moves: readonly Move[]): Game {
  let current = initial;
  for (const move of moves) {
    current = step(move, current);
  }
  return current;
}

/** Whether the board is won. */
export function isWon(board: Game): boolean {
  return board.won;
}
