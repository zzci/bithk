import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/utils";
import { RenameDialog } from "./-documents-rename-dialog";

const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { error: (...a: unknown[]) => toastError(...a) } }));

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  toastError.mockReset();
  globalThis.fetch = fetchMock;
});

afterEach(() => {
  fetchMock.mockReset();
});

const target = { id: "d1", title: "Old name" };

describe("renameDialog", () => {
  it("renders nothing while target is null", () => {
    const { container } = renderWithProviders(<RenameDialog target={null} onOpenChange={() => {}} />);
    // Dialog content is portalled; with no target the dialog is closed.
    expect(container.querySelector("input")).toBeNull();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("seeds the input with the current title", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: { id: "d1", title: "Old name", version: 3 } }));
    renderWithProviders(<RenameDialog target={target} onOpenChange={() => {}} />);
    expect(await screen.findByDisplayValue("Old name")).toBeInTheDocument();
  });

  it("keeps Save disabled until the document version has loaded", async () => {
    // Never resolve the document fetch: version stays unknown, Save disabled.
    fetchMock.mockReturnValue(new Promise(() => {}) as Promise<Response>);
    renderWithProviders(<RenameDialog target={target} onOpenChange={() => {}} />);
    const save = await screen.findByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
  });

  it("submits a rename against the fetched version", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    fetchMock.mockImplementation(async (_url, init) => {
      if ((init?.method ?? "GET") === "PATCH")
        return jsonResponse({ success: true, data: { id: "d1", title: "New name", version: 4 } });
      return jsonResponse({ success: true, data: { id: "d1", title: "Old name", version: 3 } });
    });
    renderWithProviders(<RenameDialog target={target} onOpenChange={onOpenChange} />);
    const input = await screen.findByDisplayValue("Old name");
    await user.clear(input);
    await user.type(input, "New name");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(c => (c[1]?.method ?? "GET") === "PATCH");
      expect(patch).toBeTruthy();
      expect(JSON.parse(String(patch![1]?.body))).toMatchObject({ version: 3, title: "New name" });
    });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("warns and does not submit when the title is cleared", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: { id: "d1", title: "Old name", version: 3 } }));
    renderWithProviders(<RenameDialog target={target} onOpenChange={() => {}} />);
    const input = await screen.findByDisplayValue("Old name");
    await user.clear(input);
    await user.keyboard("{Enter}");
    expect(toastError).toHaveBeenCalled();
    expect(fetchMock.mock.calls.some(c => (c[1]?.method ?? "GET") === "PATCH")).toBe(false);
  });
});
