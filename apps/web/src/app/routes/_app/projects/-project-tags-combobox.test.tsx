import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "@/test/utils";
import { ProjectTagsCombobox } from "./-project-tags-combobox";

// A thin controlled wrapper so the test can assert on the emitted value.
function Harness({ suggestions }: { readonly suggestions: readonly string[] }) {
  const [value, setValue] = useState<readonly string[]>([]);
  return (
    <>
      <ProjectTagsCombobox value={value} onChange={setValue} suggestions={suggestions} />
      <output data-testid="value">{value.join(",")}</output>
    </>
  );
}

describe("projectTagsCombobox", () => {
  it("lists existing tags and selects one", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness suggestions={["alpha", "beta"]} />);

    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "alpha" }));

    expect(screen.getByTestId("value")).toHaveTextContent("alpha");
  });

  it("creates a brand-new tag from the typed query", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness suggestions={["alpha"]} />);

    await user.click(screen.getByRole("combobox"));
    const input = await screen.findByPlaceholderText("Search or create tags");
    await user.type(input, "gamma");
    await user.click(await screen.findByRole("option", { name: "Create \"gamma\"" }));

    expect(screen.getByTestId("value")).toHaveTextContent("gamma");
  });

  it("removes a selected tag via its chip", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness suggestions={["alpha", "beta"]} />);

    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "alpha" }));
    expect(screen.getByTestId("value")).toHaveTextContent("alpha");

    await user.click(screen.getByRole("button", { name: "Remove tag alpha" }));
    expect(screen.getByTestId("value")).toHaveTextContent("");
  });
});
