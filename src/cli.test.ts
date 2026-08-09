import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("cli", () => {
  it("prints Hello, World!", () => {
    const output = execFileSync(process.execPath, ["dist/cli.mjs"], {
      encoding: "utf8",
    });

    expect(output.trim()).toBe("Hello, World!");
  });
});
