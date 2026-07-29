export function getPolicy(policyId: string): string | null {
  return policyId === "known" ? "allow" : null;
}
