import type { ProjectTag } from "@/shared/lib/api/projects";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/utils";
import { ProjectTagFilter } from "./-project-tag-filter";

// Tags in most-used-first order (ids t0..tN). With PINNED_COUNT=5 the first 5
// are pinned inline chips and the remainder feed the "Tags" selector.
function tags(...names: string[]): ProjectTag[] {
  return names.map((name, i) => ({ id: `t${i}`, name, usageCount: names.length - i }));
}

// Eight tags: pinned = alpha..epsilon (t0..t4), rest = zeta/eta/theta (t5..t7).
const EIGHT = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta"];

afterEach(() => {
  vi.restoreAllMocks();
});

describe("projectTagFilter (single-select)", () => {
  it("renders nothing when there are no tags", () => {
    const { container } = renderWithProviders(
      <ProjectTagFilter tags={[]} selectedTagId={null} onSelect={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders pinned tags as toggle buttons and selects an inactive one", async () => {
    const onSelect = vi.fn();
    renderWithProviders(
      <ProjectTagFilter tags={tags("alpha", "beta", "gamma")} selectedTagId={null} onSelect={onSelect} />,
    );

    const chip = screen.getByRole("button", { name: "Filter by alpha", pressed: false });
    await userEvent.click(chip);
    expect(onSelect).toHaveBeenCalledWith("t0");
  });

  it("clears via onClear when the active pinned chip is clicked", async () => {
    const onClear = vi.fn();
    renderWithProviders(
      <ProjectTagFilter
        tags={tags("alpha", "beta", "gamma")}
        selectedTagId="t0"
        onSelect={() => {}}
        onClear={onClear}
      />,
    );

    const chip = screen.getByRole("button", { name: "Filter by alpha", pressed: true });
    await userEvent.click(chip);
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("renders no selector when there are 5 or fewer tags", () => {
    renderWithProviders(
      <ProjectTagFilter tags={tags("alpha", "beta", "gamma")} selectedTagId={null} onSelect={() => {}} />,
    );
    expect(screen.queryByRole("button", { name: "Tags" })).not.toBeInTheDocument();
  });

  it("lists only non-pinned, non-selected tags in the dropdown", async () => {
    renderWithProviders(
      <ProjectTagFilter tags={tags(...EIGHT)} selectedTagId="t5" onSelect={() => {}} onClear={() => {}} />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Tags" }));
    expect(await screen.findByRole("menuitem", { name: "eta" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "theta" })).toBeInTheDocument();
    // zeta is selected and excluded; pinned tags never appear in the dropdown.
    expect(screen.queryByRole("menuitem", { name: "zeta" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "alpha" })).not.toBeInTheDocument();
  });

  it("keeps the dropdown trigger neutral (never filled)", () => {
    renderWithProviders(
      <ProjectTagFilter tags={tags(...EIGHT)} selectedTagId="t0" onSelect={() => {}} onClear={() => {}} />,
    );
    const trigger = screen.getByRole("button", { name: "Tags" });
    expect(trigger.className).not.toContain("bg-primary");
  });

  it("selects a non-pinned tag from the dropdown", async () => {
    const onSelect = vi.fn();
    renderWithProviders(
      <ProjectTagFilter tags={tags(...EIGHT)} selectedTagId={null} onSelect={onSelect} onClear={() => {}} />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Tags" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "zeta" }));
    expect(onSelect).toHaveBeenCalledWith("t5");
  });

  it("renders a non-pinned selected tag as a removable chip whose X calls onClear", async () => {
    const onClear = vi.fn();
    renderWithProviders(
      <ProjectTagFilter tags={tags(...EIGHT)} selectedTagId="t5" onSelect={() => {}} onClear={onClear} />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Remove tag zeta" }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});

describe("projectTagFilter (multi-select)", () => {
  it("toggles pinned chips independently via onToggle", async () => {
    const onToggle = vi.fn();
    renderWithProviders(
      <ProjectTagFilter multiple tags={tags("alpha", "beta", "gamma")} selectedTagIds={["t1"]} onToggle={onToggle} />,
    );

    // selectedTagIds reflected in aria-pressed.
    expect(screen.getByRole("button", { name: "Filter by alpha", pressed: false })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Filter by beta", pressed: true })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Filter by gamma" }));
    expect(onToggle).toHaveBeenCalledWith("t2");
  });

  it("renders no selector when there are 5 or fewer tags", () => {
    renderWithProviders(
      <ProjectTagFilter multiple tags={tags("alpha", "beta")} selectedTagIds={[]} onToggle={() => {}} />,
    );
    expect(screen.queryByRole("combobox", { name: "Tags" })).not.toBeInTheDocument();
  });

  it("lists only non-pinned, non-selected tags in the combobox", async () => {
    const onToggle = vi.fn();
    renderWithProviders(
      <ProjectTagFilter multiple tags={tags(...EIGHT)} selectedTagIds={["t5"]} onToggle={onToggle} />,
    );

    await userEvent.click(screen.getByRole("combobox", { name: "Tags" }));
    expect(await screen.findByRole("option", { name: "eta" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "theta" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "zeta" })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "alpha" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("option", { name: "eta" }));
    expect(onToggle).toHaveBeenCalledWith("t6");
  });

  it("keeps the combobox trigger neutral (never filled)", () => {
    renderWithProviders(
      <ProjectTagFilter multiple tags={tags(...EIGHT)} selectedTagIds={["t5"]} onToggle={() => {}} />,
    );
    const trigger = screen.getByRole("combobox", { name: "Tags" });
    expect(trigger.className).not.toContain("bg-primary");
  });

  it("renders a non-pinned selected tag as a removable chip and deselects via the X", async () => {
    const onToggle = vi.fn();
    renderWithProviders(
      <ProjectTagFilter multiple tags={tags(...EIGHT)} selectedTagIds={["t5"]} onToggle={onToggle} />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Remove tag zeta" }));
    expect(onToggle).toHaveBeenCalledWith("t5");
  });

  it("does not render a removable chip for a pinned selected tag", () => {
    renderWithProviders(
      <ProjectTagFilter multiple tags={tags(...EIGHT)} selectedTagIds={["t0"]} onToggle={() => {}} />,
    );
    // The pinned chip conveys selection; no duplicate removable chip exists.
    expect(screen.getByRole("button", { name: "Filter by alpha", pressed: true })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove tag alpha" })).not.toBeInTheDocument();
  });
});

describe("projectTagFilter (responsive fallback)", () => {
  // jsdom does no layout, so the ResizeObserver never reports a positive width.
  // The component must keep its MAX (5) pinned fallback so consumers that rely
  // on all five pinning when unmeasured do not regress.
  it("pins up to the MAX (5) chips when the container width is unmeasured", () => {
    renderWithProviders(
      <ProjectTagFilter tags={tags(...EIGHT)} selectedTagId={null} onSelect={() => {}} onClear={() => {}} />,
    );

    for (const name of ["alpha", "beta", "gamma", "delta", "epsilon"]) {
      expect(screen.getByRole("button", { name: `Filter by ${name}` })).toBeInTheDocument();
    }
    // The 6th most-used tag is not pinned; it lives behind the selector.
    expect(screen.queryByRole("button", { name: "Filter by zeta" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tags" })).toBeInTheDocument();
  });
});
