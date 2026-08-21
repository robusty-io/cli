import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Config } from "./config";
import { CliError } from "./errors";
import { launcherRequest } from "./http";

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    webUrl: "https://www.robusty.io",
    launcherUrl: "https://launcher.robusty.io",
    token: "rbst_secret-token",
    ...overrides,
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("launcherRequest", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("throws without calling fetch when no token is configured", async () => {
    const config = makeConfig({ token: undefined });

    await expect(launcherRequest(config, "/api/launch/start")).rejects.toThrow(
      CliError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the Authorization header and JSON body", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { launchId: "l1", slug: "abc" }),
    );

    await launcherRequest(makeConfig(), "/api/launch/start", {
      method: "POST",
      body: { suiteUid: "s1", variableOverrides: [] },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://launcher.robusty.io/api/launch/start");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer rbst_secret-token",
      "Content-Type": "application/json",
      Accept: "application/json",
    });
    expect(init.body).toBe(
      JSON.stringify({ suiteUid: "s1", variableOverrides: [] }),
    );
  });

  it("returns the parsed JSON body on success", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { launchId: "l1", slug: "abc" }),
    );

    const result = await launcherRequest(makeConfig(), "/api/launch/start");

    expect(result).toEqual({ launchId: "l1", slug: "abc" });
  });

  it("wraps network failures in a CliError without leaking the token", async () => {
    fetchMock.mockRejectedValue(new Error("boom"));

    let caught: unknown;
    try {
      await launcherRequest(makeConfig(), "/api/launch/start");
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(CliError);
    expect((caught as CliError).message).not.toContain("rbst_secret-token");
  });

  const statusCases: Array<{
    status: number;
    body: unknown;
    expected: string | RegExp;
  }> = [
    {
      status: 400,
      body: { success: false, error: "Cannot launch an empty test suite" },
      expected: /Cannot launch an empty test suite/,
    },
    {
      status: 401,
      body: { success: false, error: "unauthorized" },
      expected: /credential is missing/,
    },
    {
      status: 402,
      body: {
        error: "quota_exceeded",
        required: 5,
        quota: { remaining: 2, limit: 200 },
      },
      expected: /Quota exceeded.*2\/200/,
    },
    {
      status: 403,
      body: { success: false, error: "forbidden" },
      expected: /does not have access/,
    },
    {
      status: 403,
      body: {
        error: "overage_cap_exceeded",
        required: 5,
        quota: { remaining: 0, limit: 200 },
      },
      expected: /Overage cap reached.*0\/200/,
    },
    {
      status: 404,
      body: { success: false, error: "Suite not found" },
      expected: /Suite not found\. Pass --debug/,
    },
    {
      status: 409,
      body: { success: false, error: "Could not allocate launch serial" },
      expected: /Could not allocate launch serial\. Try again\./,
    },
    {
      status: 500,
      body: { success: false, error: "authentication_unavailable" },
      expected: /temporarily unavailable/,
    },
    {
      status: 500,
      body: { success: false, error: "Failed to start launch" },
      expected: /Failed to start launch\. Pass --debug/,
    },
  ];

  it.each(statusCases)(
    "maps HTTP $status to a descriptive CliError",
    async ({ status, body, expected }) => {
      fetchMock.mockResolvedValue(jsonResponse(status, body));

      let caught: unknown;
      try {
        await launcherRequest(makeConfig(), "/api/launch/start");
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(CliError);
      expect((caught as CliError).message).toMatch(expected);
    },
  );

  it("never includes the token in a thrown error message", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(401, { success: false, error: "unauthorized" }),
    );

    let caught: unknown;
    try {
      await launcherRequest(makeConfig(), "/api/launch/start");
    } catch (error) {
      caught = error;
    }

    expect((caught as CliError).message).not.toContain("rbst_secret-token");
  });

  describe("debug mode", () => {
    let errorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    });

    afterEach(() => {
      errorSpy.mockRestore();
    });

    it("prints nothing to stderr when debug is not set", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(200, { launchId: "l1", slug: "abc" }),
      );

      await launcherRequest(makeConfig(), "/api/launch/start", {
        method: "POST",
        body: { suiteUid: "s1" },
      });

      expect(errorSpy).not.toHaveBeenCalled();
    });

    it("prints the request method/URL/body and the response status/body", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(400, { success: false, error: "Invalid request body" }),
      );

      await expect(
        launcherRequest(makeConfig(), "/api/launch/start", {
          method: "POST",
          body: { suiteUid: "e86os" },
          debug: true,
        }),
      ).rejects.toThrow(CliError);

      const lines: string[] = errorSpy.mock.calls.map(
        (call: unknown[]) => call[0] as string,
      );
      expect(lines.some((line) => line.includes("POST"))).toBe(true);
      expect(lines.some((line) => line.includes("/api/launch/start"))).toBe(
        true,
      );
      expect(lines.some((line) => line.includes('"suiteUid":"e86os"'))).toBe(
        true,
      );
      expect(lines.some((line) => line.includes("400"))).toBe(true);
      expect(lines.some((line) => line.includes("Invalid request body"))).toBe(
        true,
      );
    });

    it("never prints the token or Authorization header in debug output", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(401, { success: false, error: "unauthorized" }),
      );

      await expect(
        launcherRequest(makeConfig(), "/api/launch/start", { debug: true }),
      ).rejects.toThrow(CliError);

      const lines: string[] = errorSpy.mock.calls.map(
        (call: unknown[]) => call[0] as string,
      );
      for (const line of lines) {
        expect(line).not.toContain("rbst_secret-token");
        expect(line).not.toContain("Authorization");
      }
    });

    it("omits the 'Pass --debug for details.' hint when debug is already on", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(404, { success: false, error: "Suite not found" }),
      );

      let caught: unknown;
      try {
        await launcherRequest(makeConfig(), "/api/launch/start", {
          debug: true,
        });
      } catch (error) {
        caught = error;
      }

      expect((caught as CliError).message).not.toContain("--debug");
    });

    it("includes the 'Pass --debug for details.' hint when debug is off", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(404, { success: false, error: "Suite not found" }),
      );

      let caught: unknown;
      try {
        await launcherRequest(makeConfig(), "/api/launch/start");
      } catch (error) {
        caught = error;
      }

      expect((caught as CliError).message).toContain("--debug");
    });

    it("logs the underlying network error when debug is on", async () => {
      fetchMock.mockRejectedValue(new Error("getaddrinfo ENOTFOUND"));

      await expect(
        launcherRequest(makeConfig(), "/api/launch/start", { debug: true }),
      ).rejects.toThrow(CliError);

      const lines: string[] = errorSpy.mock.calls.map(
        (call: unknown[]) => call[0] as string,
      );
      expect(lines.some((line) => line.includes("getaddrinfo ENOTFOUND"))).toBe(
        true,
      );
    });
  });
});
