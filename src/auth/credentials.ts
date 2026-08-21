import type { Config } from "../config";
import { createCredentialStore } from "./credential-store";
import type { CredentialStore } from "./credential-store";

export type ResolvedCredential =
  | { source: "environment"; token: string }
  | {
      source: "stored";
      token: string;
      user: { id: string; email: string };
    };

export async function resolveCredential(
  config: Config,
  store: CredentialStore = createCredentialStore(config),
): Promise<ResolvedCredential | undefined> {
  if (config.token) return { source: "environment", token: config.token };

  const stored = await store.get();

  return stored ? { source: "stored", ...stored } : undefined;
}
