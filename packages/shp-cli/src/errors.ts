export const EXIT_SUCCESS = 0;
export const EXIT_FAILURE = 1;
export const EXIT_USAGE = 2;

export class CliDiagnosticError extends Error {
  constructor(
    message: string,
    readonly exitCode: number = EXIT_USAGE
  ) {
    super(message);
  }
}

export function cliExitCode(error: unknown): number {
  return error instanceof CliDiagnosticError ? error.exitCode : EXIT_FAILURE;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
