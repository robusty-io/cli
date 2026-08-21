import { execFileSync, spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("cli", () => {
  it("prints usage when run with no arguments", () => {
    const output = execFileSync(process.execPath, ["dist/cli.mjs"], {
      encoding: "utf8",
    });

    expect(output).toContain("USAGE");
    expect(output).toContain("launch");
    expect(output).toContain("login");
    expect(output).toContain("link");
    expect(output).toContain("logout");
    expect(output).toContain("ENVIRONMENT VARIABLES");
    expect(output).toContain("ROBUSTY_TOKEN");
    expect(output).toContain("robusty login");
  });

  it("omits the ENVIRONMENT VARIABLES section from subcommand help", () => {
    const output = execFileSync(
      process.execPath,
      ["dist/cli.mjs", "launch", "--help"],
      { encoding: "utf8" },
    );

    expect(output).toContain("USAGE");
    expect(output).not.toContain("ENVIRONMENT VARIABLES");
    expect(output).not.toContain("ROBUSTY_TOKEN");
  });

  it("does not run the root command's output after a subcommand", () => {
    const result = spawnSync(
      process.execPath,
      [
        "dist/cli.mjs",
        "launch",
        "--suite",
        "00000000-0000-0000-0000-000000000000",
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          ROBUSTY_TOKEN: "",
          ROBUSTY_WEB_URL: "https://cli-test.invalid",
        },
      },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("robusty login");
    expect(result.stdout).not.toContain("USAGE");
    expect(result.stderr).not.toContain("USAGE");
  });
});
