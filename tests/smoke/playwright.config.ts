import { existsSync } from "node:fs";
import process from "node:process";
import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.SMOKE_BASE_URL ?? `http://bit.localhost:${process.env.NSL_PORT ?? "1355"}`;
const chromiumExecutablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
  ?? (existsSync("/work/bin/chromium") ? "/work/bin/chromium" : undefined);

export default defineConfig({
  testDir: ".",
  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium-posix-locale",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: chromiumExecutablePath ? { executablePath: chromiumExecutablePath } : undefined,
      },
    },
  ],
  webServer: process.env.SMOKE_SKIP_WEBSERVER === "1"
    ? undefined
    : {
        command: "bun run dev",
        url: baseURL,
        timeout: 120_000,
        reuseExistingServer: !process.env.CI,
      },
});
