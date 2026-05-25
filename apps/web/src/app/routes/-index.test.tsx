import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: { component: () => ReactNode }) => opts,
  Navigate: ({ to }: { to: string }) => <div data-testid="navigate" data-to={to} />,
}));

const { IndexRedirect } = await import("./index");

describe("index redirect", () => {
  it("sends the root route to the authenticated app guard", () => {
    render(<IndexRedirect />);
    expect(screen.getByTestId("navigate")).toHaveAttribute("data-to", "/overview");
  });
});
