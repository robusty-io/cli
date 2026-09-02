import { defineCommand } from "citty";
import type { Config } from "../config";
import { loadConfig } from "../config";
import type {
  CredentialStore,
  StoredCredential,
} from "../auth/credential-store";
import { createCredentialStore } from "../auth/credential-store";
import {
  authorizeInBrowser,
  exchangeAuthorizationCode,
} from "../auth/browser-auth";
import { resolveProjectLink, writeProjectLink } from "../project/link";
import { selectProject } from "../project/selection";
import { fetchProjects } from "../project/api";

export interface LoginDependencies {
  loadConfig: () => Config;
  createStore: (config: Config) => CredentialStore;
  authorize: typeof authorizeInBrowser;
  exchange: typeof exchangeAuthorizationCode;
  openBrowser: (url: string) => Promise<unknown>;
  fetchProjects: typeof fetchProjects;
  selectProject: typeof selectProject;
  resolveLink: typeof resolveProjectLink;
  writeLink: typeof writeProjectLink;
  cwd: () => string;
}

async function defaultOpenBrowser(url: string): Promise<unknown> {
  const { default: open } = await import("open");
  return open(url);
}

const defaultDependencies: LoginDependencies = {
  loadConfig,
  createStore: createCredentialStore,
  authorize: authorizeInBrowser,
  exchange: exchangeAuthorizationCode,
  openBrowser: defaultOpenBrowser,
  fetchProjects,
  selectProject,
  resolveLink: resolveProjectLink,
  writeLink: writeProjectLink,
  cwd: process.cwd,
};

export async function runLogin(
  browser: boolean,
  dependencies: LoginDependencies = defaultDependencies,
): Promise<void> {
  const config = dependencies.loadConfig();
  const store = dependencies.createStore(config);

  const { code, verifier } = await dependencies.authorize(config, {
    browser,
    openBrowser: dependencies.openBrowser,
  });
  const credential: StoredCredential = await dependencies.exchange(
    config,
    code,
    verifier,
  );

  await store.set(credential);

  console.log(`Logged in as ${credential.user.email}.`);

  try {
    const projects = await dependencies.fetchProjects(config, credential.token);
    const existing = await dependencies.resolveLink(dependencies.cwd());

    if (
      existing &&
      projects.some((project) => project.uid === existing.projectId)
    ) {
      console.log(`Linked project: ${existing.projectName}.`);
      return;
    }

    const project = await dependencies.selectProject(projects);

    await dependencies.writeLink(dependencies.cwd(), project);

    console.log(`Linked this directory to ${project.name}.`);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Project linking was cancelled.";

    console.error(
      `Login succeeded, but this directory was not linked: ${message}`,
    );
    console.error("Run robusty link to finish setup.");
  }
}

export function shouldOpenBrowser(rawArgs: string[]): boolean {
  return !rawArgs.includes("--no-browser");
}

export default defineCommand({
  meta: {
    name: "login",
    description: "Authenticate in a browser and link this directory",
  },
  args: {
    "no-browser": {
      type: "boolean",
      description: "Print the authorization URL without opening a browser",
    },
  },
  async run({ rawArgs }) {
    await runLogin(shouldOpenBrowser(rawArgs));
  },
});
