import type { Config } from "@/config";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { getDriver, registerDriver } from "./registry";
import { __resetS3DriverForTests, s3Driver, s3ObjectKey } from "./s3";

// Importing the driver self-registers it; presign is pure SigV4 (no network),
// so we can exercise setup + presignDownload offline with dummy credentials.
// The byte-moving methods (put/getStream/delete/exists) hit S3 and are not
// covered here.

function s3Config(overrides: Record<string, string | undefined> = {}): Config {
  return {
    FILE_S3_BUCKET: "test-bucket",
    FILE_S3_REGION: "auto",
    FILE_S3_ENDPOINT: "https://acc.r2.cloudflarestorage.com",
    FILE_S3_ACCESS_KEY_ID: "AKIAEXAMPLE",
    FILE_S3_SECRET_ACCESS_KEY: "secretEXAMPLE",
    FILE_S3_PREFIX: "",
    ...overrides,
  } as unknown as Config;
}

// Sibling suites (local.test) reset the shared driver registry, so re-register
// before each case to keep this file order-independent in the shared process.
beforeEach(() => {
  registerDriver(s3Driver);
});

afterEach(() => {
  __resetS3DriverForTests();
});

describe("s3 driver registration", () => {
  test("is resolvable under the name 's3'", () => {
    expect(getDriver("s3")).toBe(s3Driver);
    expect(s3Driver.name).toBe("s3");
  });
});

describe("s3 driver setup", () => {
  test("throws listing every missing required value", () => {
    expect(() => s3Driver.setup!({ FILE_S3_REGION: "auto", FILE_S3_PREFIX: "" } as unknown as Config))
      .toThrow(/FILE_S3_BUCKET.*FILE_S3_ACCESS_KEY_ID.*FILE_S3_SECRET_ACCESS_KEY/);
  });

  test("throws when only the secret is missing", () => {
    expect(() => s3Driver.setup!(s3Config({ FILE_S3_SECRET_ACCESS_KEY: undefined })))
      .toThrow(/FILE_S3_SECRET_ACCESS_KEY/);
  });

  test("accepts a complete config", () => {
    expect(() => s3Driver.setup!(s3Config())).not.toThrow();
  });
});

describe("s3ObjectKey prefixing", () => {
  test("no prefix returns the key unchanged", () => {
    s3Driver.setup!(s3Config({ FILE_S3_PREFIX: "" }));
    expect(s3ObjectKey("ab/cd/hash")).toBe("ab/cd/hash");
  });

  test("trims surrounding slashes from the prefix", () => {
    s3Driver.setup!(s3Config({ FILE_S3_PREFIX: "/uploads/" }));
    expect(s3ObjectKey("ab/cd/hash")).toBe("uploads/ab/cd/hash");
  });
});

describe("s3 presignDownload", () => {
  test("returns a signed GET URL carrying the prefixed key", async () => {
    s3Driver.setup!(s3Config({ FILE_S3_PREFIX: "blobs" }));
    const url = await s3Driver.presignDownload!("ab/cd/deadbeef", {
      expiresSeconds: 300,
      filename: "photo.png",
      inline: true,
      contentType: "image/png",
    });
    expect(url).toContain("https://acc.r2.cloudflarestorage.com");
    expect(url).toContain("test-bucket/blobs/ab/cd/deadbeef");
    expect(url).toContain("X-Amz-Signature=");
    expect(url).toContain("X-Amz-Expires=300");
  });
});
