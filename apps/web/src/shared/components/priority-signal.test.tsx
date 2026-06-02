import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PriorityGlyph, PrioritySignal } from "./priority-signal";

describe("prioritySignal", () => {
  it("exposes the label as an accessible image", () => {
    render(<PrioritySignal priority="high" label="High priority" />);
    expect(screen.getByRole("img", { name: "High priority" })).toBeInTheDocument();
  });

  it("renders medium and high with visually distinct glyphs and colors", () => {
    const { container: medium } = render(<PrioritySignal priority="medium" label="Medium" />);
    const { container: high } = render(<PrioritySignal priority="high" label="High" />);

    const mediumIcon = medium.querySelector("svg");
    const highIcon = high.querySelector("svg");

    // Different signal-bar glyph...
    expect(mediumIcon).toHaveClass("lucide-signal-medium");
    expect(highIcon).toHaveClass("lucide-signal-high");
    // ...and a different token color (info/blue vs warning/yellow).
    expect(mediumIcon).toHaveClass("text-info");
    expect(highIcon).toHaveClass("text-warning");
  });

  it("renders a tinted chip behind the urgent glyph", () => {
    const { container } = render(<PrioritySignal priority="urgent" label="Urgent" />);
    expect(container.querySelector("svg")).toHaveClass("lucide-signal", "text-destructive");
    expect(container.querySelector("span > span")).toHaveClass("bg-destructive/15");
  });

  it("renders the glyph variant as decorative (aria-hidden, no accessible name)", () => {
    render(<PriorityGlyph priority="low" />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});
