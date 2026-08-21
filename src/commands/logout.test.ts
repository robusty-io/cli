import { afterEach, describe, expect, it, vi } from "vitest";
import type { CredentialStore } from "../auth/credential-store";
import type { Config } from "../config";
import { runLogout } from "./logout";
import type { LogoutDependencies } from "./logout";

function makeDependencies(token: string | undefined = undefined) {
  const config: Config = {
    webUrl: "https://www.robusty.io",
    launcherUrl: "https://launcher.robusty.io",
    token,
  };
  const store: CredentialStore = {
    get: vi.fn<CredentialStore["get"]>(),
    set: vi.fn<CredentialStore["set"]>(),
    delete: vi.fn<CredentialStore["delete"]>(),
  };
  const dependencies: LogoutDependencies = {
    loadConfig: vi.fn(() => config),
    createStore: vi.fn(() => store),
    deleteLink: vi.fn(async () => true),
    cwd: vi.fn(() => "/workspace/project"),
  };
  return { config, store, dependencies };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runLogout", () => {
  it("deletes local credentials and the project link", async () => {
    const mocks = makeDependencies();
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    await runLogout(mocks.dependencies);

    expect(mocks.dependencies.createStore).toHaveBeenCalledWith(mocks.config);
    expect(mocks.store.delete).toHaveBeenCalledOnce();
    expect(mocks.dependencies.deleteLink).toHaveBeenCalledWith(
      "/workspace/project",
    );
    expect(log).toHaveBeenNthCalledWith(
      1,
      "Logged out locally and removed the project link.",
    );
    expect(log).toHaveBeenNthCalledWith(
      2,
      "Revoke the server token separately in Account Settings if needed.",
    );
    expect(error).not.toHaveBeenCalled();
  });

  it("reports when the directory has no project link", async () => {
    const mocks = makeDependencies();
    vi.mocked(mocks.dependencies.deleteLink).mockResolvedValue(false);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await runLogout(mocks.dependencies);

    expect(log).toHaveBeenNthCalledWith(
      1,
      "Logged out locally. No project link was found.",
    );
  });

  it("warns that an environment credential remains active without printing it", async () => {
    const mocks = makeDependencies("rbst_environment-secret");
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    await runLogout(mocks.dependencies);

    expect(error).toHaveBeenCalledWith(
      "Warning: ROBUSTY_TOKEN is still set in your environment and will continue to authenticate commands.",
    );
    const output = [...log.mock.calls, ...error.mock.calls].flat().join("\n");
    expect(output).not.toContain("rbst_environment-secret");
  });

  it("propagates credential-store deletion failures", async () => {
    const mocks = makeDependencies();
    vi.mocked(mocks.store.delete).mockRejectedValue(new Error("delete failed"));
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await expect(runLogout(mocks.dependencies)).rejects.toThrow(
      "delete failed",
    );
    expect(mocks.dependencies.deleteLink).toHaveBeenCalledOnce();
    expect(log).not.toHaveBeenCalled();
  });
});
