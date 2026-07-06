import { describe, expect, test } from "bun:test";
import { mimeFromFilename, mimeMatchesContent, sniffKind, sniffMime } from "./mime-sniff";

function bytes(...vals: number[]): Uint8Array {
  return Uint8Array.from(vals);
}

describe("sniffKind", () => {
  test("recognises specific image subtypes by magic bytes", () => {
    expect(sniffKind(bytes(0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A))).toBe("png");
    expect(sniffKind(bytes(0xFF, 0xD8, 0xFF, 0xE0))).toBe("jpeg");
    expect(sniffKind(bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61))).toBe("gif");
    expect(sniffKind(bytes(0x42, 0x4D, 0x00, 0x00))).toBe("bmp");
    expect(sniffKind(bytes(0x49, 0x49, 0x2A, 0x00))).toBe("tiff");
    // WebP: RIFF????WEBP — the offset-8 marker disambiguates from WAV/AVI.
    expect(sniffKind(bytes(0x52, 0x49, 0x46, 0x46, 0x10, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50))).toBe("webp");
  });

  test("recognises PDF, ZIP, 7z magic bytes", () => {
    expect(sniffKind(bytes(0x25, 0x50, 0x44, 0x46, 0x2D, 0x31))).toBe("pdf");
    expect(sniffKind(bytes(0x50, 0x4B, 0x03, 0x04))).toBe("zip");
    expect(sniffKind(bytes(0x37, 0x7A, 0xBC, 0xAF, 0x27, 0x1C))).toBe("7z");
  });

  test("RIFF prefix without WEBP marker is NOT classified as webp", () => {
    // Bare RIFF could be WAV / AVI — we sniff null so the upload path falls
    // through to the "no signature matched" rejection.
    expect(sniffKind(bytes(0x52, 0x49, 0x46, 0x46, 0x10, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45))).toBeNull();
  });

  test("classifies plain ASCII as text", () => {
    expect(sniffKind(new TextEncoder().encode("hello, world\n"))).toBe("text");
    expect(sniffKind(new Uint8Array(0))).toBe("text");
  });

  test("returns null for unknown non-text binary blobs", () => {
    // SVG is XML text and sniffs as "text" (accepted as image/svg+xml by
    // mimeMatchesContent, never inline-rendered). A binary blob with no
    // known signature still sniffs as null.
    expect(sniffKind(bytes(0x00, 0x01, 0x02, 0x03, 0x04))).toBeNull();
  });
});

describe("mimeMatchesContent", () => {
  test("png claimed as image/png passes", () => {
    expect(mimeMatchesContent("image/png", bytes(0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A))).toBe(true);
  });

  test("png claimed as image/jpeg is REJECTED (subtype mismatch)", () => {
    // Subtype must match exactly so audit / quota rows record the right thing.
    expect(mimeMatchesContent("image/jpeg", bytes(0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A))).toBe(false);
  });

  test("jpeg claimed as image/jpg (common alias) passes", () => {
    expect(mimeMatchesContent("image/jpg", bytes(0xFF, 0xD8, 0xFF, 0xE0))).toBe(true);
  });

  test("png claimed as application/pdf is rejected", () => {
    expect(mimeMatchesContent("application/pdf", bytes(0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A))).toBe(false);
  });

  test("text claimed as text/csv passes", () => {
    expect(mimeMatchesContent("text/csv", new TextEncoder().encode("a,b,c\n1,2,3"))).toBe(true);
  });

  test("svg xml content claimed as image/svg+xml passes (sniffs as text)", () => {
    const svg = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 1 1\"><rect width=\"1\" height=\"1\"/></svg>";
    expect(mimeMatchesContent("image/svg+xml", new TextEncoder().encode(svg))).toBe(true);
    expect(mimeMatchesContent("image/svg+xml", new TextEncoder().encode("<svg/>"))).toBe(true);
  });

  test("text content claimed as a non-svg image type is still rejected", () => {
    // The text arm only matches text/* and the svg exception — never image/png.
    expect(mimeMatchesContent("image/png", new TextEncoder().encode("not a png"))).toBe(false);
  });
});

