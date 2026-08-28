import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "@/shared/stores/auth";
import { renderWithProviders } from "@/test/utils";
import { SettingsDialog } from "./settings-dialog";

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
}

const fetchMock = vi.fn<typeof fetch>();

const user = {
  id: "u1",
  username: "alice",
  name: "Alice Liddell",
  email: "alice@example.com",
  role: "admin" as const,
  status: "active",
  lastLoginAt: null,
  createdAt: "2026-05-23T00:00:00.000Z",
  groups: [{ id: "g1", name: "Eng", description: null }],
  modules: ["documents", "drive", "projects", "contacts", "hr"],
};

beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock;
  useAuthStore.setState({ user, loading: false });
});

afterEach(() => {
  fetchMock.mockReset();
  useAuthStore.setState({ user: null, loading: true });
});

describe("settingsDialog", () => {
  it("renders nothing when there is no signed-in user", () => {
    useAuthStore.setState({ user: null });
    const { container } = renderWithProviders(<SettingsDialog open onOpenChange={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the profile tab with the user's identity", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: [] }));
    renderWithProviders(<SettingsDialog open onOpenChange={() => {}} />);
    expect(await screen.findByText("Alice Liddell")).toBeInTheDocument();
    expect(screen.getByText("alice")).toBeInTheDocument();
    expect(screen.getByText("Admin")).toBeInTheDocument();
    expect(screen.getByText("Eng")).toBeInTheDocument();
  });

  it("lists no TOTP devices initially and offers to add one", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: [] }));
    const userEv = userEvent.setup();
    renderWithProviders(<SettingsDialog open onOpenChange={() => {}} />);
    await userEv.click(screen.getByRole("tab", { name: "Security" }));
    expect(await screen.findByText("No TOTP devices configured.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New" })).toBeInTheDocument();
  });

  it("walks through the add-device flow and confirms a code", async () => {
    const userEv = userEvent.setup();
    fetchMock.mockImplementation(async (url, init) => {
      const method = (init?.method ?? "GET").toUpperCase();
      const path = String(url);
      if (method === "GET" && path.endsWith("/account/me/totp"))
        return jsonResponse({ success: true, data: [] });
      if (method === "POST" && path.endsWith("/account/me/totp")) {
        return jsonResponse({
          success: true,
          data: { id: "dev1", name: "Phone", secret: "ABC123", uri: "otpauth://x", qrCode: "data:image/png;base64,Zm9v" },
        });
      }
      // confirm
      return jsonResponse({ success: true, data: null });
    });

    renderWithProviders(<SettingsDialog open onOpenChange={() => {}} />);
    await userEv.click(screen.getByRole("tab", { name: "Security" }));
    await userEv.click(await screen.findByRole("button", { name: "New" }));

    const nameInput = await screen.findByLabelText("Device Name");
    await userEv.type(nameInput, "Phone");
    await userEv.click(screen.getByRole("button", { name: /Next/ }));

    // The QR/verify step appears once the setup POST resolves.
    const codeInput = await screen.findByLabelText("Verification Code");
    await userEv.type(codeInput, "123456");
    await userEv.click(screen.getByRole("button", { name: "Verify" }));

    await waitFor(() => {
      const confirm = fetchMock.mock.calls.find(c => String(c[0]).includes("/confirm"));
      expect(confirm).toBeTruthy();
      expect(JSON.parse(String(confirm![1]?.body)).code).toBe("123456");
    });
  });

  it("renders an existing verified device", async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      success: true,
      data: [{ id: "d1", name: "YubiKey", verified: true, createdAt: "2026-05-23T00:00:00.000Z" }],
    }));
    const userEv = userEvent.setup();
    renderWithProviders(<SettingsDialog open onOpenChange={() => {}} />);
    await userEv.click(screen.getByRole("tab", { name: "Security" }));
    expect(await screen.findByText("YubiKey")).toBeInTheDocument();
    expect(screen.getByText("Verified")).toBeInTheDocument();
  });
});
