import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it, vi } from "vitest";
import testI18n from "@/test/i18n";
import { TagsRow } from "./-documents-tags";

function renderRow(tags: readonly string[] = [], onChange = vi.fn()) {
  render(
    <I18nextProvider i18n={testI18n}>
      <TagsRow tags={tags} onChange={onChange} />
    </I18nextProvider>,
  );
  return { onChange };
}

describe("tagsRow", () => {
  it("shows a single add affordance when there are no tags", () => {
    renderRow([]);
    expect(screen.getByRole("button", { name: /Add tag/ })).toBeInTheDocument();
  });

  it("adds a normalized tag on Enter", async () => {
    const user = userEvent.setup();
    const { onChange } = renderRow([]);
    await user.click(screen.getByRole("button", { name: /Add tag/ }));
    await user.type(screen.getByPlaceholderText("Add tag..."), "React{Enter}");
    // Lower-cased and stripped of non-word characters.
    expect(onChange).toHaveBeenCalledWith(["react"]);
  });

  it("strips punctuation and whitespace when committing", async () => {
    const user = userEvent.setup();
    const { onChange } = renderRow([]);
    await user.click(screen.getByRole("button", { name: /Add tag/ }));
    await user.type(screen.getByPlaceholderText("Add tag..."), "C++ Lang!{Enter}");
    expect(onChange).toHaveBeenCalledWith(["clang"]);
  });

  it("renders existing tags and removes one via its × button", async () => {
    const user = userEvent.setup();
    const { onChange } = renderRow(["alpha", "beta"]);
    expect(screen.getByText("alpha")).toBeInTheDocument();
    expect(screen.getByText("beta")).toBeInTheDocument();
    const removeButtons = screen.getAllByRole("button", { name: "Remove tag" });
    await user.click(removeButtons[0]!);
    expect(onChange).toHaveBeenCalledWith(["beta"]);
  });

  it("ignores a duplicate (case-insensitive) tag", async () => {
    const user = userEvent.setup();
    const { onChange } = renderRow(["react"]);
    await user.click(screen.getByRole("button", { name: "Add tag..." }));
    await user.type(screen.getByPlaceholderText("Add tag..."), "REACT{Enter}");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("cancels the inline editor on Escape without emitting", async () => {
    const user = userEvent.setup();
    const { onChange } = renderRow([]);
    await user.click(screen.getByRole("button", { name: /Add tag/ }));
    const input = screen.getByPlaceholderText("Add tag...");
    await user.type(input, "draft{Escape}");
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByPlaceholderText("Add tag...")).not.toBeInTheDocument();
  });
});
