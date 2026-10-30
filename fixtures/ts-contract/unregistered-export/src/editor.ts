export function saveDraft(text: string): number {
  return text.length;
}

export function mergeAutosaves(autosaves: readonly string[]): string {
  return autosaves.join("\n");
}

// Added without a reviewed fn in editor.shape.
export function discardDraft(draftId: string): boolean {
  return draftId.length > 0;
}
