import { describe, expect, it } from "vitest";
import { isPreviewable, previewKindFor } from "./attachment-section";

function att(mimetype: string) {
  return { id: "1", filename: "f", mimetype, size: 1, downloadUrl: "/x" };
}

describe("resource attachment preview classification", () => {
  it("treats svg as a previewable image (rendered via <img> over a re-typed blob)", () => {
    expect(previewKindFor("image/svg+xml")).toBe("image");
    expect(isPreviewable(att("image/svg+xml"))).toBe(true);
  });

  it("treats raster images as previewable", () => {
    expect(isPreviewable(att("image/png"))).toBe(true);
    expect(isPreviewable(att("image/jpeg"))).toBe(true);
  });

  it("does not preview non-image types", () => {
    expect(previewKindFor("application/pdf")).toBe("other");
    expect(isPreviewable(att("text/plain"))).toBe(false);
    expect(isPreviewable(att("application/xml"))).toBe(false);
  });
});
