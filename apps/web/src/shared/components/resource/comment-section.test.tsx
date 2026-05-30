import type { ResourceComment, ResourceUser } from "./comment-section";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/utils";

const mocks = vi.hoisted(() => ({
  http: vi.fn(),
}));

vi.mock("@/shared/lib/http", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    BASE_PATH: "",
    http: (path: string, init?: RequestInit) => mocks.http(path, init),
  };
});

// The real editor lazy-loads Milkdown/ProseMirror, which is noise for these
// wiring tests — stub it to a plain element that echoes its content.
vi.mock("@/shared/components/editor", () => ({
  MarkdownEditor: ({ value, defaultValue, placeholder }: { value?: string; defaultValue?: string; placeholder?: string }) => (
    <div data-testid="markdown">{value ?? defaultValue ?? placeholder ?? ""}</div>
  ),
}));

const { ResourceCommentSection } = await import("./comment-section");

const RESOURCE = "projects/p1/issues";
const RESOURCE_ID = "i1";

const comments: ResourceComment[] = [
  { id: "c1", authorId: "u-self", content: "mine", createdAt: "2026-05-30T10:00:00Z", updatedAt: "2026-05-30T10:00:00Z" },
  { id: "c2", authorId: "u-other", content: "theirs", createdAt: "2026-05-30T10:00:00Z", updatedAt: "2026-05-30T10:00:00Z" },
];

const attachment = {
  id: "a1",
  filename: "report.txt",
  mimetype: "text/plain",
  size: 12,
  uploadedBy: "u-self",
  createdAt: "2026-05-30T10:00:00Z",
};

const userMap = new Map<string, ResourceUser>([
  ["u-self", { id: "u-self", name: "Alice" }],
  ["u-other", { id: "u-other", name: "Bob" }],
]);

function routeHttp() {
  mocks.http.mockImplementation((path: string) => {
    if (path === `/${RESOURCE}/${RESOURCE_ID}/comments`)
      return Promise.resolve({ data: comments });
    if (path === `/${RESOURCE}/${RESOURCE_ID}/comments/c1/attachments`)
      return Promise.resolve({ data: [attachment] });
    if (path.endsWith("/attachments"))
      return Promise.resolve({ data: [] });
    if (path === "/system/upload-limits")
      return Promise.resolve({ data: { maxFileSize: 10 * 1024 * 1024, maxAttachmentsPerResource: 20, totalQuota: null } });
    return Promise.resolve({ data: null });
  });
}

function renderSection(currentUserId: string) {
  return renderWithProviders(
    <ResourceCommentSection
      resource={RESOURCE}
      resourceId={RESOURCE_ID}
      userMap={userMap}
      i18nNs="issues"
      canDelete={() => false}
      enableAttachments
      currentUserId={currentUserId}
      canDeleteAttachment={att => att.uploadedBy === currentUserId}
    />,
  );
}

function renderComposer(stickyComposer: boolean) {
  return renderWithProviders(
    <ResourceCommentSection
      resource={RESOURCE}
      resourceId={RESOURCE_ID}
      userMap={userMap}
      i18nNs="issues"
      canDelete={() => false}
      stickyComposer={stickyComposer}
    />,
  );
}

describe("resourceCommentSection attachments", () => {
  beforeEach(() => {
    mocks.http.mockReset();
    routeHttp();
  });

  it("shows the upload control only on the current user's own comment", async () => {
    renderSection("u-self");
    await screen.findByText("Alice");

    // The composer Paperclip shares the "Upload" title, so exclude it; among
    // the per-comment controls only Alice's (c1) is rendered, not Bob's (c2).
    const send = await screen.findByRole("button", { name: "Send" });
    const composerScope = send.closest("div");
    const uploadButtons = (await screen.findAllByTitle("Upload")).filter(b => !composerScope?.contains(b));
    expect(uploadButtons).toHaveLength(1);
    expect(screen.getByText("Bob")).toBeInTheDocument();
  });

  it("lists existing attachments for a comment", async () => {
    renderSection("u-self");
    expect(await screen.findByText("report.txt")).toBeInTheDocument();
  });

  it("opens the confirm dialog and deletes a comment attachment", async () => {
    const user = userEvent.setup();
    renderSection("u-self");
    await screen.findByText("report.txt");

    await user.click(screen.getByTitle("Delete"));

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Delete Attachment")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(mocks.http).toHaveBeenCalledWith(
        `/${RESOURCE}/${RESOURCE_ID}/comments/c1/attachments/a1`,
        { method: "DELETE" },
      );
    });
  });
});

