import type { ProjectView } from "@/shared/lib/api/projects";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/utils";
import { ProjectCoverField } from "./-project-cover-field";

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) },
}));

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
}

const fetchMock = vi.fn<typeof fetch>();

function project(overrides: Partial<ProjectView> = {}): ProjectView {
  return {
    id: "p1",
    code: "PRJ-1",
    name: "Atlas",
    status: "active",
    description: null,
    tags: [],
    coverImageUrl: null,
    creatorId: "u1",
    version: 1,
    updatedAt: "2026-05-25T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  fetchMock.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
  globalThis.fetch = fetchMock;
});

afterEach(() => {
  fetchMock.mockReset();
});

describe("projectCoverField", () => {
  it("shows the upload affordance and hides remove when there is no cover", () => {
    renderWithProviders(<ProjectCoverField project={project()} />);

    expect(screen.getByRole("button", { name: "Upload cover" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove cover" })).not.toBeInTheDocument();
  });

  it("offers replace + remove once a cover exists", () => {
    renderWithProviders(<ProjectCoverField project={project({ coverImageUrl: "/api/files/x/content" })} />);

    expect(screen.getByRole("button", { name: "Replace cover" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove cover" })).toBeInTheDocument();
  });

  it("uploads a picked file via POST and toasts success", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: project({ coverImageUrl: "/api/files/x/content" }) }));
    const { container } = renderWithProviders(<ProjectCoverField project={project()} />);

    const input = container.querySelector<HTMLInputElement>("input[type=\"file\"]")!;
    await userEvent.upload(input, new File(["png-bytes"], "cover.png", { type: "image/png" }));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Cover image updated"));
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("/projects/p1/cover-image");
    expect(init?.method).toBe("POST");
  });

  it("removes an existing cover via DELETE and toasts success", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: project({ coverImageUrl: null }) }));
    renderWithProviders(<ProjectCoverField project={project({ coverImageUrl: "/api/files/x/content" })} />);

    await userEvent.click(screen.getByRole("button", { name: "Remove cover" }));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Cover image removed"));
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("/projects/p1/cover-image");
    expect(init?.method).toBe("DELETE");
  });
});
