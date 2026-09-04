import { ApiError, CliError } from "./errors";

/** Context passed to an `ErrorMapper` when a request returns a non-2xx status. */
export interface ErrorResponseContext {
  status: number;
  statusText: string;
  /** The response body parsed as JSON, or `undefined` if empty/not JSON. */
  json: unknown;
  /** Whether `--debug` diagnostics were requested for this call. */
  debug: boolean;
}

/** Translates a non-2xx HTTP response into a domain-specific `ApiError`. */
export type ErrorMapper = (context: ErrorResponseContext) => ApiError;

export interface ApiRequestOptions {
  method?: string;
  body?: unknown;
  /** Bearer token; the `Authorization` header is omitted when absent. */
  token?: string | undefined;
  /**
   * When true, prints request/response diagnostics to stderr (method, URL,
   * response status, and raw response body) to help debug an opaque server
   * error. Never prints the token or the `Authorization` header value.
   */
  debug?: boolean;
  /** Maps non-2xx responses to an `ApiError`. Defaults to a generic mapper. */
  mapError?: ErrorMapper;
}

/** Appends "Pass --debug for details." unless debug is already enabled. */
export function debugHint(debug: boolean): string {
  return debug ? "" : " Pass --debug for details.";
}

const defaultErrorMapper: ErrorMapper = ({ status }) =>
  new ApiError(`Unexpected response from the server (HTTP ${status}).`, status);

/**
 * Sends a JSON request to `baseUrl + path` and returns the parsed JSON body.
 *
 * Handles Bearer auth, JSON encoding/decoding, optional stderr debug logging,
 * and network-failure wrapping. Non-2xx responses are translated by `mapError`
 * (or a generic mapper) into an `ApiError`. Throws a `CliError` if the request
 * fails to reach the server. Never logs the token or the `Authorization`
 * header.
 */
export async function apiRequest<T>(
  baseUrl: string,
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const url = `${baseUrl}${path}`;
  const method = options.method ?? "GET";
  const debug = options.debug === true;
  const mapError = options.mapError ?? defaultErrorMapper;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (options.token !== undefined) {
    headers.Authorization = `Bearer ${options.token}`;
  }

  const requestInit: RequestInit = { method, headers };
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
    throw new CliError(
      `Could not reach ${baseUrl}. Check your network connection.`,
    );
  }

  const text = await response.text();
  if (debug) {
    logDebug(`response: ${response.status} ${response.statusText}`);
    logDebug(`response body: ${text.length > 0 ? text : "(empty)"}`);
  }
  const json = parseJsonBody(text);

  if (!response.ok) {
    throw mapError({
      status: response.status,
      statusText: response.statusText,
      json,
      debug,
    });
  }

  return json as T;
}

function logDebug(message: string): void {
  console.error(`[debug] ${message}`);
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
