// The level of Winning Is Impossible: board size, flag, start and walls.
//
// x grows to the right (0..11), y grows downward (0..7). The board wraps, so
// the room in the top-left corner is closed by two walls inside the board and
// two across its far edges.

export const WIDTH = 12;
export const HEIGHT = 8;
export const FLAG = { x: 1, y: 1 } as const;
export const START = { x: 8, y: 5 } as const;

const ROOM_W = 3;
const ROOM_H = 3;

/** Whether (x, y) is a wall cell of the level. */
export function wallAt(x: number, y: number): boolean {
  const east = x === ROOM_W && y <= ROOM_H;
  const south = x <= ROOM_W && y === ROOM_H;
  const north = x <= ROOM_W && y === HEIGHT - 1;
  const west = x === WIDTH - 1 && y <= ROOM_H;
  return east || south || north || west;
}
