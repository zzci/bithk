import type { CreateProjectInput } from "@/shared/lib/api/projects";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/utils";
import { ProjectFormDialog } from "./-project-form-dialog";

describe("projectFormDialog", () => {
  it("renders the create form with the required name field", () => {
    renderWithProviders(
      <ProjectFormDialog open onOpenChange={vi.fn()} pending={false} onSubmit={vi.fn()} />,
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("New project")).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toBeRequired();
  });

  it("keeps submit disabled until a name is entered", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <ProjectFormDialog open onOpenChange={vi.fn()} pending={false} onSubmit={vi.fn()} />,
    );
    const submit = screen.getByRole("button", { name: "Create" });
    expect(submit).toBeDisabled();
    await user.type(screen.getByLabelText("Name"), "Bridge");
    expect(submit).toBeEnabled();
  });

  it("submits a trimmed payload with the optional fields included only when filled", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn<(v: CreateProjectInput) => void>();
    renderWithProviders(
      <ProjectFormDialog open onOpenChange={vi.fn()} pending={false} onSubmit={onSubmit} />,
    );
    await user.type(screen.getByLabelText("Name"), "  Bridge  ");
    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const payload = onSubmit.mock.calls[0]![0];
    expect(payload.name).toBe("Bridge");
    // Code and status are derived by the backend, never sent from here.
    expect("code" in payload).toBe(false);
    expect("status" in payload).toBe(false);
    // Untouched optional fields stay out of the payload entirely.
    expect("description" in payload).toBe(false);
    expect("tags" in payload).toBe(false);
    // The preset is always explicit; General mounts no maritime sections, so
    // it carries no section data.
    expect(payload.preset).toBe("general");
    expect("sectionData" in payload).toBe(false);
  });

  it("reveals the ship-profile fields only under the ship preset", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <ProjectFormDialog open onOpenChange={vi.fn()} pending={false} onSubmit={vi.fn()} />,
    );
    expect(screen.queryByLabelText("Hull number")).not.toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "Ship" }));
    expect(screen.getByLabelText("Hull number")).toBeInTheDocument();
    expect(screen.getByLabelText("IMO number")).toBeInTheDocument();

    // Switching back hides them again.
    await user.click(screen.getByRole("radio", { name: "General project" }));
    expect(screen.queryByLabelText("Hull number")).not.toBeInTheDocument();
  });

  it("submits the ship preset with its particulars under sectionData", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn<(v: CreateProjectInput) => void>();
    renderWithProviders(
      <ProjectFormDialog open onOpenChange={vi.fn()} pending={false} onSubmit={onSubmit} />,
    );
    await user.type(screen.getByLabelText("Name"), "Atlas");
    await user.click(screen.getByRole("radio", { name: "Ship" }));
    await user.type(screen.getByLabelText("Hull number"), "HULL-7");
    await user.type(screen.getByLabelText("IMO number"), "IMO-1234567");
    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const payload = onSubmit.mock.calls[0]![0];
    expect(payload.preset).toBe("ship");
    const shipData = payload.sectionData?.["ship-profile"] as Record<string, unknown>;
    expect(shipData.hullNumber).toBe("HULL-7");
    expect(shipData.imoNumber).toBe("IMO-1234567");
    // Untouched particulars clear to null rather than being omitted.
    expect(shipData.mmsi).toBeNull();
  });

  it("omits a blank hull number so the API generates one", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn<(v: CreateProjectInput) => void>();
    renderWithProviders(
      <ProjectFormDialog open onOpenChange={vi.fn()} pending={false} onSubmit={onSubmit} />,
    );
    await user.type(screen.getByLabelText("Name"), "Atlas");
    await user.click(screen.getByRole("radio", { name: "Ship" }));
    await user.click(screen.getByRole("button", { name: "Create" }));

    const shipData = onSubmit.mock.calls[0]![0].sectionData?.["ship-profile"] as Record<string, unknown>;
    expect("hullNumber" in shipData).toBe(false);
    expect(shipData.shipStatus).toBe("laid_up");
  });

  it("blocks submit while a ship particular is out of range", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderWithProviders(
      <ProjectFormDialog open onOpenChange={vi.fn()} pending={false} onSubmit={onSubmit} />,
    );
    await user.type(screen.getByLabelText("Name"), "Atlas");
    await user.click(screen.getByRole("radio", { name: "Ship" }));
    // 1500 predates the earliest plausible build year (1900).
    await user.type(screen.getByLabelText("Build year"), "1500");

    expect(screen.getByRole("button", { name: "Create" })).toBeDisabled();
    screen.getByRole("dialog").querySelector("form")!.requestSubmit();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("does not submit when the name is only whitespace", async () => {
    const onSubmit = vi.fn();
    renderWithProviders(
      <ProjectFormDialog open onOpenChange={vi.fn()} pending={false} onSubmit={onSubmit} />,
    );
    // The button is disabled, so a programmatic form submit is the only path —
    // the guard inside submit() must still reject a blank name.
    const form = screen.getByRole("dialog").querySelector("form")!;
    form.requestSubmit();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("surfaces a server error message in the banner", () => {
    renderWithProviders(
      <ProjectFormDialog
        open
        onOpenChange={vi.fn()}
        pending={false}
        errorMessage="A project with that name already exists"
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByText("A project with that name already exists")).toBeInTheDocument();
  });

  it("does not submit while a request is pending", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderWithProviders(
      <ProjectFormDialog open onOpenChange={vi.fn()} pending onSubmit={onSubmit} />,
    );
    await user.type(screen.getByLabelText("Name"), "Bridge");
    const submit = screen.getByRole("button", { name: "Create" });
    expect(submit).toBeDisabled();
    screen.getByRole("dialog").querySelector("form")!.requestSubmit();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
