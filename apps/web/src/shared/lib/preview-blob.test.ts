import { describe, expect, it } from "vitest";
import { retypeBlobToMime } from "./preview-blob";

describe("retypeBlobToMime", () => {
  it("re-types an octet-stream svg blob to image/svg+xml", () => {
    // The backend serves SVG as octet-stream; the preview re-types it so an
    // <img> blob: URL renders it (scripts still never execute under <img>).
    const raw = new Blob(["<svg xmlns=\"http://www.w3.org/2000/svg\"/>"], { type: "application/octet-stream" });
    const typed = retypeBlobToMime(raw, "image/svg+xml");
    expect(typed.type).toBe("image/svg+xml");
    expect(typed.size).toBe(raw.size);
  });

  it("re-types a raster blob to its declared mimetype", () => {
    const raw = new Blob([new Uint8Array([0x89, 0x50, 0x4E, 0x47])], { type: "application/octet-stream" });
    expect(retypeBlobToMime(raw, "image/png").type).toBe("image/png");
  });

  it("leaves the blob untouched when no mimetype is given", () => {
    const raw = new Blob(["x"], { type: "application/octet-stream" });
    expect(retypeBlobToMime(raw, "")).toBe(raw);
  });
});
