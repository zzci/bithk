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

  it("floats the close button on the preview image and caps its size", async () => {
    renderWithProviders(
      <CoverImage src="/x.jpg" kind="project" enableLightbox className="h-28 w-full" />,
    );

    await userEvent.click(screen.getByRole("button", { name: "View larger image" }));
    const dialog = await screen.findByRole("dialog");
    const image = within(dialog).getByRole("img", { name: "Cover image" });
    const close = within(dialog).getByRole("button", { name: "Close" });

    // The close control sits in the image's own positioned wrapper, so it lands
    // on the picture's top-right corner instead of a wide popup corner.
    expect(close.parentElement).toBe(image.parentElement);
    expect(image.parentElement?.className).toContain("relative");
    expect(close.className).toContain("absolute");
    expect(close.className).toContain("top-2");
    expect(close.className).toContain("right-2");

    // The popup shrink-wraps the image (no viewport-wide box), and the image
    // itself carries the standard size cap.
    expect(dialog.className).toContain("w-auto");
    expect(dialog.className).toContain("max-w-none");
    expect(dialog.className).not.toContain("max-w-[");
    expect(image.className).toContain("max-h-[80vh]");
    expect(image.className).toContain("object-contain");
  });

  it("closes when the blank area around the image is clicked", async () => {
    renderWithProviders(
      <CoverImage src="/x.jpg" kind="ship" enableLightbox className="h-28 w-full" />,
    );

    await userEvent.click(screen.getByRole("button", { name: "View larger image" }));
    await screen.findByRole("dialog");

    const backdrop = document.querySelector("[data-slot='dialog-overlay']");
    expect(backdrop).not.toBeNull();
    await userEvent.click(backdrop!);
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
