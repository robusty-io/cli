#!/usr/bin/env node
import { defineCommand, runMain } from "citty";
import { description, version } from "../package.json" with { type: "json" };
import { showUsage } from "./help";
import { withErrorHandling } from "./with-error-handling";

// citty always runs a command's own `run()` in addition to whichever
// subcommand was dispatched when both `run` and `subCommands` are defined
// on the same command. To avoid the root's output printing after every
// subcommand invocation, the no-args behavior is modeled as a hidden
// `default` subcommand instead of a `run` on the root command.
const main = defineCommand({
  meta: {
    name: "@robusty/cli",
    version,
    description,
  },
  subCommands: {
    root: () =>
      defineCommand({
        meta: {
          name: "root",
          hidden: true,
        },
        async run() {
          await showUsage(main);
        },
      }),
    login: () =>
      import("./commands/login").then((m) => withErrorHandling(m.default)),
    link: () =>
      import("./commands/link").then((m) => withErrorHandling(m.default)),
    launch: () =>
      import("./commands/launch").then((m) => withErrorHandling(m.default)),
    logout: () =>
      import("./commands/logout").then((m) => withErrorHandling(m.default)),
  },
  default: "root",
});

runMain(main, { showUsage });
