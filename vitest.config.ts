import { defineConfig } from "vitest/config";

// Separate from vite.config.ts, which builds the library.
export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: { include: ["test/**/*.test.{ts,tsx}"] },
});
