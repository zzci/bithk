import type { TeamDirectory } from "@/shared/lib/api/drive";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/utils";
import { DirectoryEditDialog } from "./-team-directory-list";

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

const directory = { id: "td1", name: "Design", description: "Design team" } as TeamDirectory;

describe("directoryEditDialog", () => {
  it("creates a directory with name + description via POST", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: directory }));
    renderWithProviders(<DirectoryEditDialog state={{ type: "create" }} onClose={onClose} />);

    expect(screen.getByText("New team directory")).toBeInTheDocument();
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
    await user.type(screen.getByLabelText("Name"), "Design");
    await user.type(screen.getByLabelText("Description"), "Design team");
    await user.click(save);

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(c => (c[1]?.method ?? "GET").toUpperCase() === "POST");
      expect(String(post![0])).toBe("/api/drive/team-directories");
      expect(JSON.parse(String(post![1]?.body))).toEqual({ name: "Design", description: "Design team" });
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("seeds fields for a rename and submits a PUT", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: directory }));
    renderWithProviders(<DirectoryEditDialog state={{ type: "rename", directory }} onClose={vi.fn()} />);

    expect(screen.getByText("Edit directory")).toBeInTheDocument();
    const name = screen.getByDisplayValue("Design");
    await user.clear(name);
    await user.type(name, "Brand");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const put = fetchMock.mock.calls.find(c => (c[1]?.method ?? "GET").toUpperCase() === "PUT");
      expect(String(put![0])).toBe("/api/drive/team-directories/td1");
      expect(JSON.parse(String(put![1]?.body)).name).toBe("Brand");
    });
  });

  it("surfaces a server error message", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(jsonResponse(
      { success: false, error: { code: "CONFLICT", message: "Name taken" } },
      { status: 409 },
    ));
    renderWithProviders(<DirectoryEditDialog state={{ type: "create" }} onClose={vi.fn()} />);
    await user.type(screen.getByLabelText("Name"), "Design");
    await user.click(screen.getByRole("button", { name: "Save" }));
    // errorMessage is not used here — the raw HttpError.message ("Name taken") surfaces.
    expect(await screen.findByText("Name taken")).toBeInTheDocument();
  });
});
