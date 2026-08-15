import { describe, expect, it } from "vitest";
import { loadConfig } from "./config";
import { CliError } from "./errors";

describe("loadConfig", () => {
  it("uses the default launcher URL and no token when nothing is set", () => {
    const config = loadConfig({});

    expect(config.launcherUrl).toBe("https://launcher.robusty.io");
    expect(config.token).toBeUndefined();
  });

  it("reads overrides from the environment", () => {
    const config = loadConfig({
      ROBUSTY_LAUNCHER_URL: "https://launcher-staging.robusty.io",
      ROBUSTY_TOKEN: "rbst_test-token",
    });

    expect(config.launcherUrl).toBe("https://launcher-staging.robusty.io");
    expect(config.token).toBe("rbst_test-token");
  });

  it("strips trailing slashes from the configured launcher URL", () => {
    const config = loadConfig({
      ROBUSTY_LAUNCHER_URL: "https://launcher.robusty.io///",
    });

    expect(config.launcherUrl).toBe("https://launcher.robusty.io");
  });

  it("treats an empty or whitespace-only token as unset", () => {
    expect(loadConfig({ ROBUSTY_TOKEN: "" }).token).toBeUndefined();
    expect(loadConfig({ ROBUSTY_TOKEN: "   " }).token).toBeUndefined();
  });

  it("trims whitespace around a configured token", () => {
    expect(loadConfig({ ROBUSTY_TOKEN: "  rbst_abc  " }).token).toBe(
      "rbst_abc",
    );
  });

  it("rejects an invalid ROBUSTY_LAUNCHER_URL", () => {
    expect(() => loadConfig({ ROBUSTY_LAUNCHER_URL: "not-a-url" })).toThrow(
      CliError,
    );
  });

  it("rejects a non-http(s) URL scheme", () => {
    expect(() =>
      loadConfig({ ROBUSTY_LAUNCHER_URL: "ftp://launcher.robusty.io" }),
    ).toThrow(CliError);
  });
});
