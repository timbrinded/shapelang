export type Cst = {
  offset: number;
  length: number;
  text: string;
  tokenType?: { name: string };
  content?: readonly Cst[];
};
export type Span = { start: number; length: number };

function stringToken(node: Cst | undefined): Cst | undefined {
  if (node?.tokenType?.name === "STRING") return node;
  for (const child of node?.content ?? []) {
    const found = stringToken(child);
    if (found) return found;
  }
  return undefined;
}

/** Native positions refer to the raw UTF-16 payload, excluding its quotes. */
export function stringSpan(node: Cst | undefined): Span {
  const token = stringToken(node);
  return token
    ? { start: token.offset + 1, length: Math.max(0, token.length - 2) }
    : { start: node?.offset ?? 0, length: Math.max(1, node?.length ?? 1) };
}

/** Langium retains escape spelling in STRING values; decode without evaluating code. */
export function stringValue(node: Cst | undefined): string | undefined {
  const raw = stringToken(node)?.text;
  if (!raw) return undefined;
  if (raw.startsWith('"')) {
    try {
      const value: unknown = JSON.parse(raw);
      return typeof value === "string" ? value : undefined;
    } catch {
      return undefined;
    }
  }
  let result = "";
  const escapes: Record<string, string> = {
    n: "\n",
    r: "\r",
    t: "\t",
    b: "\b",
    f: "\f",
    "\\": "\\",
    '"': '"',
    "'": "'",
    "/": "/"
  };
  for (let index = 1; index < raw.length - 1; index++) {
    const character = raw[index];
    if (character !== "\\") {
      result += character;
      continue;
    }
    const next = raw[++index];
    if (next === "u") {
      const hex = raw.slice(index + 1, index + 5);
      if (!/^[0-9a-f]{4}$/i.test(hex)) return undefined;
      result += String.fromCharCode(Number.parseInt(hex, 16));
      index += 4;
    } else if (next !== undefined && Object.hasOwn(escapes, next)) {
      result += escapes[next];
    } else return undefined;
  }
  return result;
}
