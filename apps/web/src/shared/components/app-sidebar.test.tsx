import type { AnchorHTMLAttributes, ReactNode } from "react";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SidebarProvider } from "@/shared/components/ui/sidebar";
import { useAuthStore } from "@/shared/stores/auth";
import { renderWithProviders } from "@/test/utils";
import { AppSidebar } from "./app-sidebar";

// Router primitives the sidebar consumes. `currentPathname` is mutable so each
// test can place the active route where it needs it.
let currentPathname = "/overview";
const logoutMock = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string; children: ReactNode }) => (
    <a href={to} {...rest}>{children}</a>
  ),
  useRouterState: () => ({ location: { pathname: currentPathname } }),
  useNavigate: () => vi.fn(),
}));

const ALL_MODULES = ["documents", "drive", "projects", "ships", "contacts", "hr"];

const adminUser = {
  id: "u1",
  username: "alice",
  name: "Alice Liddell",
  email: "alice@example.com",
  role: "admin" as const,
  modules: ALL_MODULES,
};

const normalUser = { ...adminUser, role: "user" as const, name: "Bob Stone", email: "bob@example.com" };

function renderSidebar() {
  return renderWithProviders(
    <SidebarProvider>
      <AppSidebar />
    </SidebarProvider>,
  );
}

beforeEach(() => {
  currentPathname = "/overview";
  logoutMock.mockReset();
  useAuthStore.setState({ user: normalUser as never, loading: false, logout: logoutMock as never });
});

afterEach(() => {
  useAuthStore.setState({ user: null, loading: true });
});

describe("appSidebar navigation", () => {
  it("renders the overview destinations and the search entry", () => {
    renderSidebar();
    expect(screen.getByRole("link", { name: /Overview/ })).toHaveAttribute("href", "/overview");
    expect(screen.getByRole("link", { name: /Documents/ })).toHaveAttribute("href", "/documents");
    expect(screen.getByRole("link", { name: /Drive/ })).toHaveAttribute("href", "/drive");
    expect(screen.getByRole("link", { name: /Projects/ })).toHaveAttribute("href", "/projects");
    expect(screen.getByRole("button", { name: /Search/ })).toBeInTheDocument();
  });

  it("highlights the active route only", () => {
    currentPathname = "/documents";
    renderSidebar();
    // base-ui marks the active item with a bare `data-active` attribute and
    // omits it entirely otherwise.
    expect(screen.getByRole("link", { name: /Documents/ })).toHaveAttribute("data-active");
    expect(screen.getByRole("link", { name: /Overview/ })).not.toHaveAttribute("data-active");
  });
});

describe("appSidebar module visibility", () => {
  it("shows granted modules and hides the rest", () => {
    const user = { ...normalUser, modules: ["documents", "ships"] };
    useAuthStore.setState({ user: user as never, loading: false, logout: logoutMock as never });
    renderSidebar();
    expect(screen.getByRole("link", { name: /Documents/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Ships/ })).toBeInTheDocument();
    // Ungated entries stay visible regardless of the module set.
    expect(screen.getByRole("link", { name: /Overview/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Drive/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Projects/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Contacts/ })).not.toBeInTheDocument();
  });

  it("shows every module to a user granted all keys", () => {
    renderSidebar();
    for (const name of [/Documents/, /Drive/, /Projects/, /Ships/, /Contacts/]) {
      expect(screen.getByRole("link", { name })).toBeInTheDocument();
    }
  });
});

describe("appSidebar role-based menu visibility", () => {
  it("hides admin navigation from a normal user", () => {
    renderSidebar();
    expect(screen.queryByRole("link", { name: "Users" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Audit Log" })).not.toBeInTheDocument();
  });

  it("shows admin navigation to an admin user", () => {
    useAuthStore.setState({ user: adminUser as never, loading: false, logout: logoutMock as never });
    renderSidebar();
    expect(screen.getByRole("link", { name: "Users" })).toHaveAttribute("href", "/admin/users");
    expect(screen.getByRole("link", { name: "Policies" })).toHaveAttribute("href", "/admin/policies");
    expect(screen.getByRole("link", { name: "Audit Log" })).toHaveAttribute("href", "/admin/audit");
    expect(screen.getByRole("link", { name: "Cron" })).toHaveAttribute("href", "/admin/cron");
  });
});

describe("appSidebar interactions", () => {
  it("opens the command palette on Ctrl/Cmd+K", async () => {
    renderSidebar();
    expect(screen.queryByPlaceholderText(/Search documents/)).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(await screen.findByPlaceholderText(/Search documents/)).toBeInTheDocument();
  });

  it("collapses the sidebar via the collapse toggle", async () => {
    const user = userEvent.setup();
    renderSidebar();
    const collapse = screen.getByRole("button", { name: "Collapse sidebar" });
    await user.click(collapse);
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Collapse sidebar" })).not.toBeInTheDocument(),
    );
  });

  it("exposes the signed-in user and a logout action in the account menu", async () => {
    const user = userEvent.setup();
    renderSidebar();
    expect(screen.getByText("Bob Stone")).toBeInTheDocument();
    await user.click(screen.getByText("Bob Stone"));
    const logout = await screen.findByText("Logout");
    await user.click(logout);
    expect(logoutMock).toHaveBeenCalled();
  });

  it("opens the Tally popup from the feedback button when the widget is loaded", async () => {
    const user = userEvent.setup();
    const openPopup = vi.fn();
    window.Tally = { openPopup };
    try {
      renderSidebar();
      await user.click(screen.getByRole("button", { name: "Feedback" }));
      expect(openPopup).toHaveBeenCalledWith("jaEZP1", { width: 480, hideTitle: true });
    }
    finally {
      delete window.Tally;
    }
  });

  it("falls back to opening the Tally form in a new tab when the widget is missing", async () => {
    const user = userEvent.setup();
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    try {
      renderSidebar();
      await user.click(screen.getByRole("button", { name: "Feedback" }));
      expect(openSpy).toHaveBeenCalledWith("https://tally.so/r/jaEZP1", "_blank", "noopener");
    }
    finally {
      openSpy.mockRestore();
    }
  });
});
