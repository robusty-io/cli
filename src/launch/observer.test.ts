import { describe, expect, it, vi } from "vitest";
import type { Config } from "../config";
import type { LaunchSocket, LaunchSocketCloseEvent } from "./observer";
import { launchSocketUrl, observeLaunch } from "./observer";

const config: Config = {
  webUrl: "https://www.robusty.io",
  launcherUrl: "https://launcher.robusty.io",
  token: undefined,
};

class FakeSocket implements LaunchSocket {
  private messageListener: ((event: { data: unknown }) => void) | undefined;
  private openListener: (() => void) | undefined;
  private errorListener: (() => void) | undefined;
  private closeListener: ((event: LaunchSocketCloseEvent) => void) | undefined;
  close = vi.fn();

  addEventListener(
    type: "message",
    listener: (event: { data: unknown }) => void,
  ): void;
  addEventListener(
    type: "close",
    listener: (event: LaunchSocketCloseEvent) => void,
  ): void;
  addEventListener(type: "open" | "error", listener: () => void): void;
  addEventListener(
    type: "message" | "open" | "error" | "close",
    listener:
      | ((event: { data: unknown }) => void)
      | ((event: LaunchSocketCloseEvent) => void)
      | (() => void),
  ): void {
    if (type === "message") {
      this.messageListener = listener as (event: { data: unknown }) => void;
    } else if (type === "open") {
      this.openListener = listener as () => void;
    } else if (type === "error") {
      this.errorListener = listener as () => void;
    } else {
      this.closeListener = listener as (event: LaunchSocketCloseEvent) => void;
    }
  }

  send(message: unknown): void {
    this.sendRaw(JSON.stringify(message));
  }

  sendRaw(data: unknown): void {
    this.messageListener?.({ data });
  }

  open(): void {
    this.openListener?.();
  }

  finish(
    event: LaunchSocketCloseEvent = {
      code: 1000,
      reason: "",
      wasClean: true,
    },
  ): void {
    this.closeListener?.(event);
  }

  fail(): void {
    this.errorListener?.();
  }
}

describe("launchSocketUrl", () => {
  it("builds a ticket-authenticated WebSocket URL", () => {
    expect(launchSocketUrl(config, "launch slug", "ticket&value")).toBe(
      "wss://launcher.robusty.io/launch/launch%20slug?ticket=ticket%26value",
    );
  });

  it("uses ws for an http launcher override", () => {
    expect(
      launchSocketUrl(
        { ...config, launcherUrl: "http://localhost:3000" },
        "abc123",
        "ticket",
      ),
    ).toBe("ws://localhost:3000/launch/abc123?ticket=ticket");
  });
});

