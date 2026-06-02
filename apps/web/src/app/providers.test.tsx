import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Providers } from "./providers";

function Boom(): never {
  throw new Error("kaboom");
}

describe("providers app-wide error boundary", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders a reloadable fallback instead of white-screening when a child throws", () => {
    // React logs caught render errors to console.error; silence the expected
    // noise so the suite output stays clean.
    vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <Providers>
        <Boom />
      </Providers>,
    );

    // The boundary swaps the crashed subtree for the fallback panel: assert on
    // its stable, translation-independent bits (the warning glyph + a control).
    expect(screen.getByText("⚠")).toBeInTheDocument();
    expect(screen.getAllByRole("button").length).toBeGreaterThan(0);
  });
});
