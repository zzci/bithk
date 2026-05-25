import type { Page, Route } from "@playwright/test";
import { expect, test } from "@playwright/test";

const user = {
  id: "smoke-user",
  username: "smoke",
  name: "Smoke User",
  email: "smoke@example.com",
  role: "admin",
  status: "active",
  lastLoginAt: null,
  createdAt: "2026-05-25T00:00:00.000Z",
  groups: [],
};

const project = {
  id: "smoke-project",
  code: "SMOKE",
  name: "Smoke Project",
  status: "active",
  description: null,
  tags: [],
  creatorId: user.id,
  version: 1,
  updatedAt: "2026-05-25T00:00:00.000Z",
};

const routes = [
  { path: "/ships", title: "Ships" },
  { path: "/projects", title: "Projects" },
  { path: "/contacts", title: "Contacts" },
] as const;

async function mockApi(page: Page): Promise<void> {
  await page.route("**/*", async (route: Route) => {
    const url = new URL(route.request().url());
    if (!url.pathname.startsWith("/api/"))
      return route.continue();

    const path = url.pathname.replace(/^\/api/, "");
    const listMeta = (total = 0) => ({
      total,
      page: Number(url.searchParams.get("page") ?? 1),
      limit: Number(url.searchParams.get("limit") ?? 20),
    });

    if (path === "/health/ready")
      return route.fulfill({ json: { status: "ready" } });
    if (path === "/account/me")
      return route.fulfill({ json: { success: true, data: user } });
    if (path === "/tags")
      return route.fulfill({ json: { success: true, data: [] } });
    if (path === "/contacts")
      return route.fulfill({ json: { success: true, data: [] } });
    if (path === "/ships")
      return route.fulfill({ json: { success: true, data: [], meta: listMeta() } });
    if (path === "/projects") {
      const data = url.searchParams.get("status") === "archived" ? [] : [project];
      return route.fulfill({ json: { success: true, data, meta: listMeta(data.length) } });
    }

    return route.fulfill({
      status: 404,
      json: { success: false, error: { code: "SMOKE_UNHANDLED", message: path } },
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

for (const routeInfo of routes) {
  test(`${routeInfo.path} renders without browser errors`, async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error")
        errors.push(message.text());
    });
    page.on("pageerror", error => errors.push(error.message));

    await page.goto(routeInfo.path);
    await expect(page.getByRole("heading", { level: 1, name: routeInfo.title })).toBeVisible();
    await page.waitForLoadState("networkidle");

    expect(errors).toEqual([]);
  });
}
