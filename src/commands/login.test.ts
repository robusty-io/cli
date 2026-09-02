import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  CredentialStore,
  StoredCredential,
} from "../auth/credential-store";
import type { Config } from "../config";
import type { ProjectLink } from "../project/link";
import type { CliProjectSummary } from "../project/api";
import { runLogin, shouldOpenBrowser } from "./login";
import type { LoginDependencies } from "./login";

const config: Config = {
  webUrl: "https://www.robusty.io",
  launcherUrl: "https://launcher.robusty.io",
  token: undefined,
};

const credential: StoredCredential = {
  token: "rbst_user-secret",
  user: { id: "user-1", email: "user@example.com" },
};

const project: CliProjectSummary = { uid: "project-1", name: "Main Project" };

function makeDependencies() {
  const store: CredentialStore = {
    get: vi.fn<CredentialStore["get"]>(),
    set: vi.fn<CredentialStore["set"]>(),
    delete: vi.fn<CredentialStore["delete"]>(),
  };
  const authorize = vi.fn<LoginDependencies["authorize"]>().mockResolvedValue({
    code: "authorization-code",
    verifier: "pkce-verifier",
  });
  const exchange = vi
    .fn<LoginDependencies["exchange"]>()
    .mockResolvedValue(credential);
  const fetchProjects = vi
    .fn<LoginDependencies["fetchProjects"]>()
    .mockResolvedValue([project]);
  const selectProject = vi
    .fn<LoginDependencies["selectProject"]>()
    .mockResolvedValue(project);
  const resolveLink = vi
    .fn<LoginDependencies["resolveLink"]>()
    .mockResolvedValue(undefined);
  const writeLink = vi.fn<LoginDependencies["writeLink"]>().mockResolvedValue({
    projectId: project.uid,
    projectName: project.name,
  });
  const openBrowser = vi.fn(async () => undefined);
  const dependencies: LoginDependencies = {
    loadConfig: vi.fn(() => config),
    createStore: vi.fn(() => store),
    authorize,
    exchange,
    openBrowser,
    fetchProjects,
    selectProject,
    resolveLink,
    writeLink,
    cwd: vi.fn(() => "/workspace/project"),
  };
  return {
    dependencies,
    store,
    authorize,
    exchange,
    fetchProjects,
    selectProject,
    resolveLink,
    writeLink,
    openBrowser,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runLogin", () => {
  it("authenticates, persists the credential, and links a selected project", async () => {
    const mocks = makeDependencies();
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await runLogin(false, mocks.dependencies);

    expect(mocks.authorize).toHaveBeenCalledWith(config, {
      browser: false,
      openBrowser: mocks.openBrowser,
    });
    expect(mocks.exchange).toHaveBeenCalledWith(
      config,
      "authorization-code",
      "pkce-verifier",
    );
    expect(mocks.store.set).toHaveBeenCalledWith(credential);
    expect(mocks.fetchProjects).toHaveBeenCalledWith(config, credential.token);
    expect(mocks.resolveLink).toHaveBeenCalledWith("/workspace/project");
    expect(mocks.selectProject).toHaveBeenCalledWith([project]);
    expect(mocks.writeLink).toHaveBeenCalledWith("/workspace/project", project);
    expect(log).toHaveBeenNthCalledWith(1, "Logged in as user@example.com.");
    expect(log).toHaveBeenNthCalledWith(
      2,
      "Linked this directory to Main Project.",
    );
    expect(vi.mocked(mocks.store.set).mock.invocationCallOrder[0]).toBeLessThan(
      mocks.fetchProjects.mock.invocationCallOrder[0] as number,
    );
  });

  it("preserves an accessible existing project link", async () => {
    const mocks = makeDependencies();
    const existing: ProjectLink = {
      projectId: project.uid,
      projectName: "Previously Linked",
    };
    mocks.resolveLink.mockResolvedValue(existing);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await runLogin(true, mocks.dependencies);

    expect(mocks.selectProject).not.toHaveBeenCalled();
    expect(mocks.writeLink).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith("Linked project: Previously Linked.");
  });

  it("replaces an inaccessible existing link", async () => {
    const mocks = makeDependencies();
    mocks.resolveLink.mockResolvedValue({
      projectId: "inaccessible-project",
      projectName: "Old Project",
    });

    await runLogin(true, mocks.dependencies);

    expect(mocks.selectProject).toHaveBeenCalledWith([project]);
    expect(mocks.writeLink).toHaveBeenCalledWith("/workspace/project", project);
  });

  it("keeps a successful login when project linking fails", async () => {
    const mocks = makeDependencies();
    mocks.selectProject.mockRejectedValue(new Error("selection cancelled"));
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    await expect(runLogin(true, mocks.dependencies)).resolves.toBeUndefined();

    expect(mocks.store.set).toHaveBeenCalledWith(credential);
    expect(error).toHaveBeenNthCalledWith(
      1,
      "Login succeeded, but this directory was not linked: selection cancelled",
    );
    expect(error).toHaveBeenNthCalledWith(
      2,
      "Run robusty link to finish setup.",
    );
  });

  it("does not continue when browser authorization fails", async () => {
    const mocks = makeDependencies();
    mocks.authorize.mockRejectedValue(new Error("browser failed"));

    await expect(runLogin(true, mocks.dependencies)).rejects.toThrow(
      "browser failed",
    );

    expect(mocks.exchange).not.toHaveBeenCalled();
    expect(mocks.store.set).not.toHaveBeenCalled();
    expect(mocks.fetchProjects).not.toHaveBeenCalled();
  });

  it("does not expose authentication secrets in command output", async () => {
    const mocks = makeDependencies();
    mocks.fetchProjects.mockRejectedValue(
      new Error("project service unavailable"),
    );
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    await runLogin(true, mocks.dependencies);

    const output = [...log.mock.calls, ...error.mock.calls].flat().join("\n");
    expect(output).not.toContain(credential.token);
    expect(output).not.toContain("authorization-code");
    expect(output).not.toContain("pkce-verifier");
  });
});

describe("shouldOpenBrowser", () => {
  it("opens the browser by default", () => {
    expect(shouldOpenBrowser([])).toBe(true);
  });

  it("disables browser opening with --no-browser", () => {
    expect(shouldOpenBrowser(["--no-browser"])).toBe(false);
  });
});
