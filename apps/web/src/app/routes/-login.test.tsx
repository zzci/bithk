import type { ReactNode } from "react";
import { screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "@/shared/stores/auth";
import { renderWithProviders } from "@/test/utils";

const mocks = vi.hoisted(() => ({
  fetchUser: vi.fn(),
  http: vi.fn(),
  useSearch: vi.fn<() => { redirect: string | undefined }>(() => ({ redirect: undefined })),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: { component: () => ReactNode }) => ({
    ...opts,
    useSearch: mocks.useSearch,
  }),
  Navigate: ({ to, replace }: { to: string; replace?: boolean }) => (
    <div data-testid="navigate" data-replace={String(!!replace)} data-to={to} />
  ),
}));

vi.mock("@/shared/lib/http", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    BASE_PATH: "",
    http: (path: string, init?: RequestInit) => mocks.http(path, init),
  };
});

const { LoginPage } = await import("./login");

beforeEach(() => {
  mocks.fetchUser.mockReset();
  mocks.http.mockReset();
  mocks.useSearch.mockReset();
  mocks.useSearch.mockReturnValue({ redirect: undefined });
  useAuthStore.setState({
    user: null,
    loading: true,
    fetchUser: mocks.fetchUser,
  } as never);
});

describe("login page session reuse", () => {
  it("redirects an already-authenticated browser without rendering login mode", async () => {
    mocks.useSearch.mockReturnValue({ redirect: "/drive?view=recent" });
    mocks.fetchUser.mockResolvedValue({ kind: "ok" });

    renderWithProviders(<LoginPage />);

    await waitFor(() => {
      expect(screen.getByTestId("navigate")).toHaveAttribute("data-to", "/drive?view=recent");
    });
    expect(screen.getByTestId("navigate")).toHaveAttribute("data-replace", "true");
    expect(mocks.http).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Username")).not.toBeInTheDocument();
  });

  it("renders the single-user form after a clean unauthenticated response", async () => {
    mocks.fetchUser.mockResolvedValue({ kind: "unauthorized" });
    mocks.http.mockResolvedValue({
      success: true,
      data: { mode: "single-user", oauthConfigured: false },
    });

    renderWithProviders(<LoginPage />);

    expect(await screen.findByLabelText("Username")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(mocks.http).toHaveBeenCalledWith("/account/auth/mode", undefined);
  });
});
