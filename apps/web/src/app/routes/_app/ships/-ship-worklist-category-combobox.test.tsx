import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/utils";
import { WorklistCategoryCombobox } from "./-ship-worklist-tab";

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

function Harness() {
  const [value, setValue] = useState("");
  return (
    <div>
      <WorklistCategoryCombobox value={value} onChange={setValue} />
      <output data-testid="value">{value}</output>
    </div>
  );
}

describe("worklistCategoryCombobox", () => {
  it("suggests the global vocabulary as options", async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      success: true,
      data: [
        { id: "wc1", name: "Routine Maintenance", description: null, createdAt: "2026-06-02T00:00:00.000Z", updatedAt: "2026-06-02T00:00:00.000Z" },
        { id: "wc2", name: "Safety Inspection", description: null, createdAt: "2026-06-02T00:00:00.000Z", updatedAt: "2026-06-02T00:00:00.000Z" },
      ],
    }));

    const user = userEvent.setup();
    renderWithProviders(<Harness />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const input = screen.getByRole("combobox");
    await user.type(input, "Routine");

    expect(await screen.findByText("Routine Maintenance")).toBeInTheDocument();
    expect(screen.getByTestId("value")).toHaveTextContent("Routine");
  });

  it("accepts arbitrary free text that is not in the vocabulary", async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      success: true,
      data: [
        { id: "wc1", name: "Routine Maintenance", description: null, createdAt: "2026-06-02T00:00:00.000Z", updatedAt: "2026-06-02T00:00:00.000Z" },
      ],
    }));

    const user = userEvent.setup();
    renderWithProviders(<Harness />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const input = screen.getByRole("combobox");
    await user.type(input, "Custom Bespoke Task");

    expect(screen.getByTestId("value")).toHaveTextContent("Custom Bespoke Task");
    expect(input).toHaveValue("Custom Bespoke Task");
  });
});
