export function getLabel(recordId: string): string {
  if (recordId !== "known") {
    throw new Error("missing record");
  }
  return "record";
}
