import type { ReactNode } from "react";
import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "@/shared/stores/auth";
import { renderWithProviders } from "@/test/utils";

// `hr.tsx` exports only `Route`; collapse the route factory to an identity to
// reach the layout component, and stub the router primitives so the redirect
// target and the rendered child slot are observable without a mounted router.
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: { component: () => ReactNode }) => opts,
  Navigate: ({ to }: { to: string }) => <div data-testid="navigate" data-to={to} />,
  Outlet: () => <div data-testid="outlet" />,
  useNavigate: () => vi.fn(),
  useRouterState: ({ select }: { select: (s: { location: { pathname: string } }) => unknown }) =>
    select({ location: { pathname: "/hr/colleagues" } }),
}));

const { Route } = await import("./hr");
const HrLayout = (Route as unknown as { component: () => ReactNode }).component;

afterEach(() => {
  useAuthStore.setState({ user: null, loading: true });
});

describe("hr layout gating and tabs", () => {
  it("renders the tab nav and outlet for an admin user", () => {
    useAuthStore.setState({ user: { role: "admin" } as never, loading: false });
    renderWithProviders(<HrLayout />);
    expect(screen.getByTestId("outlet")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Colleagues" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Approvals" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Payroll" })).toBeInTheDocument();
    expect(screen.queryByTestId("navigate")).not.toBeInTheDocument();
  });

  it("redirects a non-admin user to the overview route", () => {
    useAuthStore.setState({ user: { role: "user" } as never, loading: false });
    renderWithProviders(<HrLayout />);
    const nav = screen.getByTestId("navigate");
    expect(nav).toHaveAttribute("data-to", "/overview");
    expect(screen.queryByTestId("outlet")).not.toBeInTheDocument();
  });

  it("redirects when there is no authenticated user", () => {
    useAuthStore.setState({ user: null, loading: false });
    renderWithProviders(<HrLayout />);
    expect(screen.getByTestId("navigate")).toHaveAttribute("data-to", "/overview");
  });
});
