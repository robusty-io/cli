import { describe, expect, it, vi } from "vitest";
import { createLaunchRenderer } from "./ui";

const spinnerMocks = vi.hoisted(() => {
  const start = vi.fn();
  const spinner = {
    text: "",
    start,
    stop: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
  };
  start.mockImplementation(() => spinner);

  return { create: vi.fn(() => spinner), spinner };
});

vi.mock("yocto-spinner", () => ({ default: spinnerMocks.create }));

describe("createLaunchRenderer", () => {
  it("uses yocto-spinner for TTY progress", () => {
    const write = vi.fn();
    const output = { isTTY: true, write };
    const renderer = createLaunchRenderer(2, output);

    renderer.start();
    renderer.update({
      total: 2,
      passed: 1,
      failed: 0,
      running: 1,
      tests: [
        { testCaseUid: "login", testCaseSlug: "login-flow", status: "passed" },
      ],
    });
    renderer.finish(
      {
        total: 2,
        passed: 2,
        failed: 0,
        running: 0,
        incomplete: 0,
        tests: [
          {
            testCaseUid: "login",
            testCaseSlug: "login-flow",
            status: "passed",
          },
          {
            testCaseUid: "checkout",
            testCaseSlug: "checkout-flow",
            status: "passed",
          },
        ],
      },
      "https://www.robusty.io/project/project-1/launches/launch-1",
    );

    expect(spinnerMocks.create).toHaveBeenCalledWith({
      text: "Running 2 tests: 0 passed, 0 failed, 2 remaining",
      color: "yellow",
      stream: output,
      handleSignals: false,
    });
    expect(spinnerMocks.spinner.start).toHaveBeenCalledOnce();
    expect(spinnerMocks.spinner.text).toBe(
      "Running 2 tests: 1 passed, 0 failed, 1 remaining",
    );
    expect(spinnerMocks.spinner.success).toHaveBeenCalledWith(
      "Test suite passed: 2 passed, 0 failed cases.",
    );
    expect(write).not.toHaveBeenCalled();
  });

  it("prints stable progress and failed-test details outside a TTY", () => {
    const write = vi.fn();
    const renderer = createLaunchRenderer(2, { isTTY: false, write });

    renderer.start();
    renderer.update({
      total: 2,
      passed: 1,
      failed: 1,
      running: 0,
      tests: [
        { testCaseUid: "login", testCaseSlug: "login-flow", status: "passed" },
        {
          testCaseUid: "8119525e-b766-4753-9ba4-2e2eb9f03a71",
          testCaseSlug: "checkout-flow",
          status: "failed",
          conclusion:
            "Button stayed disabled\nbecause payment details were invalid",
        },
      ],
    });
    renderer.finish(
      {
        total: 2,
        passed: 1,
        failed: 1,
        running: 0,
        incomplete: 0,
        tests: [
          {
            testCaseUid: "login",
            testCaseSlug: "login-flow",
            status: "passed",
          },
          {
            testCaseUid: "8119525e-b766-4753-9ba4-2e2eb9f03a71",
            testCaseSlug: "checkout-flow",
            status: "failed",
            conclusion:
              "Button stayed disabled\nbecause payment details were invalid",
          },
        ],
      },
      "https://www.robusty.io/project/project-1/launches/launch-1",
    );

    expect(write.mock.calls.flat().join("")).toBe(
      [
        "Running 2 tests...",
        "[PASS] login-flow",
        "Test suite failed: 1 passed, 1 failed cases.",
        "",
        "Failed tests (1):",
        "- checkout-flow: Button stayed disabled because payment details were invalid.",
        "",
        "View full logs: https://www.robusty.io/project/project-1/launches/launch-1",
        "",
      ].join("\n"),
    );
  });
});
