import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { Server, ServerResponse } from "node:http";
import type { Config } from "../config";
import { ApiError, CliError } from "../errors";
import {
  apiErrorResponseSchema,
  tokenExchangeResponseSchema,
} from "../schemas";
import type { StoredCredential } from "../schemas";

const CALLBACK_PATH = "/callback";
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

export interface PkceValues {
  state: string;
  verifier: string;
  challenge: string;
}

export interface BrowserAuthorizationOptions {
  openBrowser?: (url: string) => Promise<unknown>;
  browser?: boolean;
  timeoutMs?: number;
  printUrl?: (url: string) => void;
  label?: string;
}

export interface TokenExchangeOptions {
  fetch?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
  retryDeadlineMs?: number;
}

export function createPkceValues(
  random: (size: number) => Buffer = randomBytes,
): PkceValues {
  const state = random(32).toString("base64url");
  const verifier = random(32).toString("base64url");
  const challenge = createHash("sha256")
    .update(verifier, "ascii")
    .digest("base64url");
  return { state, verifier, challenge };
}

function browserPage(response: ServerResponse, success: boolean): void {
  response.writeHead(success ? 200 : 400, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(
    `<!doctype html><html><head><meta charset="utf-8"><title>Robusty CLI</title></head><body><h1>${success ? "Authentication complete" : "Authentication failed"}</h1><p>${success ? "You can close this window and return to the terminal." : "Return to the terminal and try again."}</p></body></html>`,
  );
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();

  if (!address || typeof address === "string") {
    throw new CliError("Could not start the local authentication listener.");
  }

  return address.port;
}

async function closeServer(server: Server): Promise<void> {
  server.closeAllConnections();
  if (!server.listening) return;

  await new Promise<void>((resolve) => server.close(() => resolve()));
}

export async function authorizeInBrowser(
  config: Config,
  options: BrowserAuthorizationOptions = {},
): Promise<{ code: string; verifier: string }> {
  const pkce = createPkceValues();
  let settle:
    | ((result: { code: string; verifier: string }) => void)
    | undefined;
  let reject: ((error: Error) => void) | undefined;
  let rejectAborted: ((error: Error) => void) | undefined;
  let consumed = false;

  const callback = new Promise<{ code: string; verifier: string }>(
    (resolve, rejectCallback) => {
      settle = resolve;
      reject = rejectCallback;
    },
  );

  void callback.catch(() => undefined);

  const aborted = new Promise<never>((_resolve, rejectAbort) => {
    rejectAborted = rejectAbort;
  });

  void aborted.catch(() => undefined);

  const server = createServer((request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");

    if (request.method !== "GET") {
      response.writeHead(405, { Allow: "GET" }).end();
      return;
    }

    if (requestUrl.pathname !== CALLBACK_PATH) {
      response.writeHead(404).end();
      return;
    }

    if (consumed || requestUrl.searchParams.get("state") !== pkce.state) {
      browserPage(response, false);
      return;
    }

    consumed = true;

    const error = requestUrl.searchParams.get("error");

    if (error) {
      browserPage(response, false);
      reject?.(
        new CliError(
          error === "access_denied"
            ? "Authentication was denied."
            : "Browser authentication failed.",
        ),
      );
      return;
    }

    const code = requestUrl.searchParams.get("code");

    if (!code) {
      browserPage(response, false);
      reject?.(
        new CliError("The authentication callback did not include a code."),
      );
      return;
    }

    browserPage(response, true);
    settle?.({ code, verifier: pkce.verifier });
  });

  const timeoutMs = Math.min(
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    10 * 60 * 1000,
  );
  const timeout = setTimeout(() => {
    rejectAborted?.(
      new CliError(
        "Browser authentication timed out. Run robusty login again.",
      ),
    );
  }, timeoutMs);

  timeout.unref();

  const cancel = () =>
    rejectAborted?.(new CliError("Browser authentication cancelled."));

  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);

  try {
    const port = await listen(server);
    const redirectUri = `http://127.0.0.1:${port}${CALLBACK_PATH}`;
    const authorizationUrl = new URL(`${config.webUrl}/cli/authorize`);

    authorizationUrl.searchParams.set("redirect_uri", redirectUri);
    authorizationUrl.searchParams.set("state", pkce.state);
    authorizationUrl.searchParams.set("code_challenge", pkce.challenge);
    authorizationUrl.searchParams.set(
      "label",
      options.label?.trim() || "Robusty CLI",
    );

    const url = authorizationUrl.toString();

    (
      options.printUrl ??
      ((value) => console.log(`Open this URL to authenticate:\n${value}`))
    )(url);

    if (options.browser !== false) {
      if (!options.openBrowser) {
        throw new CliError("No browser opener was configured.");
      }

      const opened = options.openBrowser(url).catch(() => {
        throw new CliError(
          "Could not open a browser. Run robusty login --no-browser and open the printed URL.",
        );
      });

      return await Promise.race([opened.then(() => callback), aborted]);
    }

    return await Promise.race([callback, aborted]);
  } finally {
    clearTimeout(timeout);
    process.off("SIGINT", cancel);
    process.off("SIGTERM", cancel);
    await closeServer(server);
  }
}

export async function exchangeAuthorizationCode(
  config: Config,
  code: string,
  verifier: string,
  options: TokenExchangeOptions = {},
): Promise<StoredCredential> {
  const request = options.fetch ?? fetch;
  const sleep =
    options.sleep ??
    ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;
  const deadline = now() + (options.retryDeadlineMs ?? 10_000);

  async function attempt(delay: number): Promise<StoredCredential> {
    const remaining = deadline - now();

    if (remaining <= 0) {
      throw new CliError("Authentication timed out. Run robusty login again.");
    }

    const signal = AbortSignal.timeout(remaining);
    let response: Response;

    try {
      response = await request(`${config.webUrl}/api/cli/token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ code, code_verifier: verifier }),
        signal,
      });
    } catch {
      if (signal.aborted) {
        throw new CliError(
          "Authentication timed out. Run robusty login again.",
        );
      }
      throw new CliError(
        `Could not reach ${config.webUrl}. Check your network connection.`,
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = undefined;
    }

    if (response.ok) {
      const result = tokenExchangeResponseSchema.safeParse(body);

      if (!result.success) {
        throw new CliError(
          "Robusty returned an invalid authentication response.",
        );
      }

      return { token: result.data.token, user: result.data.user };
    }

    const errorResponse = apiErrorResponseSchema.safeParse(body);
    const codeValue = errorResponse.success
      ? errorResponse.data.error
      : undefined;

    if (
      codeValue === "authentication_unavailable" &&
      now() + delay <= deadline
    ) {
      await sleep(delay);

      return attempt(Math.min(delay * 2, 2_000));
    }

    if (codeValue === "authentication_unavailable") {
      throw new ApiError(
        "Authentication is temporarily unavailable. Try again shortly.",
        response.status,
        codeValue,
      );
    }

    if (codeValue === "invalid_grant") {
      throw new ApiError(
        "The authorization expired or was already used. Run robusty login again.",
        response.status,
        codeValue,
      );
    }

    if (codeValue === "invalid_request") {
      throw new ApiError(
        "Robusty rejected the authentication request. Run robusty login again.",
        response.status,
        codeValue,
      );
    }

    throw new ApiError(
      `Authentication failed (HTTP ${response.status}).`,
      response.status,
      codeValue,
    );
  }

  return attempt(250);
}
