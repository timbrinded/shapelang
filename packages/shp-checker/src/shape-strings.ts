export function normalizeShapeSourcePath(path: string): string {
  const withoutAnchor = path.split("#", 1)[0] ?? path;
  const lineMatch = /^(.*):\d+(?:-\d+)?$/.exec(withoutAnchor);
  return normalizeShapePath(lineMatch?.[1] ?? withoutAnchor);
}

export function normalizeShapePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

export function unquoteShapeString(value: string): string {
  const first = value.at(0);
  const last = value.at(-1);
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return value.slice(1, -1);
  }
  return value;
}
