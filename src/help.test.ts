import { defineCommand } from "citty";
import { describe, expect, it, vi } from "vitest";
import { showUsage } from "./help";

describe("showUsage", () => {
  it("appends an ENVIRONMENT VARIABLES section to the root help", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await showUsage(
      defineCommand({
        meta: { name: "test", description: "Test command" },
      }),
    );

    expect(logSpy).toHaveBeenCalledTimes(1);
    const output = logSpy.mock.calls[0]?.[0] as string;
    expect(output).toContain("ENVIRONMENT VARIABLES");
    expect(output).toContain("ROBUSTY_TOKEN");

    logSpy.mockRestore();
  });

  it("shows how to obtain and set the token", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await showUsage(
      defineCommand({
        meta: { name: "test", description: "Test command" },
      }),
    );

    const output = logSpy.mock.calls[0]?.[0] as string;
    expect(output).toContain("Project Settings");
    expect(output).toContain("export ROBUSTY_TOKEN=");

    logSpy.mockRestore();
  });

  it("does not mention the internal-only launcher URL override", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await showUsage(
      defineCommand({
        meta: { name: "test", description: "Test command" },
      }),
    );

    const output = logSpy.mock.calls[0]?.[0] as string;
    expect(output).not.toContain("ROBUSTY_LAUNCHER_URL");

    logSpy.mockRestore();
  });

  it("omits the ENVIRONMENT VARIABLES section for subcommand help", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const parent = defineCommand({
      meta: { name: "root", description: "Root command" },
    });

    await showUsage(
      defineCommand({
        meta: { name: "sub", description: "Subcommand" },
      }),
      parent,
    );

    const output = logSpy.mock.calls[0]?.[0] as string;
    expect(output).not.toContain("ENVIRONMENT VARIABLES");
    expect(output).not.toContain("ROBUSTY_TOKEN");

    logSpy.mockRestore();
  });
});
