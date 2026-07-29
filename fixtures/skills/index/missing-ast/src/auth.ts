export function requireUser(userId: string | undefined): string {
  if (userId === undefined) {
    throw new Error("authentication required");
  }
  return userId;
}
