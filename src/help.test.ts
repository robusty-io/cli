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

  it("leads local users to browser login and describes the CI token", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await showUsage(
      defineCommand({
        meta: { name: "test", description: "Test command" },
      }),
    );

    const output = logSpy.mock.calls[0]?.[0] as string;
    expect(output).toContain("robusty login");
    expect(output).toContain("For CI");
    expect(output).not.toContain("export ROBUSTY_TOKEN=");

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
    expect(output).not.toContain("ROBUSTY_WEB_URL");

    logSpy.mockRestore();
  });

  it("appends an EXAMPLES section to the launch subcommand help", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const parent = defineCommand({
      meta: { name: "root", description: "Root command" },
    });

    await showUsage(
      defineCommand({
        meta: { name: "launch", description: "Start a test suite launch" },
      }),
      parent,
    );

    const output = logSpy.mock.calls[0]?.[0] as string;
    expect(output).toContain("EXAMPLES");
    expect(output).toContain(
      "robusty launch --suite=mt2lv --var=PROJECT_URL=https://robusty-pr-60.railway.app",
    );

    logSpy.mockRestore();
  });

  it("omits the EXAMPLES section for subcommands without examples", async () => {
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
    expect(output).not.toContain("EXAMPLES");

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
