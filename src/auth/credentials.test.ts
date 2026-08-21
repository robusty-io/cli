import { describe, expect, it, vi } from "vitest";
import type { Config } from "../config";
import type { CredentialStore, StoredCredential } from "./credential-store";
import { resolveCredential } from "./credentials";

function config(token: string | undefined): Config {
  return {
    webUrl: "https://www.robusty.io",
    launcherUrl: "https://launcher.robusty.io",
    token,
  };
}

function storeWith(value: StoredCredential | undefined): {
  store: CredentialStore;
  get: ReturnType<typeof vi.fn>;
} {
  const get = vi.fn(async () => value);
  return {
    store: {
      get,
      set: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined),
    },
    get,
  };
}

describe("resolveCredential", () => {
  it("gives the environment token precedence without reading storage", async () => {
    const stored = storeWith({
      token: "rbst_stored-token",
      user: { id: "user-1", email: "user@example.com" },
    });

    await expect(
      resolveCredential(config("rbst_environment-token"), stored.store),
    ).resolves.toEqual({
      source: "environment",
      token: "rbst_environment-token",
    });
    expect(stored.get).not.toHaveBeenCalled();
  });

  it("returns the stored token and user metadata when no environment token exists", async () => {
    const stored = storeWith({
      token: "rbst_stored-token",
      user: { id: "user-1", email: "user@example.com" },
    });

    await expect(
      resolveCredential(config(undefined), stored.store),
    ).resolves.toEqual({
      source: "stored",
      token: "rbst_stored-token",
      user: { id: "user-1", email: "user@example.com" },
    });
    expect(stored.get).toHaveBeenCalledOnce();
  });

  it("returns undefined when neither credential source is available", async () => {
    const stored = storeWith(undefined);

    await expect(
      resolveCredential(config(undefined), stored.store),
    ).resolves.toBeUndefined();
    expect(stored.get).toHaveBeenCalledOnce();
  });

  it("treats a blank direct config token as absent", async () => {
    const stored = storeWith({
      token: "rbst_stored-token",
      user: { id: "user-1", email: "user@example.com" },
    });

    await expect(
      resolveCredential(config(""), stored.store),
    ).resolves.toMatchObject({
      source: "stored",
      token: "rbst_stored-token",
    });
    expect(stored.get).toHaveBeenCalledOnce();
  });
});
