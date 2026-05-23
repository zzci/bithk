import type * as ResourceModule from "@/shared/components/resource";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "@/shared/stores/auth";
import { renderWithProviders } from "@/test/utils";

// Heavy / out-of-lane children are stubbed at their module boundary so the
// test exercises DocumentDetail's own orchestration (view/edit, save,
// validation, conflict, delete, tag persistence, share, upload guards).
vi.mock("@/shared/components/editor", () => ({
  MarkdownEditor: ({ value, onChange, readOnly }: {
    value?: string;
    onChange?: (v: string) => void;
    readOnly?: boolean;
  }) =>
    readOnly
      ? <div data-testid="md-readonly">{value}</div>
      : <textarea aria-label="content" value={value} onChange={e => onChange?.(e.target.value)} />,
}));

const openShareSpy = vi.fn();
vi.mock("@/shared/components/share", () => ({ useShare: () => ({ openShare: openShareSpy }) }));

const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { error: (...a: unknown[]) => toastError(...a) } }));

// Controllable attachment-upload surface; partitionBySize stays real.
const uploadMutate = vi.fn();
const uploadHook = {
  upload: { mutate: uploadMutate, isPending: false },
  fileInputRef: { current: null as HTMLInputElement | null },
  limits: { maxAttachmentsPerResource: 20, maxFileSize: 1024 },
  attachmentCount: 0,
};
vi.mock("@/shared/components/resource", async (orig) => {
  const actual = await orig<typeof ResourceModule>();
  return {
    ...actual,
    ResourceFooterSections: () => <div data-testid="footer" />,
    useResourceAttachmentUpload: () => uploadHook,
  };
});

const { DocumentDetail } = await import("./-documents-detail");

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
}

const fetchMock = vi.fn<typeof fetch>();

interface Doc {
  id: string;
  title: string;
  content: string;
  tags: string;
  version: number;
  creatorId: string;
  updatedAt: string;
  commentsLocked: boolean;
}

function doc(overrides: Partial<Doc> = {}): Doc {
  return {
    id: "d1",
    title: "Spec",
    content: "hello body",
    tags: "[\"alpha\"]",
    version: 2,
    creatorId: "u1",
    updatedAt: "2026-05-23T00:00:00.000Z",
    commentsLocked: false,
    ...overrides,
  };
}

/** Route document GET / users GET; PATCH and DELETE handled by the caller. */
function routeDoc(d: Doc, onMutate?: (method: string) => Response) {
  fetchMock.mockImplementation(async (url, init) => {
    const method = (init?.method ?? "GET").toUpperCase();
    const path = String(url);
    if (method !== "GET" && onMutate)
      return onMutate(method);
    if (path.includes("/users"))
      return jsonResponse({ success: true, data: [{ id: "u1", username: "alice", name: "Alice" }] });
    return jsonResponse({ success: true, data: d });
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  toastError.mockReset();
  openShareSpy.mockReset();
  uploadMutate.mockReset();
  uploadHook.attachmentCount = 0;
  uploadHook.limits = { maxAttachmentsPerResource: 20, maxFileSize: 1024 };
  globalThis.fetch = fetchMock;
  useAuthStore.setState({ user: { id: "u1", role: "admin" } as never, loading: false });
});

afterEach(() => {
  fetchMock.mockReset();
  useAuthStore.setState({ user: null, loading: true });
});

describe("documentDetail — load states", () => {
  it("shows a loading hint before the document resolves", () => {
    fetchMock.mockReturnValue(new Promise(() => {}) as Promise<Response>);
    renderWithProviders(<DocumentDetail docId="d1" onDeleted={() => {}} />);
    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("shows an error hint when the document fails to load", async () => {
    fetchMock.mockResolvedValue(jsonResponse(
      { success: false, error: { code: "NOT_FOUND", message: "gone" } },
      { status: 404 },
    ));
    renderWithProviders(<DocumentDetail docId="d1" onDeleted={() => {}} />);
    expect(await screen.findByText("Failed to load data")).toBeInTheDocument();
  });
});

describe("documentDetail — view mode", () => {
  it("renders the title, creator byline and rendered content", async () => {
    routeDoc(doc());
    renderWithProviders(<DocumentDetail docId="d1" onDeleted={() => {}} />);
    expect((await screen.findAllByText("Spec")).length).toBeGreaterThan(0);
    // The creator name resolves once the users query lands; it shares the
    // byline line with the date separator, so match on the containing text.
    expect(await screen.findByText(/Alice/)).toBeInTheDocument();
    expect(screen.getByTestId("md-readonly")).toHaveTextContent("hello body");
  });

  it("opens the share dialog for the document", async () => {
    const user = userEvent.setup();
    routeDoc(doc());
    renderWithProviders(<DocumentDetail docId="d1" onDeleted={() => {}} />);
    await screen.findAllByText("Spec");
    await user.click(screen.getByRole("button", { name: "Share" }));
    expect(openShareSpy).toHaveBeenCalledWith({ resourceType: "document", resourceId: "d1", name: "Spec" });
  });

  it("persists a tag change immediately in view mode", async () => {
    const user = userEvent.setup();
    const patched: string[] = [];
    routeDoc(doc(), (method) => {
      patched.push(method);
      return jsonResponse({ success: true, data: doc({ tags: "[\"alpha\",\"beta\"]", version: 3 }) });
    });
    renderWithProviders(<DocumentDetail docId="d1" onDeleted={() => {}} />);
    await screen.findAllByText("Spec");
    await user.click(screen.getByRole("button", { name: "Add tag..." }));
    await user.type(screen.getByPlaceholderText("Add tag..."), "beta{Enter}");
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(c => (c[1]?.method ?? "GET").toUpperCase() === "PATCH");
      expect(patch).toBeTruthy();
      expect(JSON.parse(String(patch![1]?.body)).tags).toEqual(["alpha", "beta"]);
    });
  });
});

describe("documentDetail — edit mode", () => {
  it("warns and skips the request when the title is cleared", async () => {
    const user = userEvent.setup();
    routeDoc(doc());
    renderWithProviders(<DocumentDetail docId="d1" onDeleted={() => {}} />);
    await screen.findAllByText("Spec");
    await user.click(screen.getByRole("button", { name: "Edit" }));
    const title = await screen.findByLabelText("Document title");
    await user.clear(title);
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(toastError).toHaveBeenCalled();
    expect(fetchMock.mock.calls.some(c => (c[1]?.method ?? "GET").toUpperCase() === "PATCH")).toBe(false);
  });

  it("saves an edited title/content and returns to view mode", async () => {
    const user = userEvent.setup();
    routeDoc(doc(), () => jsonResponse({ success: true, data: doc({ title: "Spec v2", version: 3 }) }));
    renderWithProviders(<DocumentDetail docId="d1" onDeleted={() => {}} />);
    await screen.findAllByText("Spec");
    await user.click(screen.getByRole("button", { name: "Edit" }));
    const title = await screen.findByLabelText("Document title");
    await user.clear(title);
    await user.type(title, "Spec v2");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(c => (c[1]?.method ?? "GET").toUpperCase() === "PATCH");
      expect(JSON.parse(String(patch![1]?.body))).toMatchObject({ version: 2, title: "Spec v2" });
    });
    await waitFor(() => expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument());
  });

  it("keeps the draft and warns on a version conflict", async () => {
    const user = userEvent.setup();
    let patchSeen = false;
    fetchMock.mockImplementation(async (url, init) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "PATCH" && !patchSeen) {
        patchSeen = true;
        return jsonResponse(
          { success: false, error: { code: "VERSION_CONFLICT", message: "stale" } },
          { status: 409 },
        );
      }
      if (String(url).includes("/users"))
        return jsonResponse({ success: true, data: [] });
      // GET (initial + conflict refetch).
      return jsonResponse({ success: true, data: doc({ version: 9 }) });
    });
    renderWithProviders(<DocumentDetail docId="d1" onDeleted={() => {}} />);
    await screen.findAllByText("Spec");
    await user.click(screen.getByRole("button", { name: "Edit" }));
    const title = await screen.findByLabelText("Document title");
    await user.clear(title);
    await user.type(title, "My draft");
    await user.click(screen.getByRole("button", { name: "Save" }));
    // Stays in edit mode (Save still present) and the draft is untouched.
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(screen.getByLabelText("Document title")).toHaveValue("My draft");
  });
});

