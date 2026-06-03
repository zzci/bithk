import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TagChip } from "./tag-chip";

describe("tagChip", () => {
  it("renders the label", () => {
    render(<TagChip label="alpha" />);
    expect(screen.getByText("alpha")).toBeInTheDocument();
  });

  it("renders a remove button and calls onRemove when removable", () => {
    const onRemove = vi.fn();
    render(<TagChip label="alpha" removable removeLabel="Remove tag alpha" onRemove={onRemove} />);

    const button = screen.getByRole("button", { name: "Remove tag alpha" });
    fireEvent.click(button);
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("renders no button when not removable", () => {
    render(<TagChip label="alpha" />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
