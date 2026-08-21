import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../config";
import { CliError } from "../errors";
import {
  createCredentialStore,
  credentialEnvironmentId,
  defaultConfigDirectory,
} from "./credential-store";
import type { KeyringEntry, StoredCredential } from "./credential-store";

const productionConfig: Config = {
  webUrl: "https://www.robusty.io",
  launcherUrl: "https://launcher.robusty.io",
  token: undefined,
};

const stagingConfig: Config = {
  webUrl: "https://staging.robusty.io",
  launcherUrl: "https://launcher-staging.robusty.io",
  token: undefined,
};

const credential: StoredCredential = {
  token: "rbst_stored-secret",
  user: { id: "user-1", email: "user@example.com" },
};

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "robusty-auth-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

function unavailableKeyring(): Promise<never> {
  return Promise.reject(new Error("keyring unavailable"));
}

function memoryEntry(initialPassword: string | null = null): {
  entry: KeyringEntry;
  getPassword: ReturnType<typeof vi.fn>;
  setPassword: ReturnType<typeof vi.fn>;
  deletePassword: ReturnType<typeof vi.fn>;
} {
  let password = initialPassword;
  const getPassword = vi.fn(() => password);
  const setPassword = vi.fn((value: string) => {
    password = value;
  });
  const deletePassword = vi.fn(() => {
    const existed = password !== null;
    password = null;
    return existed;
  });
  return {
    entry: { getPassword, setPassword, deletePassword },
    getPassword,
    setPassword,
    deletePassword,
  };
}

async function fallbackFile(
  configDirectory: string,
): Promise<Record<string, string>> {
  return JSON.parse(
    await readFile(join(configDirectory, "auth.json"), "utf8"),
  ) as Record<string, string>;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
  vi.restoreAllMocks();
});

describe("credentialEnvironmentId", () => {
  it("is a stable SHA-256 identifier for both environment URLs", () => {
    expect(credentialEnvironmentId(productionConfig)).toBe(
      "3a40c590501e64605dc01df3a0e161fbbfafc6a5ebf01adddb6e123336650380",
    );
    expect(credentialEnvironmentId(stagingConfig)).toBe(
      "567bcc80a4d8e155139ad52079e72a0da68eafdb85ca17c29239922c6d2e9f3a",
    );
  });

  it("changes when either service URL changes and ignores the environment token", () => {
    const original = credentialEnvironmentId(productionConfig);
    expect(
      credentialEnvironmentId({
        ...productionConfig,
        webUrl: "https://other.robusty.io",
      }),
    ).not.toBe(original);
    expect(
      credentialEnvironmentId({
        ...productionConfig,
        launcherUrl: "https://other-launcher.robusty.io",
      }),
    ).not.toBe(original);
    expect(
      credentialEnvironmentId({ ...productionConfig, token: "rbst_override" }),
    ).toBe(original);
  });
});

describe("defaultConfigDirectory", () => {
  it("uses the native macOS application support directory", () => {
    expect(defaultConfigDirectory("darwin", {}, "/Users/tester")).toBe(
      "/Users/tester/Library/Application Support/robusty",
    );
  });

  it("uses APPDATA on Windows and falls back to the roaming profile", () => {
    expect(
      defaultConfigDirectory(
        "win32",
        { APPDATA: "C:\\Users\\tester\\AppData\\Custom" },
        "C:\\Users\\tester",
      ),
    ).toBe("C:\\Users\\tester\\AppData\\Custom\\Robusty");
    expect(
      defaultConfigDirectory("win32", { APPDATA: "  " }, "C:\\Users\\tester"),
    ).toBe("C:\\Users\\tester\\AppData\\Roaming\\Robusty");
  });

  it("uses XDG_CONFIG_HOME on other platforms and falls back to ~/.config", () => {
    expect(
      defaultConfigDirectory(
        "linux",
        { XDG_CONFIG_HOME: "/xdg" },
        "/home/tester",
      ),
    ).toBe("/xdg/robusty");
    expect(
      defaultConfigDirectory("linux", { XDG_CONFIG_HOME: " " }, "/home/tester"),
    ).toBe("/home/tester/.config/robusty");
  });
});

