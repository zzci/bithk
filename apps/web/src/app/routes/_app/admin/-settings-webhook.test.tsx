import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import enSettings from "@/locales/en/settings.json";
import { renderWithProviders } from "@/test/utils";
import { WebhookSettingsTab } from "./-settings-webhook";

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
}

const hook = {
  id: "wh1",
  name: "ops-alerts",
  url: "https://example.com/hooks/ops",
  events: ["issue.*", "share.created"],
  enabled: true,
  hasSecret: true,
  consecutiveFailures: 2,
  lastDeliveryAt: "2026-09-01T10:00:00.000Z",
  lastDeliveryStatus: "failed",
  createdBy: "admin",
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
};

const fetchMock = vi.fn<typeof fetch>();
const calls = () => fetchMock.mock.calls.map(c => ({ url: String(c[0]), method: (c[1] as RequestInit | undefined)?.method ?? "GET", body: (c[1] as RequestInit | undefined)?.body }));

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input, init) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    if (url === "/api/admin/webhooks" && method === "GET")
      return jsonResponse({ success: true, data: [hook] });
    if (url === "/api/admin/webhooks" && method === "POST")
      return jsonResponse({ success: true, data: { ...hook, id: "wh2", name: "new-hook" } }, { status: 201 });
    if (url === "/api/admin/webhooks/wh1/test" && method === "POST")
      return jsonResponse({ success: true, data: { deliveryId: "d9" } }, { status: 202 });
    if (url === "/api/admin/webhooks/wh1" && method === "DELETE")
      return jsonResponse({ success: true, data: null });
    if (url === "/api/admin/webhooks/wh1" && method === "PATCH")
      return jsonResponse({ success: true, data: { ...hook, enabled: false } });
    if (url.startsWith("/api/admin/webhooks/wh1/deliveries"))
      return jsonResponse({ success: true, data: [{ id: "d1", event: "webhook.test", eventId: "test-1", payload: "{}", status: "success", attempts: 1, responseStatus: 200, error: null, createdAt: "2026-09-01T10:00:00.000Z", finishedAt: "2026-09-01T10:00:01.000Z" }], meta: { total: 1, page: 1, limit: 20 } });
    return jsonResponse({ success: false, error: { code: "NOT_FOUND", message: url } }, { status: 404 });
  });
  globalThis.fetch = fetchMock;
});

afterEach(() => {
  fetchMock.mockReset();
});

describe("webhookSettingsTab (FEAT-060)", () => {
  it("lists subscriptions from /admin/webhooks with events, health and the enabled switch", async () => {
    renderWithProviders(<WebhookSettingsTab />);
    expect(await screen.findByText("ops-alerts")).toBeInTheDocument();
    expect(screen.getByText("https://example.com/hooks/ops")).toBeInTheDocument();
    expect(screen.getByText("issue.*")).toBeInTheDocument();
    expect(screen.getByText(enSettings.webhook.failures_other.replace("{{count}}", "2"))).toBeInTheDocument();
    const toggle = screen.getByRole("switch", { name: enSettings.webhook.colEnabled });
    await userEvent.click(toggle);
    await waitFor(() => {
      const patch = calls().find(c => c.url === "/api/admin/webhooks/wh1" && c.method === "PATCH");
      expect(patch).toBeDefined();
      expect(JSON.parse(String(patch!.body))).toEqual({ enabled: false });
    });
  });

  it("creates a subscription from the dialog", async () => {
    renderWithProviders(<WebhookSettingsTab />);
    await screen.findByText("ops-alerts");
    await userEvent.click(screen.getByRole("button", { name: enSettings.webhook.create }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText(enSettings.webhook.fieldName), "new-hook");
    await userEvent.type(within(dialog).getByLabelText(enSettings.webhook.fieldUrl), "https://example.com/new");
    await userEvent.type(within(dialog).getByLabelText(enSettings.webhook.fieldSecret), "s3cret");
    const events = within(dialog).getByLabelText(enSettings.webhook.fieldEvents);
    await userEvent.clear(events);
    await userEvent.type(events, "issue.*, share.created");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => {
      const post = calls().find(c => c.url === "/api/admin/webhooks" && c.method === "POST");
      expect(post).toBeDefined();
      expect(JSON.parse(String(post!.body))).toEqual({ name: "new-hook", url: "https://example.com/new", secret: "s3cret", events: ["issue.*", "share.created"], enabled: true });
    });
  });

  it("sends a test ping and opens the delivery log", async () => {
    renderWithProviders(<WebhookSettingsTab />);
    await screen.findByText("ops-alerts");
    await userEvent.click(screen.getByRole("button", { name: enSettings.webhook.test }));
    await waitFor(() => expect(calls().some(c => c.url === "/api/admin/webhooks/wh1/test" && c.method === "POST")).toBe(true));
    await userEvent.click(screen.getByRole("button", { name: enSettings.webhook.deliveries }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("webhook.test")).toBeInTheDocument();
    expect(within(dialog).getByText(enSettings.webhook.status.success)).toBeInTheDocument();
  });

  it("deletes after confirmation", async () => {
    renderWithProviders(<WebhookSettingsTab />);
    await screen.findByText("ops-alerts");
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("alertdialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(calls().some(c => c.url === "/api/admin/webhooks/wh1" && c.method === "DELETE")).toBe(true));
  });
});
