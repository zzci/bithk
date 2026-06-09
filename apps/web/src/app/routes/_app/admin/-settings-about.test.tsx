import { screen, waitFor } from "@testing-library/react";
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

function routeVersionFetch() {
  fetchMock.mockResolvedValue(jsonResponse({
    success: true,
    data: {
      version: "0.1.5",
      commit: "abc123def456",
      buildTime: "2026-06-09T12:00:00.000Z",
      lode: {
        configured: true,
        active: true,
        status: "ready",
        current: "0.1.5",
        stateStatus: "clean",
        readiness: { ready: true },
        update: {
          configStatus: "valid",
          policy: "manual",
          channel: "stable",
          asset: "linux-x64",
          sourceType: "github",
          source: "owner/repo",
        },
        manualOperations: {
          check: false,
          apply: false,
        },
      },
    },
  }));
}

describe("aboutSettingsTab", () => {
  it("renders system version and safe lode status fields", async () => {
    routeVersionFetch();

    renderWithProviders(<AboutSettingsTab />);

    await waitFor(() => expect(screen.getAllByText("0.1.5")).toHaveLength(2));
    expect(screen.getByText("abc123def456")).toBeInTheDocument();
    expect(screen.getByText("ready")).toBeInTheDocument();
    expect(screen.getByText("clean")).toBeInTheDocument();
    expect(screen.getByText("valid")).toBeInTheDocument();
    expect(screen.getByText("stable")).toBeInTheDocument();
    expect(screen.getByText("owner/repo")).toBeInTheDocument();
    expect(screen.getAllByText("Unsupported")).toHaveLength(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/system/version");
  });

  it("refreshes the version query without exposing manual controls", async () => {
    routeVersionFetch();

    renderWithProviders(<AboutSettingsTab />);
    await waitFor(() => expect(screen.getAllByText("0.1.5")).toHaveLength(2));

    expect(screen.queryByRole("button", { name: "Check for update" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Apply update" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Refresh" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });
});
