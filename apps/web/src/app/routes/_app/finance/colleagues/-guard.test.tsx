import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "@/shared/stores/auth";

// `index.lazy.tsx` exports only `Route`; collapse the route factory to an
// identity to reach the gating component, and stub the router's Navigate so
// the redirect target is observable without a mounted router. The page body
// is stubbed too — its behavior is covered by `-colleagues-page.test.tsx`.
vi.mock("@tanstack/react-router", () => ({
  createLazyFileRoute: () => (opts: { component: () => ReactNode }) => opts,
  Navigate: ({ to }: { to: string }) => <div data-testid="navigate" data-to={to} />,
}));

vi.mock("../-colleagues-page", () => ({
  FinanceColleaguesPage: () => <div data-testid="colleagues-page">finance colleagues</div>,
}));

const { Route } = await import("./index.lazy");
const GuardedPage = (Route as unknown as { component: () => ReactNode }).component;

afterEach(() => {
  useAuthStore.setState({ user: null, loading: true });
});

describe("finance colleagues route gating", () => {
  it("renders the page for an admin user", () => {
    useAuthStore.setState({ user: { role: "admin" } as never, loading: false });
    render(<GuardedPage />);
    expect(screen.getByTestId("colleagues-page")).toBeInTheDocument();
    expect(screen.queryByTestId("navigate")).not.toBeInTheDocument();
  });

  it("redirects a non-admin user to the overview route", () => {
    useAuthStore.setState({ user: { role: "user" } as never, loading: false });
    render(<GuardedPage />);
    const nav = screen.getByTestId("navigate");
    expect(nav).toHaveAttribute("data-to", "/overview");
    expect(screen.queryByTestId("colleagues-page")).not.toBeInTheDocument();
  });

  it("redirects when there is no authenticated user", () => {
    useAuthStore.setState({ user: null, loading: false });
    render(<GuardedPage />);
    expect(screen.getByTestId("navigate")).toHaveAttribute("data-to", "/overview");
  });
});
