import type { Page, Route } from "@playwright/test";
import { existsSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { contactsFixtureResponse } from "../fixtures/contacts";

const chromiumExecutablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
  ?? (existsSync("/work/bin/chromium") ? "/work/bin/chromium" : undefined);

test.use({
  baseURL: process.env.SMOKE_BASE_URL ?? "http://bit.localhost:1355",
  launchOptions: chromiumExecutablePath ? { executablePath: chromiumExecutablePath } : undefined,
});

const user = {
  id: "contacts-user",
  username: "contacts",
  name: "Contacts User",
  email: "contacts@example.com",
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
    const contactsResponse = contactsFixtureResponse(path, url.searchParams);
    if (contactsResponse)
      return route.fulfill({ json: contactsResponse });

    if (path === "/health/ready")
      return route.fulfill({ json: { status: "ready" } });
    if (path === "/account/me")
      return route.fulfill({ json: { success: true, data: user } });
    if (path === "/tags")
      return route.fulfill({ json: { success: true, data: [] } });

    return route.fulfill({
      status: 404,
      json: { success: false, error: { code: "CONTACTS_TEST_UNHANDLED", message: path } },
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

test("contacts directory parity renders list, filters, and detail drawer without browser errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error")
      errors.push(message.text());
  });
  page.on("pageerror", error => errors.push(error.message));

  await page.goto("/contacts");

  await expect(page.getByRole("heading", { level: 1, name: "Contacts" })).toBeVisible();
  await expect(page.getByText("Total contacts")).toBeVisible();
  await expect(page.getByRole("button", { name: "Active 4" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Public 5" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Company / unit" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Contact person" })).toBeVisible();
  await expect(page.getByRole("button", { name: "MAN ES Regional Office", exact: true })).toBeVisible();
  await expect(page.getByText("Main engine")).toBeVisible();

  await page.getByRole("button", { name: "MAN ES Regional Office", exact: true }).click();
  const drawer = page.getByRole("dialog");
  await expect(drawer.getByRole("heading", { name: "MAN ES Regional Office" })).toBeVisible();
  await expect(drawer.getByText("Contact methods")).toBeVisible();
  await expect(drawer.getByText("Tags and notes")).toBeVisible();

  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Confidential Hull Consultant" }).click();
  await expect(page.getByRole("dialog").getByLabel("Masked field").first()).toBeVisible();
  await expect(page.getByText("Hidden").first()).toBeVisible();

  await page.waitForLoadState("networkidle");
  expect(errors).toEqual([]);
});
