import type { CliContext } from "./context";

export function stdout(context: CliContext, text: string): void {
  context.process.stdout.write(text);
}

export function stderr(context: CliContext, text: string): void {
  context.process.stderr.write(text);
}

export function setExitCode(context: CliContext, exitCode: number): void {
  context.process.exitCode = exitCode;
}
