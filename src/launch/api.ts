import type { Config } from "../config";
import { ApiError, CliError } from "../errors";
import type { ApiRequestOptions, ErrorResponseContext } from "../http";
import { apiRequest, debugHint } from "../http";
import { apiErrorResponseSchema } from "../schemas";

export interface LauncherRequestOptions {
  method?: string;
  body?: unknown;
  /** See `ApiRequestOptions.debug`. */
  debug?: boolean;
}

interface QuotaInfo {
  remaining?: number | undefined;
  limit?: number | undefined;
}

/**
 * Sends an authenticated request to the Robusty launcher API.
 *
 * A thin wrapper over the generic `apiRequest` transport that targets
 * `config.launcherUrl`, requires a token, and maps launcher status codes to
 * user-facing messages.
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

  const requestOptions: ApiRequestOptions = {
    token: config.token,
    mapError: mapLauncherError,
  };
  if (options.method !== undefined) {
    requestOptions.method = options.method;
  }
  if (options.body !== undefined) {
    requestOptions.body = options.body;
  }
  if (options.debug !== undefined) {
    requestOptions.debug = options.debug;
  }

  // ROBUSTY_LAUNCHER_URL is internal-only (not a documented/supported
  // override), so it's intentionally not named in user-facing network errors.
  return apiRequest<T>(config.launcherUrl, path, requestOptions);
}

function punctuate(message: string): string {
  return /[.!?]$/.test(message) ? message : `${message}.`;
}

function formatQuota(quota: QuotaInfo | undefined): string {
  if (!quota || quota.remaining === undefined || quota.limit === undefined) {
    return "";
  }
  return ` (${quota.remaining}/${quota.limit} launches remaining this period)`;
}

function mapLauncherError({
  status,
  json,
  debug,
}: ErrorResponseContext): ApiError {
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
