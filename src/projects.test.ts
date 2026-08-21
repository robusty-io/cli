import { describe, expect, it, vi } from "vitest";
import type { Config } from "./config";
import { ApiError, CliError } from "./errors";
import { fetchProjects } from "./projects";

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
  it("requests and parses the project list with the stored user token", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(200, {
        projects: [
          { uid: "project-1", name: "First", ignored: true },
          { uid: "project-2", name: "Second" },
        ],
      }),
    );

    await expect(
      fetchProjects(config, "rbst_user-secret", request),
    ).resolves.toEqual([
      { uid: "project-1", name: "First" },
      { uid: "project-2", name: "Second" },
    ]);
    expect(request).toHaveBeenCalledWith(
      "https://www.robusty.io/api/cli/projects",
      {
        headers: {
          Authorization: "Bearer rbst_user-secret",
          Accept: "application/json",
        },
      },
    );
  });

  it("accepts an empty project list", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(200, { projects: [] }));

    await expect(fetchProjects(config, "token", request)).resolves.toEqual([]);
  });

  it.each([
    null,
    {},
    { projects: null },
    { projects: [{}] },
    { projects: [{ uid: 1, name: "Project" }] },
    { projects: [{ uid: "project-1", name: null }] },
  ])("rejects an invalid successful response: %j", async (body) => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(200, body));

    await expect(fetchProjects(config, "token", request)).rejects.toThrow(
      "Robusty returned an invalid project list.",
    );
  });

  it("rejects non-JSON success responses", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("not json", { status: 200 }));

    await expect(fetchProjects(config, "token", request)).rejects.toThrow(
      CliError,
    );
  });

  it("preserves status and API error code for authentication failures", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(401, { error: "unauthorized" }));

    const error = await fetchProjects(config, "token", request).catch(
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
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(503, { error: { internal: true } }));

    const error = await fetchProjects(config, "token", request).catch(
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
    const request = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("request leaked rbst_user-secret"));

    const error = await fetchProjects(
      config,
      "rbst_user-secret",
      request,
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(CliError);
    expect((error as Error).message).toBe(
      "Could not reach https://www.robusty.io. Check your network connection.",
    );
    expect((error as Error).message).not.toContain("rbst_user-secret");
  });
});
