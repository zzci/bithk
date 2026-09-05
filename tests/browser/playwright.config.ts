import { resolve } from "node:path";
import process from "node:process";
import { defineConfig } from "@playwright/test";

const baseURL = process.env.BROWSER_BASE_URL ?? "http://127.0.0.1:3419";

export default defineConfig({
  testDir: ".",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  workers: 1,
  reporter: "list",
  use: { baseURL, trace: "retain-on-failure" },
  ...(process.env.BROWSER_SKIP_WEBSERVER === "1"
    ? {}
    : {
        webServer: {
          command: "bun --env-file=/dev/null tests/browser/server.ts",
          cwd: resolve(import.meta.dirname, "../.."),
          url: `${baseURL}/api/health/ready`,
          timeout: 60_000,
          reuseExistingServer: false,
          gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
        },
      }),
});
