import { createHash } from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, win32 } from "node:path";
import type { Config } from "../config";
import { CliError } from "../errors";
import { fallbackRecordsSchema, storedCredentialSchema } from "../schemas";
import type { StoredCredential } from "../schemas";

export type { StoredCredential } from "../schemas";

export interface CredentialStore {
  get(): Promise<StoredCredential | undefined>;
  set(credential: StoredCredential): Promise<void>;
  delete(): Promise<void>;
}

export interface KeyringEntry {
  getPassword(): string | null;
  setPassword(password: string): void;
  deletePassword(): boolean;
}

export interface CredentialStoreOptions {
  configDir?: string;
  createKeyringEntry?: () => Promise<KeyringEntry>;
  warn?: (message: string) => void;
}

const SERVICE_NAME = "Robusty CLI";
let didWarnAboutFallback = false;

export function credentialEnvironmentId(config: Config): string {
  return createHash("sha256")
    .update(`${config.webUrl}\n${config.launcherUrl}`)
    .digest("hex");
}

export function defaultConfigDirectory(
  platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  home = homedir(),
): string {
  if (platform === "darwin") {
    return join(home, "Library", "Application Support", "robusty");
  }
  if (platform === "win32") {
    return win32.join(
      env.APPDATA?.trim() || win32.join(home, "AppData", "Roaming"),
      "Robusty",
    );
  }
  return join(env.XDG_CONFIG_HOME?.trim() || join(home, ".config"), "robusty");
}

function decodeCredential(value: string): StoredCredential | undefined {
  try {
    const result = storedCredentialSchema.safeParse(JSON.parse(value));

    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}

function sanitizeStorageError(action: string): CliError {
  return new CliError(`Could not ${action} the local Robusty credential.`);
}

async function defaultKeyringEntry(account: string): Promise<KeyringEntry> {
  const { Entry } = await import("@napi-rs/keyring");
  return new Entry(SERVICE_NAME, account);
}

export function createCredentialStore(
  config: Config,
  options: CredentialStoreOptions = {},
): CredentialStore {
  const environmentId = credentialEnvironmentId(config);
  const filePath = join(
    options.configDir ?? defaultConfigDirectory(),
    "auth.json",
  );
  const createEntry =
    options.createKeyringEntry ?? (() => defaultKeyringEntry(environmentId));
  const warn = options.warn ?? console.error;

  function warnAboutFallback(): void {
    if (didWarnAboutFallback) return;

    warn(
      "Warning: the system credential store is unavailable; using a protected global file instead.",
    );
    didWarnAboutFallback = true;
  }

  async function getEntry(): Promise<KeyringEntry | undefined> {
    try {
      return await createEntry();
    } catch {
      warnAboutFallback();
      return undefined;
    }
  }

  async function readFallback(): Promise<StoredCredential | undefined> {
    try {
      const contents = await readFile(filePath, "utf8");
      const result = fallbackRecordsSchema.safeParse(JSON.parse(contents));

      if (!result.success) return undefined;

      const value = result.data[environmentId];

      return value ? decodeCredential(value) : undefined;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw sanitizeStorageError("read");
    }
  }

  async function readFallbackRecords(): Promise<Record<string, string>> {
    try {
      const contents = await readFile(filePath, "utf8");
      const result = fallbackRecordsSchema.safeParse(JSON.parse(contents));

      return result.success ? result.data : {};
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw sanitizeStorageError("read");
    }
  }

  async function writeFallback(records: Record<string, string>): Promise<void> {
    const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;

    try {
      await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
      await chmod(dirname(filePath), 0o700).catch(() => undefined);
      await writeFile(temporaryPath, `${JSON.stringify(records, null, 2)}\n`, {
        mode: 0o600,
        flag: "wx",
      });
      await rename(temporaryPath, filePath);
      await chmod(filePath, 0o600).catch(() => undefined);
    } catch {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      throw sanitizeStorageError("write");
    }
  }

  async function deleteFallback(): Promise<void> {
    const records = await readFallbackRecords();
    if (!(environmentId in records)) return;

    delete records[environmentId];

    if (Object.keys(records).length === 0) {
      try {
        await rm(filePath, { force: true });
      } catch {
        throw sanitizeStorageError("delete");
      }

      return;
    }

    await writeFallback(records);
  }

  return {
    async get() {
      const fallback = await readFallback();
      if (fallback) return fallback;

      const entry = await getEntry();

      if (entry) {
        try {
          const value = entry.getPassword();

          if (value) {
            const credential = decodeCredential(value);

            if (credential) return credential;
          }
        } catch {
          // A runtime keyring failure still permits the global fallback.
          warnAboutFallback();
        }
      }

      return undefined;
    },

    async set(credential) {
      const serialized = JSON.stringify(credential);
      const records = await readFallbackRecords();
      const hasFallback = environmentId in records;

      if (hasFallback) {
        records[environmentId] = serialized;
        await writeFallback(records);
      }

      const entry = await getEntry();

      if (entry) {
        try {
          entry.setPassword(serialized);
        } catch {
          warnAboutFallback();

          if (!hasFallback) {
            records[environmentId] = serialized;
            await writeFallback(records);
          }

          return;
        }

        await deleteFallback();

        return;
      }

      if (!hasFallback) {
        records[environmentId] = serialized;
        await writeFallback(records);
      }
    },

    async delete() {
      const entry = await getEntry();
      let nativeDeleteFailed = false;

      if (entry) {
        try {
          entry.deletePassword();
        } catch {
          nativeDeleteFailed = true;
        }
      }

      await deleteFallback();

      if (nativeDeleteFailed) throw sanitizeStorageError("fully delete");
    },
  };
}
