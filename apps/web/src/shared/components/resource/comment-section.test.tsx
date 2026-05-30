import type { ResourceComment, ResourceUser } from "./comment-section";
import { screen, waitFor, within } from "@testing-library/react";
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

describe("resourceCommentSection attachments", () => {
  beforeEach(() => {
    mocks.http.mockReset();
    routeHttp();
  });

  it("shows the upload control only on the current user's own comment", async () => {
    renderSection("u-self");
    await screen.findByText("Alice");

    // Alice owns c1, Bob owns c2 — exactly one upload control is rendered.
    const uploadButtons = await screen.findAllByTitle("Upload");
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
