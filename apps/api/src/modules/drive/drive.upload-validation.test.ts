import type { Config } from "@/config";
import { describe, expect, test } from "bun:test";
import { AppError } from "@/shared/lib/errors";
import { validateDriveUpload } from "./drive.upload-validation";

const config: Pick<Config, "MAX_UPLOAD_BYTES"> = { MAX_UPLOAD_BYTES: 1024 };

function expectCode(file: File, code: string): void {
  try {
    validateDriveUpload(file, config);
    throw new Error("expected validateDriveUpload to throw");
  }
  catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(code);
  }
}

describe("validateDriveUpload size cap", () => {
  test("rejects empty files", () => {
    expectCode(new File([], "empty.txt", { type: "text/plain" }), "VALIDATION_ERROR");
  });

  test("rejects files over the per-file ceiling", () => {
    const big = new Uint8Array(config.MAX_UPLOAD_BYTES + 1);
    expectCode(new File([big], "big.bin", { type: "text/plain" }), "FILE_TOO_LARGE");
  });

  test("accepts a file exactly at the ceiling", () => {
    const body = "a".repeat(config.MAX_UPLOAD_BYTES);
    expect(() => validateDriveUpload(new File([body], "edge.txt", { type: "text/plain" }), config)).not.toThrow();
  });
});

describe("validateDriveUpload accepts any type", () => {
  test("accepts SVG (previously blocked)", () => {
    const svg = "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>";
    expect(() => validateDriveUpload(new File([svg], "icon.svg", { type: "image/svg+xml" }), config)).not.toThrow();
  });

  test("accepts an arbitrary binary type / extension", () => {
    expect(() => validateDriveUpload(new File(["MZ"], "tool.exe", { type: "application/x-msdownload" }), config)).not.toThrow();
  });

  test("accepts a name with no extension", () => {
    expect(() => validateDriveUpload(new File(["plain text"], "README", { type: "" }), config)).not.toThrow();
  });
});
