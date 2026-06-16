import { afterEach, describe, expect, test } from "bun:test";
import { fileInlineContentUrl, setFileUrlBasePath } from "./file.service";

describe("fileInlineContentUrl", () => {
  afterEach(() => {
    // Restore the module default ("" = root) so other suites that build cover /
    // avatar URLs (and assume no base path) are unaffected by this singleton.
    setFileUrlBasePath("");
  });

  test("is root-relative when no base path is configured (dev / root deploy)", () => {
    setFileUrlBasePath("");
    expect(fileInlineContentUrl("file1", "ref1")).toBe("/api/files/file1/content?ref=ref1&inline=true");
  });

  test("carries the configured base path so it resolves under a base-path deploy (FIX-043)", () => {
    setFileUrlBasePath("/app");
    expect(fileInlineContentUrl("file1", "ref1")).toBe("/app/api/files/file1/content?ref=ref1&inline=true");
  });
});
