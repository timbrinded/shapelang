import { getPolicy } from "./policy";

export function handleRequest(policyId: string): string {
  const policy = getPolicy(policyId);
  return policy === null ? "deny" : policy;
}
