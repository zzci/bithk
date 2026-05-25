import { chromium, expect, type Page, type Route } from "@playwright/test";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { contactsFixtureResponse } from "../fixtures/contacts";
import { projectsFixtureResponse } from "../fixtures/projects";
import { shipsFixtureResponse } from "../fixtures/ships";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const outDir = path.join(repoRoot, "docs/plan/parity-shots/PLAN-019-F");
const currentDir = path.join(outDir, "current");
const prototypeDir = path.join(outDir, "prototype");

const currentBaseUrl = process.env.PARITY_CURRENT_BASE_URL ?? "http://bit.localhost:1355";
const prototypeUrl = process.env.PARITY_PROTOTYPE_URL ?? "https://fr.ds.cc/bit.html";
const chromiumExecutablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
  ?? (existsSync("/work/bin/chromium") ? "/work/bin/chromium" : undefined);

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

const visibleUsers = [
  { id: "user-admin", name: "Admin User", email: "admin@example.com" },
];

async function mockCurrentApi(page: Page): Promise<void> {
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

  await page.route("**/*", async (route: Route) => {
    const url = new URL(route.request().url());
    if (!url.pathname.startsWith("/api/"))
      return route.continue();

    const apiPath = url.pathname.replace(/^\/api/, "");
    if (apiPath === "/health/ready")
      return route.fulfill({ json: { status: "ready" } });
    if (apiPath === "/account/me")
      return route.fulfill({ json: { success: true, data: user } });
    if (apiPath === "/account/visible-users")
      return route.fulfill({ json: { success: true, data: visibleUsers } });
    if (apiPath === "/drive/entries")
      return route.fulfill({ json: { success: true, data: [] } });

    const payload
      = shipsFixtureResponse(apiPath, url.searchParams)
        ?? projectsFixtureResponse(apiPath, url.searchParams)
        ?? contactsFixtureResponse(apiPath, url.searchParams);

    if (payload !== undefined)
      return route.fulfill({ json: payload });

    return route.fulfill({
      status: 404,
      json: { success: false, error: { code: "PARITY_UNHANDLED", message: apiPath } },
    });
  });
}

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => undefined);
  await page.waitForTimeout(300);
}

async function capture(page: Page, dir: string, name: string): Promise<void> {
  await settle(page);
  await page.screenshot({
    path: path.join(dir, `${name}.png`),
    fullPage: true,
    animations: "disabled",
  });
}

async function captureCurrent(page: Page): Promise<void> {
  await mockCurrentApi(page);

  await page.goto(`${currentBaseUrl}/ships`);
  await expect(page.getByRole("heading", { level: 1, name: "Ships" })).toBeVisible();
  await capture(page, currentDir, "ships-list");

  await page.goto(`${currentBaseUrl}/ships/ship-atlas`);
  await expect(page.getByRole("heading", { level: 1, name: "Atlas Voyager" })).toBeVisible();
  await capture(page, currentDir, "ship-detail-overview");
  await page.getByRole("tab", { name: /Profile/ }).click();
  await capture(page, currentDir, "ship-detail-profile");
  await page.getByRole("tab", { name: /Maintenance/ }).click();
  await capture(page, currentDir, "ship-detail-maintenance");

  await page.goto(`${currentBaseUrl}/projects`);
  await expect(page.getByRole("heading", { level: 1, name: "Projects" })).toBeVisible();
  await capture(page, currentDir, "projects-list");

  await page.goto(`${currentBaseUrl}/projects/proj-atlas-refit`);
  await expect(page.getByRole("heading", { level: 1, name: "Atlas main-engine refit" })).toBeVisible();
  await capture(page, currentDir, "project-detail-overview");
  await page.getByRole("tab", { name: /Work Orders/ }).click();
  await capture(page, currentDir, "project-detail-issues");
  await page.getByRole("tab", { name: /Procurement/ }).click();
  await capture(page, currentDir, "project-detail-procurement");
  await page.getByRole("tab", { name: /Members/ }).click();
  await capture(page, currentDir, "project-detail-members");

  await page.goto(`${currentBaseUrl}/contacts`);
  await expect(page.getByRole("heading", { level: 1, name: "Contacts" })).toBeVisible();
  await capture(page, currentDir, "contacts-directory");
}

async function clickPrototypeSidebar(page: Page, index: number): Promise<void> {
  await page.locator(".sb-item").nth(index).click();
  await settle(page);
}

async function clickPrototypeDetailTab(page: Page, index: number): Promise<void> {
  await page.locator(".detail-tabs .tab").nth(index).click();
  await settle(page);
}

async function capturePrototype(page: Page): Promise<void> {
  await page.goto(prototypeUrl);
  await page.locator(".main-scroll").waitFor({ timeout: 20_000 });
  await capture(page, prototypeDir, "ships-list");

  await page.locator(".ship-card").first().click();
  await page.locator(".detail").waitFor({ timeout: 20_000 });
  await capture(page, prototypeDir, "ship-detail-overview");
  await clickPrototypeDetailTab(page, 1);
  await capture(page, prototypeDir, "ship-detail-profile");
  await clickPrototypeDetailTab(page, 3);
  await capture(page, prototypeDir, "ship-detail-maintenance");

  await clickPrototypeSidebar(page, 5);
  await capture(page, prototypeDir, "projects-list");

  await page.locator(".proj-card").first().click();
  await page.locator(".detail").waitFor({ timeout: 20_000 });
  await capture(page, prototypeDir, "project-detail-overview");
  await clickPrototypeDetailTab(page, 1);
  await capture(page, prototypeDir, "project-detail-issues");
  await clickPrototypeDetailTab(page, 2);
  await capture(page, prototypeDir, "project-detail-procurement");
  await clickPrototypeDetailTab(page, 3);
  await capture(page, prototypeDir, "project-detail-members");

  await clickPrototypeSidebar(page, 6);
  await capture(page, prototypeDir, "contacts-directory");
}

await mkdir(currentDir, { recursive: true });
await mkdir(prototypeDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: chromiumExecutablePath,
});

try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
  });
  const currentPage = await context.newPage();
  await captureCurrent(currentPage);
  await currentPage.close();

  const prototypePage = await context.newPage();
  await capturePrototype(prototypePage);
  await prototypePage.close();
  await context.close();
}
finally {
  await browser.close();
}

console.log(`PLAN-019 parity screenshots written to ${path.relative(repoRoot, outDir)}`);
