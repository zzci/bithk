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
        // (2026-05, after F1/F2/F3 UI suites merged):
        // lines ~30.0, statements ~29.9, functions ~30.1, branches ~25.0.
        thresholds: {
          lines: 29,
          functions: 29,
          statements: 29,
          branches: 24,
        },
      },
    },
  }),
);
