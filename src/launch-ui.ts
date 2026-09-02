import type { Writable } from "node:stream";
import yoctoSpinner from "yocto-spinner";
import type { Spinner } from "yocto-spinner";
import type { LaunchProgress, LaunchResult } from "./launch-observer";

interface OutputStream {
  isTTY?: boolean;
  write: (chunk: string) => unknown;
}

export interface LaunchRenderer {
  start: () => void;
  update: (progress: LaunchProgress) => void;
  finish: (result: LaunchResult, launchUrl: string) => void;
  stop: () => void;
}

function progressLine(progress: LaunchProgress): string {
  return `Running ${progress.total} tests: ${progress.passed} passed, ${progress.failed} failed, ${progress.running} remaining`;
}

function failureLine(test: LaunchResult["tests"][number]): string {
  const conclusion =
    test.conclusion?.trim().replace(/\s+/g, " ") || "Test failed";
  const punctuation = /[.!?]$/.test(conclusion) ? "" : ".";
  return `- ${test.testCaseSlug}: ${conclusion}${punctuation}\n`;
}

export function createLaunchRenderer(
  total: number,
  output: OutputStream = process.stdout,
): LaunchRenderer {
  const tty = output.isTTY === true;
  const printed = new Set<string>();
  let progress: LaunchProgress = {
    total,
    passed: 0,
    failed: 0,
    running: total,
    tests: [],
  };
  let spinner: Spinner | undefined;

  const stopSpinner = () => {
    spinner?.stop();
    spinner = undefined;
  };

  return {
    start() {
      if (!tty) {
        output.write(`Running ${total} tests...\n`);
        return;
      }

      spinner = yoctoSpinner({
        text: progressLine(progress),
        color: "yellow",
        stream: output as Writable,
        handleSignals: false,
      }).start();
    },

    update(nextProgress) {
      progress = nextProgress;
      if (spinner) {
        spinner.text = progressLine(progress);
        return;
      }

      if (tty) return;

      for (const test of progress.tests) {
        if (test.status !== "passed" || printed.has(test.testCaseUid)) continue;
        printed.add(test.testCaseUid);
        output.write(`[PASS] ${test.testCaseSlug}\n`);
      }
    },

    finish(result, launchUrl) {
      progress = result;
      const outcome = result.failed === 0 ? "passed" : "failed";
      const summary = `Test suite ${outcome}: ${result.passed} passed, ${result.failed} failed cases.`;

      if (spinner) {
        if (result.failed === 0) spinner.success(summary);
        else spinner.error(summary);
        spinner = undefined;
      } else {
        output.write(`${summary}\n`);
      }

      const failures = result.tests.filter((test) => test.status === "failed");
      if (failures.length > 0) {
        output.write(`\nFailed tests (${failures.length}):\n`);
      }

      for (const test of failures) {
        output.write(failureLine(test));
      }

      if (result.failed > 0) {
        output.write(`\nView full logs: ${launchUrl}\n`);
      }

      if (result.incomplete > 0) {
        output.write(
          `${result.incomplete} tests did not report a final status.\n`,
        );
      }
    },

    stop() {
      stopSpinner();
    },
  };
}
