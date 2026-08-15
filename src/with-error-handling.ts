import type { ArgsDef, CommandDef } from "citty";
import { CliError } from "./errors";

/**
 * Wraps a command so that a thrown `CliError` is printed as a clean message
 * on stderr and sets `process.exitCode`, instead of bubbling up to citty's
 * default `runMain` handler (which prints the raw error/stack trace and
 * always exits with code 1).
 *
 * Any other (unexpected) error is rethrown as-is.
 */
export function withErrorHandling<T extends ArgsDef = ArgsDef>(
  command: CommandDef<T>,
): CommandDef<T> {
  const originalRun = command.run;
  if (!originalRun) {
    return command;
  }

  return {
    ...command,
    async run(context) {
      try {
        return await originalRun(context);
      } catch (error) {
        if (error instanceof CliError) {
          console.error(error.message);
          process.exitCode = error.exitCode;
          return;
        }
        throw error;
      }
    },
  };
}
