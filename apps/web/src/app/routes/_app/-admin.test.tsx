import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "@/shared/stores/auth";

// `admin.tsx` exports only `Route`; collapse the route factory to an identity
// to reach the gating component, and stub the router primitives it renders so
// the redirect target / outlet are observable without a mounted router.
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: { component: () => ReactNode }) => opts,
  Navigate: ({ to }: { to: string }) => <div data-testid="navigate" data-to={to} />,
  Outlet: () => <div data-testid="outlet">admin area</div>,
}));

const { Route } = await import("./admin");
const AdminLayout = (Route as unknown as { component: () => ReactNode }).component;

afterEach(() => {
  useAuthStore.setState({ user: null, loading: true });
});

describe("adminLayout gating", () => {
  it("renders the admin outlet for an admin user", () => {
    useAuthStore.setState({ user: { role: "admin" } as never, loading: false });
    render(<AdminLayout />);
    expect(screen.getByTestId("outlet")).toBeInTheDocument();
    expect(screen.queryByTestId("navigate")).not.toBeInTheDocument();
  });

  it("redirects a non-admin user to the overview route", () => {
    useAuthStore.setState({ user: { role: "user" } as never, loading: false });
    render(<AdminLayout />);
    const nav = screen.getByTestId("navigate");
    expect(nav).toHaveAttribute("data-to", "/overview");
    expect(screen.queryByTestId("outlet")).not.toBeInTheDocument();
  });

  it("redirects when there is no authenticated user", () => {
    useAuthStore.setState({ user: null, loading: false });
    render(<AdminLayout />);
    expect(screen.getByTestId("navigate")).toHaveAttribute("data-to", "/overview");
  });
});
