export function getLabel(recordId: string): string | null {
  return recordId === "known" ? "record" : null;
}
