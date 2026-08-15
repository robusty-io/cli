/**
 * Error thrown by CLI commands to report a user-facing failure.
 *
 * Unlike an unexpected/internal error, a `CliError` is caught centrally
 * (see `withErrorHandling` in `cli.ts`) and printed as a clean, single-line
 * message rather than a stack trace.
 */
export class CliError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode = 1) {
    super(message);
    this.name = "CliError";
    this.exitCode = exitCode;
  }
}
