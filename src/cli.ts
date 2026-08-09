#!/usr/bin/env node
import { defineCommand, runMain } from "citty";
import { description, version } from "../package.json" with { type: "json" };

const main = defineCommand({
  meta: {
    name: "@robusty/cli",
    version,
    description,
  },
  run() {
    console.log("Hello, World!");
  },
});

runMain(main);
