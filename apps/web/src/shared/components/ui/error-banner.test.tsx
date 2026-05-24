import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ErrorBanner } from "./error-banner";

describe("errorBanner", () => {
  it("renders nothing when there is no message", () => {
    const { container } = render(<ErrorBanner message={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for an empty string", () => {
    const { container } = render(<ErrorBanner message="" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the message when present", () => {
    render(<ErrorBanner message="Something broke" />);
    expect(screen.getByText("Something broke")).toBeInTheDocument();
  });

  it("merges a custom className with the destructive alert styles", () => {
    render(<ErrorBanner message="oops" className="mt-4" />);
    expect(screen.getByText("oops")).toBeInTheDocument();
    const banner = screen.getByRole("alert");
    expect(banner.className).toContain("mt-4");
    expect(banner.className).toContain("text-destructive");
  });
});
