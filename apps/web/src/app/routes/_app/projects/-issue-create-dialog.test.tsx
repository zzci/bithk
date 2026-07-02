import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/utils";
import { CreateIssueDialog } from "./-issue-create-dialog";

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (_input, init) => {
    if (String(init?.method ?? "GET").toUpperCase() === "POST")
      return jsonResponse({ success: true, data: { id: "i9" } }, { status: 201 });
    return jsonResponse({ success: true, data: [] });
  });
  globalThis.fetch = fetchMock;
});

afterEach(() => {
  fetchMock.mockReset();
});

function renderDialog(overrides: Partial<React.ComponentProps<typeof CreateIssueDialog>> = {}) {
  const onOpenChange = vi.fn();
  const utils = renderWithProviders(
    <CreateIssueDialog
      projectId="p1"
      members={[]}
      memberLabels={new Map()}
      initialStatus="todo"
      open
      onOpenChange={onOpenChange}
      {...overrides}
    />,
  );
  return { ...utils, onOpenChange };
}

describe("createIssueDialog", () => {
  it("disables submit while the title is empty", async () => {
    renderDialog();
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "Create issue" })).toBeDisabled();
  });

  it("renders the status and priority pills from the static label maps", async () => {
    renderDialog({ initialStatus: "working" });
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("button", { name: /In Progress/ })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /Low/ })).toBeInTheDocument();
  });

  it("posts the composed body and closes on success", async () => {
    const user = userEvent.setup();
    const { onOpenChange } = renderDialog();
    const dialog = await screen.findByRole("dialog");

    await user.type(within(dialog).getByPlaceholderText("Issue title"), "Replace pump seal");
    await user.click(within(dialog).getByRole("button", { name: "Create issue" }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(c => String(c[1]?.method ?? "").toUpperCase() === "POST");
      expect(post).toBeDefined();
      expect(String(post![0])).toContain("/projects/p1/issues");
      const body = JSON.parse(String(post![1]!.body)) as Record<string, unknown>;
      expect(body).toMatchObject({ title: "Replace pump seal", status: "todo", priority: "low" });
    });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  }, 15000);

  it("lists every status option with its mapped label in the status dropdown", async () => {
    const user = userEvent.setup();
    renderDialog();
    const dialog = await screen.findByRole("dialog");

    await user.click(within(dialog).getByRole("button", { name: /To Do/ }));
    for (const label of ["To Do", "In Progress", "In Review", "Done", "Cancelled"])
      expect(await screen.findByRole("menuitemradio", { name: new RegExp(label) })).toBeInTheDocument();
  }, 15000);
});
