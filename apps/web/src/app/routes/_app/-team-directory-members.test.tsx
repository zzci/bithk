import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/utils";
import { TeamDirectoryMembersPanel } from "./-team-directory-members";

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

const members = [
  { id: "m1", userId: "u1", role: "editor" },
  { id: "m2", userId: "u2", role: "viewer" },
];
const users = [
  { id: "u1", username: "alice", name: "Alice" },
  { id: "u2", username: "bob", name: "Bob" },
  { id: "u3", username: "carol", name: "Carol" },
];

/** Route the three reads the panel issues, plus member mutations. */
function routeFetch(role: "admin" | "viewer", onMutate?: (method: string) => Response) {
  fetchMock.mockImplementation(async (url, init) => {
    const method = (init?.method ?? "GET").toUpperCase();
    const path = String(url);
    if (method !== "GET" && onMutate)
      return onMutate(method);
    if (path.includes("/account/visible-users"))
      return jsonResponse({ success: true, data: users });
    if (path.endsWith("/members"))
      return jsonResponse({ success: true, data: members });
    // directory view carries the caller's effective role
    return jsonResponse({ success: true, data: { id: "td1", name: "Design", role } });
  });
}

describe("teamDirectoryMembersPanel", () => {
  it("does not fetch the directory or members while closed", async () => {
    routeFetch("admin");
    renderWithProviders(<TeamDirectoryMembersPanel directoryId="td1" open={false} onOpenChange={() => {}} />);
    // The directory + members reads are gated on `open`; only the shared
    // visible-users lookup (ungated, cached) may fire.
    await waitFor(() => {
      const calls = fetchMock.mock.calls.map(c => String(c[0]));
      expect(calls.some(u => u.endsWith("/members"))).toBe(false);
      expect(calls.some(u => /\/team-directories\/td1$/.test(u))).toBe(false);
    });
  });

  it("lists members and shows the admin add panel + remove controls for an admin", async () => {
    routeFetch("admin");
    renderWithProviders(<TeamDirectoryMembersPanel directoryId="td1" open onOpenChange={() => {}} />);
    expect(await screen.findByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByText("Add user")).toBeInTheDocument();
    // One remove button per member.
    expect(screen.getAllByRole("button", { name: "Remove" })).toHaveLength(2);
  });

  it("removes a member via DELETE when the admin clicks remove", async () => {
    const user = userEvent.setup();
    routeFetch("admin", () => jsonResponse({ success: true, data: { id: "m1" } }));
    renderWithProviders(<TeamDirectoryMembersPanel directoryId="td1" open onOpenChange={() => {}} />);
    await screen.findByText("Alice");
    await user.click(screen.getAllByRole("button", { name: "Remove" })[0]!);
    await waitFor(() => {
      const del = fetchMock.mock.calls.find(c => (c[1]?.method ?? "GET").toUpperCase() === "DELETE");
      expect(del).toBeTruthy();
      expect(String(del![0])).toBe("/api/drive/team-directories/td1/members/m1");
    });
  });

  it("renders a read-only roster for a non-admin", async () => {
    routeFetch("viewer");
    renderWithProviders(<TeamDirectoryMembersPanel directoryId="td1" open onOpenChange={() => {}} />);
    await screen.findByText("Alice");
    expect(screen.queryByText("Add user")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
    // Roles surface as read-only badges instead of editable selects.
    expect(screen.getByText("Editor")).toBeInTheDocument();
    expect(screen.getByText("Viewer")).toBeInTheDocument();
  });

  it("shows the empty hint when there are no members", async () => {
    fetchMock.mockImplementation(async (url) => {
      const path = String(url);
      if (path.includes("/account/visible-users"))
        return jsonResponse({ success: true, data: users });
      if (path.endsWith("/members"))
        return jsonResponse({ success: true, data: [] });
      return jsonResponse({ success: true, data: { id: "td1", name: "Design", role: "admin" } });
    });
    renderWithProviders(<TeamDirectoryMembersPanel directoryId="td1" open onOpenChange={() => {}} />);
    expect(await screen.findByText("No members yet")).toBeInTheDocument();
  });
});
