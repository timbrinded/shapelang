import { CliDiagnosticError, EXIT_USAGE } from "./errors";

export async function git(args: string[], action: string): Promise<string> {
  const child = Bun.spawn(["git", ...args], { stdout: "pipe", stderr: "pipe" });
  const [output, errorOutput, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited
  ]);
  if (exitCode !== 0) {
    throw new CliDiagnosticError(
      `error: failed to ${action}\n\n${errorOutput.trim()}\n`,
      EXIT_USAGE
    );
  }
  return output;
}

/**
 * Tracked and untracked, non-ignored files, relative to the current directory.
 * A tracked file deleted but not yet staged is left out. A file outside a sparse
 * checkout stays in, since git still tracks it; that is why deletions come from
 * git rather than from the filesystem.
 */
export async function repositoryFiles(): Promise<string[]> {
  const [listing, deletedListing] = await Promise.all([
    git(["ls-files", "-z", "--cached", "--others", "--exclude-standard"], "list repository files"),
    git(["ls-files", "-z", "--deleted"], "list deleted files")
  ]);
  const deleted = new Set(deletedListing.split("\0"));
  return [...new Set(listing.split("\0").filter((path) => path.length > 0 && !deleted.has(path)))];
}
