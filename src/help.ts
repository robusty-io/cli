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
 * Service URL overrides are intentionally excluded: they are internal-only,
 * not part of the documented/supported interface.
 *
 * There is intentionally no `--token` flag: CLI-AUTH.md requires that a
 * project token never be passed as a command-line argument (it would be
 * visible in shell history, process lists, and CI logs), so the env var is
 * the only supported way to provide it.
 */
const ENVIRONMENT_VARIABLES: Array<[name: string, description: string]> = [
  ["ROBUSTY_TOKEN", "CI project token; overrides a saved browser login"],
];

/**
 * Per-command usage examples appended to a subcommand's `--help` output.
 *
 * citty has no native "examples" concept, so these are rendered here (keyed by
 * the subcommand's `meta.name`) in the same visual style as the sections citty
 * renders itself.
 */
const COMMAND_EXAMPLES: Record<string, string[]> = {
  launch: [
    "robusty launch --suite=mt2lv --var PROJECT_URL=https://robusty-pr-60.railway.app",
  ],
};

function renderExamplesSection(examples: string[]): string {
  return [
    underline(bold("EXAMPLES")),
    "",
    ...examples.map((example) => `  ${cyan(example)}`),
  ].join("\n");
}

async function resolveCommandName<T extends ArgsDef = ArgsDef>(
  cmd: CommandDef<T>,
): Promise<string | undefined> {
  const meta = await cmd.meta;
  return meta?.name;
}

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
    "For local use, authenticate and link the current directory:",
    "",
    `  ${cyan("robusty login")}`,
    "",
    "For CI, set ROBUSTY_TOKEN from your secret manager.",
  ].join("\n");
}

/**
 * Drop-in replacement for citty's `showUsage` that appends an "ENVIRONMENT
 * VARIABLES" section to the top-level (root) help only, so CI configuration
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

    if (!parent) {
      console.log(`${usage}\n\n${renderEnvironmentSection()}\n`);
      return;
    }

    const commandName = await resolveCommandName(cmd);
    const examples =
      commandName !== undefined ? COMMAND_EXAMPLES[commandName] : undefined;
    const output = examples
      ? `${usage.trimEnd()}\n\n${renderExamplesSection(examples)}`
      : usage;
    console.log(`${output}\n`);
  } catch (error) {
    console.error(error);
  }
}
