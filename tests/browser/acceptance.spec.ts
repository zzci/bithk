import type { Page } from "@playwright/test";
import process from "node:process";
import { test as base, chromium, expect } from "@playwright/test";

const test = base.extend({
  browser: async ({ playwright, browserName }, runWithBrowser) => {
    const remote = process.env.BROWSER_CDP_URL
      ? await chromium.connectOverCDP(process.env.BROWSER_CDP_URL)
      : await playwright[browserName].launch();
    try {
      await runWithBrowser(remote);
    }
    finally {
      await remote.close();
    }
  },
});

async function login(page: Page) {
  await page.goto("/login");
  await page.getByRole("textbox", { name: "Username" }).fill("acceptance");
  await page.getByRole("textbox", { name: "Password" }).fill("acceptance-local-fixture");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Welcome, Acceptance User" })).toBeVisible();
}

test("login persists across reload and supports keyboard navigation", async ({ page }) => {
  await login(page);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Welcome, Acceptance User" })).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to main content" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();
});

test("drive creation and view controls remain visible on narrow screens", async ({ page }) => {
  await login(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/drive");
  const create = page.getByRole("button", { name: "New", exact: true });
  await expect(create).toBeVisible();
  for (const name of ["New", "Grid view", "List view"]) {
    const bounds = await page.getByRole("button", { name, exact: true }).boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  }
  await create.click();
  await expect(page.getByRole("menuitem", { name: "New folder", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(create).toBeFocused();
  await create.click();
  await page.getByRole("menuitem", { name: "New folder", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "New folder", exact: true });
  const folderName = `Browser folder ${Date.now()}`;
  await dialog.getByRole("textbox", { name: "Name", exact: true }).fill(folderName);
  await dialog.getByRole("button", { name: "Create", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(folderName, { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText(folderName, { exact: true })).toBeVisible();
});

test("built assets are immutable while the entry document revalidates", async ({ page, request }) => {
  await page.goto("/login");
  const script = await page.locator("script[type=\"module\"][src]").getAttribute("src");
  expect(script).toMatch(/\/assets\//);
  const asset = await request.get(script!);
  expect(asset.status()).toBe(200);
  expect(asset.headers()["cache-control"]).toBe("public, max-age=31536000, immutable");
  const html = await request.get("/login");
  expect(html.headers()["cache-control"]).toBe("no-cache");
  const logo = await request.get("/logo.svg");
  expect(logo.headers()["cache-control"]).toBe("no-cache");
});

test("document creation and immediate edits persist the latest body", async ({ page }) => {
  await login(page);
  await page.goto("/documents/new");
  await page.getByRole("textbox", { name: "Document title" }).fill("Browser acceptance document");
  const editor = page.locator(".ProseMirror[contenteditable=true]").first();
  await editor.fill("The latest document body must survive immediate creation.");
  await page.getByRole("button", { name: "New Document", exact: true }).click();
  await expect(page.getByText("The latest document body must survive immediate creation.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await editor.fill("The latest document body must survive immediate saving.");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("The latest document body must survive immediate saving.", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("The latest document body must survive immediate saving.", { exact: true })).toBeVisible();
});

test("switching to source immediately retains the latest editor content", async ({ page }) => {
  await login(page);
  await page.goto("/documents/new");
  await page.locator(".ProseMirror[contenteditable=true]").fill("Keep the last edit when switching views.");
  await page.getByRole("button", { name: "View source", exact: true }).click();
  await expect(page.locator(".cm-content")).toContainText("Keep the last edit when switching views.");
  await page.getByRole("button", { name: "Back to editor", exact: true }).click();
  await expect(page.locator(".ProseMirror[contenteditable=true]")).toContainText("Keep the last edit when switching views.");
});
