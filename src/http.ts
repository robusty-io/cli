import type { Config } from "./config";
import { ApiError, CliError } from "./errors";
import { apiErrorResponseSchema } from "./schemas";

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
  remaining?: number | undefined;
  limit?: number | undefined;
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

function formatQuota(quota: QuotaInfo | undefined): string {
  if (!quota || quota.remaining === undefined || quota.limit === undefined) {
    return "";
  }
  return ` (${quota.remaining}/${quota.limit} launches remaining this period)`;
}

function toApiError(status: number, json: unknown, debug: boolean): ApiError {
  const result = apiErrorResponseSchema.safeParse(json);
  const code = result.success ? result.data.error : undefined;
  const quota = result.success ? result.data.quota : undefined;
  const hint = debugHint(debug);

  switch (status) {
    case 400:
      return new ApiError(
        `Robusty rejected the request${code ? `: ${code}` : ""}.${hint}`,
        status,
        code,
      );

    case 401:
      return new ApiError(
        `Authentication failed: the credential is missing, malformed, unknown, expired, or revoked.${hint}`,
        status,
        code,
      );

    case 402:
      return new ApiError(
        `Quota exceeded for this project${formatQuota(quota)}.${hint}`,
        status,
        code,
      );

    case 403:
      if (code === "overage_cap_exceeded") {
        return new ApiError(
          `Overage cap reached for this project${formatQuota(quota)}.${hint}`,
          status,
          code,
        );
      }

      return new ApiError(
        `This credential does not have access to the requested project.${hint}`,
        status,
        code,
      );

    case 404:
      return new ApiError(
        `${punctuate(code ?? "Suite not found.")}${hint}`,
        status,
        code,
      );

    case 409:
      return new ApiError(
        `${punctuate(code ?? "Could not allocate a launch serial.")} Try again.${hint}`,
        status,
        code,
      );

    case 500:
      if (code === "authentication_unavailable") {
        return new ApiError(
          `Authentication is temporarily unavailable. Your token may still be valid; retry shortly.${hint}`,
          status,
          code,
        );
      }

      return new ApiError(
        `${punctuate(code ?? "Robusty encountered an internal error starting the launch.")}${hint}`,
        status,
        code,
      );

    default:
      return new ApiError(
        `Unexpected response from Robusty (HTTP ${status}).${hint}`,
        status,
        code,
      );
  }
}
