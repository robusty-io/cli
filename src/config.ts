import { CliError } from "./errors";

/** Base URL for the Robusty launcher API, used for authenticated CLI requests. */
const DEFAULT_LAUNCHER_URL = "https://launcher.robusty.io";

export interface Config {
  /** Robusty launcher API base URL, used for authenticated requests such as `launch`. */
  launcherUrl: string;
  /** Project token (`rbst_...`) used to authenticate requests, if provided. */
  token: string | undefined;
}

function normalizeUrl(rawValue: string, envVarName: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawValue);
  } catch {
    throw new CliError(
      `Invalid ${envVarName}: "${rawValue}" is not a valid URL.`,
    );
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new CliError(
      `Invalid ${envVarName}: "${rawValue}" must use http or https.`,
    );
  }

  return `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}`;
}

function readUrl(
  env: NodeJS.ProcessEnv,
  name: "ROBUSTY_LAUNCHER_URL",
  fallback: string,
): string {
  const rawValue = env[name]?.trim();
  return normalizeUrl(
    rawValue && rawValue.length > 0 ? rawValue : fallback,
    name,
  );
}

function readToken(env: NodeJS.ProcessEnv): string | undefined {
  const rawValue = env.ROBUSTY_TOKEN?.trim();
  return rawValue && rawValue.length > 0 ? rawValue : undefined;
}

/**
 * Loads CLI configuration from environment variables.
 *
 * An explicit `env` object may be passed for testing; defaults to `process.env`.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    launcherUrl: readUrl(env, "ROBUSTY_LAUNCHER_URL", DEFAULT_LAUNCHER_URL),
    token: readToken(env),
  };
}
