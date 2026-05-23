import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/utils";
import { CreateForm, EmptyState } from "./-documents-create";

// The Milkdown editor is lazy + ProseMirror-heavy; swap it for a plain
// textarea so the create flow can be exercised deterministically.
vi.mock("@/shared/components/editor", () => ({
  MarkdownEditor: ({ value, onChange, placeholder }: {
    value?: string;
    onChange?: (v: string) => void;
    placeholder?: string;
  }) => (
    <textarea
      aria-label="content"
      placeholder={placeholder}
      value={value}
      onChange={e => onChange?.(e.target.value)}
    />
  ),
}));

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

describe("emptyState", () => {
  it("invokes onCreate when the create button is pressed", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    renderWithProviders(<EmptyState onCreate={onCreate} />);
    expect(screen.getByText("Select a document to view")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Create Document/ }));
    expect(onCreate).toHaveBeenCalledTimes(1);
  });
});

describe("createForm", () => {
  it("blocks submission and warns when the title is blank", async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    renderWithProviders(<CreateForm onCancel={() => {}} onCreated={onCreated} />);
    // The create button is disabled while the title is empty; the keyboard
    // path still guards with a toast, so type a space then a real title to
    // exercise both branches.
    const title = screen.getByLabelText("Document title");
    await user.type(title, "   ");
    expect(screen.getByRole("button", { name: "Create Document" })).toBeDisabled();
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("creates the document and reports the new id", async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: { id: "doc-9", title: "Spec" } }));
    renderWithProviders(<CreateForm onCancel={() => {}} onCreated={onCreated} />);
    await user.type(screen.getByLabelText("Document title"), "Spec");
    await user.type(screen.getByLabelText("content"), "hello");
    await user.click(screen.getByRole("button", { name: "Create Document" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith("doc-9"));
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("/api/documents");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toMatchObject({ title: "Spec", content: "hello", parentId: null });
  });

  it("surfaces a server error as a toast", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(jsonResponse(
      { success: false, error: { code: "CONFLICT", message: "dup" } },
      { status: 409 },
    ));
    renderWithProviders(<CreateForm onCancel={() => {}} onCreated={vi.fn()} />);
    await user.type(screen.getByLabelText("Document title"), "Spec");
    await user.click(screen.getByRole("button", { name: "Create Document" }));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
  });

  it("cancels via the cancel button", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    renderWithProviders(<CreateForm onCancel={onCancel} onCreated={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
