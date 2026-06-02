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

  it("opens the selector labeled Tags, lists every unselected tag, and selects one", async () => {
    const onSelect = vi.fn();
    renderWithProviders(
      <ProjectTagFilter tags={tags("alpha", "beta", "gamma")} selectedTagId={null} onSelect={onSelect} />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Tags" }));
    expect(await screen.findByRole("menuitem", { name: "alpha" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "beta" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("menuitem", { name: "gamma" }));
    expect(onSelect).toHaveBeenCalledWith("t2");
  });

  it("keeps the trigger neutral (outline, never filled) when a tag is selected", () => {
    renderWithProviders(
      <ProjectTagFilter tags={tags("alpha", "beta")} selectedTagId="t0" onSelect={() => {}} />,
    );
    const trigger = screen.getByRole("button", { name: "Tags" });
    expect(trigger.className).not.toContain("bg-primary");
  });

  it("excludes the selected tag from the dropdown list", async () => {
    renderWithProviders(
      <ProjectTagFilter tags={tags("alpha", "beta", "gamma")} selectedTagId="t0" onSelect={() => {}} />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Tags" }));
    expect(await screen.findByRole("menuitem", { name: "beta" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "alpha" })).not.toBeInTheDocument();
  });

  it("shows a graceful empty row when no unselected tags remain", async () => {
    renderWithProviders(
      <ProjectTagFilter tags={tags("alpha")} selectedTagId="t0" onSelect={() => {}} />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Tags" }));
    expect(await screen.findByText("No more tags")).toBeInTheDocument();
  });

  it("renders the selected tag as a non-removable chip when onClear is omitted", () => {
    renderWithProviders(
      <ProjectTagFilter tags={tags("alpha", "beta")} selectedTagId="t0" onSelect={() => {}} />,
    );
    // The chip shows the selected tag name; without onClear it carries no X.
    expect(screen.getByText("alpha")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove tag alpha" })).not.toBeInTheDocument();
  });

  it("renders a removable selected chip and clears via the X when onClear is provided", async () => {
    const onClear = vi.fn();
    renderWithProviders(
      <ProjectTagFilter tags={tags("alpha", "beta")} selectedTagId="t0" onSelect={() => {}} onClear={onClear} />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Remove tag alpha" }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});

describe("projectTagFilter (multi-select)", () => {
  it("lists every unselected tag in the selector and toggles one", async () => {
    const onToggle = vi.fn();
    renderWithProviders(
      <ProjectTagFilter multiple tags={tags("alpha", "beta", "gamma")} selectedTagIds={[]} onToggle={onToggle} />,
    );

    await userEvent.click(screen.getByRole("combobox", { name: "Tags" }));
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

    await userEvent.click(screen.getByRole("combobox", { name: "Tags" }));
    const search = await screen.findByPlaceholderText("Search tags");
    await userEvent.type(search, "gamma");
    await userEvent.click(await screen.findByRole("option", { name: "gamma" }));
    expect(onToggle).toHaveBeenCalledWith("t2");
  });

  it("keeps the trigger neutral (never filled) when tags are selected", () => {
    renderWithProviders(
      <ProjectTagFilter multiple tags={tags("alpha", "beta")} selectedTagIds={["t1"]} onToggle={() => {}} />,
    );
    const trigger = screen.getByRole("combobox", { name: "Tags" });
    expect(trigger.className).not.toContain("bg-primary");
  });

  it("excludes selected tags from the combobox list", async () => {
    const onToggle = vi.fn();
    renderWithProviders(
      <ProjectTagFilter multiple tags={tags("alpha", "beta", "gamma")} selectedTagIds={["t1"]} onToggle={onToggle} />,
    );

    await userEvent.click(screen.getByRole("combobox", { name: "Tags" }));
    expect(await screen.findByRole("option", { name: "alpha" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "beta" })).not.toBeInTheDocument();
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
