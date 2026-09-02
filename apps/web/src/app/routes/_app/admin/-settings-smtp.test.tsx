import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import enSettings from "@/locales/en/settings.json";
import { renderWithProviders } from "@/test/utils";
import { SmtpSettingsTab } from "./-settings-smtp";

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
}

const fetchMock = vi.fn<typeof fetch>();

const SMTP_ROWS = [
  { key: "smtp.enabled", value: "true", updatedBy: null, updatedAt: "2026-09-01" },
  { key: "smtp.host", value: "smtp.example.com", updatedBy: null, updatedAt: "2026-09-01" },
  { key: "smtp.secure", value: "false", updatedBy: null, updatedAt: "2026-09-01" },
];

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input, init) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    if (url.startsWith("/api/settings?prefix="))
      return jsonResponse({ success: true, data: SMTP_ROWS });
    if (url === "/api/system/branding")
      return jsonResponse({ success: true, data: { appDisplayName: "Bit" } });
    if (url === "/api/admin/smtp/test" && method === "POST")
      return jsonResponse({ success: true, data: { to: "admin@example.com", messageId: "<m1>" } });
    if (url.startsWith("/api/settings/") && method === "PUT")
      return jsonResponse({ success: true, data: null });
    return jsonResponse({ success: false, error: { code: "NOT_FOUND", message: url } }, { status: 404 });
  });
  globalThis.fetch = fetchMock;
});

afterEach(() => {
  fetchMock.mockReset();
});

describe("smtpSettingsTab (FEAT-059)", () => {
  it("renders the implicit-TLS switch from smtp.secure and writes it back on toggle", async () => {
    renderWithProviders(<SmtpSettingsTab />);
    const secure = await screen.findByRole("switch", { name: enSettings.smtp.secure });
    expect(secure).toHaveAttribute("aria-checked", "false");
    await userEvent.click(secure);
    await waitFor(() => {
      const put = fetchMock.mock.calls.find(c => String(c[0]) === "/api/settings/smtp.secure" && (c[1] as RequestInit | undefined)?.method === "PUT");
      expect(put).toBeDefined();
      expect(JSON.parse(String((put![1] as RequestInit).body))).toEqual({ value: "true" });
    });
  });

  it("sends a test email and reports the recipient", async () => {
    renderWithProviders(<SmtpSettingsTab />);
    const button = await screen.findByRole("button", { name: enSettings.smtp.sendTest });
    await userEvent.click(button);
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(c => String(c[0]) === "/api/admin/smtp/test" && (c[1] as RequestInit | undefined)?.method === "POST")).toBe(true);
    });
    expect(await screen.findByText(enSettings.smtp.testSent.replace("{{to}}", "admin@example.com"))).toBeInTheDocument();
  });
});
