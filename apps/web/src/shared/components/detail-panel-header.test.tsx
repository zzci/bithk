import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "@/test/utils";
import { DetailPanelHeader } from "./detail-panel-header";

describe("detailPanelHeader", () => {
  it("renders extraActions inside the header, before the delete button", () => {
    renderWithProviders(
      <DetailPanelHeader
        variant="drawer"
        title="Acme Marine"
        labels={{ close: "Close", delete: "Delete" }}
        onClose={() => {}}
        onDelete={() => {}}
        extraActions={<button type="button">Extra action</button>}
      />,
    );

    expect(screen.getByText("Acme Marine")).toBeInTheDocument();

    const extra = screen.getByRole("button", { name: "Extra action" });
    const del = screen.getByRole("button", { name: "Delete" });
    expect(extra).toBeInTheDocument();
    // extraActions slot is positioned before the delete button.
    expect(extra.compareDocumentPosition(del) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("renders without extraActions and keeps the existing actions", () => {
    renderWithProviders(
      <DetailPanelHeader
        variant="drawer"
        title="Acme Marine"
        labels={{ close: "Close" }}
        onClose={() => {}}
      />,
    );

    expect(screen.getByText("Acme Marine")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
    expect(screen.queryByText("Extra action")).not.toBeInTheDocument();
  });
});
