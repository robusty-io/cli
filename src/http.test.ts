import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, CliError } from "./errors";
import type { ErrorResponseContext } from "./http";
import { apiRequest } from "./http";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("apiRequest", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends a GET with JSON headers and no Authorization when no token is given", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true }));

    await apiRequest("https://api.example.com", "/things");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.example.com/things");
    expect(init.method).toBe("GET");
    expect(init.headers).toMatchObject({
      "Content-Type": "application/json",
      Accept: "application/json",
    });
    expect(init.headers).not.toHaveProperty("Authorization");
    expect(init.body).toBeUndefined();
  });

  it("adds the Authorization header and serializes the body when provided", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true }));

    await apiRequest("https://api.example.com", "/things", {
      method: "POST",
      token: "secret-token",
      body: { name: "widget" },
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer secret-token",
    });
    expect(init.body).toBe(JSON.stringify({ name: "widget" }));
  });

  it("returns the parsed JSON body on success", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { id: "x", n: 1 }));

    const result = await apiRequest("https://api.example.com", "/things");

    expect(result).toEqual({ id: "x", n: 1 });
  });

  it("uses the generic default mapper for non-2xx responses when no mapError is given", async () => {
    fetchMock.mockResolvedValue(jsonResponse(500, { error: "boom" }));

    const error = await apiRequest("https://api.example.com", "/things").catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 500,
      message: "Unexpected response from the server (HTTP 500).",
    });
  });

  it("routes non-2xx responses through a supplied mapError with full context", async () => {
    fetchMock.mockResolvedValue(jsonResponse(418, { detail: "teapot" }));

    const contexts: ErrorResponseContext[] = [];
    const mapError = (context: ErrorResponseContext): ApiError => {
      contexts.push(context);
      return new ApiError("mapped", context.status, "teapot");
    };

    const error = await apiRequest("https://api.example.com", "/brew", {
      debug: false,
      mapError,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 418, code: "teapot" });
    expect(contexts).toEqual([
      {
        status: 418,
        statusText: expect.any(String),
        json: { detail: "teapot" },
        debug: false,
      },
    ]);
  });

  it("passes undefined json to mapError for empty or non-JSON error bodies", async () => {
    fetchMock.mockResolvedValue(new Response("not json", { status: 400 }));

    let received: unknown = "unset";
    await apiRequest("https://api.example.com", "/things", {
      mapError: ({ status, json }) => {
        received = json;
        return new ApiError("mapped", status);
      },
    }).catch(() => undefined);

    expect(received).toBeUndefined();
  });

  it("wraps network failures in a CliError naming the base URL, without the token", async () => {
    fetchMock.mockRejectedValue(new Error("request leaked secret-token"));

    const error = await apiRequest("https://api.example.com", "/things", {
      token: "secret-token",
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(CliError);
    expect((error as CliError).message).toBe(
      "Could not reach https://api.example.com. Check your network connection.",
    );
    expect((error as CliError).message).not.toContain("secret-token");
  });

  describe("debug mode", () => {
    let errorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    });

    afterEach(() => {
      errorSpy.mockRestore();
    });

    it("prints nothing to stderr when debug is off", async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, { ok: true }));

      await apiRequest("https://api.example.com", "/things");

      expect(errorSpy).not.toHaveBeenCalled();
    });

    it("prints request and response diagnostics without the token", async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, { ok: true }));

      await apiRequest("https://api.example.com", "/things", {
        method: "POST",
        token: "secret-token",
        body: { name: "widget" },
        debug: true,
      });

      const lines: string[] = errorSpy.mock.calls.map(
        (call: unknown[]) => call[0] as string,
      );
      expect(lines.some((line) => line.includes("POST"))).toBe(true);
      expect(lines.some((line) => line.includes('"name":"widget"'))).toBe(true);
      expect(lines.some((line) => line.includes("200"))).toBe(true);
      for (const line of lines) {
        expect(line).not.toContain("secret-token");
        expect(line).not.toContain("Authorization");
      }
    });

    it("logs the underlying network error when debug is on", async () => {
      fetchMock.mockRejectedValue(new Error("getaddrinfo ENOTFOUND"));

      await expect(
        apiRequest("https://api.example.com", "/things", { debug: true }),
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
