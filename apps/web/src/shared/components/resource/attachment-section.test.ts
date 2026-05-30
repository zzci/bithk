import { describe, expect, it } from "vitest";
import { isPreviewable } from "./attachment-section";

describe("resource attachment isPreviewable", () => {
  it("treats svg as previewable (rendered via <img> over a re-typed blob)", () => {
    expect(isPreviewable("image/svg+xml")).toBe(true);
  });

  it("treats raster images as previewable", () => {
    expect(isPreviewable("image/png")).toBe(true);
    expect(isPreviewable("image/jpeg")).toBe(true);
  });

  it("treats pdf and text as previewable", () => {
    expect(isPreviewable("application/pdf")).toBe(true);
    expect(isPreviewable("text/plain")).toBe(true);
    expect(isPreviewable("application/xml")).toBe(true);
  });

  it("does not preview unknown binary types", () => {
    expect(isPreviewable("application/zip")).toBe(false);
    expect(isPreviewable("video/mp4")).toBe(false);
  });
});
