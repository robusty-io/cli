import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  CredentialStore,
  StoredCredential,
} from "../auth/credential-store";
import type { Config } from "../config";
import { ApiError, CliError } from "../errors";
import type { CliProjectSummary } from "../projects";
import { runLink } from "./link";
import type { LinkDependencies } from "./link";

const config: Config = {
  webUrl: "https://www.robusty.io",
  launcherUrl: "https://launcher.robusty.io",
  token: "rbst_environment-secret",
};

const credential: StoredCredential = {
  token: "rbst_stored-secret",
  user: { id: "user-1", email: "user@example.com" },
};

const project: CliProjectSummary = { uid: "project-1", name: "Main Project" };

function makeDependencies(stored: StoredCredential | null = credential) {
  const store: CredentialStore = {
    get: vi
      .fn<CredentialStore["get"]>()
      .mockResolvedValue(stored === null ? undefined : stored),
    set: vi.fn<CredentialStore["set"]>(),
    delete: vi.fn<CredentialStore["delete"]>(),
  };
  const fetchProjects = vi
    .fn<LinkDependencies["fetchProjects"]>()
    .mockResolvedValue([project]);
  const selectProject = vi
    .fn<LinkDependencies["selectProject"]>()
    .mockResolvedValue(project);
  const writeLink = vi.fn<LinkDependencies["writeLink"]>().mockResolvedValue({
    projectId: project.uid,
    projectName: project.name,
  });
  const dependencies: LinkDependencies = {
    loadConfig: vi.fn(() => config),
    createStore: vi.fn(() => store),
    fetchProjects,
    selectProject,
    writeLink,
    cwd: vi.fn(() => "/workspace/project"),
  };
  return { dependencies, store, fetchProjects, selectProject, writeLink };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runLink", () => {
  it("requires a stored browser login even when ROBUSTY_TOKEN is set", async () => {
    const mocks = makeDependencies(null);

    const error = await runLink(undefined, mocks.dependencies).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(CliError);
    expect(error).toMatchObject({
      message: "You are not logged in. Run robusty login first.",
    });
    expect(mocks.fetchProjects).not.toHaveBeenCalled();
    expect(mocks.selectProject).not.toHaveBeenCalled();
    expect(mocks.writeLink).not.toHaveBeenCalled();
  });

  it("uses the stored token and passes an explicit project selector", async () => {
    const mocks = makeDependencies();
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await runLink("Main Project", mocks.dependencies);

    expect(mocks.fetchProjects).toHaveBeenCalledWith(
      config,
      "rbst_stored-secret",
    );
    expect(mocks.selectProject).toHaveBeenCalledWith([project], {
      project: "Main Project",
    });
    expect(mocks.writeLink).toHaveBeenCalledWith("/workspace/project", project);
    expect(log).toHaveBeenCalledWith("Linked this directory to Main Project.");
  });

  it("uses interactive selection options when no project was requested", async () => {
    const mocks = makeDependencies();
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    await runLink(undefined, mocks.dependencies);

    expect(mocks.selectProject).toHaveBeenCalledWith([project], {});
  });

  it("deletes the stored credential after a confirmed 401", async () => {
    const mocks = makeDependencies();
    const apiError = new ApiError("invalid login", 401, "unauthorized");
    mocks.fetchProjects.mockRejectedValue(apiError);

    await expect(runLink(undefined, mocks.dependencies)).rejects.toBe(apiError);
    expect(mocks.store.delete).toHaveBeenCalledOnce();
    expect(mocks.selectProject).not.toHaveBeenCalled();
    expect(mocks.writeLink).not.toHaveBeenCalled();
  });

  it("retains the stored credential for non-authentication API errors", async () => {
    const mocks = makeDependencies();
    const apiError = new ApiError(
      "temporarily unavailable",
      500,
      "authentication_unavailable",
    );
    mocks.fetchProjects.mockRejectedValue(apiError);

    await expect(runLink(undefined, mocks.dependencies)).rejects.toBe(apiError);
    expect(mocks.store.delete).not.toHaveBeenCalled();
  });
});
