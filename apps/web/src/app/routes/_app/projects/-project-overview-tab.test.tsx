import type { PinnedItem } from "@/shared/lib/api/pins";
import type { ProjectView } from "@/shared/lib/api/projects";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computeCapabilities } from "@/shared/hooks/use-project-capabilities";
import { renderWithProviders } from "@/test/utils";
import { ProjectOverviewTab } from "./-project-overview-tab";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
  });
}

function listResponse(data: unknown[]) {
  return jsonResponse({ success: true, data, meta: { total: data.length, page: 1, limit: 20 } });
}

const fetchMock = vi.fn<typeof fetch>();

interface RouteData {
  readonly issues?: unknown[];
  readonly procurements?: unknown[];
  readonly pinned?: readonly PinnedItem[];
}

function routeFetch({ issues = [], procurements = [], pinned = [] }: RouteData = {}) {
  fetchMock.mockImplementation(async (url) => {
    const path = String(url);
    if (path.includes("/pinned-items"))
      return jsonResponse({ success: true, data: pinned });
    if (path.includes("/issues"))
      return listResponse(issues);
    if (path.includes("/procurements"))
      return listResponse(procurements);
    return jsonResponse({ success: true, data: [] });
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  routeFetch();
  globalThis.fetch = fetchMock;
});

afterEach(() => {
  fetchMock.mockReset();
});

// Procurement-capable caps unless a test opts into the view-only variant.
const procCaps = computeCapabilities(["procurement.view"], false);
const noProcCaps = computeCapabilities([], false);

function project(overrides: Partial<ProjectView> = {}): ProjectView {
  return {
    id: "p1",
    name: "Tower",
    code: "TWR",
    description: "A tall building",
    status: "active",
    creatorId: "u1",
    tags: [{ id: "t1", name: "infra" }],
    coverImageUrl: null,
    createdAt: "2026-05-23T00:00:00.000Z",
    updatedAt: "2026-05-23T00:00:00.000Z",
    ...overrides,
  } as ProjectView;
}

function pin(overrides: Partial<PinnedItem> = {}): PinnedItem {
  return {
    id: "it1",
    shortId: "i1",
    type: "issue",
    title: "Pinned order",
    status: "todo",
    pinnedAt: "2026-05-24T00:00:00.000Z",
    ...overrides,
  };
}

describe("projectOverviewTab", () => {
  it("renders the project description", () => {
    renderWithProviders(
      <ProjectOverviewTab project={project()} caps={procCaps} onOpenTab={vi.fn()} />,
    );
    expect(screen.getByText("Description")).toBeInTheDocument();
    expect(screen.getByText("A tall building")).toBeInTheDocument();
  });

  it("shows the description empty state when no description is set", () => {
    renderWithProviders(
      <ProjectOverviewTab project={project({ description: "" })} caps={procCaps} onOpenTab={vi.fn()} />,
    );
    expect(screen.getByText("No description yet.")).toBeInTheDocument();
  });

  it("renders a mixed pinned list as single-line rows", async () => {
    routeFetch({
      pinned: [
        pin({ id: "it1", type: "issue", title: "Fix pump", status: "todo" }),
        pin({ id: "it2", type: "procurement", title: "Buy steel", status: "draft", pinnedAt: "2026-05-23T00:00:00.000Z" }),
      ],
    });
    renderWithProviders(
      <ProjectOverviewTab project={project()} caps={procCaps} onOpenTab={vi.fn()} />,
    );
    // Scope to the pinned list so titles/status are asserted unambiguously
    // against the "Latest procurements" list heading on the same page.
    const pinnedList = within(await screen.findByRole("list", { name: "Pinned" }));
    expect(pinnedList.getByText("Fix pump")).toBeInTheDocument();
    expect(pinnedList.getByText("Buy steel")).toBeInTheDocument();
    // The kind is now a leading icon labelled by accessible name (not text);
    // the status badge still renders on each single-line row.
    expect(pinnedList.getByRole("img", { name: "Work order" })).toBeInTheDocument();
    expect(pinnedList.getByRole("img", { name: "Procurement" })).toBeInTheDocument();
    expect(pinnedList.getByText("To Do")).toBeInTheDocument();
  });

  it("shows only the description in the info card — creator/updated/tags moved to the header", () => {
    renderWithProviders(
      <ProjectOverviewTab project={project()} caps={procCaps} onOpenTab={vi.fn()} />,
    );
    expect(screen.getByText("Description")).toBeInTheDocument();
    expect(screen.getByText("A tall building")).toBeInTheDocument();
    expect(screen.queryByText(/Creator/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Last updated/)).not.toBeInTheDocument();
    expect(screen.queryByText("infra")).not.toBeInTheDocument();
  });

  it("no longer renders the work order and procurement summary metrics", async () => {
    routeFetch({
      issues: [{ id: "i1", title: "Fix leak", status: "todo", priority: "high", updatedAt: "2026-05-24T00:00:00.000Z" }],
      procurements: [{ id: "pr1", itemName: "Buy steel", status: "draft", updatedAt: "2026-05-24T00:00:00.000Z" }],
    });
    renderWithProviders(
      <ProjectOverviewTab project={project()} caps={procCaps} onOpenTab={vi.fn()} />,
    );
    // Latest lists still load, but the old summary metric tiles are gone.
    await screen.findByText("Fix leak");
    await screen.findByText("Buy steel");
    // The "Work orders" metric label only existed on the removed summary tiles
    // ("Latest work orders" is a different heading), so it must be absent now.
    expect(screen.queryByText("Work orders")).not.toBeInTheDocument();
  });

  it("shows the pinned empty state when nothing is pinned", async () => {
    renderWithProviders(
      <ProjectOverviewTab project={project()} caps={procCaps} onOpenTab={vi.fn()} />,
    );
    expect(await screen.findByText(/Nothing pinned yet/)).toBeInTheDocument();
  });

  it("switches to the issues tab from the latest work orders 'View all'", async () => {
    const user = userEvent.setup();
    const onOpenTab = vi.fn();
    routeFetch({ issues: [{ id: "i1", title: "Fix leak", status: "todo", priority: "high", updatedAt: "2026-05-24T00:00:00.000Z" }] });
    renderWithProviders(
      <ProjectOverviewTab project={project()} caps={procCaps} onOpenTab={onOpenTab} />,
    );
    await screen.findByText("Fix leak");
    await user.click(screen.getAllByRole("button", { name: "View all" })[0]!);
    expect(onOpenTab).toHaveBeenCalledWith("issues");
  });

  it("hides procurement sections when the viewer lacks procurement.view", () => {
    renderWithProviders(
      <ProjectOverviewTab project={project()} caps={noProcCaps} onOpenTab={vi.fn()} />,
    );
    expect(screen.queryByText("Latest procurements")).not.toBeInTheDocument();
  });

  it("renders the latest work orders empty state", async () => {
    renderWithProviders(
      <ProjectOverviewTab project={project()} caps={procCaps} onOpenTab={vi.fn()} />,
    );
    expect(await screen.findByText("No work orders found.")).toBeInTheDocument();
  });

  it("renders the latest procurements empty state", async () => {
    renderWithProviders(
      <ProjectOverviewTab project={project()} caps={procCaps} onOpenTab={vi.fn()} />,
    );
    expect(await screen.findByText("No procurement records found.")).toBeInTheDocument();
  });

  it("navigates from a pinned work order row to the issues tab", async () => {
    const user = userEvent.setup();
    const onOpenTab = vi.fn();
    routeFetch({ pinned: [pin({ id: "it1", type: "issue", title: "Fix pump", status: "todo" })] });
    renderWithProviders(
      <ProjectOverviewTab project={project()} caps={procCaps} onOpenTab={onOpenTab} />,
    );
    await user.click(await screen.findByRole("button", { name: /Fix pump/ }));
    expect(onOpenTab).toHaveBeenCalledWith("issues");
  });

  it("navigates from a pinned procurement row to the procurement tab", async () => {
    const user = userEvent.setup();
    const onOpenTab = vi.fn();
    routeFetch({ pinned: [pin({ id: "it2", type: "procurement", title: "Buy steel", status: "draft" })] });
    renderWithProviders(
      <ProjectOverviewTab project={project()} caps={procCaps} onOpenTab={onOpenTab} />,
    );
    await user.click(await screen.findByRole("button", { name: /Buy steel/ }));
    expect(onOpenTab).toHaveBeenCalledWith("procurement");
  });

  it("disables a pinned procurement row when procurement is not viewable", async () => {
    const onOpenTab = vi.fn();
    routeFetch({ pinned: [pin({ id: "it2", type: "procurement", title: "Buy steel", status: "draft" })] });
    renderWithProviders(
      <ProjectOverviewTab project={project()} caps={noProcCaps} onOpenTab={onOpenTab} />,
    );
    expect(await screen.findByRole("button", { name: /Buy steel/ })).toBeDisabled();
  });

  it("navigates from a latest work order row to the issues tab", async () => {
    const user = userEvent.setup();
    const onOpenTab = vi.fn();
    routeFetch({ issues: [{ id: "i1", title: "Fix leak", status: "todo", priority: "high", updatedAt: "2026-05-24T00:00:00.000Z" }] });
    renderWithProviders(
      <ProjectOverviewTab project={project()} caps={procCaps} onOpenTab={onOpenTab} />,
    );
    await user.click(await screen.findByRole("button", { name: /Fix leak/ }));
    expect(onOpenTab).toHaveBeenCalledWith("issues");
  });
});
