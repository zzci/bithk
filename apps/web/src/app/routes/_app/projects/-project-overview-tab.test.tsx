import type { PinnedItem } from "@/shared/lib/api/pins";
import type { ProjectView } from "@/shared/lib/api/projects";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/utils";
import { ProjectOverviewTab } from "./-project-overview-tab";
import { computeCapabilities } from "./-use-project-role";

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
    status: "open",
    pinnedAt: "2026-05-24T00:00:00.000Z",
    ...overrides,
  };
}

describe("projectOverviewTab", () => {
  it("renders the project description", () => {
    renderWithProviders(
      <ProjectOverviewTab project={project()} userNames={new Map([["u1", "Alice"]])} caps={procCaps} onOpenTab={vi.fn()} />,
    );
    expect(screen.getByText("Description")).toBeInTheDocument();
    expect(screen.getByText("A tall building")).toBeInTheDocument();
  });

  it("shows the description empty state when no description is set", () => {
    renderWithProviders(
      <ProjectOverviewTab project={project({ description: "" })} userNames={new Map()} caps={procCaps} onOpenTab={vi.fn()} />,
    );
    expect(screen.getByText("No description yet.")).toBeInTheDocument();
  });

  it("renders the creator in the info block", () => {
    renderWithProviders(
      <ProjectOverviewTab project={project()} userNames={new Map([["u1", "Alice"]])} caps={procCaps} onOpenTab={vi.fn()} />,
    );
    expect(screen.getByText(/Alice/)).toBeInTheDocument();
    expect(screen.getByText("infra")).toBeInTheDocument();
  });

  it("renders a mixed pinned list with kind badges", async () => {
    routeFetch({
      pinned: [
        pin({ id: "it1", type: "issue", title: "Fix pump", status: "open" }),
        pin({ id: "it2", type: "procurement", title: "Buy steel", status: "draft", pinnedAt: "2026-05-23T00:00:00.000Z" }),
      ],
    });
    renderWithProviders(
      <ProjectOverviewTab project={project()} userNames={new Map()} caps={procCaps} onOpenTab={vi.fn()} />,
    );
    expect(await screen.findByText("Fix pump")).toBeInTheDocument();
    expect(screen.getByText("Buy steel")).toBeInTheDocument();
    // Kind badges distinguish the two types by label (+ icon).
    expect(screen.getByText("Work order")).toBeInTheDocument();
    expect(screen.getByText("Procurement")).toBeInTheDocument();
  });

  it("shows the pinned empty state when nothing is pinned", async () => {
    renderWithProviders(
      <ProjectOverviewTab project={project()} userNames={new Map()} caps={procCaps} onOpenTab={vi.fn()} />,
    );
    expect(await screen.findByText(/Nothing pinned yet/)).toBeInTheDocument();
  });

  it("switches to the issues tab from the latest work orders 'View all'", async () => {
    const user = userEvent.setup();
    const onOpenTab = vi.fn();
    routeFetch({ issues: [{ id: "i1", title: "Fix leak", status: "open", priority: "high", updatedAt: "2026-05-24T00:00:00.000Z" }] });
    renderWithProviders(
      <ProjectOverviewTab project={project()} userNames={new Map()} caps={procCaps} onOpenTab={onOpenTab} />,
    );
    await screen.findByText("Fix leak");
    await user.click(screen.getAllByRole("button", { name: "View all" })[0]!);
    expect(onOpenTab).toHaveBeenCalledWith("issues");
  });

  it("hides procurement sections when the viewer lacks procurement.view", () => {
    renderWithProviders(
      <ProjectOverviewTab project={project()} userNames={new Map()} caps={noProcCaps} onOpenTab={vi.fn()} />,
    );
    expect(screen.queryByText("Latest procurements")).not.toBeInTheDocument();
  });
});
