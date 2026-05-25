import type { Page, Route } from "@playwright/test";
import { existsSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { contactsFixtureResponse } from "../fixtures/contacts";
import { projectsFixtureResponse } from "../fixtures/projects";
import { shipsFixtureResponse } from "../fixtures/ships";

const appURL = process.env.SMOKE_BASE_URL ?? "http://localhost:4175";
const chromiumExecutablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
  ?? (existsSync("/work/bin/chromium") ? "/work/bin/chromium" : undefined);

if (chromiumExecutablePath)
  test.use({ launchOptions: { executablePath: chromiumExecutablePath } });

const user = {
  id: "user-admin",
  username: "admin",
  name: "Admin User",
  email: "admin@example.com",
  role: "admin",
  status: "active",
  lastLoginAt: null,
  createdAt: "2026-05-25T00:00:00.000Z",
  groups: [],
};

async function mockApi(page: Page): Promise<void> {
  await page.route("**/*", async (route: Route) => {
    const url = new URL(route.request().url());
    if (!url.pathname.startsWith("/api/"))
      return route.continue();

    const path = url.pathname.replace(/^\/api/, "");
    if (path === "/health/ready")
      return route.fulfill({ json: { status: "ready" } });
    if (path === "/account/me")
      return route.fulfill({ json: { success: true, data: user } });
    if (path === "/drive/entries")
      return route.fulfill({ json: { success: true, data: [] } });

    const payload
      = shipsFixtureResponse(path, url.searchParams)
        ?? projectsFixtureResponse(path, url.searchParams)
        ?? contactsFixtureResponse(path, url.searchParams);

    if (payload !== undefined)
      return route.fulfill({ json: payload });

    return route.fulfill({
      status: 404,
      json: { success: false, error: { code: "E2E_UNHANDLED", message: path } },
    });
  });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "language", {
      configurable: true,
      get: () => "en-US@posix",
    });
    Object.defineProperty(navigator, "languages", {
      configurable: true,
      get: () => ["en-US@posix", "en-US", "en"],
    });
  });
  await mockApi(page);
});

test("ships list and detail render current-API parity elements without browser errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error")
      errors.push(message.text());
  });
  page.on("pageerror", error => errors.push(error.message));

  await page.goto(new URL("/ships", appURL).toString());

  await expect(page.getByRole("heading", { level: 1, name: "Ships" })).toBeVisible();
  await expect(page.getByRole("button", { name: /All 4/ })).toBeVisible();
  await expect(page.getByText("Atlas Voyager")).toBeVisible();
  await expect(page.getByText("9876543")).toBeVisible();
  await expect(page.getByText("Shanghai")).toBeVisible();

  await page.getByRole("button", { name: /Atlas Voyager/ }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Atlas Voyager" })).toBeVisible();
  await expect(page.getByText("proj-atlas-refit").first()).toBeVisible();
  await expect(page.getByRole("tab", { name: /Profile 1/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Equipment 3/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Maintenance 4/ })).toBeVisible();

  await page.getByRole("tab", { name: /Profile 1/ }).click();
  await expect(page.getByRole("heading", { name: "Vessel profile" })).toBeVisible();
  await expect(page.getByText("North Dock")).toBeVisible();

  await page.getByRole("tab", { name: /Equipment 3/ }).click();
  await expect(page.getByText("Cylinder liner overhaul in progress.")).toBeVisible();

  await page.getByRole("tab", { name: /Maintenance 4/ }).click();
  await expect(page.getByRole("button", { name: /Templates 2/ })).toBeVisible();
  await expect(page.getByText("Main-engine lube oil renewal")).toBeVisible();
  await page.getByRole("button", { name: /Work orders 2/ }).click();
  await expect(page.getByText("Renew main-engine lube oil")).toBeVisible();

  await page.waitForLoadState("networkidle");
  expect(errors).toEqual([]);
});
