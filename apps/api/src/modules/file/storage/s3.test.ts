import type { S3DriverParams } from "./s3";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { getDriver, registerDriver } from "./registry";
import { __resetS3DriverForTests, configureS3Driver, isS3Configured, s3Driver, s3ObjectKey } from "./s3";

// Importing the driver self-registers it; presign is pure SigV4 (no network),
// so we can exercise configure + presignDownload offline with dummy credentials.
// The byte-moving methods (put/getStream/delete/exists) hit S3 and are not
// covered here. FEAT-047: the client is built from explicit params
// (`configureS3Driver`), not env config, since storage config now lives in the DB.

function s3Params(overrides: Partial<Record<keyof S3DriverParams, string | undefined>> = {}): S3DriverParams {
  return {
    bucket: "test-bucket",
    region: "auto",
    endpoint: "https://acc.r2.cloudflarestorage.com",
    accessKeyId: "AKIAEXAMPLE",
    secretAccessKey: "secretEXAMPLE",
    prefix: "",
    ...overrides,
  } as S3DriverParams;
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

describe("configureS3Driver", () => {
  test("throws listing every missing required value", () => {
    expect(() => configureS3Driver({ region: "auto", prefix: "" } as unknown as S3DriverParams))
      .toThrow(/bucket.*accessKeyId.*secret/);
  });

  test("throws when only the secret is missing", () => {
    expect(() => configureS3Driver(s3Params({ secretAccessKey: undefined })))
      .toThrow(/secret/);
  });

  test("accepts a complete config and marks S3 configured", () => {
    expect(() => configureS3Driver(s3Params())).not.toThrow();
    expect(isS3Configured()).toBe(true);
  });
});

describe("s3ObjectKey prefixing", () => {
  test("no prefix returns the key unchanged", () => {
    configureS3Driver(s3Params({ prefix: "" }));
    expect(s3ObjectKey("ab/cd/hash")).toBe("ab/cd/hash");
  });

  test("trims surrounding slashes from the prefix", () => {
    configureS3Driver(s3Params({ prefix: "/uploads/" }));
    expect(s3ObjectKey("ab/cd/hash")).toBe("uploads/ab/cd/hash");
  });
});

describe("s3 presignDownload", () => {
  test("returns a signed GET URL carrying the prefixed key", async () => {
    configureS3Driver(s3Params({ prefix: "blobs" }));
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
