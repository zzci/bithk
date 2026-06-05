import { describe, expect, it } from "vitest";
import { UNIVER_SHEET_MIME } from "@/shared/lib/api/drive";
import { resolvePreviewKind } from "./-file-preview-types";

describe("resolvePreviewKind", () => {
  it("inlines the safe raster image types", () => {
    for (const mime of ["image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp", "image/tiff"])
      expect(resolvePreviewKind(mime, "photo.png")).toBe("image");
  });

  it("shows SVG as source, never inline", () => {
    expect(resolvePreviewKind("image/svg+xml", "icon.svg")).toBe("text");
    expect(resolvePreviewKind("", "icon.svg")).toBe("text");
  });

  it("does not inline other image/* types", () => {
    expect(resolvePreviewKind("image/avif", "a.avif")).toBe("unsupported");
    expect(resolvePreviewKind("image/heic", "a.heic")).toBe("unsupported");
  });

  it("classifies pdf by mime or extension", () => {
    expect(resolvePreviewKind("application/pdf", "x")).toBe("pdf");
    expect(resolvePreviewKind("", "doc.pdf")).toBe("pdf");
  });

  it("classifies markdown by mime or extension", () => {
    expect(resolvePreviewKind("text/markdown", "x")).toBe("markdown");
    expect(resolvePreviewKind("", "readme.md")).toBe("markdown");
  });

  it("classifies text and code payloads", () => {
    expect(resolvePreviewKind("text/plain", "x")).toBe("text");
    expect(resolvePreviewKind("", "main.ts")).toBe("text");
    expect(resolvePreviewKind("application/json", "x")).toBe("text");
  });

  it("routes spreadsheets and binaries to the download card", () => {
    expect(resolvePreviewKind("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "book.xlsx")).toBe("unsupported");
    expect(resolvePreviewKind("application/octet-stream", "data.bin")).toBe("unsupported");
  });

  it("classifies the univer sheet mime as unsupported", () => {
    expect(resolvePreviewKind(UNIVER_SHEET_MIME, "sheet")).toBe("unsupported");
  });
});
