import { describe, expect, it } from "vitest";

import { resolvePreviewKind } from "./-file-preview-dialog";

describe("resolvePreviewKind", () => {
  it("routes images by mimetype", () => {
    expect(resolvePreviewKind("image/png", "a.png")).toBe("image");
    // SVG is XSS-fragile, so it is shown as source text, never inline-rendered.
    expect(resolvePreviewKind("image/svg+xml", "a.svg")).toBe("text");
  });

  it("routes pdf by mimetype or extension", () => {
    expect(resolvePreviewKind("application/pdf", "a.pdf")).toBe("pdf");
    expect(resolvePreviewKind("application/octet-stream", "a.pdf")).toBe("pdf");
  });

  it("routes markdown ahead of plain text", () => {
    expect(resolvePreviewKind("text/markdown", "a.md")).toBe("markdown");
    expect(resolvePreviewKind("application/octet-stream", "readme.markdown")).toBe("markdown");
  });

  it("routes plain text and source code to text", () => {
    expect(resolvePreviewKind("text/plain", "a.txt")).toBe("text");
    expect(resolvePreviewKind("application/octet-stream", "main.ts")).toBe("text");
    expect(resolvePreviewKind("application/json", "data.json")).toBe("text");
    expect(resolvePreviewKind("application/ld+json", "x")).toBe("text");
  });

  it("falls back to unsupported for unknown binary types", () => {
    expect(resolvePreviewKind("application/zip", "a.zip")).toBe("unsupported");
    expect(resolvePreviewKind("video/mp4", "a.mp4")).toBe("unsupported");
  });
});
