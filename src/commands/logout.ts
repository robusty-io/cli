import { defineCommand } from "citty";
import type { Config } from "../config";
import { loadConfig } from "../config";
import type { CredentialStore } from "../auth/credential-store";
import { createCredentialStore } from "../auth/credential-store";
import { deleteProjectLink } from "../project-link";

export interface LogoutDependencies {
  loadConfig: () => Config;
  createStore: (config: Config) => CredentialStore;
  deleteLink: (directory: string) => Promise<boolean>;
  cwd: () => string;
}

const defaultDependencies: LogoutDependencies = {
  loadConfig,
  createStore: createCredentialStore,
  deleteLink: deleteProjectLink,
  cwd: process.cwd,
};

export async function runLogout(
  dependencies: LogoutDependencies = defaultDependencies,
): Promise<void> {
  const config = dependencies.loadConfig();
  const store = dependencies.createStore(config);
  const [, removedLink] = await Promise.all([
    store.delete(),
    dependencies.deleteLink(dependencies.cwd()),
  ]);

  console.log(
    removedLink
      ? "Logged out locally and removed the project link."
      : "Logged out locally. No project link was found.",
  );
  console.log(
    "Revoke the server token separately in Account Settings if needed.",
  );

  if (config.token) {
    console.error(
      "Warning: ROBUSTY_TOKEN is still set in your environment and will continue to authenticate commands.",
    );
  }
}

export default defineCommand({
  meta: {
    name: "logout",
    description: "Delete the saved browser login and project link",
  },
  async run() {
    await runLogout();
  },
});
