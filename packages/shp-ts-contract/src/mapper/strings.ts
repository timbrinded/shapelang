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

/**
 * Langium decodes STRING values but drops the backslash of an escape it does not
 * know, so `\u0041` and `\x41` read as `u0041` and `x41`. An escaped backslash
 * (`\\u0041`) is an ordinary backslash and is not reported.
 */
export function hasNumericEscape(node: Cst | undefined): boolean {
  return /(?<!\\)(?:\\\\)*\\[ux]/.test(stringToken(node)?.text ?? "");
}
