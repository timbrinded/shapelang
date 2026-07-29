export function getPolicy(policyId: string): string {
  if (policyId !== "known") {
    throw new Error("missing policy");
  }
  return "allow";
}
