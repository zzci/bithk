import type { ProjectTag } from "@/shared/lib/api/projects";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/utils";
import { ProjectTagFilter } from "./-project-tag-filter";

function tags(...names: string[]): ProjectTag[] {
  return names.map((name, i) => ({ id: `t${i}`, name, usageCount: names.length - i }));
}

// jsdom does no layout, so offsetWidth/clientWidth are 0 by default. Override
// clientWidth on the container to simulate a wide row where everything fits.
function withWideContainer(): () => void {
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 1000 });
  return () => {
    if (original)
      Object.defineProperty(HTMLElement.prototype, "clientWidth", original);
    else
      delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth;
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("projectTagFilter", () => {
  it("renders nothing when there are no tags", () => {
    const { container } = renderWithProviders(
      <ProjectTagFilter tags={[]} selectedTagId={null} onSelect={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders every tag inline when the row is wide enough", () => {
    const restore = withWideContainer();
    try {
      renderWithProviders(
        <ProjectTagFilter tags={tags("alpha", "beta", "gamma")} selectedTagId={null} onSelect={() => {}} />,
      );
      // Inline chips only (no overflow). The hidden measuring layer is aria-hidden,
      // so accessible-name queries see just the visible chips.
      expect(screen.getByRole("button", { name: "alpha" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "beta" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "gamma" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "More tags" })).not.toBeInTheDocument();
    }
    finally {
      restore();
    }
  });

  it("calls onSelect when an inline chip is clicked", async () => {
    const restore = withWideContainer();
    const onSelect = vi.fn();
    try {
      renderWithProviders(
        <ProjectTagFilter tags={tags("alpha", "beta")} selectedTagId={null} onSelect={onSelect} />,
      );
      await userEvent.click(screen.getByRole("button", { name: "beta" }));
      expect(onSelect).toHaveBeenCalledWith("t1");
    }
    finally {
      restore();
    }
  });

  it("marks the selected chip as pressed", () => {
    const restore = withWideContainer();
    try {
      renderWithProviders(
        <ProjectTagFilter tags={tags("alpha", "beta")} selectedTagId="t0" onSelect={() => {}} />,
      );
      expect(screen.getByRole("button", { name: "alpha" })).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByRole("button", { name: "beta" })).toHaveAttribute("aria-pressed", "false");
    }
    finally {
      restore();
    }
  });

  it("moves overflowing tags into a More dropdown and filters when one is picked", async () => {
    // Default jsdom clientWidth (0) forces all-but-one tag into the overflow.
    const onSelect = vi.fn();
    renderWithProviders(
      <ProjectTagFilter tags={tags("alpha", "beta", "gamma")} selectedTagId={null} onSelect={onSelect} />,
    );

    const more = screen.getByRole("button", { name: "More tags" });
    expect(more).toBeInTheDocument();

    await userEvent.click(more);
    const item = await screen.findByRole("menuitem", { name: "gamma" });
    await userEvent.click(item);
    expect(onSelect).toHaveBeenCalledWith("t2");
  });
});

describe("projectTagFilter (multi-select)", () => {
  it("reflects the selected ids as pressed chips", () => {
    const restore = withWideContainer();
    try {
      renderWithProviders(
        <ProjectTagFilter multiple tags={tags("alpha", "beta")} selectedTagIds={["t1"]} onToggle={() => {}} />,
      );
      expect(screen.getByRole("button", { name: "alpha" })).toHaveAttribute("aria-pressed", "false");
      expect(screen.getByRole("button", { name: "beta" })).toHaveAttribute("aria-pressed", "true");
    }
    finally {
      restore();
    }
  });

  it("calls onToggle when an inline chip is clicked", async () => {
    const restore = withWideContainer();
    const onToggle = vi.fn();
    try {
      renderWithProviders(
        <ProjectTagFilter multiple tags={tags("alpha", "beta")} selectedTagIds={[]} onToggle={onToggle} />,
      );
      await userEvent.click(screen.getByRole("button", { name: "beta" }));
      expect(onToggle).toHaveBeenCalledWith("t1");
    }
    finally {
      restore();
    }
  });

  it("toggles an overflow tag through the searchable More combobox", async () => {
    // Default jsdom clientWidth (0) forces all-but-one tag into the overflow.
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
});
