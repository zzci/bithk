import type { ReactNode } from "react";
import { screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "@/shared/stores/auth";
import { renderWithProviders } from "@/test/utils";

// The overview route only exports `Route`; its component is closed over by
// `createLazyFileRoute`. Reduce the route factory to an identity so the test
// can reach `Route.component`, and stub `Link` as a plain anchor (no router
// context is mounted here).
vi.mock("@tanstack/react-router", () => ({
  createLazyFileRoute: () => (opts: { component: () => ReactNode }) => opts,
  Link: ({ to, children }: { to: string; children: ReactNode }) => (
    <a href={to} data-testid="tile-link">{children}</a>
  ),
}));

const { Route } = await import("./overview.lazy");
// The mock collapses the route to its plain options object; reach the component.
const OverviewPage = (Route as unknown as { component: () => ReactNode }).component;

beforeEach(() => {
  useAuthStore.setState({
    user: { name: "Alice Liddell", username: "alice" } as never,
    loading: false,
  });
});

afterEach(() => {
  useAuthStore.setState({ user: null, loading: true });
});

describe("overviewPage", () => {
  it("greets the signed-in user by name and shows the page description", () => {
    renderWithProviders(<OverviewPage />);
    expect(screen.getByRole("heading", { name: "Welcome, Alice Liddell" })).toBeInTheDocument();
    expect(screen.getByText("Welcome to your workspace.")).toBeInTheDocument();
  });

  it("falls back to the username when the display name is absent", () => {
    useAuthStore.setState({ user: { username: "bob" } as never, loading: false });
    renderWithProviders(<OverviewPage />);
    expect(screen.getByRole("heading", { name: "Welcome, bob" })).toBeInTheDocument();
  });

  it("renders an empty greeting when no user is loaded", () => {
    useAuthStore.setState({ user: null, loading: false });
    renderWithProviders(<OverviewPage />);
    // Interpolation collapses to the bare prefix when name is "".
    expect(screen.getByRole("heading", { name: /Welcome,/ })).toBeInTheDocument();
  });

  it("renders a navigable tile per registered destination with i18n copy", () => {
    renderWithProviders(<OverviewPage />);
    const links = screen.getAllByTestId("tile-link");
    expect(links).toHaveLength(2);

    const projects = screen.getByRole("link", { name: /Projects/ });
    const documents = screen.getByRole("link", { name: /Documents/ });
    expect(projects).toHaveAttribute("href", "/projects");
    expect(documents).toHaveAttribute("href", "/documents");

    expect(screen.getByText("Browse projects and their work orders.")).toBeInTheDocument();
    expect(screen.getByText("Browse and edit documents.")).toBeInTheDocument();
  });
});
