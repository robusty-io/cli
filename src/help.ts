import { renderUsage } from "citty";
import type { ArgsDef, CommandDef } from "citty";

// citty doesn't export its internal color helpers, so they're replicated
// here (same escape codes and the same NO_COLOR/TERM/TEST/CI detection) to
// keep this section visually consistent with the USAGE/OPTIONS/COMMANDS
// sections citty renders itself.
const noColor = (() => {
  const env = globalThis.process?.env ?? {};
  return Boolean(
    env.NO_COLOR === "1" || env.TERM === "dumb" || env.TEST || env.CI,
  );
})();

function colorize(open: number, close = 39) {
  return (text: string): string =>
    noColor ? text : `\u001B[${open}m${text}\u001B[${close}m`;
}

const bold = colorize(1, 22);
const cyan = colorize(36);
const underline = colorize(4, 24);

/**
 * Environment variables surfaced to users in `--help` output.
 *
 * `ROBUSTY_LAUNCHER_URL` is intentionally excluded: it's an internal-only
 * override, not part of the documented/supported interface.
 *
 * There is intentionally no `--token` flag: CLI-AUTH.md requires that a
 * project token never be passed as a command-line argument (it would be
 * visible in shell history, process lists, and CI logs), so the env var is
 * the only supported way to provide it.
 */
const ENVIRONMENT_VARIABLES: Array<[name: string, description: string]> = [
  ["ROBUSTY_TOKEN", "Project token used to authenticate requests (required)"],
];

function renderEnvironmentSection(): string {
  const nameWidth = Math.max(
    ...ENVIRONMENT_VARIABLES.map(([name]) => name.length),
  );
  const lines = ENVIRONMENT_VARIABLES.map(
    ([name, description]) =>
      `  ${cyan(name.padEnd(nameWidth))}    ${description}`,
  );
  return [
    underline(bold("ENVIRONMENT VARIABLES")),
    "",
    ...lines,
    "",
    "Create a project token in Project Settings \u2192 Tokens, then:",
    "",
    `  ${cyan("export ROBUSTY_TOKEN=rbst_...")}`,
  ].join("\n");
}

/**
 * Drop-in replacement for citty's `showUsage` that appends an "ENVIRONMENT
 * VARIABLES" section to the top-level (root) help only, so required config
 * like `ROBUSTY_TOKEN` is discoverable from `robusty --help` without
 * repeating it on every subcommand's `--help` (e.g. `robusty launch --help`).
 *
 * citty only omits `parent` when rendering usage for the root command itself,
 * so that's used to detect "is this the root help".
 */
export async function showUsage<T extends ArgsDef = ArgsDef>(
  cmd: CommandDef<T>,
  parent?: CommandDef<T>,
): Promise<void> {
  try {
    const usage = await renderUsage(cmd, parent);
    const output = parent ? usage : `${usage}\n\n${renderEnvironmentSection()}`;
    console.log(`${output}\n`);
  } catch (error) {
    console.error(error);
  }
}
