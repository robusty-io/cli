import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../config";
import { CliError } from "../errors";
import { launcherRequest } from "./api";

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

  it("targets the launcher URL with the configured token", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { launchId: "l1", slug: "abc" }),
    );

    await launcherRequest(makeConfig(), "/api/launch/start", {
      method: "POST",
      body: { suiteUid: "s1" },
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://launcher.robusty.io/api/launch/start");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer rbst_secret-token",
    });
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

  it("omits the 'Pass --debug for details.' hint when debug is already on", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(404, { success: false, error: "Suite not found" }),
    );

    const error = await launcherRequest(makeConfig(), "/api/launch/start", {
      debug: true,
    }).catch((caught: unknown) => caught);

    expect((error as CliError).message).not.toContain("--debug");
  });
});
