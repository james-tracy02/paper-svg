import { resolve } from "node:path";
import { defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";

// Separate from vite.config.ts, which builds the library.
export default defineConfig({
  esbuild: { jsx: "automatic" },
  // The demo imports "paper-svg"; point it at the source, as demo/vite.config.ts does.
  resolve: { alias: { "paper-svg": resolve(__dirname, "src/index.ts") } },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["test/**/*.test.{ts,tsx}"],
          exclude: ["test/browser/**"],
        },
      },
      {
        // Renders real fixtures in Chromium: masks are measured with getBBox, so they need a real DOM.
        extends: true,
        test: {
          name: "browser",
          include: ["test/browser/**/*.test.{ts,tsx}"],
          testTimeout: 60_000,
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: "chromium", viewport: { width: 1200, height: 1600 } }],
          },
        },
      },
    ],
  },
});
