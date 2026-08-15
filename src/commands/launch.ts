import { defineCommand } from "citty";
import { loadConfig } from "../config";
import { CliError } from "../errors";
import type { LauncherRequestOptions } from "../http";
import { launcherRequest } from "../http";

export interface VariableOverride {
  name: string;
  value: string;
}

interface LaunchStartResponse {
  launchId: string;
  slug: string;
}

/**
 * Extracts every `--var NAME=VALUE` / `--var=NAME=VALUE` occurrence from raw
 * argv.
 *
 * citty 0.2.2's `string` argument type does not collect repeated flags into
 * an array (each repetition simply overwrites the previous value), so `--var`
 * is scanned manually here instead of relying on the parsed `args.var` value.
 */
export function collectVarFlagValues(rawArgs: string[]): string[] {
  const values: string[] = [];
  const inlinePrefix = "--var=";

  for (let index = 0; index < rawArgs.length; index++) {
    const arg = rawArgs[index];
    if (arg === undefined) {
      continue;
    }

    if (arg === "--var") {
      const next = rawArgs[index + 1];
      if (next !== undefined) {
        values.push(next);
        index++;
      }
      continue;
    }

    if (arg.startsWith(inlinePrefix)) {
      values.push(arg.slice(inlinePrefix.length));
    }
  }

  return values;
}

export function parseVariableOverrides(values: string[]): VariableOverride[] {
  return values.map((entry) => {
    const separatorIndex = entry.indexOf("=");
    if (separatorIndex <= 0) {
      throw new CliError(`Invalid --var "${entry}". Expected NAME=VALUE.`);
    }
    return {
      name: entry.slice(0, separatorIndex),
      value: entry.slice(separatorIndex + 1),
    };
  });
}

export default defineCommand({
  meta: {
    name: "launch",
    description: "Start a test suite launch",
  },
  args: {
    suite: {
      type: "string",
      description: "ID of the suite to launch",
      required: true,
    },
    var: {
      type: "string",
      description: "Variable override as NAME=VALUE (repeatable)",
    },
    debug: {
      type: "boolean",
      description:
        "Print request/response details to stderr for troubleshooting",
    },
  },
  async run({ args, rawArgs }) {
    const config = loadConfig();
    const variableOverrides = parseVariableOverrides(
      collectVarFlagValues(rawArgs),
    );

    const requestOptions: LauncherRequestOptions = {
      method: "POST",
      body: {
        suiteUid: args.suite,
        variableOverrides,
      },
    };
    if (args.debug) {
      requestOptions.debug = true;
    }

    const response = await launcherRequest<LaunchStartResponse>(
      config,
      "/api/launch/start",
      requestOptions,
    );

    console.log(`Launch started: ${response.slug}`);
  },
});
