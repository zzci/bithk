import { afterEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { buildOuterApp } from "./app";
import { __resetS3DriverForTests, configureS3Driver } from "./modules/file/storage/s3";
import { testConfig } from "./shared/test/route-harness";

// FIX-065: presigned direct-upload PUTs and presigned-GET previews point the
// browser at the S3 endpoint, so its origin must be a valid CSP source or the
// browser blocks the request. The outer shell resolves the origin per request
// from the live driver state.

async function cspOf(app: ReturnType<typeof buildOuterApp>): Promise<string> {
  const res = await app.request("/api/health");
  return res.headers.get("content-security-policy") ?? "";
}

afterEach(() => {
  __resetS3DriverForTests();
});

describe("outer-shell CSP S3 source", () => {
  test("omits any S3 origin while storage is unconfigured (degrades to 'self')", async () => {
    const app = buildOuterApp(new Hono(), testConfig());
    const csp = await cspOf(app);
    expect(csp).toContain("connect-src 'self' blob:");
    expect(csp).not.toContain("r2.cloudflarestorage.com");
  });

  test("adds the configured S3 origin to connect/img/media/frame sources", async () => {
    configureS3Driver({
      bucket: "b",
      region: "auto",
      endpoint: "https://acc.r2.cloudflarestorage.com",
      accessKeyId: "AKIAEXAMPLE",
      secretAccessKey: "secretEXAMPLE",
      prefix: "",
    });
    const app = buildOuterApp(new Hono(), testConfig());
    const csp = await cspOf(app);
    const origin = "https://acc.r2.cloudflarestorage.com";
    expect(csp).toContain(`connect-src 'self' blob: ${origin}`);
    expect(csp).toContain(`img-src 'self' data: blob: ${origin}`);
    expect(csp).toContain(`media-src 'self' blob: ${origin}`);
    expect(csp).toContain(origin); // also present in frame-src
  });
});
