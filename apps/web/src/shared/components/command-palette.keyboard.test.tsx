import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "@/shared/stores/auth";
import { renderWithProviders } from "@/test/utils";
import { CommandPalette } from "./command-palette";

const navigateMock = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
}));

const ALL_MODULES = ["documents", "drive", "projects", "contacts", "hr"];

beforeEach(() => {
  navigateMock.mockReset();
  useAuthStore.setState({ user: { role: "user", modules: ALL_MODULES } as never, loading: false });
});

afterEach(() => {
  useAuthStore.setState({ user: null, loading: true });
});

describe("commandPalette role filtering", () => {
  it("omits admin destinations for a non-admin user", async () => {
    renderWithProviders(<CommandPalette open onOpenChange={() => {}} />);
    expect(await screen.findByText("Overview")).toBeInTheDocument();
    expect(screen.queryByText("Users")).not.toBeInTheDocument();
    expect(screen.queryByText("Audit Log")).not.toBeInTheDocument();
  });

  it("includes admin destinations for an admin user", async () => {
    useAuthStore.setState({ user: { role: "admin", modules: ALL_MODULES } as never, loading: false });
    renderWithProviders(<CommandPalette open onOpenChange={() => {}} />);
    expect(await screen.findByText("Users")).toBeInTheDocument();
    expect(screen.getByText("Audit Log")).toBeInTheDocument();
  });
});

describe("commandPalette keyboard navigation", () => {
  it("moves the active row with arrow keys and activates it with Enter", async () => {
    const user = userEvent.setup();
    renderWithProviders(<CommandPalette open onOpenChange={() => {}} />);

    const input = await screen.findByRole("textbox");
    const rows = () => screen.getAllByRole("button").filter(b => b.hasAttribute("data-active"));

    // First quick entry is active on open.
    expect(rows()[0]).toHaveAttribute("data-active", "true");
    expect(rows()[0]).toHaveTextContent("Overview");

    await user.click(input);
    await user.keyboard("{ArrowDown}");
    // Active moves off the first row onto the second (Documents).
    const active = rows().find(b => b.getAttribute("data-active") === "true");
    expect(active).toHaveTextContent("Documents");

    await user.keyboard("{ArrowUp}");
    expect(rows().find(b => b.getAttribute("data-active") === "true")).toHaveTextContent("Overview");

    await user.keyboard("{Enter}");
    expect(navigateMock).toHaveBeenCalledWith({ to: "/overview", search: {} });
  });
});
