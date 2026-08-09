import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/cli.ts"],
  platform: "node",
  format: "esm",
  target: "node22",
  clean: true,
  dts: false,
  shims: true,
});
