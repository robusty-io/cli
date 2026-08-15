import type { Config } from "./config";
import { CliError } from "./errors";

export interface LauncherRequestOptions {
  method?: string;
  body?: unknown;
  /**
   * When true, prints request/response diagnostics to stderr (method, URL,
   * response status, and raw response body) to help debug an opaque server
   * error. Never prints the token or the `Authorization` header value.
   */
  debug?: boolean;
}

interface QuotaInfo {
  remaining: number | undefined;
  limit: number | undefined;
}

/**
 * Sends an authenticated request to the Robusty launcher API.
 *
 * Throws a `CliError` if no token is configured (before any network call),
 * if the request fails to reach the server, or if the server responds with
 * a non-2xx status. Never logs the token or the `Authorization` header.
 */
export async function launcherRequest<T>(
  config: Config,
  path: string,
  options: LauncherRequestOptions = {},
): Promise<T> {
  if (!config.token) {
    throw new CliError(
      "No project token found. Set ROBUSTY_TOKEN to a project token created in Project Settings \u2192 Tokens.",
    );
  }

  const url = `${config.launcherUrl}${path}`;
  const method = options.method ?? "GET";
  const debug = options.debug === true;

  const requestInit: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
  };
  if (options.body !== undefined) {
    requestInit.body = JSON.stringify(options.body);
  }

  if (debug) {
    logDebug(`${method} ${url}`);
    if (requestInit.body !== undefined) {
      logDebug(`request body: ${requestInit.body as string}`);
    }
  }

  let response: Response;
  try {
    response = await fetch(url, requestInit);
  } catch (cause) {
    if (debug) {
      logDebug(`fetch failed: ${describeError(cause)}`);
    }
    // ROBUSTY_LAUNCHER_URL is internal-only (not a documented/supported
    // override), so it's intentionally not named in this user-facing message.
    throw new CliError(
      `Could not reach ${config.launcherUrl}. Check your network connection.${debugHint(debug)}`,
    );
  }

  const text = await response.text();
  if (debug) {
    logDebug(`response: ${response.status} ${response.statusText}`);
    logDebug(`response body: ${text.length > 0 ? text : "(empty)"}`);
  }
  const json = parseJsonBody(text);

  if (!response.ok) {
    throw toApiError(response.status, json, debug);
  }

  return json as T;
}

function logDebug(message: string): void {
  console.error(`[debug] ${message}`);
}

function debugHint(debug: boolean): string {
  return debug ? "" : " Pass --debug for details.";
}

function punctuate(message: string): string {
  return /[.!?]$/.test(message) ? message : `${message}.`;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseJsonBody(text: string): unknown {
  if (text.length === 0) {
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function errorField(json: unknown): string | undefined {
  if (json && typeof json === "object" && "error" in json) {
    const value = (json as { error?: unknown }).error;
    return typeof value === "string" ? value : undefined;
  }
  return undefined;
}

function extractQuota(json: unknown): QuotaInfo | undefined {
  if (!json || typeof json !== "object" || !("quota" in json)) {
    return undefined;
  }
  const quota = (json as { quota?: unknown }).quota;
  if (!quota || typeof quota !== "object") {
    return undefined;
  }
  const record = quota as Record<string, unknown>;
  return {
    remaining:
      typeof record.remaining === "number" ? record.remaining : undefined,
    limit: typeof record.limit === "number" ? record.limit : undefined,
  };
}

function formatQuota(quota: QuotaInfo | undefined): string {
  if (!quota || quota.remaining === undefined || quota.limit === undefined) {
    return "";
  }
  return ` (${quota.remaining}/${quota.limit} launches remaining this period)`;
}

function toApiError(status: number, json: unknown, debug: boolean): CliError {
  const code = errorField(json);
  const quota = extractQuota(json);
  const hint = debugHint(debug);

  switch (status) {
    case 400:
      return new CliError(
        `Robusty rejected the request${code ? `: ${code}` : ""}.${hint}`,
      );
    case 401:
      return new CliError(
        `Authentication failed: the token is missing, malformed, unknown, expired, or revoked. Check ROBUSTY_TOKEN.${hint}`,
      );
    case 402:
      return new CliError(
        `Quota exceeded for this project${formatQuota(quota)}.${hint}`,
      );
    case 403:
      if (code === "overage_cap_exceeded") {
        return new CliError(
          `Overage cap reached for this project${formatQuota(quota)}.${hint}`,
        );
      }
      return new CliError(
        `This token does not have access to the requested project.${hint}`,
      );
    case 404:
      return new CliError(`${punctuate(code ?? "Suite not found.")}${hint}`);
    case 409:
      return new CliError(
        `${punctuate(code ?? "Could not allocate a launch serial.")} Try again.${hint}`,
      );
    case 500:
      if (code === "authentication_unavailable") {
        return new CliError(
          `Authentication is temporarily unavailable. Your token may still be valid; retry shortly.${hint}`,
        );
      }
      return new CliError(
        `${punctuate(code ?? "Robusty encountered an internal error starting the launch.")}${hint}`,
      );
    default:
      return new CliError(
        `Unexpected response from Robusty (HTTP ${status}).${hint}`,
      );
  }
}
