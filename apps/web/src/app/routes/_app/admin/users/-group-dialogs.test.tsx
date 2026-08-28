import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Dialog, DialogContent } from "@/shared/components/ui/dialog";
import { renderWithProviders } from "@/test/utils";
import { DefaultModulesDialog, GroupFormDialog } from "./-group-dialogs";

// The dialogs render several base-ui switches; driving them in jsdom under
// parallel CPU contention is slow.
vi.setConfig({ testTimeout: 20_000 });

function renderInDialog(ui: React.ReactElement) {
  return renderWithProviders(
    <Dialog open>
      <DialogContent>{ui}</DialogContent>
    </Dialog>,
  );
}

describe("groupFormDialog", () => {
  it("disables submit while the name is empty", async () => {
    renderInDialog(
      <GroupFormDialog
        onSubmit={vi.fn()}
        title="New Group"
        description="desc"
        submitLabel="Create"
      />,
    );
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "Create" })).toBeDisabled();
  });

  it("labels every module switch from the static label map", async () => {
    renderInDialog(
      <GroupFormDialog onSubmit={vi.fn()} title="New Group" description="desc" submitLabel="Create" />,
    );
    const dialog = await screen.findByRole("dialog");
    for (const label of ["Documents", "Drive", "Projects", "Contacts", "HR"])
      expect(within(dialog).getByRole("switch", { name: label })).toBeInTheDocument();
  });

  it("submits trimmed fields with the toggled modules in registry order", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderInDialog(
      <GroupFormDialog onSubmit={onSubmit} title="New Group" description="desc" submitLabel="Create" />,
    );
    const dialog = await screen.findByRole("dialog");

    await user.type(within(dialog).getByLabelText("Group Name"), "  Engineering  ");
    // Toggle out of registry order; the submitted list must still follow it.
    await user.click(within(dialog).getByRole("switch", { name: "HR" }));
    await user.click(within(dialog).getByRole("switch", { name: "Documents" }));
    await user.click(within(dialog).getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith("Engineering", "", ["documents", "hr"]);
    });
  });
});

describe("defaultModulesDialog", () => {
  it("submits the toggled module set", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderInDialog(
      <DefaultModulesDialog
        initialModules={["documents"]}
        onSubmit={onSubmit}
        title="Edit default modules"
        description="desc"
        submitLabel="Save"
      />,
    );
    const dialog = await screen.findByRole("dialog");

    expect(within(dialog).getByRole("switch", { name: "Documents" })).toBeChecked();
    await user.click(within(dialog).getByRole("switch", { name: "Drive" }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(["documents", "drive"]);
    });
  });
});
