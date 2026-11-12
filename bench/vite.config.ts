import { resolve } from "node:path";
import { defineConfig } from "vite";

// Serves the profiling page (see bench/profile.mjs). Imports the library from source, like the demo.
export default defineConfig(({ command }) => ({
  root: __dirname,
  base: "./",
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: {
      "paper-svg": resolve(__dirname, "../src/index.ts"),
      // Production React still reports to <Profiler> in its profiling build.
      ...(command === "build" ? { "react-dom/client": "react-dom/profiling" } : {}),
    },
  },
  // The page loads character fixtures from test/fixtures.
  server: { fs: { allow: [resolve(__dirname, "..")] } },
}));
