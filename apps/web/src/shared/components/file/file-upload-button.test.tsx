import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FileUploadButton } from "./file-upload-button";

function getInput(container: HTMLElement): HTMLInputElement {
  return container.querySelector<HTMLInputElement>("input[type=\"file\"]")!;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fileUploadButton — accept policy", () => {
  it("sets NO accept attribute by default (OA accepts any file type)", () => {
    const { container } = render(<FileUploadButton onSelect={() => {}} />);
    expect(getInput(container)).not.toHaveAttribute("accept");
  });

  it("restricts to image/* when accept=\"image\"", () => {
    const { container } = render(<FileUploadButton accept="image" onSelect={() => {}} />);
    expect(getInput(container)).toHaveAttribute("accept", "image/*");
  });

  it("uses an explicit acceptOverride verbatim", () => {
    const { container } = render(
      <FileUploadButton acceptOverride=".csv,text/csv" onSelect={() => {}} />,
    );
    expect(getInput(container)).toHaveAttribute("accept", ".csv,text/csv");
  });

  it("lets acceptOverride win over the accept policy", () => {
    const { container } = render(
      <FileUploadButton accept="image" acceptOverride=".csv,text/csv" onSelect={() => {}} />,
    );
    expect(getInput(container)).toHaveAttribute("accept", ".csv,text/csv");
  });
});

describe("fileUploadButton — input wiring", () => {
  it("applies multiple and directory flags to the input", () => {
    const { container } = render(
      <FileUploadButton multiple directory onSelect={() => {}} />,
    );
    const input = getInput(container);
    expect(input.multiple).toBe(true);
    expect(input).toHaveAttribute("webkitdirectory");
  });

  it("forwards inputRef to the internal input element", () => {
    const ref = { current: null as HTMLInputElement | null };
    const { container } = render(<FileUploadButton inputRef={ref} onSelect={() => {}} />);
    expect(ref.current).toBe(getInput(container));
  });
});

describe("fileUploadButton — selection", () => {
  it("fires onSelect with the picked File[] and resets the input value", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const { container } = render(<FileUploadButton multiple onSelect={onSelect} />);
    const input = getInput(container);

    const file = new File(["hello"], "note.txt", { type: "text/plain" });
    await user.upload(input, file);

    expect(onSelect).toHaveBeenCalledTimes(1);
    const passed = onSelect.mock.calls[0]![0] as File[];
    expect(Array.isArray(passed)).toBe(true);
    expect(passed.map(f => f.name)).toEqual(["note.txt"]);
    // Reset after change so re-picking the same file fires onSelect again.
    expect(input.value).toBe("");
  });

  it("does not fire onSelect when nothing is picked", () => {
    const onSelect = vi.fn();
    const { container } = render(<FileUploadButton onSelect={onSelect} />);
    fireEvent.change(getInput(container), { target: { files: [] } });
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe("fileUploadButton — children trigger", () => {
  it("opens the picker when the rendered trigger is clicked", async () => {
    const user = userEvent.setup();
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    render(
      <FileUploadButton onSelect={() => {}}>
        <button type="button">Pick file</button>
      </FileUploadButton>,
    );

    await user.click(screen.getByRole("button", { name: "Pick file" }));
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it("does not open the picker while disabled", async () => {
    const user = userEvent.setup();
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    render(
      <FileUploadButton disabled onSelect={() => {}}>
        <button type="button">Pick file</button>
      </FileUploadButton>,
    );

    await user.click(screen.getByRole("button", { name: "Pick file" }));
    expect(clickSpy).not.toHaveBeenCalled();
  });
});
