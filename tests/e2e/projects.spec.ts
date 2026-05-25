import type { Page, Route } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { contactsFixtureResponse } from "../fixtures/contacts";
import { projectsFixtureResponse } from "../fixtures/projects";

test.use({
  baseURL: process.env.PROJECTS_BASE_URL ?? "http://bit.localhost:1355",
  launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
    : undefined,
});

const user = {
  id: "user-admin",
  username: "admin",
  name: "Admin",
  email: "admin@example.com",
  role: "admin",
  status: "active",
  lastLoginAt: null,
  createdAt: "2026-05-25T00:00:00.000Z",
  groups: [],
};

const visibleUsers = [
  { id: "user-admin", name: "Admin", email: "admin@example.com" },
];

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
    if (path === "/account/visible-users")
      return route.fulfill({ json: { success: true, data: visibleUsers } });

    const projectsResponse = projectsFixtureResponse(path, url.searchParams);
    if (projectsResponse)
      return route.fulfill({ json: projectsResponse });

    const contactsResponse = contactsFixtureResponse(path, url.searchParams);
    if (contactsResponse)
      return route.fulfill({ json: contactsResponse });

    return route.fulfill({
      status: 404,
      json: { success: false, error: { code: "PROJECTS_TEST_UNHANDLED", message: path } },
    });
  });
}

async function usePosixLocale(page: Page): Promise<void> {
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
}

function collectBrowserErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error")
      errors.push(message.text());
  });
  page.on("pageerror", error => errors.push(error.message));
  return errors;
}

test.beforeEach(async ({ page }) => {
  await usePosixLocale(page);
  await mockApi(page);
});

test("projects list renders dense cards and list toggle without browser errors", async ({ page }) => {
  const errors = collectBrowserErrors(page);

  await page.goto("/projects");
  await expect(page.getByRole("heading", { level: 1, name: "Projects" })).toBeVisible();
  await expect(page.getByText("Atlas main-engine refit")).toBeVisible();
  await expect(page.getByText("Main-engine overhaul, procurement, and class survey readiness.")).toBeVisible();
  await page.getByRole("button", { name: "List view" }).click();
  await expect(page.getByRole("columnheader", { name: "Updated" })).toBeVisible();
  await page.waitForLoadState("networkidle");

  expect(errors).toEqual([]);
});

test("project detail renders members, categories, issues kanban and procurement summary", async ({ page }) => {
  const errors = collectBrowserErrors(page);

  await page.goto("/projects/proj-atlas-refit");
  await expect(page.getByRole("heading", { level: 1, name: "Atlas main-engine refit" })).toBeVisible();
  await expect(page.getByText("Main engine spares")).toBeVisible();

  await page.getByRole("tab", { name: /Members/ }).click();
  await expect(page.getByText("Morgan Lee")).toBeVisible();
  await expect(page.getByText("Field Lead").first()).toBeVisible();

  await page.getByRole("tab", { name: /Work Orders/ }).click();
  await expect(page.getByRole("button", { name: /All statuses/ })).toBeVisible();
  await page.getByRole("button", { name: "Kanban view" }).click();
  await expect(page.getByText("Approve shaft alignment report")).toBeVisible();

  await page.getByRole("tab", { name: /Procurement/ }).click();
  await expect(page.getByRole("button", { name: /Ordered 1 215000 USD Amount/ })).toBeVisible();
  await expect(page.getByText("Main bearing shell set")).toBeVisible();
  await page.waitForLoadState("networkidle");

  expect(errors).toEqual([]);
});
