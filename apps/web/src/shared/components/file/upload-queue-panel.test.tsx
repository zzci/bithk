import type { UploadTask } from "./upload-queue";
import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderWithProviders } from "@/test/utils";
import { useFileUploadStore } from "./upload-queue";
import { UploadQueuePanel } from "./upload-queue-panel";

function task(over: Partial<UploadTask>): UploadTask {
  return {
    id: over.id ?? "t",
    name: over.name ?? "file.txt",
    size: over.size ?? 1024,
    status: over.status ?? "uploading",
    progress: over.progress ?? 0,
    relativePath: over.relativePath,
    error: over.error,
  };
}

// The store is a module-level singleton, so reset it to its empty state after
// every case to keep the panel's visibility logic isolated between tests.
afterEach(() => {
  useFileUploadStore.setState({ tasks: [], preparing: false });
});

describe("uploadQueuePanel", () => {
  it("groups same-folder files under one folder header with a file count, and renders loose files flat", () => {
    useFileUploadStore.setState({
      preparing: false,
      tasks: [
        task({ id: "a", name: "a.txt", relativePath: "docs/a.txt", status: "uploading", progress: 40 }),
        task({ id: "b", name: "b.txt", relativePath: "docs/b.txt", status: "uploading", progress: 60 }),
        task({ id: "c", name: "c.txt", relativePath: "c.txt", status: "uploading", progress: 10 }),
      ],
    });
    renderWithProviders(<UploadQueuePanel />);

    // Folder group header for "docs" with its 2-file count (common ns copy).
    expect(screen.getByText("docs")).toBeInTheDocument();
    expect(screen.getByText("2 files")).toBeInTheDocument();

    // Overall summary while uploading: "Uploading {done}/{total}".
    expect(screen.getByText("Uploading 0/3")).toBeInTheDocument();

    // Every file (grouped and loose) renders by name.
    expect(screen.getByText("a.txt")).toBeInTheDocument();
    expect(screen.getByText("b.txt")).toBeInTheDocument();
    expect(screen.getByText("c.txt")).toBeInTheDocument();
  });

  it("shows the overall completion summary once all tasks are done", () => {
    useFileUploadStore.setState({
      preparing: false,
      tasks: [
        task({ id: "a", name: "a.txt", status: "done", progress: 100 }),
        task({ id: "b", name: "b.txt", status: "done", progress: 100 }),
      ],
    });
    renderWithProviders(<UploadQueuePanel />);

    expect(screen.getByText("Upload complete")).toBeInTheDocument();
  });

  it("shows the preparing-folders placeholder while folders are being created", () => {
    useFileUploadStore.setState({ tasks: [], preparing: true });
    renderWithProviders(<UploadQueuePanel />);

    expect(screen.getByText("Preparing folders…")).toBeInTheDocument();
  });

  it("renders nothing when the queue is empty and not preparing", () => {
    useFileUploadStore.setState({ tasks: [], preparing: false });
    const { container } = renderWithProviders(<UploadQueuePanel />);

    expect(container).toBeEmptyDOMElement();
  });
});