describe("native credential storage", () => {
  it("writes, reads, and deletes a serialized credential through the adapter", async () => {
    const configDirectory = await temporaryDirectory();
    const adapter = memoryEntry();
    const createEntry = vi.fn(async () => adapter.entry);
    const store = createCredentialStore(productionConfig, {
      configDir: configDirectory,
      createKeyringEntry: createEntry,
    });

    await store.set(credential);

    expect(adapter.setPassword).toHaveBeenCalledOnce();
    expect(adapter.setPassword).toHaveBeenCalledWith(
      JSON.stringify(credential),
    );
    await expect(store.get()).resolves.toEqual(credential);
    expect(adapter.getPassword).toHaveBeenCalledOnce();
    await expect(store.delete()).resolves.toBeUndefined();
    expect(adapter.deletePassword).toHaveBeenCalledOnce();
    await expect(store.get()).resolves.toBeUndefined();
    expect(createEntry).toHaveBeenCalledTimes(4);
    await expect(
      stat(join(configDirectory, "auth.json")),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("falls back to the file when a native credential is absent or malformed", async () => {
    const configDirectory = await temporaryDirectory();
    const fallbackStore = createCredentialStore(productionConfig, {
      configDir: configDirectory,
      createKeyringEntry: unavailableKeyring,
    });
    await fallbackStore.set(credential);

    const emptyNative = memoryEntry();
    const emptyStore = createCredentialStore(productionConfig, {
      configDir: configDirectory,
      createKeyringEntry: async () => emptyNative.entry,
    });
    await expect(emptyStore.get()).resolves.toEqual(credential);

    const malformedNative = memoryEntry('{"token":12}');
    const malformedStore = createCredentialStore(productionConfig, {
      configDir: configDirectory,
      createKeyringEntry: async () => malformedNative.entry,
    });
    await expect(malformedStore.get()).resolves.toEqual(credential);
  });

  it("uses the fallback when native get or set operations throw", async () => {
    const configDirectory = await temporaryDirectory();
    const entry: KeyringEntry = {
      getPassword: () => {
        throw new Error("native read failed with rbst_native-secret");
      },
      setPassword: () => {
        throw new Error("native write failed with rbst_native-secret");
      },
      deletePassword: () => false,
    };
    const warn = vi.fn<(message: string) => void>();
    const store = createCredentialStore(productionConfig, {
      configDir: configDirectory,
      createKeyringEntry: async () => entry,
      warn,
    });

    await store.set(credential);
    await expect(store.get()).resolves.toEqual(credential);
    const contents = await readFile(join(configDirectory, "auth.json"), "utf8");
    expect(contents).toContain("rbst_stored-secret");
    for (const call of warn.mock.calls) {
      expect(call[0]).not.toContain("rbst_stored-secret");
      expect(call[0]).not.toContain("rbst_native-secret");
    }
  });

  it("warns when a runtime native read failure requires the fallback", async () => {
    vi.resetModules();
    const { createCredentialStore: createFreshCredentialStore } =
      await import("./credential-store");
    const configDirectory = await temporaryDirectory();
    const warn = vi.fn<(message: string) => void>();
    const entry: KeyringEntry = {
      getPassword: () => {
        throw new Error("native read failed");
      },
      setPassword: () => undefined,
      deletePassword: () => false,
    };
    const store = createFreshCredentialStore(productionConfig, {
      configDir: configDirectory,
      createKeyringEntry: async () => entry,
      warn,
    });

    await expect(store.get()).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(
      "Warning: the system credential store is unavailable; using a protected global file instead.",
    );
  });
});

describe("fallback credential storage", () => {
  it("round-trips credentials in an environment-keyed global file", async () => {
    const root = await temporaryDirectory();
    const configDirectory = join(root, "nested", "config");
    const warn = vi.fn<(message: string) => void>();
    const store = createCredentialStore(productionConfig, {
      configDir: configDirectory,
      createKeyringEntry: unavailableKeyring,
      warn,
    });

    await store.set(credential);
    await expect(store.get()).resolves.toEqual(credential);

    const records = await fallbackFile(configDirectory);
    expect(Object.keys(records)).toEqual([
      credentialEnvironmentId(productionConfig),
    ]);
    expect(
      JSON.parse(records[credentialEnvironmentId(productionConfig)]!),
    ).toEqual(credential);
    expect(await readdir(configDirectory)).toEqual(["auth.json"]);
  });

  it("creates the fallback directory and file with user-only permissions", async () => {
    const root = await temporaryDirectory();
    const configDirectory = join(root, "new-config");
    const store = createCredentialStore(productionConfig, {
      configDir: configDirectory,
      createKeyringEntry: unavailableKeyring,
    });

    await store.set(credential);

    if (process.platform !== "win32") {
      expect((await stat(configDirectory)).mode & 0o777).toBe(0o700);
      expect(
        (await stat(join(configDirectory, "auth.json"))).mode & 0o777,
      ).toBe(0o600);
    }
  });

  it("isolates credentials by the web and launcher environment pair", async () => {
    const configDirectory = await temporaryDirectory();
    const productionStore = createCredentialStore(productionConfig, {
      configDir: configDirectory,
      createKeyringEntry: unavailableKeyring,
    });
    const stagingStore = createCredentialStore(stagingConfig, {
      configDir: configDirectory,
      createKeyringEntry: unavailableKeyring,
    });
    const stagingCredential: StoredCredential = {
      token: "rbst_staging-secret",
      user: { id: "staging-user", email: "staging@example.com" },
    };

    await productionStore.set(credential);
    await stagingStore.set(stagingCredential);

    await expect(productionStore.get()).resolves.toEqual(credential);
    await expect(stagingStore.get()).resolves.toEqual(stagingCredential);
    const records = await fallbackFile(configDirectory);
    expect(Object.keys(records).toSorted()).toEqual(
      [
        credentialEnvironmentId(productionConfig),
        credentialEnvironmentId(stagingConfig),
      ].toSorted(),
    );
  });

  it("deletes only the selected environment and removes the empty file", async () => {
    const configDirectory = await temporaryDirectory();
    const productionStore = createCredentialStore(productionConfig, {
      configDir: configDirectory,
      createKeyringEntry: unavailableKeyring,
    });
    const stagingStore = createCredentialStore(stagingConfig, {
      configDir: configDirectory,
      createKeyringEntry: unavailableKeyring,
    });
    await productionStore.set(credential);
    await stagingStore.set({
      token: "rbst_staging-secret",
      user: { id: "staging-user", email: "staging@example.com" },
    });

    await productionStore.delete();

    await expect(productionStore.get()).resolves.toBeUndefined();
    await expect(stagingStore.get()).resolves.toMatchObject({
      token: "rbst_staging-secret",
    });
    const records = await fallbackFile(configDirectory);
    expect(records[credentialEnvironmentId(productionConfig)]).toBeUndefined();
    expect(records[credentialEnvironmentId(stagingConfig)]).toBeDefined();

    await stagingStore.delete();
    await expect(
      stat(join(configDirectory, "auth.json")),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(stagingStore.delete()).resolves.toBeUndefined();
  });

  it("deletes both native and fallback copies", async () => {
    const configDirectory = await temporaryDirectory();
    const fallbackStore = createCredentialStore(productionConfig, {
      configDir: configDirectory,
      createKeyringEntry: unavailableKeyring,
    });
    await fallbackStore.set(credential);
    const adapter = memoryEntry(JSON.stringify(credential));
    const nativeStore = createCredentialStore(productionConfig, {
      configDir: configDirectory,
      createKeyringEntry: async () => adapter.entry,
    });

    await nativeStore.delete();

    expect(adapter.deletePassword).toHaveBeenCalledOnce();
    await expect(
      stat(join(configDirectory, "auth.json")),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(nativeStore.get()).resolves.toBeUndefined();
  });

  it("uses a new fallback credential when a native write fails over an old native value", async () => {
    const configDirectory = await temporaryDirectory();
    const oldCredential = {
      token: "rbst_old-secret",
      user: { id: "old-user", email: "old@example.com" },
    };
    const entry: KeyringEntry = {
      getPassword: () => JSON.stringify(oldCredential),
      setPassword: () => {
        throw new Error("native write unavailable");
      },
      deletePassword: () => true,
    };
    const store = createCredentialStore(productionConfig, {
      configDir: configDirectory,
      createKeyringEntry: async () => entry,
    });

    await store.set(credential);

    await expect(store.get()).resolves.toEqual(credential);
  });

  it("removes fallback data but reports a sanitized native deletion failure", async () => {
    vi.resetModules();
    const { createCredentialStore: createFreshCredentialStore } =
      await import("./credential-store");
    const configDirectory = await temporaryDirectory();
    const fallbackStore = createFreshCredentialStore(productionConfig, {
      configDir: configDirectory,
      createKeyringEntry: unavailableKeyring,
    });
    await fallbackStore.set(credential);
    const store = createFreshCredentialStore(productionConfig, {
      configDir: configDirectory,
      createKeyringEntry: async () => ({
        getPassword: () => JSON.stringify(credential),
        setPassword: () => undefined,
        deletePassword: () => {
          throw new Error(`failed for ${credential.token}`);
        },
      }),
    });

    await expect(store.delete()).rejects.toThrow(
      "Could not fully delete the local Robusty credential.",
    );
    await expect(
      stat(join(configDirectory, "auth.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("can load the native keyring package", async () => {
    const keyring = await import("@napi-rs/keyring");
    expect(keyring.Entry).toBeTypeOf("function");
  });

  it("treats malformed stored credentials as absent", async () => {
    const configDirectory = await temporaryDirectory();
    const environmentId = credentialEnvironmentId(productionConfig);
    await writeFile(
      join(configDirectory, "auth.json"),
      JSON.stringify({ [environmentId]: '{"token":12,"user":{}}' }),
    );
    const store = createCredentialStore(productionConfig, {
      configDir: configDirectory,
      createKeyringEntry: unavailableKeyring,
    });

    await expect(store.get()).resolves.toBeUndefined();
  });

  it("sanitizes fallback read errors without disclosing file contents", async () => {
    const configDirectory = await temporaryDirectory();
    const leakedValue = "rbst_corrupt-file-secret";
    await writeFile(
      join(configDirectory, "auth.json"),
      `{not-json:${leakedValue}`,
    );
    const store = createCredentialStore(productionConfig, {
      configDir: configDirectory,
      createKeyringEntry: unavailableKeyring,
    });

    let caught: unknown;
    try {
      await store.get();
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(CliError);
    expect((caught as Error).message).toBe(
      "Could not read the local Robusty credential.",
    );
    expect((caught as Error).message).not.toContain(leakedValue);
  });

  it("sanitizes fallback write errors and removes temporary files", async () => {
    const root = await temporaryDirectory();
    const configDirectory = join(root, "config");
    await mkdir(configDirectory);
    await mkdir(join(configDirectory, "auth.json"));
    const store = createCredentialStore(productionConfig, {
      configDir: configDirectory,
      createKeyringEntry: unavailableKeyring,
    });

    let caught: unknown;
    try {
      await store.set(credential);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(CliError);
    expect((caught as Error).message).not.toContain(credential.token);
    expect(
      (await readdir(configDirectory)).filter((name) => name.endsWith(".tmp")),
    ).toEqual([]);
  });
});
