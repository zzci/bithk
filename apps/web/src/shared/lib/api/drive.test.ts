import { describe, expect, it } from "vitest";
import { parseContentDispositionFilename } from "./drive";

describe("parseContentDispositionFilename", () => {
  it("returns undefined when the header is absent", () => {
    expect(parseContentDispositionFilename(null)).toBeUndefined();
  });

  it("reads the plain filename form", () => {
    expect(parseContentDispositionFilename("attachment; filename=\"report.pdf\"")).toBe("report.pdf");
  });

  it("reads an unquoted plain filename", () => {
    expect(parseContentDispositionFilename("attachment; filename=notes.txt")).toBe("notes.txt");
  });

  it("prefers the RFC 5987 extended form and decodes it", () => {
    expect(
      parseContentDispositionFilename("attachment; filename=\"fallback.txt\"; filename*=UTF-8''r%C3%A9sum%C3%A9.pdf"),
    ).toBe("résumé.pdf");
  });

  it("falls back to the plain form when extended encoding is malformed", () => {
    expect(
      parseContentDispositionFilename("attachment; filename=\"safe.txt\"; filename*=UTF-8''%E0%A4%A"),
    ).toBe("safe.txt");
  });
});
