import { defineCommand } from "citty";
import type { CredentialStore } from "../auth/credential-store";
import { loadConfig } from "../config";
import { createCredentialStore } from "../auth/credential-store";
import type { ResolvedCredential } from "../auth/credentials";
import { resolveCredential } from "../auth/credentials";
import type { Config } from "../config";
import { ApiError, CliError } from "../errors";
import type { LauncherRequestOptions } from "../http";
import { launcherRequest } from "../http";
import { observeLaunch } from "../launch/observer";
import { createLaunchRenderer } from "../launch/ui";
import { resolveProjectLink } from "../project/link";
import { launchStartResponseSchema } from "../schemas";

export interface VariableOverride {
  name: string;
  value: string;
}

export interface LaunchDependencies {
  loadConfig: () => Config;
  createStore: (config: Config) => CredentialStore;
  resolveCredential: (
    config: Config,
    store: CredentialStore,
  ) => Promise<ResolvedCredential | undefined>;
  resolveLink: typeof resolveProjectLink;
  request: (
    config: Config,
    path: string,
    options?: LauncherRequestOptions,
  ) => Promise<unknown>;
  observe: typeof observeLaunch;
  createRenderer: typeof createLaunchRenderer;
  cwd: () => string;
}

export interface LaunchInput {
  suite: string;
  variableOverrides: VariableOverride[];
  debug: boolean;
}

const defaultDependencies: LaunchDependencies = {
  loadConfig,
  createStore: createCredentialStore,
  resolveCredential,
  resolveLink: resolveProjectLink,
  request: launcherRequest,
  observe: observeLaunch,
  createRenderer: createLaunchRenderer,
  cwd: process.cwd,
};

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

export async function runLaunch(
  input: LaunchInput,
  dependencies: LaunchDependencies = defaultDependencies,
): Promise<void> {
  const config = dependencies.loadConfig();
  const store = dependencies.createStore(config);
  const credential = await dependencies.resolveCredential(config, store);

  if (!credential) {
    throw new CliError(
      "You are not logged in. Run robusty login, or set ROBUSTY_TOKEN to a project token in CI.",
    );
  }

  let projectId: string | undefined;

  if (credential.source === "stored") {
    const link = await dependencies.resolveLink(dependencies.cwd());

    if (!link) {
      throw new CliError(
        "This directory is not linked to a Robusty project. Run robusty link.",
      );
    }

    projectId = link.projectId;
  }

  const requestOptions: LauncherRequestOptions = {
    method: "POST",
    body: {
      suiteUid: input.suite,
      variableOverrides: input.variableOverrides,
      ...(projectId !== undefined ? { projectId } : {}),
    },
  };

  if (input.debug) requestOptions.debug = true;

  console.log("Creating test launch...");

  let body: unknown;
  try {
    body = await dependencies.request(
      { ...config, token: credential.token },
      "/api/launch/start",
      requestOptions,
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      if (credential.source === "stored") {
        await store.delete();

        throw new CliError(
          "Your saved login is no longer valid. Run robusty login again.",
        );
      }

      throw new CliError(
        "Authentication failed. Update the ROBUSTY_TOKEN project token in your CI secret.",
      );
    }

    throw error;
  }

  const result = launchStartResponseSchema.safeParse(body);

  if (!result.success) {
    throw new CliError("Robusty returned an invalid launch response.");
  }

  const launchUrl = new URL(
    `/project/${encodeURIComponent(result.data.projectId)}/launches/${encodeURIComponent(result.data.slug)}`,
    config.webUrl,
  ).toString();
  console.log(`Launch created: ${launchUrl}`);

  const renderer = dependencies.createRenderer(result.data.total);
  renderer.start();

  let launchResult;
  try {
    launchResult = await dependencies.observe(
      config,
      {
        slug: result.data.slug,
        wsTicket: result.data.wsTicket,
        total: result.data.total,
      },
      { onUpdate: renderer.update, debug: input.debug },
    );
  } catch (error) {
    renderer.stop();
    throw error;
  }

  renderer.finish(launchResult, launchUrl);

  if (launchResult.failed > 0) {
    process.exitCode = 1;
  }
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
        "Print HTTP and WebSocket details to stderr for troubleshooting",
    },
  },
  async run({ args, rawArgs }) {
    const variableOverrides = parseVariableOverrides(
      collectVarFlagValues(rawArgs),
    );

    await runLaunch({
      suite: args.suite,
      variableOverrides,
      debug: args.debug ?? false,
    });
  },
});
