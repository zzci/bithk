import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/utils";
import { AboutSettingsTab } from "./-settings-about";

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock;
});

afterEach(() => {
  fetchMock.mockReset();
});

const versionBody = {
  success: true,
  data: {
    version: "0.1.5",
    commit: "abc123def456",
    buildTime: "2026-06-09T12:00:00.000Z",
    lode: {
      supervised: true,
      active: true,
      stateAvailable: true,
      status: "running",
      current: "0.1.5",
      lastGood: "0.1.4",
      available: "0.1.6",
      channel: "stable",
      ready: true,
      hold: false,
      configChanged: false,
      history: [{ version: "0.1.5", at: "2026-06-09T12:00:00.000Z", result: "good" }],
      updateAvailable: true,
      rollbackTarget: "0.1.4",
      updateConfig: { policy: "auto", channel: "stable", asset: "bit-linux-x64.tar.gz", sourceType: "github", source: "zzci/bithk" },
    },
  },
};

function url(input: Parameters<typeof fetch>[0]): string {
  return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

// GET /api/system/version returns the build + lode summary; any POST lode action
// resolves to a generic ok envelope.
function mockRoutes() {
  fetchMock.mockImplementation((input) => {
    if (url(input).endsWith("/system/version"))
      return Promise.resolve(jsonResponse(versionBody));
    return Promise.resolve(jsonResponse({ success: true, data: { status: "ok" } }));
  });
}

describe("aboutSettingsTab", () => {
  it("renders the system version and lode status fields", async () => {
    mockRoutes();

    renderWithProviders(<AboutSettingsTab />);

    await waitFor(() => expect(screen.getByText("abc123def456")).toBeInTheDocument());
    expect(screen.getByText("running")).toBeInTheDocument();
    // Operator update config from lode.toml.
    expect(screen.getByText("auto")).toBeInTheDocument();
    expect(screen.getByText("zzci/bithk")).toBeInTheDocument();
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/system/version");
  });

  it("requests an update via lode after confirmation", async () => {
    mockRoutes();

    renderWithProviders(<AboutSettingsTab />);
    await waitFor(() => expect(screen.getByText("abc123def456")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Update to latest" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Confirm" }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(c => url(c[0]).endsWith("/system/lode/update"));
      expect(call).toBeDefined();
      expect((call?.[1] as RequestInit | undefined)?.method).toBe("POST");
    });
  });

  it("refreshes the version query", async () => {
    mockRoutes();

    renderWithProviders(<AboutSettingsTab />);
    await waitFor(() => expect(screen.getByText("abc123def456")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Refresh" }));

    await waitFor(() =>
      expect(fetchMock.mock.calls.filter(c => url(c[0]).endsWith("/system/version")).length).toBeGreaterThanOrEqual(2),
    );
  });
});
