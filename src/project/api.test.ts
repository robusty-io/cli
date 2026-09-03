import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../config";
import { ApiError, CliError } from "../errors";
import { fetchProjects } from "./api";

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

describe("fetchProjects", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requests and parses the project list with the stored user token", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        projects: [
          { uid: "project-1", name: "First", ignored: true },
          { uid: "project-2", name: "Second" },
        ],
      }),
    );

    await expect(fetchProjects(config, "rbst_user-secret")).resolves.toEqual([
      { uid: "project-1", name: "First" },
      { uid: "project-2", name: "Second" },
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://www.robusty.io/api/cli/projects");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer rbst_user-secret",
      Accept: "application/json",
    });
  });

  it("accepts an empty project list", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { projects: [] }));

    await expect(fetchProjects(config, "token")).resolves.toEqual([]);
  });

  it.each([
    null,
    {},
    { projects: null },
    { projects: [{}] },
    { projects: [{ uid: 1, name: "Project" }] },
    { projects: [{ uid: "project-1", name: null }] },
  ])("rejects an invalid successful response: %j", async (body) => {
    fetchMock.mockResolvedValue(jsonResponse(200, body));

    await expect(fetchProjects(config, "token")).rejects.toThrow(
      "Robusty returned an invalid project list.",
    );
  });

  it("rejects non-JSON success responses", async () => {
    fetchMock.mockResolvedValue(new Response("not json", { status: 200 }));

    await expect(fetchProjects(config, "token")).rejects.toThrow(CliError);
  });

  it("preserves status and API error code for authentication failures", async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { error: "unauthorized" }));

    const error = await fetchProjects(config, "token").catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 401,
      code: "unauthorized",
      message: "Your saved login is no longer valid. Run robusty login again.",
    });
  });

  it("maps other HTTP failures without trusting a non-string error code", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(503, { error: { internal: true } }),
    );

    const error = await fetchProjects(config, "token").catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 503,
      code: undefined,
      message: "Could not list Robusty projects (HTTP 503).",
    });
  });

  it("sanitizes network failures", async () => {
    fetchMock.mockRejectedValue(new Error("request leaked rbst_user-secret"));

    const error = await fetchProjects(config, "rbst_user-secret").catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(CliError);
    expect((error as Error).message).toBe(
      "Could not reach https://www.robusty.io. Check your network connection.",
    );
    expect((error as Error).message).not.toContain("rbst_user-secret");
  });
});
