import type { FilterDimension } from "./list-filter";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/utils";
import { ListFilter } from "./list-filter";

afterEach(() => {
  vi.restoreAllMocks();
});

// A fully-resident single-select dimension (matches the projects status filter).
function statusDim(overrides: Partial<Extract<FilterDimension, { mode: "single" }>> = {}): FilterDimension {
  return {
    key: "status",
    label: "Status",
    mode: "single",
    resident: true,
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

// Eight tags, residentCount 5: t0..t4 pinned inline, t5..t7 in the dropdown.
const EIGHT = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta"];

function tagDim(overrides: Partial<Extract<FilterDimension, { mode: "single" }>> = {}): FilterDimension {
  return {
    key: "tags",
    label: "Tags",
    mode: "single",
    residentCount: 5,
    value: null,
    onChange: () => {},
    options: EIGHT.map((name, i) => ({ value: `t${i}`, label: name })),
    ...overrides,
  };
}

// A non-resident multi-select dimension (everything lives in the dropdown).
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

describe("listFilter (resident dimension)", () => {
  it("renders the whole resident group inline as toggle chips with counts", () => {
    renderWithProviders(<ListFilter dimensions={[statusDim()]} />);

    // Both options are inline toggle buttons; the default is pressed.
    expect(screen.getByRole("button", { name: /Active/, pressed: true })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Archived/, pressed: false })).toBeInTheDocument();
    // A fully-resident dimension contributes no dropdown trigger.
    expect(screen.queryByRole("button", { name: "Filter" })).not.toBeInTheDocument();
  });

  it("selects an inactive resident option via its inline chip", async () => {
    const onChange = vi.fn();
    renderWithProviders(<ListFilter dimensions={[statusDim({ onChange })]} />);

    await userEvent.click(screen.getByRole("button", { name: /Archived/ }));
    expect(onChange).toHaveBeenCalledWith("__archived__");
  });

  it("re-selecting the active resident option resets to the default", async () => {
    const onChange = vi.fn();
    renderWithProviders(<ListFilter dimensions={[statusDim({ value: "__archived__", onChange })]} />);

    await userEvent.click(screen.getByRole("button", { name: /Archived/, pressed: true }));
    expect(onChange).toHaveBeenCalledWith("__active__");
  });

  it("shows no removable chip for a resident selection (highlight conveys state)", () => {
    renderWithProviders(<ListFilter dimensions={[statusDim({ value: "__archived__" })]} />);
    expect(screen.queryByRole("button", { name: /^Remove/ })).not.toBeInTheDocument();
  });
});

describe("listFilter (residentCount split)", () => {
  it("pins the first N options inline and puts the remainder in the dropdown", async () => {
    renderWithProviders(<ListFilter dimensions={[tagDim()]} />);

    // t0..t4 pinned inline.
    for (const name of ["alpha", "beta", "gamma", "delta", "epsilon"])
      expect(screen.getByRole("button", { name, pressed: false })).toBeInTheDocument();
    // t5 is not pinned; it lives behind the Filter dropdown.
    expect(screen.queryByRole("button", { name: "zeta" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Filter" }));
    expect(await screen.findByRole("menuitemcheckbox", { name: "zeta" })).toBeInTheDocument();
    expect(screen.getByRole("menuitemcheckbox", { name: "theta" })).toBeInTheDocument();
  });

  it("toggles a resident tag chip", async () => {
    const onChange = vi.fn();
    renderWithProviders(<ListFilter dimensions={[tagDim({ onChange })]} />);

    await userEvent.click(screen.getByRole("button", { name: "alpha" }));
    expect(onChange).toHaveBeenCalledWith("t0");
  });

  it("selects a non-resident option from the dropdown", async () => {
    const onChange = vi.fn();
    renderWithProviders(<ListFilter dimensions={[tagDim({ onChange })]} />);

    await userEvent.click(screen.getByRole("button", { name: "Filter" }));
    await userEvent.click(await screen.findByRole("menuitemcheckbox", { name: "zeta" }));
    expect(onChange).toHaveBeenCalledWith("t5");
  });

  it("renders a non-resident selection as a removable chip that clears it", async () => {
    const onChange = vi.fn();
    renderWithProviders(<ListFilter dimensions={[tagDim({ value: "t5", onChange })]} />);

    await userEvent.click(screen.getByRole("button", { name: "Remove zeta" }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("shows no removable chip when the selection is a resident (pinned) tag", () => {
    renderWithProviders(<ListFilter dimensions={[tagDim({ value: "t0" })]} />);
    expect(screen.getByRole("button", { name: "alpha", pressed: true })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Remove/ })).not.toBeInTheDocument();
  });
});

describe("listFilter (non-resident multi-select)", () => {
  it("lists options in the dropdown and toggles them in/out immutably", async () => {
    const onChange = vi.fn();
    renderWithProviders(<ListFilter dimensions={[multiDim({ value: ["l0"], onChange })]} />);

    await userEvent.click(screen.getByRole("button", { name: "Filter" }));
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

describe("listFilter (multiple dimensions)", () => {
  it("renders resident chips, a shared dropdown for remainders, and cross-dimension chips", async () => {
    renderWithProviders(
      <ListFilter dimensions={[statusDim({ value: "__archived__" }), tagDim({ value: "t5" })]} />,
    );

    // Status is resident → inline highlighted chip, no removable chip.
    expect(screen.getByRole("button", { name: /Archived/, pressed: true })).toBeInTheDocument();
    // Tag t5 is non-resident → removable chip.
    expect(screen.getByRole("button", { name: "Remove zeta" })).toBeInTheDocument();

    // The single dropdown only carries the tag remainder (status is resident).
    await userEvent.click(screen.getByRole("button", { name: "Filter" }));
    expect(await screen.findByRole("menuitemcheckbox", { name: "zeta", checked: true })).toBeInTheDocument();
    expect(screen.queryByRole("menuitemcheckbox", { name: /Archived/ })).not.toBeInTheDocument();
  });
});
