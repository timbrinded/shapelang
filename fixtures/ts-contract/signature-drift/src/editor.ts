// Now asynchronous; the reviewed signature still returns a number.
export async function saveDraft(text: string): Promise<number> {
  return text.length;
}

export function mergeAutosaves(autosaves: readonly string[]): string {
  return autosaves.join("\n");
}