describe("observeLaunch", () => {
  it("tracks terminal states, conclusions, and test slugs", async () => {
    const socket = new FakeSocket();
    const onUpdate = vi.fn();
    const observing = observeLaunch(
      config,
      { slug: "launch-1", wsTicket: "ticket", total: 2 },
      { connect: () => socket, onUpdate },
    );

    socket.send({
      testCaseUid: "checkout",
      testCaseSlug: "checkout-flow",
      logId: "log-1",
      message: { type: "action", content: "Click Pay" },
    });
    socket.send({
      testCaseUid: "checkout",
      testCaseSlug: "checkout-flow",
      logId: "log-2",
      message: {
        type: "status",
        status: "failed",
        content: "Payment form did not close",
      },
    });
    socket.send({
      testCaseUid: "login",
      testCaseSlug: "login-flow",
      logId: "log-3",
      message: { type: "status", status: "passed", content: "Passed" },
    });
    socket.finish();

    await expect(observing).resolves.toEqual({
      total: 2,
      passed: 1,
      failed: 1,
      running: 0,
      incomplete: 0,
      tests: [
        {
          testCaseUid: "checkout",
          testCaseSlug: "checkout-flow",
          status: "failed",
          conclusion: "Payment form did not close",
        },
        {
          testCaseUid: "login",
          testCaseSlug: "login-flow",
          status: "passed",
        },
      ],
    });
    expect(onUpdate).toHaveBeenCalledTimes(2);
  });

  it("rejects when the socket closes before every test completes", async () => {
    const socket = new FakeSocket();
    const observing = observeLaunch(
      config,
      { slug: "launch-1", wsTicket: "ticket", total: 3 },
      { connect: () => socket },
    );

    socket.send({
      testCaseUid: "search",
      testCaseSlug: "search-messages",
      logId: "log-1",
      message: { type: "info", content: "Waiting for results" },
    });
    socket.send({
      testCaseUid: "search",
      testCaseSlug: "search-messages",
      logId: "log-2",
      message: { type: "error", content: "Browser disconnected" },
    });
    socket.finish({ code: 4401, reason: "Unauthorized", wasClean: true });

    await expect(observing).rejects.toThrow(
      "Launch observation ended before all tests finished (1/3 completed; WebSocket code 4401: Unauthorized).",
    );
  });

  it("rejects invalid server events and closes the socket", async () => {
    const socket = new FakeSocket();
    const observing = observeLaunch(
      config,
      { slug: "launch-1", wsTicket: "ticket", total: 1 },
      { connect: () => socket },
    );

    socket.sendRaw("not json");

    await expect(observing).rejects.toThrow(
      "Robusty sent an invalid launch event.",
    );
    expect(socket.close).toHaveBeenCalledOnce();
  });

  it("rejects when the server goes idle past the timeout", async () => {
    vi.useFakeTimers();
    try {
      const socket = new FakeSocket();
      const observing = observeLaunch(
        config,
        { slug: "launch-1", wsTicket: "ticket", total: 2 },
        { connect: () => socket, idleTimeoutMs: 1_000 },
      );

      // Activity resets the idle timer, so silence is measured from here.
      socket.send({
        testCaseUid: "checkout",
        testCaseSlug: "checkout-flow",
        logId: "log-1",
        message: { type: "status", status: "passed", content: "Passed" },
      });

      // Attach the rejection handler before the timer fires to avoid an
      // unhandled rejection when the fake timer settles the promise.
      const rejection = expect(observing).rejects.toThrow(
        "Launch observation timed out: no activity from https://launcher.robusty.io for 1s.",
      );

      // Not enough silence yet: the timer was reset by the message above.
      await vi.advanceTimersByTimeAsync(999);
      // Now cross the idle threshold.
      await vi.advanceTimersByTimeAsync(1);

      await rejection;
      expect(socket.close).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not time out while the server keeps sending events", async () => {
    vi.useFakeTimers();
    try {
      const socket = new FakeSocket();
      const observing = observeLaunch(
        config,
        { slug: "launch-1", wsTicket: "ticket", total: 1 },
        { connect: () => socket, idleTimeoutMs: 1_000 },
      );

      // Each message re-arms the timer just before it would fire, so the
      // observation survives well past a single idle window.
      const keepAlive = (logId: string) =>
        socket.send({
          testCaseUid: "checkout",
          testCaseSlug: "checkout-flow",
          logId,
          message: { type: "action", content: "Click" },
        });

      await vi.advanceTimersByTimeAsync(999);
      keepAlive("log-0");
      await vi.advanceTimersByTimeAsync(999);
      keepAlive("log-1");
      await vi.advanceTimersByTimeAsync(999);
      keepAlive("log-2");

      socket.send({
        testCaseUid: "checkout",
        testCaseSlug: "checkout-flow",
        logId: "log-done",
        message: { type: "status", status: "passed", content: "Passed" },
      });
      socket.finish();

      await expect(observing).resolves.toMatchObject({
        passed: 1,
        failed: 0,
        running: 0,
        incomplete: 0,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects WebSocket connection errors", async () => {
    const socket = new FakeSocket();
    const observing = observeLaunch(
      config,
      { slug: "launch-1", wsTicket: "ticket", total: 1 },
      { connect: () => socket },
    );

    socket.fail();

    await expect(observing).rejects.toThrow(
      "Lost the connection to https://launcher.robusty.io while observing the launch.",
    );
  });
});
