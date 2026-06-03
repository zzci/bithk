import type { FilterDimension } from "./list-filter";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/utils";
import { ListFilter } from "./list-filter";

afterEach(() => {
  vi.restoreAllMocks();
});

// A single-select dimension (matches a status filter): default "__active__".
function singleDim(overrides: Partial<Extract<FilterDimension, { mode: "single" }>> = {}): FilterDimension {
  return {
    key: "status",
    label: "Status",
    mode: "single",
    defaultValue: "__active__",
    value: "__active__",
    onChange: () => {},
    options: [
      { value: "__active__", label: "Active", count: 3 },
      { value: "__archived__", label: "Archived", count: 1 },
    ],
    ...overrides,
  };
}

// A multi-select dimension (everything lives in the dropdown).
function multiDim(overrides: Partial<Extract<FilterDimension, { mode: "multi" }>> = {}): FilterDimension {
  return {
    key: "labels",
    label: "Labels",
    mode: "multi",
    value: [],
    onChange: () => {},
    options: [
      { value: "l0", label: "red" },
      { value: "l1", label: "green" },
    ],
    ...overrides,
  };
}

describe("listFilter (single-select dimension)", () => {
  it("shows the dimension label and no remove/clear while at the default", () => {
    renderWithProviders(<ListFilter dimensions={[singleDim()]} />);

    expect(screen.getByRole("button", { name: "Status" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Remove/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Clear filters" })).not.toBeInTheDocument();
  });

  it("opens its own dropdown and selects an option", async () => {
    const onChange = vi.fn();
    renderWithProviders(<ListFilter dimensions={[singleDim({ onChange })]} />);

    await userEvent.click(screen.getByRole("button", { name: "Status" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /Archived/ }));
    expect(onChange).toHaveBeenCalledWith("__archived__");
  });

  it("when active, shows the selected value and a connected remove that resets to default", async () => {
    const onChange = vi.fn();
    renderWithProviders(<ListFilter dimensions={[singleDim({ value: "__archived__", onChange })]} />);

    // Trigger now reads the selected value rather than the dimension label.
    expect(screen.getByRole("button", { name: "Archived" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Remove Archived" }));
    expect(onChange).toHaveBeenCalledWith("__active__");
  });

  it("resets to null when no defaultValue is configured", async () => {
    const onChange = vi.fn();
    const dim: FilterDimension = {
      key: "status",
      label: "Status",
      mode: "single",
      value: "__archived__",
      onChange,
      options: [
        { value: "__active__", label: "Active" },
        { value: "__archived__", label: "Archived" },
      ],
    };
    renderWithProviders(<ListFilter dimensions={[dim]} />);

    await userEvent.click(screen.getByRole("button", { name: "Remove Archived" }));
    expect(onChange).toHaveBeenCalledWith(null);
  });
});

describe("listFilter (multi-select dimension)", () => {
  it("keeps the dimension label on the trigger and toggles options immutably", async () => {
    const onChange = vi.fn();
    renderWithProviders(<ListFilter dimensions={[multiDim({ value: ["l0"], onChange })]} />);

    await userEvent.click(screen.getByRole("button", { name: /Labels/ }));
    expect(await screen.findByRole("menuitemcheckbox", { name: "red", checked: true })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("menuitemcheckbox", { name: "green", checked: false }));
    expect(onChange).toHaveBeenCalledWith(["l0", "l1"]);
  });

  it("renders one removable chip per selected value", async () => {
    const onChange = vi.fn();
    renderWithProviders(<ListFilter dimensions={[multiDim({ value: ["l0", "l1"], onChange })]} />);

    expect(screen.getByRole("button", { name: "Remove red" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Remove green" }));
    expect(onChange).toHaveBeenCalledWith(["l0"]);
  });
});

describe("listFilter (clear all)", () => {
  it("renders an independent trigger per dimension", () => {
    renderWithProviders(
      <ListFilter dimensions={[singleDim(), singleDim({ key: "role", label: "Role" })]} />,
    );

    expect(screen.getByRole("button", { name: "Status" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Role" })).toBeInTheDocument();
  });

  it("clears every active dimension at once", async () => {
    const onSingle = vi.fn();
    const onMulti = vi.fn();
    renderWithProviders(
      <ListFilter
        dimensions={[
          singleDim({ value: "__archived__", onChange: onSingle }),
          multiDim({ value: ["l0"], onChange: onMulti }),
        ]}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(onSingle).toHaveBeenCalledWith("__active__");
    expect(onMulti).toHaveBeenCalledWith([]);
  });
});