describe("resourceCommentSection composer surface + sticky", () => {
  beforeEach(() => {
    mocks.http.mockReset();
    routeHttp();
  });

  it("renders the composer input box without a filled background", async () => {
    renderComposer(false);
    const send = await screen.findByRole("button", { name: "Send" });
    const container = send.closest("div.space-y-2");
    expect(container).not.toBeNull();
    // ITEM 3: the composer/input box no longer carries the muted fill.
    expect(container?.className).not.toContain("bg-muted/40");
  });

  it("keeps the composer at the top and non-sticky by default", async () => {
    renderComposer(false);
    const send = await screen.findByRole("button", { name: "Send" });
    // No sticky wrapper exists when the opt-in flag is off.
    expect(document.querySelector(".sticky")).toBeNull();
    // Composer precedes the comment list (existing top layout preserved).
    const firstComment = await screen.findByText("mine");
    expect(send.compareDocumentPosition(firstComment) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("pins the composer to the bottom inside a solid sticky bar when opted in", async () => {
    renderComposer(true);
    const send = await screen.findByRole("button", { name: "Send" });
    const sticky = document.querySelector(".sticky");
    expect(sticky).not.toBeNull();
    expect(sticky?.className).toContain("bottom-0");
    expect(sticky?.className).toContain("bg-background");
    // Composer sits inside the sticky bar, below the comment list.
    expect(sticky?.contains(send)).toBe(true);
    const firstComment = await screen.findByText("mine");
    expect(firstComment.compareDocumentPosition(send) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

const txtFile = () => new File(["x"], "doc.txt", { type: "text/plain" });

// Locate the hidden composer file input — the one that is a sibling of the
// Send button (the per-comment upload inputs live elsewhere in the tree).
function composerFileInput(send: HTMLElement): HTMLInputElement {
  const input = send.closest("div")?.querySelector<HTMLInputElement>("input[type=\"file\"]");
  if (!input)
    throw new Error("composer file input not found");
  return input;
}

describe("resourceCommentSection composer attachments", () => {
  const CREATED_ID = "c-new";

  beforeEach(() => {
    mocks.http.mockReset();
    mocks.http.mockImplementation((path: string, init?: RequestInit) => {
      if (path === `/${RESOURCE}/${RESOURCE_ID}/comments` && init?.method === "POST")
        return Promise.resolve({ data: { id: CREATED_ID, authorId: "u-self", content: "", createdAt: "2026-05-30T11:00:00Z", updatedAt: "2026-05-30T11:00:00Z" } });
      if (path === `/${RESOURCE}/${RESOURCE_ID}/comments`)
        return Promise.resolve({ data: comments });
      if (path === "/system/upload-limits")
        return Promise.resolve({ data: { maxFileSize: 10 * 1024 * 1024, maxAttachmentsPerResource: 20, totalQuota: null } });
      if (path.endsWith("/attachments"))
        return Promise.resolve({ data: [] });
      return Promise.resolve({ data: null });
    });
  });

  it("stages a picked file, then posts the comment and uploads it on send", async () => {
    renderSection("u-self");
    const send = await screen.findByRole("button", { name: "Send" });

    fireEvent.change(composerFileInput(send), { target: { files: [txtFile()] } });
    expect(await screen.findByText("doc.txt")).toBeInTheDocument();

    fireEvent.click(send);

    await waitFor(() => {
      expect(mocks.http).toHaveBeenCalledWith(
        `/${RESOURCE}/${RESOURCE_ID}/comments`,
        expect.objectContaining({ method: "POST", body: expect.stringContaining("hasAttachments") }),
      );
    });
    await waitFor(() => {
      expect(mocks.http).toHaveBeenCalledWith(
        `/${RESOURCE}/${RESOURCE_ID}/comments/${CREATED_ID}/attachments`,
        expect.objectContaining({ method: "POST" }),
      );
    });
  });

  it("disables Send when empty and enables it once a file is staged", async () => {
    renderSection("u-self");
    const send = await screen.findByRole("button", { name: "Send" });
    expect(send).toBeDisabled();

    fireEvent.change(composerFileInput(send), { target: { files: [txtFile()] } });
    await screen.findByText("doc.txt");
    expect(send).not.toBeDisabled();
  });
});

describe("resourceCommentSection attachment-only render", () => {
  const emptyOnly: ResourceComment[] = [
    { id: "ce", authorId: "u-self", content: "", createdAt: "2026-05-30T10:00:00Z", updatedAt: "2026-05-30T10:00:00Z" },
  ];

  beforeEach(() => {
    mocks.http.mockReset();
    mocks.http.mockImplementation((path: string) => {
      if (path === `/${RESOURCE}/${RESOURCE_ID}/comments`)
        return Promise.resolve({ data: emptyOnly });
      if (path === `/${RESOURCE}/${RESOURCE_ID}/comments/ce/attachments`)
        return Promise.resolve({ data: [attachment] });
      if (path === "/system/upload-limits")
        return Promise.resolve({ data: { maxFileSize: 10 * 1024 * 1024, maxAttachmentsPerResource: 20, totalQuota: null } });
      if (path.endsWith("/attachments"))
        return Promise.resolve({ data: [] });
      return Promise.resolve({ data: null });
    });
  });

  it("renders the attachment but no empty content box for a text-less comment", async () => {
    renderSection("u-self");
    expect(await screen.findByText("report.txt")).toBeInTheDocument();
    // No muted content box is rendered for the empty-content comment.
    const contentBoxes = [...document.querySelectorAll("div")].filter(
      d => d.className.includes("bg-muted/40") && d.className.includes("px-3"),
    );
    expect(contentBoxes).toHaveLength(0);
  });
});
