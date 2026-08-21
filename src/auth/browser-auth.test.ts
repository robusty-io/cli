import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../config";
import { ApiError, CliError } from "../errors";
import {
  authorizeInBrowser,
  createPkceValues,
  exchangeAuthorizationCode,
} from "./browser-auth";

const config: Config = {
  webUrl: "https://www.robusty.io",
  launcherUrl: "https://launcher.robusty.io",
  token: undefined,
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function callbackUrl(
  authorizationUrl: string,
  parameters: Record<string, string | undefined>,
): URL {
  const authorization = new URL(authorizationUrl);
  const redirect = authorization.searchParams.get("redirect_uri");
  if (!redirect) throw new Error("Missing redirect URI in authorization URL");
  const callback = new URL(redirect);
  for (const [name, value] of Object.entries(parameters)) {
    if (value !== undefined) callback.searchParams.set(name, value);
  }
  return callback;
}

async function expectListenerClosed(authorizationUrl: string): Promise<void> {
  const callback = callbackUrl(authorizationUrl, {});
  await expect(fetch(callback)).rejects.toThrow();
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createPkceValues", () => {
  it("creates unpadded 43-character base64url state, verifier, and challenge values", () => {
    const random = vi.fn((size: number) => Buffer.alloc(size, 0xff));

    const values = createPkceValues(random);

    expect(random).toHaveBeenCalledTimes(2);
    expect(random).toHaveBeenNthCalledWith(1, 32);
    expect(random).toHaveBeenNthCalledWith(2, 32);
    expect(values.state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(values.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(values.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(values.challenge).toBe(
      createHash("sha256").update(values.verifier, "ascii").digest("base64url"),
    );
    expect(values.state).not.toContain("=");
    expect(values.verifier).not.toContain("=");
    expect(values.challenge).not.toContain("=");
  });

  it("matches the RFC 7636 S256 challenge vector", () => {
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const random = vi
      .fn<(size: number) => Buffer>()
      .mockReturnValueOnce(Buffer.alloc(32, 0x01))
      .mockReturnValueOnce(Buffer.from(verifier, "base64url"));

    const values = createPkceValues(random);

    expect(values.verifier).toBe(verifier);
    expect(values.challenge).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });
});

describe("authorizeInBrowser", () => {
  it("prints a valid authorization URL after listening and accepts an approval", async () => {
    const printUrl = vi.fn<(url: string) => void>();
    let openedUrl = "";
    let browserStatus: number | undefined;
    let browserBody = "";
    let redirectUri = "";
    const initialSigintListeners = process.listenerCount("SIGINT");
    const initialSigtermListeners = process.listenerCount("SIGTERM");

    const result = await authorizeInBrowser(config, {
      label: "  Work laptop  ",
      printUrl,
      openBrowser: async (url) => {
        openedUrl = url;
        const authorization = new URL(url);
        redirectUri = authorization.searchParams.get("redirect_uri") ?? "";
        const response = await fetch(
          callbackUrl(url, {
            code: "authorization-code",
            state: authorization.searchParams.get("state") ?? undefined,
          }),
        );
        browserStatus = response.status;
        browserBody = await response.text();
      },
    });

    const authorization = new URL(openedUrl);
    const redirect = new URL(redirectUri);
    expect(printUrl).toHaveBeenCalledOnce();
    expect(printUrl).toHaveBeenCalledWith(openedUrl);
    expect(authorization.origin).toBe("https://www.robusty.io");
    expect(authorization.pathname).toBe("/cli/authorize");
    expect(authorization.searchParams.get("state")).toMatch(
      /^[A-Za-z0-9_-]{43}$/,
    );
    expect(authorization.searchParams.get("code_challenge")).toMatch(
      /^[A-Za-z0-9_-]{43}$/,
    );
    expect(authorization.searchParams.has("code_challenge_method")).toBe(false);
    expect(authorization.searchParams.get("label")).toBe("Work laptop");
    expect(redirect.protocol).toBe("http:");
    expect(redirect.hostname).toBe("127.0.0.1");
    expect(Number(redirect.port)).toBeGreaterThan(0);
    expect(redirect.port).not.toBe("80");
    expect(redirect.pathname).toBe("/callback");
    expect(redirect.search).toBe("");
    expect(redirect.hash).toBe("");
    expect(browserStatus).toBe(200);
    expect(browserBody).toContain("Authentication complete");
    expect(browserBody).not.toContain("authorization-code");
    expect(browserBody).not.toContain(result.verifier);
    expect(result.code).toBe("authorization-code");
    expect(result.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(process.listenerCount("SIGINT")).toBe(initialSigintListeners);
    expect(process.listenerCount("SIGTERM")).toBe(initialSigtermListeners);
    await expectListenerClosed(openedUrl);
  });

  it("uses the default label and can skip opening a browser", async () => {
    let printedUrl = "";
    const authorization = authorizeInBrowser(config, {
      browser: false,
      timeoutMs: 1_000,
      printUrl: (url) => {
        printedUrl = url;
      },
    });

    await vi.waitFor(() => expect(printedUrl).not.toBe(""));
    const url = new URL(printedUrl);
    const response = await fetch(
      callbackUrl(printedUrl, {
        code: "manual-code",
        state: url.searchParams.get("state") ?? undefined,
      }),
    );

    expect(response.status).toBe(200);
    await expect(authorization).resolves.toMatchObject({ code: "manual-code" });
    expect(url.searchParams.get("label")).toBe("Robusty CLI");
    await expectListenerClosed(printedUrl);
  });

  it("rejects access denial and returns a secret-free failure page", async () => {
    let openedUrl = "";
    let browserBody = "";
    const authorization = authorizeInBrowser(config, {
      printUrl: () => undefined,
      openBrowser: async (url) => {
        openedUrl = url;
        const state = new URL(url).searchParams.get("state") ?? undefined;
        const response = await fetch(
          callbackUrl(url, { error: "access_denied", state }),
        );
        expect(response.status).toBe(400);
        browserBody = await response.text();
      },
    });

    await expect(authorization).rejects.toThrow("Authentication was denied.");
    expect(browserBody).toContain("Authentication failed");
    expect(browserBody).not.toContain("access_denied");
    expect(browserBody).not.toContain(
      new URL(openedUrl).searchParams.get("state") ?? "unreachable",
    );
    await expectListenerClosed(openedUrl);
  });

  it("maps non-denial callback errors to a generic failure", async () => {
    let openedUrl = "";
    const authorization = authorizeInBrowser(config, {
      printUrl: () => undefined,
      openBrowser: async (url) => {
        openedUrl = url;
        const state = new URL(url).searchParams.get("state") ?? undefined;
        await fetch(callbackUrl(url, { error: "server_secret_detail", state }));
      },
    });

    await expect(authorization).rejects.toThrow(
      "Browser authentication failed.",
    );
    await expectListenerClosed(openedUrl);
  });

  it.each([
    ["missing", undefined],
    ["mismatched", "wrong-state"],
  ])(
    "ignores a callback with %s state and accepts the valid callback",
    async (_, invalidState) => {
      let invalidBody = "";
      const result = await authorizeInBrowser(config, {
        printUrl: () => undefined,
        openBrowser: async (url) => {
          const authorization = new URL(url);
          const invalidResponse = await fetch(
            callbackUrl(url, { code: "attacker-code", state: invalidState }),
          );
          expect(invalidResponse.status).toBe(400);
          invalidBody = await invalidResponse.text();

          const validResponse = await fetch(
            callbackUrl(url, {
              code: "valid-code",
              state: authorization.searchParams.get("state") ?? undefined,
            }),
          );
          expect(validResponse.status).toBe(200);
        },
      });

      expect(result.code).toBe("valid-code");
      expect(invalidBody).toContain("Authentication failed");
      expect(invalidBody).not.toContain("attacker-code");
    },
  );

  it("does not consume invalid paths or methods", async () => {
    const result = await authorizeInBrowser(config, {
      printUrl: () => undefined,
      openBrowser: async (url) => {
        const authorization = new URL(url);
        const redirect = callbackUrl(url, {});
        const invalidPath = new URL("/not-the-callback", redirect.origin);
        expect((await fetch(invalidPath)).status).toBe(404);

        const invalidMethod = await fetch(redirect, { method: "POST" });
        expect(invalidMethod.status).toBe(405);
        expect(invalidMethod.headers.get("allow")).toBe("GET");

        await fetch(
          callbackUrl(url, {
            code: "valid-code",
            state: authorization.searchParams.get("state") ?? undefined,
          }),
        );
      },
    });

    expect(result.code).toBe("valid-code");
  });

  it("rejects a valid callback that omits the authorization code", async () => {
    let openedUrl = "";
    const authorization = authorizeInBrowser(config, {
      printUrl: () => undefined,
      openBrowser: async (url) => {
        openedUrl = url;
        const state = new URL(url).searchParams.get("state") ?? undefined;
        const response = await fetch(callbackUrl(url, { state }));
        expect(response.status).toBe(400);
      },
    });

    await expect(authorization).rejects.toThrow(
      "The authentication callback did not include a code.",
    );
    await expectListenerClosed(openedUrl);
  });

  it("times out, removes signal handlers, and closes the listener", async () => {
    let printedUrl = "";
    const initialSigintListeners = process.listenerCount("SIGINT");
    const initialSigtermListeners = process.listenerCount("SIGTERM");

    await expect(
      authorizeInBrowser(config, {
        browser: false,
        timeoutMs: 20,
        printUrl: (url) => {
          printedUrl = url;
        },
      }),
    ).rejects.toThrow("Browser authentication timed out");

    expect(printedUrl).not.toBe("");
    expect(process.listenerCount("SIGINT")).toBe(initialSigintListeners);
    expect(process.listenerCount("SIGTERM")).toBe(initialSigtermListeners);
    await expectListenerClosed(printedUrl);
  });

  it("times out even when the browser opener remains pending", async () => {
    let printedUrl = "";
    let releaseBrowser: (() => void) | undefined;
    const pendingBrowser = new Promise<void>((resolve) => {
      releaseBrowser = resolve;
    });
    const authorization = authorizeInBrowser(config, {
      timeoutMs: 20,
      printUrl: (url) => {
        printedUrl = url;
      },
      openBrowser: () => pendingBrowser,
    });
    const observedAuthorization = authorization.then(
      () => ({ status: "resolved" as const }),
      (error: unknown) => ({ status: "rejected" as const, error }),
    );

    await vi.waitFor(() => expect(printedUrl).not.toBe(""));
    const outcome = await Promise.race([
      observedAuthorization,
      new Promise<{ status: "pending" }>((resolve) => {
        setTimeout(() => resolve({ status: "pending" }), 100);
      }),
    ]);

    releaseBrowser?.();
    await authorization.catch(() => undefined);

    expect(outcome.status).toBe("rejected");
    expect(outcome).toMatchObject({
      error: expect.objectContaining({
        message: expect.stringContaining("Browser authentication timed out"),
      }),
    });
    await expectListenerClosed(printedUrl);
  });

  it("sanitizes browser-opening failures and closes the listener", async () => {
    let openedUrl = "";
    let printedUrl = "";

    let caught: unknown;
    try {
      await authorizeInBrowser(config, {
        printUrl: (url) => {
          printedUrl = url;
        },
        openBrowser: async (url) => {
          openedUrl = url;
          throw new Error(`browser failed while opening ${url}`);
        },
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(CliError);
    expect((caught as Error).message).toContain("Could not open a browser");
    expect((caught as Error).message).not.toContain(openedUrl);
    expect(printedUrl).toBe(openedUrl);
    await expectListenerClosed(openedUrl);
  });

  it("fails cleanly when no browser opener is configured", async () => {
    let printedUrl = "";

    await expect(
      authorizeInBrowser(config, {
        printUrl: (url) => {
          printedUrl = url;
        },
      }),
    ).rejects.toThrow("No browser opener was configured.");

    expect(printedUrl).not.toBe("");
    await expectListenerClosed(printedUrl);
  });
});

describe("exchangeAuthorizationCode", () => {
  it("posts the code and verifier without an authorization header", async () => {
    const request = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        jsonResponse(200, {
          token: "rbst_returned-token",
          token_type: "Bearer",
          user: { id: "user-1", email: "user@example.com" },
          ignored: true,
        }),
    );

    const credential = await exchangeAuthorizationCode(
      config,
      "authorization-code",
      "pkce-verifier",
      { fetch: request as typeof fetch },
    );

    expect(credential).toEqual({
      token: "rbst_returned-token",
      user: { id: "user-1", email: "user@example.com" },
    });
    expect(request).toHaveBeenCalledOnce();
    const call = request.mock.calls[0];
    expect(call).toBeDefined();
    const [url, init] = call!;
    expect(url).toBe("https://www.robusty.io/api/cli/token");
    expect(init).toMatchObject({
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        code: "authorization-code",
        code_verifier: "pkce-verifier",
      }),
    });
    const headers = init?.headers;
    expect(headers).toBeDefined();
    expect((headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it.each([
    ["null", null],
    ["an array", []],
    [
      "a missing token",
      { token_type: "Bearer", user: { id: "u", email: "e" } },
    ],
    [
      "a non-string token",
      { token: 123, token_type: "Bearer", user: { id: "u", email: "e" } },
    ],
    [
      "the wrong token type",
      { token: "secret", token_type: "bearer", user: { id: "u", email: "e" } },
    ],
    ["a missing user", { token: "secret", token_type: "Bearer" }],
    [
      "a non-string user id",
      { token: "secret", token_type: "Bearer", user: { id: 1, email: "e" } },
    ],
    [
      "a non-string email",
      {
        token: "secret",
        token_type: "Bearer",
        user: { id: "u", email: false },
      },
    ],
  ])("rejects a successful response containing %s", async (_, body) => {
    const request = vi.fn(async () => jsonResponse(200, body));

    await expect(
      exchangeAuthorizationCode(config, "code", "verifier", {
        fetch: request as typeof fetch,
      }),
    ).rejects.toThrow("Robusty returned an invalid authentication response.");
  });

  it("rejects non-JSON success responses", async () => {
    const request = vi.fn(
      async () => new Response("not json", { status: 200 }),
    );

    await expect(
      exchangeAuthorizationCode(config, "code", "verifier", {
        fetch: request as typeof fetch,
      }),
    ).rejects.toThrow("Robusty returned an invalid authentication response.");
  });

  it("retries authentication outages with bounded exponential backoff", async () => {
    const responses = [
      jsonResponse(500, { error: "authentication_unavailable" }),
      jsonResponse(503, { error: "authentication_unavailable" }),
      jsonResponse(200, {
        token: "rbst_fresh-token",
        token_type: "Bearer",
        user: { id: "user-1", email: "user@example.com" },
      }),
    ];
    const request = vi.fn(async () => {
      const response = responses.shift();
      if (!response) throw new Error("Unexpected extra request");
      return response;
    });
    let elapsed = 0;
    const sleep = vi.fn(async (milliseconds: number) => {
      elapsed += milliseconds;
    });

    const credential = await exchangeAuthorizationCode(
      config,
      "authorization-code",
      "pkce-verifier",
      {
        fetch: request as typeof fetch,
        sleep,
        now: () => elapsed,
        retryDeadlineMs: 5_000,
      },
    );

    expect(credential.token).toBe("rbst_fresh-token");
    expect(request).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[250], [500]]);
  });

  it("stops retrying when the next delay would exceed the deadline", async () => {
    const request = vi.fn(async () =>
      jsonResponse(500, { error: "authentication_unavailable" }),
    );
    let elapsed = 0;
    const sleep = vi.fn(async (milliseconds: number) => {
      elapsed += milliseconds;
    });

    let caught: unknown;
    try {
      await exchangeAuthorizationCode(config, "code", "verifier", {
        fetch: request as typeof fetch,
        sleep,
        now: () => elapsed,
        retryDeadlineMs: 600,
      });
    } catch (error) {
      caught = error;
    }

    expect(request).toHaveBeenCalledTimes(2);
    expect(sleep.mock.calls).toEqual([[250]]);
    expect(caught).toBeInstanceOf(ApiError);
    expect(caught).toMatchObject({
      status: 500,
      code: "authentication_unavailable",
    });
    expect((caught as Error).message).toContain("temporarily unavailable");
  });

  it.each([
    [400, "invalid_grant", "expired or was already used"],
    [400, "invalid_request", "rejected the authentication request"],
    [401, "other_error", "Authentication failed (HTTP 401)"],
  ])("does not retry HTTP %i %s", async (status, error, message) => {
    const request = vi.fn(async () => jsonResponse(status, { error }));
    const sleep = vi.fn(async () => undefined);

    let caught: unknown;
    try {
      await exchangeAuthorizationCode(config, "code", "verifier", {
        fetch: request as typeof fetch,
        sleep,
      });
    } catch (caughtError) {
      caught = caughtError;
    }

    expect(request).toHaveBeenCalledOnce();
    expect(sleep).not.toHaveBeenCalled();
    expect(caught).toBeInstanceOf(ApiError);
    expect(caught).toMatchObject({ status, code: error });
    expect((caught as Error).message).toContain(message);
  });

  it("handles a non-JSON error response without retrying", async () => {
    const request = vi.fn(
      async () => new Response("upstream details", { status: 502 }),
    );

    let caught: unknown;
    try {
      await exchangeAuthorizationCode(config, "code", "verifier", {
        fetch: request as typeof fetch,
      });
    } catch (error) {
      caught = error;
    }

    expect(request).toHaveBeenCalledOnce();
    expect(caught).toBeInstanceOf(ApiError);
    expect(caught).toMatchObject({ status: 502, code: undefined });
  });

  it("sanitizes network failures without disclosing the code or verifier", async () => {
    const code = "authorization-code-secret";
    const verifier = "pkce-verifier-secret";
    const request = vi.fn(async () => {
      throw new Error(`request failed for ${code} and ${verifier}`);
    });

    let caught: unknown;
    try {
      await exchangeAuthorizationCode(config, code, verifier, {
        fetch: request as typeof fetch,
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(CliError);
    expect((caught as Error).message).toBe(
      "Could not reach https://www.robusty.io. Check your network connection.",
    );
    expect((caught as Error).message).not.toContain(code);
    expect((caught as Error).message).not.toContain(verifier);
  });

  it("does not disclose a token from an invalid success response", async () => {
    const token = "rbst_response-secret";
    const request = vi.fn(async () =>
      jsonResponse(200, {
        token,
        token_type: "Unexpected",
        user: { id: "user-1", email: "user@example.com" },
      }),
    );

    let caught: unknown;
    try {
      await exchangeAuthorizationCode(config, "code", "verifier", {
        fetch: request as typeof fetch,
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(CliError);
    expect((caught as Error).message).not.toContain(token);
  });
});
