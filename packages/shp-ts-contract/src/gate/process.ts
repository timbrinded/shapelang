import { spawn } from "node:child_process";
import { mkdtemp, open, readFile, rm, stat, type FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { errorText } from "./types.ts";

export type ProcessOutput = { stdout: string; stderr: string; exitCode: number };

/** File descriptors also work on Bun runtimes whose subprocess pipes lose output. */
export async function captureProcess(
  command: string,
  args: string[],
  cwd: string,
  options: { timeoutMs?: number } = {}
): Promise<ProcessOutput> {
  const timeoutMs = options.timeoutMs ?? 120_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
    throw new RangeError("Compiler timeout must be a positive finite number.");
  const temporary = await mkdtemp(join(tmpdir(), "shp-ts-compiler-"));
  const outputPath = join(temporary, "stdout");
  const errorPath = join(temporary, "stderr");
  let outputFile: FileHandle | undefined;
  let errorFile: FileHandle | undefined;
  let failure: string | undefined;
  try {
    outputFile = await open(outputPath, "w", 0o600);
    errorFile = await open(errorPath, "w", 0o600);
    const outputFd = outputFile.fd;
    const errorFd = errorFile.fd;
    const exitCode = await new Promise<number>((accept) => {
      // POSIX groups include tsc's execFileSync fallback and native mapper children.
      // Windows has no equivalent negative-PID kill: only the direct child is stopped.
      const processGroup = process.platform !== "win32";
      const child = spawn(command, args, {
        cwd,
        detached: processGroup,
        stdio: ["ignore", outputFd, errorFd]
      });
      const terminate = (): void => {
        if (processGroup && child.pid !== undefined) {
          try {
            process.kill(-child.pid, "SIGKILL");
            return;
          } catch {
            // The group may already have exited, or group signalling may be unavailable.
          }
        }
        child.kill("SIGKILL");
      };
      process.once("exit", terminate);
      const timer = setTimeout(() => {
        failure = `Compiler execution exceeded ${timeoutMs / 1000} seconds.`;
        terminate();
      }, timeoutMs);
      child.once("error", (error) => {
        clearTimeout(timer);
        process.removeListener("exit", terminate);
        failure = errorText(error);
        accept(1);
      });
      child.once("close", (code) => {
        clearTimeout(timer);
        process.removeListener("exit", terminate);
        // Also stop a descendant left behind by a wrapper that exits before its children.
        if (processGroup) terminate();
        accept(code ?? 1);
      });
    });
    const sizes = await Promise.all([stat(outputPath), stat(errorPath)]);
    if (sizes.some((info) => info.size > 16 * 1024 * 1024)) {
      return {
        stdout: "",
        stderr: "Compiler output exceeded the 16 MiB capture limit.\n",
        exitCode: 1
      };
    }
    const [stdout, stderr] = await Promise.all([
      readFile(outputPath, "utf8"),
      readFile(errorPath, "utf8")
    ]);
    return {
      stdout,
      stderr: failure
        ? `${stderr}${stderr && !stderr.endsWith("\n") ? "\n" : ""}${failure}\n`
        : stderr,
      exitCode: failure ? 1 : exitCode
    };
  } finally {
    await Promise.all([outputFile?.close(), errorFile?.close()]).finally(() =>
      rm(temporary, { recursive: true, force: true })
    );
  }
}
