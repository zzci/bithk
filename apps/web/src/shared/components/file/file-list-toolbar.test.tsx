import type { FileToolbarProps } from "./file-list-types";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/utils";
import { FileToolbar } from "./file-list-toolbar";
import { DEFAULT_CAPABILITIES } from "./file-list-types";

// Base props that satisfy the full FileToolbarProps contract. Each test pins
// its own `folderPath` and a fresh `onNavigateToBreadcrumb` spy so navigation
// assertions never bleed across cases.
function makeProps(
  folderPath: FileToolbarProps["folderPath"],
  onNavigateToBreadcrumb: FileToolbarProps["onNavigateToBreadcrumb"],
): FileToolbarProps {
  return {
    ownerType: "project",
    folderPath,
    loading: false,
    viewMode: "list",
    selectionMode: false,
    selectedCount: 0,
    showTitle: true,
    showSearch: false,
    searchQuery: "",
    filterBar: null,
    capabilities: DEFAULT_CAPABILITIES,
    hasRestore: false,
    showCreateActions: false,
    onNavigateToBreadcrumb,
    onRefresh: vi.fn(),
    onSearchQueryChange: vi.fn(),
    onViewModeChange: vi.fn(),
    onCancelSelection: vi.fn(),
    onBatchDownload: vi.fn(),
    onBatchRestore: vi.fn(),
    onBatchDelete: vi.fn(),
  };
}

describe("fileToolbar breadcrumb", () => {
  it("navigated into a subfolder: ancestors are links, current is plain text, clicking an ancestor navigates back", async () => {
    const user = userEvent.setup();
    const onNavigateToBreadcrumb = vi.fn();
    renderWithProviders(
      <FileToolbar
        {...makeProps(
          [
            { id: null, name: "Root" },
            { id: "a", name: "Alpha" },
            { id: "b", name: "Beta" },
          ],
          onNavigateToBreadcrumb,
        )}
      />,
    );

    const nav = screen.getByRole("navigation");
    within(nav).getByRole("list");
    expect(within(nav).getAllByRole("listitem")).toHaveLength(3);

    expect(screen.getByRole("button", { name: "Root" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Alpha" })).toBeInTheDocument();

    // The deepest crumb is plain, non-interactive text marked as current.
    expect(screen.queryByRole("button", { name: "Beta" })).toBeNull();
    expect(screen.getByText("Beta")).toHaveAttribute("aria-current", "page");

    await user.click(screen.getByRole("button", { name: "Alpha" }));
    expect(onNavigateToBreadcrumb).toHaveBeenCalledWith(1);

    await user.click(screen.getByRole("button", { name: "Root" }));
    expect(onNavigateToBreadcrumb).toHaveBeenCalledWith(0);
  });

  it("at root shows only the root label, no separator, not a link", () => {
    const onNavigateToBreadcrumb = vi.fn();
    renderWithProviders(
      <FileToolbar {...makeProps([{ id: null, name: "Root" }], onNavigateToBreadcrumb)} />,
    );

    expect(screen.getByText("Root")).toHaveAttribute("aria-current", "page");
    expect(screen.queryByRole("button", { name: "Root" })).toBeNull();
    expect(screen.queryByText("/")).toBeNull();
  });
});
