import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/utils";
import { PaginationFooter } from "./pagination-footer";

describe("paginationFooter", () => {
  it("renders the total label and prev/next using common i18n copy", () => {
    renderWithProviders(
      <PaginationFooter page={1} totalPages={3} totalLabel="42 total" onPrev={() => {}} onNext={() => {}} />,
    );
    expect(screen.getByText("42 total")).toBeInTheDocument();
    // Guards the recurring i18n-key regression: keys must resolve to real copy.
    expect(screen.getByRole("button", { name: "Previous" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeInTheDocument();
  });

  it("disables prev on the first page", () => {
    renderWithProviders(
      <PaginationFooter page={1} totalPages={3} totalLabel="x" onPrev={() => {}} onNext={() => {}} />,
    );
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next" })).toBeEnabled();
  });

  it("disables next on the last page", () => {
    renderWithProviders(
      <PaginationFooter page={3} totalPages={3} totalLabel="x" onPrev={() => {}} onNext={() => {}} />,
    );
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Previous" })).toBeEnabled();
  });

  it("fires the page callbacks on a middle page", () => {
    const onPrev = vi.fn();
    const onNext = vi.fn();
    renderWithProviders(
      <PaginationFooter page={2} totalPages={3} totalLabel="x" onPrev={onPrev} onNext={onNext} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(onPrev).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it("does not fire the callback when the button is disabled", () => {
    const onPrev = vi.fn();
    renderWithProviders(
      <PaginationFooter page={1} totalPages={3} totalLabel="x" onPrev={onPrev} onNext={() => {}} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    expect(onPrev).not.toHaveBeenCalled();
  });
});
