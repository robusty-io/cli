import { afterEach, describe, expect, it, vi } from "vitest";
import { CliError } from "./errors";
import { selectProject } from "./project-selection";
import type { CliProjectSummary } from "./projects";

const projects: CliProjectSummary[] = [
  { uid: "project-1", name: "Alpha" },
  { uid: "project-2", name: "Beta" },
];

const stdinIsTty = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
const stdoutIsTty = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");

function makeTerminalInteractive(): void {
  Object.defineProperty(process.stdin, "isTTY", {
    configurable: true,
    value: true,
  });
  Object.defineProperty(process.stdout, "isTTY", {
    configurable: true,
    value: true,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  if (stdinIsTty) Object.defineProperty(process.stdin, "isTTY", stdinIsTty);
  else Reflect.deleteProperty(process.stdin, "isTTY");
  if (stdoutIsTty) Object.defineProperty(process.stdout, "isTTY", stdoutIsTty);
  else Reflect.deleteProperty(process.stdout, "isTTY");
});

describe("selectProject", () => {
  it("rejects accounts with no accessible projects", async () => {
    await expect(selectProject([])).rejects.toThrow(
      "Your Robusty account has no accessible projects.",
    );
  });

  it("matches a UID before considering exact names", async () => {
    const uidMatch = { uid: "shared", name: "UID winner" };
    const nameMatch = { uid: "other", name: "shared" };

    await expect(
      selectProject([nameMatch, uidMatch], { project: "shared" }),
    ).resolves.toBe(uidMatch);
  });

  it("matches one exact project name", async () => {
    await expect(selectProject(projects, { project: "Beta" })).resolves.toEqual(
      projects[1],
    );
  });

  it("rejects an ambiguous exact name and asks for a UID", async () => {
    await expect(
      selectProject(
        [
          { uid: "project-1", name: "Duplicate" },
          { uid: "project-2", name: "Duplicate" },
        ],
        { project: "Duplicate" },
      ),
    ).rejects.toThrow(
      'More than one project is named "Duplicate". Use its UID instead.',
    );
  });

  it("rejects a missing UID or exact name", async () => {
    await expect(selectProject(projects, { project: "alpha" })).rejects.toThrow(
      'No accessible project matches "alpha".',
    );
  });

  it("automatically selects the only project noninteractively", async () => {
    const only = projects[0] as CliProjectSummary;
    const prompt = vi.fn<(choices: CliProjectSummary[]) => Promise<string>>();

    await expect(
      selectProject([only], { interactive: false, prompt }),
    ).resolves.toBe(only);
    expect(prompt).not.toHaveBeenCalled();
  });

  it("requires --project for multiple projects in noninteractive mode", async () => {
    const prompt = vi.fn<(choices: CliProjectSummary[]) => Promise<string>>();

    await expect(
      selectProject(projects, { interactive: false, prompt }),
    ).rejects.toThrow(
      "Multiple projects are available. Pass --project <uid-or-exact-name>.",
    );
    expect(prompt).not.toHaveBeenCalled();
  });

  it("prompts with all projects and resolves the returned UID", async () => {
    makeTerminalInteractive();
    const prompt = vi
      .fn<(choices: CliProjectSummary[]) => Promise<string>>()
      .mockResolvedValue("project-2");

    await expect(selectProject(projects, { prompt })).resolves.toEqual(
      projects[1],
    );
    expect(prompt).toHaveBeenCalledWith(projects);
  });

  it("treats an unknown prompted UID as cancellation", async () => {
    makeTerminalInteractive();
    const prompt = vi
      .fn<(choices: CliProjectSummary[]) => Promise<string>>()
      .mockResolvedValue("unknown");

    const error = await selectProject(projects, { prompt }).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(CliError);
    expect(error).toMatchObject({
      message: "Project selection was cancelled.",
    });
  });
});
