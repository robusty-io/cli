import { defineCommand } from "citty";
import type { Config } from "../config";
import { loadConfig } from "../config";
import type { CredentialStore } from "../auth/credential-store";
import { createCredentialStore } from "../auth/credential-store";
import { ApiError, CliError } from "../errors";
import { writeProjectLink } from "../project-link";
import { selectProject } from "../project-selection";
import { fetchProjects } from "../projects";

export interface LinkDependencies {
  loadConfig: () => Config;
  createStore: (config: Config) => CredentialStore;
  fetchProjects: typeof fetchProjects;
  selectProject: typeof selectProject;
  writeLink: typeof writeProjectLink;
  cwd: () => string;
}

const defaultDependencies: LinkDependencies = {
  loadConfig,
  createStore: createCredentialStore,
  fetchProjects,
  selectProject,
  writeLink: writeProjectLink,
  cwd: process.cwd,
};

export async function runLink(
  requestedProject: string | undefined,
  dependencies: LinkDependencies = defaultDependencies,
): Promise<void> {
  const config = dependencies.loadConfig();
  const store = dependencies.createStore(config);
  const credential = await store.get();

  if (!credential) {
    throw new CliError("You are not logged in. Run robusty login first.");
  }

  let projects;

  try {
    projects = await dependencies.fetchProjects(config, credential.token);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      await store.delete();
    }

    throw error;
  }

  const project = await dependencies.selectProject(
    projects,
    requestedProject ? { project: requestedProject } : {},
  );

  await dependencies.writeLink(dependencies.cwd(), project);

  console.log(`Linked this directory to ${project.name}.`);
}

export default defineCommand({
  meta: {
    name: "link",
    description: "Link this directory to a Robusty project",
  },
  args: {
    project: {
      type: "string",
      description: "Project UID or exact project name",
    },
  },
  async run({ args }) {
    await runLink(args.project);
  },
});
