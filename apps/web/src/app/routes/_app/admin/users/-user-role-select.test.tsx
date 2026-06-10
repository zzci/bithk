import type { GlobalRoleView } from "@/shared/lib/api/global-roles";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/utils";
import { UserRoleSelect } from "./-user-role-select";

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

const ROLES: GlobalRoleView[] = [
  {
    id: "sys",
    name: "Member",
    modules: ["documents", "drive", "projects", "ships", "contacts"],
    isSystem: true,
    kind: "default",
    createdAt: "2026-06-10T00:00:00.000Z",
    updatedAt: "2026-06-10T00:00:00.000Z",
  },
  {
    id: "r1",
    name: "Docs only",
    modules: ["documents"],
    isSystem: false,
    kind: null,
    createdAt: "2026-06-10T00:00:00.000Z",
    updatedAt: "2026-06-10T00:00:00.000Z",
  },
];

function routeFetch() {
  fetchMock.mockImplementation(async (_url, init) => {
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "GET")
      return jsonResponse({ success: true, data: ROLES });
    return jsonResponse({ success: true, data: null });
  });
}

describe("userRoleSelect", () => {
  it("preselects the default role when globalRoleId is null", async () => {
    routeFetch();
    renderWithProviders(<UserRoleSelect userId="u1" globalRoleId={null} onAssigned={() => {}} />);
    expect(await screen.findByRole("combobox", { name: "Role" })).toHaveTextContent("Member");
  });

  it("shows the assigned role when globalRoleId is set", async () => {
    routeFetch();
    renderWithProviders(<UserRoleSelect userId="u1" globalRoleId="r1" onAssigned={() => {}} />);
    expect(await screen.findByRole("combobox", { name: "Role" })).toHaveTextContent("Docs only");
  });

  it("assigns a role via PATCH and notifies the parent", async () => {
    const user = userEvent.setup({ delay: null, pointerEventsCheck: 0 });
    const onAssigned = vi.fn();
    routeFetch();
    renderWithProviders(<UserRoleSelect userId="u1" globalRoleId={null} onAssigned={onAssigned} />);

    await user.click(await screen.findByRole("combobox", { name: "Role" }));
    await user.click(await screen.findByRole("option", { name: "Docs only" }));

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(c => (c[1]?.method ?? "GET").toUpperCase() === "PATCH");
      expect(patch).toBeTruthy();
      expect(String(patch![0])).toBe("/api/account/users/u1");
      expect(JSON.parse(String(patch![1]?.body))).toEqual({ globalRoleId: "r1" });
      expect(onAssigned).toHaveBeenCalled();
    });
  });

  it("does not PATCH when re-selecting the current role", async () => {
    const user = userEvent.setup({ delay: null, pointerEventsCheck: 0 });
    routeFetch();
    renderWithProviders(<UserRoleSelect userId="u1" globalRoleId={null} onAssigned={() => {}} />);

    await user.click(await screen.findByRole("combobox", { name: "Role" }));
    await user.click(await screen.findByRole("option", { name: "Member" }));

    expect(fetchMock.mock.calls.every(c => (c[1]?.method ?? "GET").toUpperCase() === "GET")).toBe(true);
  });
});
