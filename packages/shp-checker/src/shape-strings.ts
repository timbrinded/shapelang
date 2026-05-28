export function normalizeShapeSourcePath(path: string): string {
  const withoutAnchor = path.split("#", 1)[0] ?? path;
  const lineMatch = /^(.*):\d+(?:-\d+)?$/.exec(withoutAnchor);
  return normalizeShapePath(lineMatch?.[1] ?? withoutAnchor);
}

export function normalizeShapePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

export function compareCodepointStrings(left: string, right: string): number {
  const leftCodepoints = Array.from(left);
  const rightCodepoints = Array.from(right);
  const length = Math.min(leftCodepoints.length, rightCodepoints.length);
  for (let index = 0; index < length; index += 1) {
    const leftCodepoint = leftCodepoints[index]?.codePointAt(0) ?? 0;
    const rightCodepoint = rightCodepoints[index]?.codePointAt(0) ?? 0;
    if (leftCodepoint !== rightCodepoint) {
      return leftCodepoint - rightCodepoint;
    }
  }
  return leftCodepoints.length - rightCodepoints.length;
}

export function unquoteShapeString(value: string): string {
  const first = value.at(0);
  const last = value.at(-1);
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return value.slice(1, -1);
  }
  return value;
}
