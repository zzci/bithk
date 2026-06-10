import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "@/shared/stores/auth";

// Stub the router primitives: the redirect target is observable via the
// Navigate stub, and `currentPathname` places the guard on any route.
let currentPathname = "/overview";

vi.mock("@tanstack/react-router", () => ({
  Navigate: ({ to }: { to: string }) => <div data-testid="navigate" data-to={to} />,
  useRouterState: ({ select }: { select: (s: { location: { pathname: string } }) => unknown }) =>
    select({ location: { pathname: currentPathname } }),
}));

const { ModuleGuard, routeModule } = await import("./-module-guard");

function setUser(modules: readonly string[]) {
  useAuthStore.setState({ user: { role: "user", modules } as never, loading: false });
}

function renderGuard(pathname: string) {
  currentPathname = pathname;
  return render(
    <ModuleGuard>
      <div data-testid="content" />
    </ModuleGuard>,
  );
}

afterEach(() => {
  useAuthStore.setState({ user: null, loading: true });
});

describe("routeModule", () => {
  it("maps module route groups to their module key", () => {
    expect(routeModule("/documents")).toBe("documents");
    expect(routeModule("/drive/some/folder")).toBe("drive");
    expect(routeModule("/projects/p1/issues/i1")).toBe("projects");
    expect(routeModule("/ships/s1")).toBe("ships");
    expect(routeModule("/contacts")).toBe("contacts");
    expect(routeModule("/hr/payroll")).toBe("hr");
  });

  it("returns null for ungated routes", () => {
    expect(routeModule("/overview")).toBeNull();
    expect(routeModule("/admin/users")).toBeNull();
    // Prefix matching is segment-aware: a sibling route that merely shares
    // the leading characters is not captured.
    expect(routeModule("/documentsarchive")).toBeNull();
  });
});

describe("moduleGuard", () => {
  it("renders the route content when the module is granted", () => {
    setUser(["documents"]);
    renderGuard("/documents");
    expect(screen.getByTestId("content")).toBeInTheDocument();
    expect(screen.queryByTestId("navigate")).not.toBeInTheDocument();
  });

  it("redirects to /overview for a hidden module", () => {
    setUser(["documents"]);
    renderGuard("/hr/colleagues");
    expect(screen.getByTestId("navigate")).toHaveAttribute("data-to", "/overview");
    expect(screen.queryByTestId("content")).not.toBeInTheDocument();
  });

  it("always passes ungated routes through", () => {
    setUser([]);
    renderGuard("/overview");
    expect(screen.getByTestId("content")).toBeInTheDocument();
  });

  it("fails closed while no user is loaded", () => {
    useAuthStore.setState({ user: null, loading: false });
    renderGuard("/documents");
    expect(screen.getByTestId("navigate")).toHaveAttribute("data-to", "/overview");
  });
});
