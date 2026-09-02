import { CliError } from "../errors";
import type { CliProjectSummary } from "./api";

export interface SelectProjectOptions {
  project?: string;
  interactive?: boolean;
  prompt?: (projects: CliProjectSummary[]) => Promise<string>;
}

async function defaultPrompt(projects: CliProjectSummary[]): Promise<string> {
  const { default: select } = await import("@inquirer/select");
  return select({
    message: "Select a Robusty project to link",
    choices: projects.map((project) => ({
      name: project.name,
      value: project.uid,
      description: project.uid,
    })),
  });
}

export async function selectProject(
  projects: CliProjectSummary[],
  options: SelectProjectOptions = {},
): Promise<CliProjectSummary> {
  if (projects.length === 0) {
    throw new CliError("Your Robusty account has no accessible projects.");
  }

  if (options.project) {
    const byUid = projects.find((project) => project.uid === options.project);
    if (byUid) return byUid;
    const byName = projects.filter(
      (project) => project.name === options.project,
    );
    if (byName.length === 1) return byName[0] as CliProjectSummary;
    if (byName.length > 1) {
      throw new CliError(
        `More than one project is named "${options.project}". Use its UID instead.`,
      );
    }
    throw new CliError(`No accessible project matches "${options.project}".`);
  }

  if (projects.length === 1) return projects[0] as CliProjectSummary;
  if (
    options.interactive === false ||
    !process.stdin.isTTY ||
    !process.stdout.isTTY
  ) {
    throw new CliError(
      "Multiple projects are available. Pass --project <uid-or-exact-name>.",
    );
  }

  let uid: string;
  try {
    uid = await (options.prompt ?? defaultPrompt)(projects);
  } catch (error) {
    if (error instanceof Error && error.name === "ExitPromptError") {
      throw new CliError("Project selection was cancelled.");
    }
    throw error;
  }
  const selected = projects.find((project) => project.uid === uid);
  if (!selected) throw new CliError("Project selection was cancelled.");
  return selected;
}
