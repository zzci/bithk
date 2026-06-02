import type { ProjectTag } from "@/shared/lib/api/projects";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/utils";
import { ProjectTagFilter } from "./-project-tag-filter";

function tags(...names: string[]): ProjectTag[] {
  return names.map((name, i) => ({ id: `t${i}`, name, usageCount: names.length - i }));
}

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

  it("opens the selector, lists every tag, and selects one", async () => {
    const onSelect = vi.fn();
    renderWithProviders(
      <ProjectTagFilter tags={tags("alpha", "beta", "gamma")} selectedTagId={null} onSelect={onSelect} />,
    );

    await userEvent.click(screen.getByRole("button", { name: "More tags" }));
    expect(await screen.findByRole("menuitem", { name: "alpha" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "beta" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("menuitem", { name: "gamma" }));
    expect(onSelect).toHaveBeenCalledWith("t2");
  });

  it("renders the selected tag as a non-removable chip", () => {
    renderWithProviders(
      <ProjectTagFilter tags={tags("alpha", "beta")} selectedTagId="t0" onSelect={() => {}} />,
    );
    // The chip shows the selected tag name; single-select chips carry no X.
    expect(screen.getByText("alpha")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove tag alpha" })).not.toBeInTheDocument();
  });
});

describe("projectTagFilter (multi-select)", () => {
  it("lists every tag in the selector with a checkable state and toggles one", async () => {
    const onToggle = vi.fn();
    renderWithProviders(
      <ProjectTagFilter multiple tags={tags("alpha", "beta", "gamma")} selectedTagIds={[]} onToggle={onToggle} />,
    );

    await userEvent.click(screen.getByRole("combobox", { name: "More tags" }));
    expect(await screen.findByRole("option", { name: "alpha" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "gamma" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("option", { name: "beta" }));
    expect(onToggle).toHaveBeenCalledWith("t1");
  });

  it("filters the selector list by the search box", async () => {
    const onToggle = vi.fn();
    renderWithProviders(
      <ProjectTagFilter multiple tags={tags("alpha", "beta", "gamma")} selectedTagIds={[]} onToggle={onToggle} />,
    );

    await userEvent.click(screen.getByRole("combobox", { name: "More tags" }));
    const search = await screen.findByPlaceholderText("Search tags");
    await userEvent.type(search, "gamma");
    await userEvent.click(await screen.findByRole("option", { name: "gamma" }));
    expect(onToggle).toHaveBeenCalledWith("t2");
  });

  it("renders selected tags as removable chips and deselects via the X button", async () => {
    const onToggle = vi.fn();
    renderWithProviders(
      <ProjectTagFilter multiple tags={tags("alpha", "beta")} selectedTagIds={["t1"]} onToggle={onToggle} />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Remove tag beta" }));
    expect(onToggle).toHaveBeenCalledWith("t1");
  });
});
