import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "@/test/utils";
import { CoverImage } from "./cover-image";

describe("coverImage", () => {
  it("opens a lightbox on click and closes on Escape when enabled", async () => {
    renderWithProviders(
      <CoverImage src="/x.jpg" kind="ship" enableLightbox className="h-28 w-full" />,
    );

    const trigger = screen.getByRole("button", { name: "View larger image" });
    await userEvent.click(trigger);

    const dialog = await screen.findByRole("dialog");
    // The thumbnail img has alt="" (presentation); only the dialog img carries
    // an accessible name, so it resolves uniquely within the dialog.
    expect(within(dialog).getByRole("img", { name: "Cover image" })).toBeInTheDocument();

    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("renders the placeholder with no trigger when src is null", () => {
    renderWithProviders(<CoverImage src={null} kind="project" />);
    expect(screen.queryByRole("button", { name: "View larger image" })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders a plain img with no trigger when enableLightbox is omitted", () => {
    const { container } = renderWithProviders(<CoverImage src="/x.jpg" kind="ship" />);
    expect(screen.queryByRole("button", { name: "View larger image" })).not.toBeInTheDocument();
    expect(container.querySelector("img[data-slot=\"card-media\"]")).not.toBeNull();
  });
});
