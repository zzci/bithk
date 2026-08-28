import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "@/shared/stores/auth";
import { renderWithProviders } from "@/test/utils";
import { CommandPalette } from "./command-palette";

const navigateMock = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
}));

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
  });
}

const fetchMock = vi.fn<typeof fetch>();

const ALL_MODULES = ["documents", "drive", "projects", "contacts", "hr"];

beforeEach(() => {
  fetchMock.mockReset();
  navigateMock.mockReset();
  globalThis.fetch = fetchMock;
  useAuthStore.setState({ user: { role: "user", modules: ALL_MODULES } as never, loading: false });
});

afterEach(() => {
  fetchMock.mockReset();
  useAuthStore.setState({ user: null, loading: true });
});

describe("commandPalette", () => {
  it("shows sidebar quick entries when the query is empty", async () => {
    renderWithProviders(<CommandPalette open onOpenChange={() => {}} />);
    expect(await screen.findByText("Quick entry")).toBeInTheDocument();
    expect(screen.getByText("Overview")).toBeInTheDocument();
    expect(screen.getByText("Documents")).toBeInTheDocument();
    expect(screen.getByText("Contacts")).toBeInTheDocument();
  });

  it("navigates and closes when a quick entry is clicked", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    renderWithProviders(<CommandPalette open onOpenChange={onOpenChange} />);
    await user.click(await screen.findByText("Overview"));
    expect(navigateMock).toHaveBeenCalledWith({ to: expect.any(String), search: {} });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("navigates to Contacts from a quick entry", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    renderWithProviders(<CommandPalette open onOpenChange={onOpenChange} />);
    await user.click(await screen.findByRole("button", { name: "Contacts" }));
    expect(navigateMock).toHaveBeenCalledWith({ to: "/contacts", search: {} });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("filters quick entries by the typed query", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(jsonResponse({
      success: true,
      data: { documents: [], issues: [], projects: [], drive: [] },
    }));
    renderWithProviders(<CommandPalette open onOpenChange={() => {}} />);
    await user.type(screen.getByRole("textbox"), "Documents");
    await waitFor(() => expect(screen.getByText("Documents")).toBeInTheDocument());
    expect(screen.queryByText("Overview")).not.toBeInTheDocument();
  });

  it("renders permission-scoped content hits and navigates to one", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(jsonResponse({
      success: true,
      data: {
        documents: [{ type: "document", id: "d1", title: "Leak report" }],
        issues: [],
        projects: [],
        drive: [],
      },
    }));
    renderWithProviders(<CommandPalette open onOpenChange={() => {}} />);
    await user.type(screen.getByRole("textbox"), "leak");
    const hit = await screen.findByText("Leak report");
    await user.click(hit);
    expect(navigateMock).toHaveBeenCalledWith({ to: "/documents/$docId", params: { docId: "d1" } });
  });

  it("shows the empty state when a query returns no hits", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(jsonResponse({
      success: true,
      data: { documents: [], issues: [], projects: [], drive: [] },
    }));
    renderWithProviders(<CommandPalette open onOpenChange={() => {}} />);
    await user.type(screen.getByRole("textbox"), "zzz-no-match");
    expect(await screen.findByText("No results")).toBeInTheDocument();
  });

  it("closes via the close button", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    renderWithProviders(<CommandPalette open onOpenChange={onOpenChange} />);
    await user.click(await screen.findByRole("button", { name: "Close" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe("commandPalette module filtering", () => {
  it("omits quick entries for modules outside me.modules", async () => {
    useAuthStore.setState({
      user: { role: "user", modules: ["documents", "projects"] } as never,
      loading: false,
    });
    renderWithProviders(<CommandPalette open onOpenChange={() => {}} />);
    expect(await screen.findByText("Documents")).toBeInTheDocument();
    expect(screen.getByText("Projects")).toBeInTheDocument();
    // "Ships" is a preset entry into the projects list, so it rides `projects`.
    expect(screen.getByText("Ships")).toBeInTheDocument();
    // Ungated destinations stay offered; gated ones outside the set vanish.
    expect(screen.getByText("Overview")).toBeInTheDocument();
    expect(screen.queryByText("Drive")).not.toBeInTheDocument();
    expect(screen.queryByText("Contacts")).not.toBeInTheDocument();
  });

  it("hides search result sections of hidden modules", async () => {
    useAuthStore.setState({
      user: { role: "user", modules: ["projects"] } as never,
      loading: false,
    });
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(jsonResponse({
      success: true,
      data: {
        documents: [{ type: "document", id: "d1", title: "Leak report" }],
        issues: [{ type: "issue", id: "i1", title: "Leaky valve", projectId: "p1" }],
        projects: [],
        drive: [],
      },
    }));
    renderWithProviders(<CommandPalette open onOpenChange={() => {}} />);
    await user.type(screen.getByRole("textbox"), "leak");
    // Issues belong to the projects module (granted); documents are hidden.
    expect(await screen.findByText("Leaky valve")).toBeInTheDocument();
    expect(screen.queryByText("Leak report")).not.toBeInTheDocument();
  });
});
