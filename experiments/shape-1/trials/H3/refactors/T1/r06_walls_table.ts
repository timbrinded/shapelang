// Winning Is Impossible -- the game logic.
//
// A 12 x 8 board, a walled room in the top-left corner with the flag in it,
// four moves. Stepping onto the flag's cell is the win. The board wraps
// around: a move off one edge re-enters on the opposite edge.
//
// The level's walls are listed once, as cells, and looked up by key.

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

function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

function wallCells(): Set<string> {
  const cells = new Set<string>();
  for (let i = 0; i <= ROOM_H; i++) {
    cells.add(cellKey(ROOM_W, i)); // the room's east wall
    cells.add(cellKey(MAP_W - 1, i)); // across the west edge
  }
  for (let i = 0; i <= ROOM_W; i++) {
    cells.add(cellKey(i, ROOM_H)); // the room's south wall
    cells.add(cellKey(i, MAP_H - 1)); // across the north edge
  }
  return cells;
}

const WALLS = wallCells();

/** Whether (x, y) is one of the level's wall cells. */
export function isWall(x: number, y: number): boolean {
  return WALLS.has(cellKey(x, y));
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
