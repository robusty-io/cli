import { afterEach, describe, expect, it, vi } from "vitest";
import type { CredentialStore } from "../auth/credential-store";
import type { ResolvedCredential } from "../auth/credentials";
import type { Config } from "../config";
import { ApiError, CliError } from "../errors";
import type { LaunchResult } from "../launch/observer";
import type { LaunchRenderer } from "../launch/ui";
import {
  collectVarFlagValues,
  parseVariableOverrides,
  runLaunch,
} from "./launch";
import type { LaunchDependencies } from "./launch";

const config: Config = {
  webUrl: "https://www.robusty.io",
  launcherUrl: "https://launcher.robusty.io",
  token: undefined,
};

const startResponse = {
  launchId: "launch-id",
  projectId: "project-web-id",
  slug: "launch-slug",
  total: 2,
  wsTicket: "socket-ticket",
};

const passedResult: LaunchResult = {
  total: 2,
  passed: 2,
  failed: 0,
  running: 0,
  incomplete: 0,
  tests: [
    { testCaseUid: "login", testCaseSlug: "login-flow", status: "passed" },
    {
      testCaseUid: "checkout",
      testCaseSlug: "checkout-flow",
      status: "passed",
    },
  ],
};

function makeDependencies(
  credential: ResolvedCredential | undefined = {
    source: "stored",
    token: "stored-token",
    user: { id: "user-1", email: "user@example.com" },
  },
) {
  const store: CredentialStore = {
    get: vi.fn<CredentialStore["get"]>(),
    set: vi.fn<CredentialStore["set"]>(),
    delete: vi.fn<CredentialStore["delete"]>(),
  };
  const renderer: LaunchRenderer = {
    start: vi.fn(),
    update: vi.fn(),
    finish: vi.fn(),
    stop: vi.fn(),
  };
  const request = vi
    .fn<LaunchDependencies["request"]>()
    .mockResolvedValue(startResponse);
  const observe = vi
    .fn<LaunchDependencies["observe"]>()
    .mockResolvedValue(passedResult);
  const dependencies: LaunchDependencies = {
    loadConfig: vi.fn(() => config),
    createStore: vi.fn(() => store),
    resolveCredential: vi.fn(async () => credential),
    resolveLink: vi.fn(async () => ({
      projectId: "project-request-id",
      projectName: "Main Project",
    })),
    request,
    observe,
    createRenderer: vi.fn(() => renderer),
    cwd: vi.fn(() => "/workspace/project"),
  };
  return { dependencies, store, renderer, request, observe };
}

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

describe("launch variable overrides", () => {
  it("collects repeated separate and inline flags", () => {
    expect(
      collectVarFlagValues([
        "suite",
        "--var",
        "BASE_URL=https://example.com",
        "--var=ROLE=admin",
      ]),
    ).toEqual(["BASE_URL=https://example.com", "ROLE=admin"]);
  });

  it("keeps equals signs in override values", () => {
    expect(parseVariableOverrides(["TOKEN=a=b"])).toEqual([
      { name: "TOKEN", value: "a=b" },
    ]);
  });
});

describe("runLaunch", () => {
  it("creates and observes a linked-project launch", async () => {
    const mocks = makeDependencies();
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await runLaunch(
      {
        suite: "checkout-suite",
        variableOverrides: [{ name: "ROLE", value: "admin" }],
        debug: true,
      },
      mocks.dependencies,
    );

    expect(mocks.request).toHaveBeenCalledWith(
      { ...config, token: "stored-token" },
      "/api/launch/start",
      {
        method: "POST",
        body: {
          suiteUid: "checkout-suite",
          projectId: "project-request-id",
          variableOverrides: [{ name: "ROLE", value: "admin" }],
        },
        debug: true,
      },
    );
    expect(log).toHaveBeenNthCalledWith(1, "Creating test launch...");
    expect(log).toHaveBeenNthCalledWith(
      2,
      "Launch created: https://www.robusty.io/project/project-web-id/launches/launch-slug",
    );
    expect(mocks.observe).toHaveBeenCalledWith(
      config,
      { slug: "launch-slug", wsTicket: "socket-ticket", total: 2 },
      { onUpdate: mocks.renderer.update, debug: true },
    );
    expect(mocks.renderer.start).toHaveBeenCalledOnce();
    expect(mocks.renderer.finish).toHaveBeenCalledWith(
      passedResult,
      "https://www.robusty.io/project/project-web-id/launches/launch-slug",
    );
  });

  it("does not require a local project link for an environment token", async () => {
    const mocks = makeDependencies({
      source: "environment",
      token: "environment-token",
    });
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    await runLaunch(
      { suite: "suite", variableOverrides: [], debug: false },
      mocks.dependencies,
    );

    expect(mocks.dependencies.resolveLink).not.toHaveBeenCalled();
    expect(mocks.request).toHaveBeenCalledWith(
      { ...config, token: "environment-token" },
      "/api/launch/start",
      {
        method: "POST",
        body: { suiteUid: "suite", variableOverrides: [] },
      },
    );
  });

  it("sets a non-zero exit code when tests fail", async () => {
    const mocks = makeDependencies();
    const failedResult: LaunchResult = {
      ...passedResult,
      passed: 1,
      failed: 1,
      tests: [
        {
          testCaseUid: "login",
          testCaseSlug: "login-flow",
          status: "passed",
        },
        {
          testCaseUid: "checkout",
          testCaseSlug: "checkout-flow",
          status: "failed",
          conclusion: "Checkout failed",
        },
      ],
    };
    mocks.observe.mockResolvedValue(failedResult);
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    await runLaunch(
      { suite: "suite", variableOverrides: [], debug: false },
      mocks.dependencies,
    );

    expect(process.exitCode).toBe(1);
    expect(mocks.renderer.finish).toHaveBeenCalledWith(
      failedResult,
      "https://www.robusty.io/project/project-web-id/launches/launch-slug",
    );
  });

  it("stops the renderer when observation fails", async () => {
    const mocks = makeDependencies();
    const error = new CliError("WebSocket failed");
    mocks.observe.mockRejectedValue(error);
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    await expect(
      runLaunch(
        { suite: "suite", variableOverrides: [], debug: false },
        mocks.dependencies,
      ),
    ).rejects.toBe(error);
    expect(mocks.renderer.stop).toHaveBeenCalledOnce();
    expect(mocks.renderer.finish).not.toHaveBeenCalled();
  });

  it("deletes an invalid stored credential after a 401", async () => {
    const mocks = makeDependencies();
    mocks.request.mockRejectedValue(new ApiError("Unauthorized", 401));
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    await expect(
      runLaunch(
        { suite: "suite", variableOverrides: [], debug: false },
        mocks.dependencies,
      ),
    ).rejects.toThrow(
      "Your saved login is no longer valid. Run robusty login again.",
    );
    expect(mocks.store.delete).toHaveBeenCalledOnce();
    expect(mocks.observe).not.toHaveBeenCalled();
  });
});
