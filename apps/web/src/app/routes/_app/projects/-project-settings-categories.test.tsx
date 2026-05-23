import type { ProcurementCategoryView } from "@/shared/lib/api/projects";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/utils";
import { ProjectSettingsCategories } from "./-project-settings-categories";

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock;
});

afterEach(() => {
  fetchMock.mockReset();
});

function category(overrides: Partial<ProcurementCategoryView> = {}): ProcurementCategoryView {
  return {
    id: "c1",
    name: "Materials",
    code: "MAT",
    description: "Raw materials",
    ...overrides,
  } as ProcurementCategoryView;
}

function routeFetch(categories: ProcurementCategoryView[]) {
  fetchMock.mockImplementation(async (_url, init) => {
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "GET")
      return jsonResponse({ success: true, data: categories });
    if (method === "POST")
      return jsonResponse({ success: true, data: category({ id: "c2", name: "Labor" }) });
    return jsonResponse({ success: true, data: null });
  });
}

describe("projectSettingsCategories", () => {
  it("shows the empty state when there are no categories", async () => {
    routeFetch([]);
    renderWithProviders(<ProjectSettingsCategories projectId="p1" canManage={false} />);
    expect(await screen.findByText("No categories yet.")).toBeInTheDocument();
  });

  it("renders each category with its code and description", async () => {
    routeFetch([category()]);
    renderWithProviders(<ProjectSettingsCategories projectId="p1" canManage />);
    expect(await screen.findByText("Materials")).toBeInTheDocument();
    expect(screen.getByText("MAT")).toBeInTheDocument();
    expect(screen.getByText("Raw materials")).toBeInTheDocument();
  });

  it("hides management actions when the viewer cannot manage", async () => {
    routeFetch([category()]);
    renderWithProviders(<ProjectSettingsCategories projectId="p1" canManage={false} />);
    await screen.findByText("Materials");
    expect(screen.queryByRole("button", { name: "Add category" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  });

  it("creates a category through the dialog", async () => {
    const user = userEvent.setup();
    routeFetch([]);
    renderWithProviders(<ProjectSettingsCategories projectId="p1" canManage />);
    await screen.findByText("No categories yet.");

    await user.click(screen.getByRole("button", { name: "Add category" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Name"), "Labor");
    await user.click(within(dialog).getByRole("button", { name: "Add" }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(c => (c[1]?.method ?? "GET").toUpperCase() === "POST");
      expect(post).toBeTruthy();
      expect(String(post![0])).toBe("/api/projects/p1/procurement-categories");
      expect(JSON.parse(String(post![1]?.body)).name).toBe("Labor");
    });
  });
});
