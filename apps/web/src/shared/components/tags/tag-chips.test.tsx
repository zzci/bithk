import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TagChips } from "./tag-chips";

const TAGS = [
  { id: "1", name: "alpha" },
  { id: "2", name: "beta" },
  { id: "3", name: "gamma" },
];

describe("tagChips", () => {
  it("renders a chip per tag when no max is set", () => {
    render(<TagChips tags={TAGS} />);
    expect(screen.getByText("alpha")).toBeInTheDocument();
    expect(screen.getByText("beta")).toBeInTheDocument();
    expect(screen.getByText("gamma")).toBeInTheDocument();
  });

  it("renders exactly `max` chips plus a +K overflow node", () => {
    render(<TagChips tags={TAGS} max={2} />);
    expect(screen.getByText("alpha")).toBeInTheDocument();
    expect(screen.getByText("beta")).toBeInTheDocument();
    expect(screen.queryByText("gamma")).not.toBeInTheDocument();
    expect(screen.getByText("+1")).toBeInTheDocument();
  });
});