describe("documentDetail — delete + uploads", () => {
  it("deletes after confirmation and notifies the parent", async () => {
    const user = userEvent.setup();
    routeDoc(doc(), () => jsonResponse({ success: true, data: null }));
    const onDeleted = vi.fn();
    renderWithProviders(<DocumentDetail docId="d1" onDeleted={onDeleted} />);
    await screen.findAllByText("Spec");
    await user.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("alertdialog").catch(() => screen.getByRole("dialog"));
    const confirm = within(dialog).getAllByRole("button").find(b => /delete/i.test(b.textContent ?? ""));
    await user.click(confirm!);
    await waitFor(() => {
      const del = fetchMock.mock.calls.find(c => (c[1]?.method ?? "GET").toUpperCase() === "DELETE");
      expect(del).toBeTruthy();
    });
    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
  });

  it("rejects an upload that exceeds the per-file size cap", async () => {
    const user = userEvent.setup();
    routeDoc(doc());
    const { container } = renderWithProviders(<DocumentDetail docId="d1" onDeleted={() => {}} />);
    await screen.findAllByText("Spec");
    const input = container.querySelector("input[type=file]") as HTMLInputElement;
    const big = new File([new Uint8Array(2048)], "big.bin");
    await user.upload(input, big);
    expect(toastError).toHaveBeenCalled();
    expect(uploadMutate).not.toHaveBeenCalled();
  });

  it("rejects uploads once the attachment quota is full", async () => {
    const user = userEvent.setup();
    uploadHook.attachmentCount = 20;
    routeDoc(doc());
    const { container } = renderWithProviders(<DocumentDetail docId="d1" onDeleted={() => {}} />);
    await screen.findAllByText("Spec");
    const input = container.querySelector("input[type=file]") as HTMLInputElement;
    await user.upload(input, new File([new Uint8Array(10)], "ok.txt"));
    expect(toastError).toHaveBeenCalled();
    expect(uploadMutate).not.toHaveBeenCalled();
  });

  it("uploads a valid file", async () => {
    const user = userEvent.setup();
    routeDoc(doc());
    const { container } = renderWithProviders(<DocumentDetail docId="d1" onDeleted={() => {}} />);
    await screen.findAllByText("Spec");
    const input = container.querySelector("input[type=file]") as HTMLInputElement;
    await user.upload(input, new File([new Uint8Array(10)], "ok.txt"));
    expect(uploadMutate).toHaveBeenCalledTimes(1);
  });
});
