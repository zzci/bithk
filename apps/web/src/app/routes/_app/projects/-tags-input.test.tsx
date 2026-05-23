import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it, vi } from "vitest";
import testI18n from "@/test/i18n";
import { TagsInput } from "./-tags-input";

function renderInput(value: readonly string[] = [], onChange = vi.fn()) {
  render(
    <I18nextProvider i18n={testI18n}>
      <TagsInput value={value} onChange={onChange} />
    </I18nextProvider>,
  );
  return { onChange };
}

describe("tagsInput", () => {
  it("renders existing tags as badges with a labelled remove button", () => {
    renderInput(["alpha", "beta"]);
    expect(screen.getByText("alpha")).toBeInTheDocument();
    expect(screen.getByText("beta")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove tag alpha" })).toBeInTheDocument();
  });

  it("adds a tag on Enter and clears the draft", async () => {
    const user = userEvent.setup();
    const { onChange } = renderInput([]);
    const input = screen.getByPlaceholderText("Add a tag and press Enter");
    await user.type(input, "design{Enter}");
    expect(onChange).toHaveBeenCalledWith(["design"]);
    expect(input).toHaveValue("");
  });

  it("adds a tag on comma", async () => {
    const user = userEvent.setup();
    const { onChange } = renderInput([]);
    await user.type(screen.getByRole("textbox"), "urgent,");
    expect(onChange).toHaveBeenCalledWith(["urgent"]);
  });

  it("removes the last tag on Backspace when the draft is empty", async () => {
    const user = userEvent.setup();
    const { onChange } = renderInput(["one", "two"]);
    await user.type(screen.getByRole("textbox"), "{Backspace}");
    expect(onChange).toHaveBeenCalledWith(["one"]);
  });

  it("removes a tag when its × button is clicked", async () => {
    const user = userEvent.setup();
    const { onChange } = renderInput(["keep", "drop"]);
    await user.click(screen.getByRole("button", { name: "Remove tag drop" }));
    expect(onChange).toHaveBeenCalledWith(["keep"]);
  });

  it("commits a trimmed draft on blur", async () => {
    const user = userEvent.setup();
    const { onChange } = renderInput([]);
    const input = screen.getByRole("textbox");
    await user.type(input, "  spaced  ");
    await user.tab();
    expect(onChange).toHaveBeenCalledWith(["spaced"]);
  });
});
