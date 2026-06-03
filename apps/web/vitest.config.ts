// Vitest configuration for the web workspace. Extends the project's
// vite.config.ts (plugins, base, etc.) and adds coverage thresholds so
// CI fails when the SPA regresses below the agreed floor. Thresholds
// are intentionally conservative — initial numbers track the existing
// suite so the gate can be tightened over time without immediately
// breaking main.
import { resolve } from "node:path";
import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

export default mergeConfig(
  viteConfig,
  defineConfig({
    resolve: {
      alias: {
        "@": resolve(__dirname, "src"),
      },
    },
    test: {
      // Component and hook tests need a DOM; pure-logic suites run fine here
      // too. jsdom keeps the environment deterministic across CI machines.
      environment: "jsdom",
      setupFiles: ["./src/test/setup.ts"],
      coverage: {
        provider: "v8",
        reporter: ["text", "lcov"],
        // Only the source code we own — vendor / generated files
        // (TanStack routeTree.gen, etc.) are excluded so the gate
        // measures hand-written code only.
        include: ["src/**/*.{ts,tsx}"],
        exclude: [
          "src/**/*.test.{ts,tsx}",
          "src/**/*.d.ts",
          "src/app/routeTree.gen.ts",
          "src/main.tsx",
          // Test-only harness (render helpers, synchronous i18n) — measuring it
          // would inflate the gate without reflecting product coverage.
          "src/test/**",
        ],
        // Thresholds are percentages (0-100). Floors track the current
        // suite with a small headroom so routine churn doesn't trip the
        // gate — raise as coverage improves, never lower. Current actuals
        // (2026-06, after FIX-027 added pure-logic suites — tag-utils,
        // status-colors, errors, use-debounce):
        // lines ~42.2, statements ~42.2, functions ~42.7, branches ~36.5.
        thresholds: {
          lines: 38,
          functions: 38,
          statements: 38,
          branches: 33,
        },
      },
    },
  }),
);