describe("sniffKind — signature variants and the text heuristic", () => {
  test("recognises gif87a, big-endian tiff, and the empty/spanned zip headers", () => {
    expect(sniffKind(bytes(0x47, 0x49, 0x46, 0x38, 0x37, 0x61))).toBe("gif"); // gif87a
    expect(sniffKind(bytes(0x4D, 0x4D, 0x00, 0x2A))).toBe("tiff"); // big-endian
    expect(sniffKind(bytes(0x50, 0x4B, 0x05, 0x06))).toBe("zip"); // empty archive
    expect(sniffKind(bytes(0x50, 0x4B, 0x07, 0x08))).toBe("zip"); // spanned archive
  });

  test("a single embedded NUL byte collapses the text classification", () => {
    expect(sniffKind(bytes(0x68, 0x69, 0x00, 0x68, 0x69))).toBeNull();
  });

  test("mostly-binary noise below the printable threshold is not text", () => {
    const noise = new Uint8Array(64);
    for (let i = 0; i < noise.length; i++)
      noise[i] = (i % 2 === 0) ? 0x01 : 0x02; // control bytes, no NULs
    expect(sniffKind(noise)).toBeNull();
  });
});

describe("mimeMatchesContent — alias coverage", () => {
  test("accepts x-zip-compressed, x-ms-bmp, and x-tiff aliases", () => {
    expect(mimeMatchesContent("application/x-zip-compressed", bytes(0x50, 0x4B, 0x03, 0x04))).toBe(true);
    expect(mimeMatchesContent("image/x-ms-bmp", bytes(0x42, 0x4D, 0x00, 0x00))).toBe(true);
    expect(mimeMatchesContent("image/x-tiff", bytes(0x49, 0x49, 0x2A, 0x00))).toBe(true);
  });

  test("matching is case-insensitive on the claimed type", () => {
    expect(mimeMatchesContent("IMAGE/PNG", bytes(0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A))).toBe(true);
  });

  test("7z bytes claiming application/zip are rejected", () => {
    expect(mimeMatchesContent("application/zip", bytes(0x37, 0x7A, 0xBC, 0xAF, 0x27, 0x1C))).toBe(false);
  });
});

describe("sniffMime (FIX-063)", () => {
  test("returns the canonical mime for definite magic signatures", () => {
    expect(sniffMime(bytes(0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A))).toBe("image/png");
    expect(sniffMime(bytes(0x25, 0x50, 0x44, 0x46, 0x2D, 0x31))).toBe("application/pdf");
    expect(sniffMime(bytes(0x50, 0x4B, 0x03, 0x04))).toBe("application/zip");
  });

  test("never claims a type for plain text — JSON snapshots must fall to the extension map", () => {
    expect(sniffMime(new TextEncoder().encode("{\"sheets\":{}}"))).toBeNull();
    expect(sniffMime(new TextEncoder().encode("just words"))).toBeNull();
  });

  test("returns null for unrecognised binary noise", () => {
    expect(sniffMime(bytes(0x00, 0x01, 0x02, 0x03, 0x04))).toBeNull();
  });
});

describe("mimeFromFilename (FIX-063)", () => {
  test("maps common extensions, case-insensitively", () => {
    expect(mimeFromFilename("budget.sheet")).toBe("application/x-univer-sheet");
    expect(mimeFromFilename("report.PDF")).toBe("application/pdf");
    expect(mimeFromFilename("notes.md")).toBe("text/markdown");
    expect(mimeFromFilename("data.csv")).toBe("text/csv");
    expect(mimeFromFilename("payload.json")).toBe("application/json");
  });

  test("returns null for unknown or absent extensions", () => {
    expect(mimeFromFilename("archive.xyz")).toBeNull();
    expect(mimeFromFilename("noextension")).toBeNull();
    expect(mimeFromFilename(".env")).toBeNull();
    expect(mimeFromFilename("trailing.")).toBeNull();
  });
});
