import type { Config } from "../config";
import { CliError } from "../errors";
import { launchServerEnvelopeSchema } from "../schemas";

export type LaunchTestStatus = "running" | "passed" | "failed";

export interface LaunchTestResult {
  testCaseUid: string;
  testCaseSlug: string;
  status: LaunchTestStatus;
  conclusion?: string;
}

export interface LaunchProgress {
  total: number;
  passed: number;
  failed: number;
  running: number;
  tests: LaunchTestResult[];
}

export interface LaunchResult extends LaunchProgress {
  incomplete: number;
}

export interface ObserveLaunchInput {
  slug: string;
  wsTicket: string;
  total: number;
}

export interface ObserveLaunchOptions {
  onUpdate?: (progress: LaunchProgress) => void;
  connect?: LaunchSocketFactory;
  debug?: boolean;
  /** Idle timeout in milliseconds; primarily an injection point for tests. */
  idleTimeoutMs?: number;
}

export interface LaunchSocketCloseEvent {
  code: number;
  reason: string;
  wasClean: boolean;
}

export interface LaunchSocket {
  addEventListener: {
    (type: "message", listener: (event: { data: unknown }) => void): void;
    (type: "close", listener: (event: LaunchSocketCloseEvent) => void): void;
    (type: "open" | "error", listener: () => void): void;
  };
  close: () => void;
}

export type LaunchSocketFactory = (url: string) => LaunchSocket;

/**
 * Fail the observation if the server sends no events for this long. This is an
 * idle timeout (reset on every message), not an overall cap, so a healthy but
 * long-running suite is never interrupted while a hung launcher still surfaces
 * an error instead of blocking indefinitely (e.g. hanging a CI pipeline).
 */
const DEFAULT_IDLE_TIMEOUT_MS = 5 * 60 * 1000;

function logDebug(message: string): void {
  console.error(`[debug] ${message}`);
}

function defaultConnect(url: string): LaunchSocket {
  return new WebSocket(url) as unknown as LaunchSocket;
}

export function launchSocketUrl(
  config: Config,
  slug: string,
  wsTicket: string,
): string {
  const url = new URL(config.launcherUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `${url.pathname.replace(/\/$/, "")}/launch/${encodeURIComponent(slug)}`;
  url.search = "";
  url.searchParams.set("ticket", wsTicket);
  return url.toString();
}

function parseEnvelope(data: unknown) {
  if (typeof data !== "string") {
    throw new CliError("Robusty sent an invalid launch event.");
  }

  let json: unknown;
  try {
    json = JSON.parse(data);
  } catch {
    throw new CliError("Robusty sent an invalid launch event.");
  }

  const result = launchServerEnvelopeSchema.safeParse(json);
  if (!result.success) {
    throw new CliError("Robusty sent an invalid launch event.");
  }

  return result.data;
}

function progressSnapshot(
  tests: Map<string, LaunchTestResult>,
  total: number,
): LaunchProgress {
  const values = [...tests.values()].map((test) => Object.assign({}, test));
  const passed = values.filter((test) => test.status === "passed").length;
  const failed = values.filter((test) => test.status === "failed").length;

  return {
    total,
    passed,
    failed,
    running: Math.max(total - passed - failed, 0),
    tests: values,
  };
}

export function observeLaunch(
  config: Config,
  input: ObserveLaunchInput,
  options: ObserveLaunchOptions = {},
): Promise<LaunchResult> {
  const connect = options.connect ?? defaultConnect;
  const url = launchSocketUrl(config, input.slug, input.wsTicket);
  const tests = new Map<string, LaunchTestResult>();

  if (options.debug) {
    const endpoint = new URL(url);
    endpoint.search = "";
    logDebug(`connecting WebSocket: ${endpoint.toString()}`);
  }

  const idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    let socket: LaunchSocket;
    let settled = false;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;

    const clearIdleTimer = () => {
      if (idleTimer !== undefined) {
        clearTimeout(idleTimer);
        idleTimer = undefined;
      }
    };

    // Reset on every event; only fires when the server goes silent.
    const armIdleTimer = () => {
      clearIdleTimer();
      idleTimer = setTimeout(() => {
        fail(
          new CliError(
            `Launch observation timed out: no activity from ${config.launcherUrl} for ${Math.round(idleTimeoutMs / 1000)}s.`,
          ),
        );
      }, idleTimeoutMs);
      idleTimer.unref?.();
    };

    const fail = (error: CliError) => {
      if (settled) return;
      settled = true;
      clearIdleTimer();
      try {
        socket?.close();
      } catch {
        // The original connection or protocol error is more useful.
      }
      reject(error);
    };

    try {
      socket = connect(url);
    } catch {
      reject(
        new CliError(
          `Could not connect to ${config.launcherUrl} to observe the launch.`,
        ),
      );
      return;
    }

    armIdleTimer();

    socket.addEventListener("message", (event) => {
      if (settled) return;

      armIdleTimer();

      let envelope;
      try {
        envelope = parseEnvelope(event.data);
      } catch (error) {
        fail(
          error instanceof CliError
            ? error
            : new CliError("Robusty sent an invalid launch event."),
        );
        return;
      }

      const { testCaseUid, testCaseSlug, message } = envelope;
      const current = tests.get(testCaseUid) ?? {
        testCaseUid,
        testCaseSlug,
        status: "running" as const,
      };

      if (current.status !== "running") return;

      switch (message.type) {
        case "info":
        case "reasoning":
        case "action":
          break;

        case "status":
          current.status = message.status;
          if (message.status === "failed") current.conclusion = message.content;
          tests.set(testCaseUid, current);
          options.onUpdate?.(progressSnapshot(tests, input.total));
          break;

        case "error":
          current.status = "failed";
          current.conclusion = message.content;
          tests.set(testCaseUid, current);
          options.onUpdate?.(progressSnapshot(tests, input.total));
          break;

        case "frame":
        case "url":
          break;
      }
    });

    socket.addEventListener("open", () => {
      if (options.debug) logDebug("WebSocket connected");
    });

    socket.addEventListener("error", () => {
      fail(
        new CliError(
          `Lost the connection to ${config.launcherUrl} while observing the launch.`,
        ),
      );
    });

    socket.addEventListener("close", (event) => {
      if (settled) return;

      const progress = progressSnapshot(tests, input.total);
      const incomplete = progress.running;

      if (options.debug) {
        logDebug(
          `WebSocket closed: code=${event.code} clean=${event.wasClean} reason=${event.reason || "(none)"} completed=${input.total - incomplete}/${input.total}`,
        );
      }

      if (incomplete > 0) {
        const closeDetails = event.reason
          ? `code ${event.code}: ${event.reason}`
          : `code ${event.code}`;
        fail(
          new CliError(
            `Launch observation ended before all tests finished (${input.total - incomplete}/${input.total} completed; WebSocket ${closeDetails}).`,
          ),
        );
        return;
      }

      settled = true;
      clearIdleTimer();
      resolve({
        ...progress,
        running: 0,
        incomplete,
      });
    });
  });
}
