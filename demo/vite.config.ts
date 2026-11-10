import { resolve } from "node:path";
import { defineConfig } from "vite";

// Imports the library from source, so library edits show up without a build.
export default defineConfig({
  root: __dirname,
  base: "./",
  esbuild: { jsx: "automatic" },
  resolve: { alias: { "paper-svg": resolve(__dirname, "../src/index.ts") } },
});
