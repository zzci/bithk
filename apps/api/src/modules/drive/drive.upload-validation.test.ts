import type { Config } from "@/config";
import { describe, expect, test } from "bun:test";
import { validateDriveUpload } from "./drive.upload-validation";

const config: Pick<Config, "MAX_UPLOAD_BYTES"> = { MAX_UPLOAD_BYTES: 1024 };

/** Build a File whose bytes are the given magic-byte prefix padded with zeros. */
function fileWith(name: string, type: string, bytes: number[], extra = 0): File {
  const buf = new Uint8Array(bytes.length + extra);
  buf.set(bytes, 0);
  return new File([buf], name, { type });
}

const PNG = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
const JPEG = [0xFF, 0xD8, 0xFF];
const PDF = [0x25, 0x50, 0x44, 0x46]; // %PDF
const ZIP = [0x50, 0x4B, 0x03, 0x04];

async function reject(file: File, code: string): Promise<void> {
  await expect(validateDriveUpload(file, config)).rejects.toMatchObject({ code });
}

describe("validateDriveUpload size cap", () => {
  test("rejects empty files", async () => {
    await reject(new File([], "empty.txt", { type: "text/plain" }), "VALIDATION_ERROR");
  });

  test("rejects files over the per-file ceiling", async () => {
    const big = new Uint8Array(config.MAX_UPLOAD_BYTES + 1);
    await reject(new File([big], "big.bin", { type: "text/plain" }), "FILE_TOO_LARGE");
  });

  test("accepts a file exactly at the ceiling", async () => {
    const body = "a".repeat(config.MAX_UPLOAD_BYTES);
    await expect(validateDriveUpload(new File([body], "edge.txt", { type: "text/plain" }), config)).resolves.toBeUndefined();
  });
});

describe("validateDriveUpload extension allow-list", () => {
  test("rejects a disallowed extension", async () => {
    await reject(fileWith("evil.exe", "application/pdf", PDF), "VALIDATION_ERROR");
  });

  test("accepts an allowed extension", async () => {
    await expect(validateDriveUpload(fileWith("doc.pdf", "application/pdf", PDF), config)).resolves.toBeUndefined();
  });

  test("a name with no extension skips the extension check", async () => {
    await expect(validateDriveUpload(new File(["plain text"], "README", { type: "text/plain" }), config)).resolves.toBeUndefined();
  });
});

describe("validateDriveUpload MIME allow-list", () => {
  test("rejects a disallowed MIME type", async () => {
    await reject(new File(["x"], "a.txt", { type: "application/x-msdownload" }), "VALIDATION_ERROR");
  });
});

describe("validateDriveUpload magic-byte sniff", () => {
  test("accepts genuine png bytes declared image/png", async () => {
    await expect(validateDriveUpload(fileWith("a.png", "image/png", PNG, 16), config)).resolves.toBeUndefined();
  });

  test("accepts genuine jpeg bytes declared image/jpeg", async () => {
    await expect(validateDriveUpload(fileWith("a.jpg", "image/jpeg", JPEG, 16), config)).resolves.toBeUndefined();
  });

  test("accepts genuine pdf bytes declared application/pdf", async () => {
    await expect(validateDriveUpload(fileWith("a.pdf", "application/pdf", PDF, 16), config)).resolves.toBeUndefined();
  });

  test("accepts genuine zip bytes declared application/zip", async () => {
    await expect(validateDriveUpload(fileWith("a.zip", "application/zip", ZIP, 16), config)).resolves.toBeUndefined();
  });

  test("rejects png bytes spoofing image/jpeg", async () => {
    await reject(fileWith("spoof.jpg", "image/jpeg", PNG, 16), "VALIDATION_ERROR");
  });

  test("rejects jpeg bytes spoofing image/png", async () => {
    await reject(fileWith("spoof.png", "image/png", JPEG, 16), "VALIDATION_ERROR");
  });

  test("rejects pdf-claimed bytes that are not a pdf", async () => {
    await reject(fileWith("spoof.pdf", "application/pdf", PNG, 16), "VALIDATION_ERROR");
  });

  test("genuine text is accepted under text/plain", async () => {
    await expect(validateDriveUpload(new File(["just some plain text\n"], "notes.txt", { type: "text/plain" }), config)).resolves.toBeUndefined();
  });
});
