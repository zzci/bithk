import type { ReactNode } from "react";
import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/utils";

// `hr.tsx` exports only `Route`; collapse the route factory to an identity to
// reach the layout component, and stub the router primitives so the rendered
// child slot is observable without a mounted router. Access gating is no
// longer the layout's job — the generic `_app` module guard owns it
// (see `-module-guard.test.tsx`).
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: { component: () => ReactNode }) => opts,
  Outlet: () => <div data-testid="outlet" />,
  useNavigate: () => vi.fn(),
  useRouterState: ({ select }: { select: (s: { location: { pathname: string } }) => unknown }) =>
    select({ location: { pathname: "/hr/colleagues" } }),
}));

const { Route } = await import("./hr");
const HrLayout = (Route as unknown as { component: () => ReactNode }).component;

describe("hr layout tabs", () => {
  it("renders the tab nav and outlet", () => {
    renderWithProviders(<HrLayout />);
    expect(screen.getByTestId("outlet")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Colleagues" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Approvals" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Payroll" })).toBeInTheDocument();
  });
});
