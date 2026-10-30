export function saveDraft(text: string): number {
  return text.length;
}

export function mergeAutosaves(autosaves: readonly string[]): string {
  return autosaves.join("\n");
}
