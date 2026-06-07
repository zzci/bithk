import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { loadConfigStrict } from "./config";
import { ROOT_DIR } from "./root";

const KEYS = [
  "NODE_ENV",
  "DATA_DIR",
  "DB_PATH",
  "FILE_STORAGE_LOCAL_ROOT",
  "LOG_FILE",
  "LODE_DATA_DIR",
] as const;

const saved = new Map<string, string | undefined>();

beforeEach(() => {
  saved.clear();
  for (const key of KEYS) {
    saved.set(key, Bun.env[key]);
    delete Bun.env[key];
  }
  Bun.env.NODE_ENV = "development";
});

afterEach(() => {
  for (const key of KEYS) {
    const value = saved.get(key);
    if (value === undefined)
      delete Bun.env[key];
    else
      Bun.env[key] = value;
  }
});

describe("loadConfigStrict path defaults", () => {
  test("keeps mutable paths under DATA_DIR when configured", async () => {
    Bun.env.DATA_DIR = "/var/lib/bit";

    const config = await loadConfigStrict(() => {});

    expect(config.DATA_DIR).toBe("/var/lib/bit");
    expect(config.DB_PATH).toBe("/var/lib/bit/db/app.db");
    expect(config.FILE_STORAGE_LOCAL_ROOT).toBe("/var/lib/bit/uploads/files");
    expect(config.LOG_FILE).toBe("/var/lib/bit/logs/app.log");
  });

  test("keeps mutable defaults under LODE_DATA_DIR/data when lode manages the app", async () => {
    Bun.env.LODE_DATA_DIR = "/srv/lode";

    const config = await loadConfigStrict(() => {});

    expect(config.DATA_DIR).toBe("/srv/lode/data");
    expect(config.DB_PATH).toBe("/srv/lode/data/db/app.db");
    expect(config.FILE_STORAGE_LOCAL_ROOT).toBe("/srv/lode/data/uploads/files");
    expect(config.LOG_FILE).toBe("/srv/lode/data/logs/app.log");
  });

  test("DATA_DIR takes precedence over LODE_DATA_DIR", async () => {
    Bun.env.DATA_DIR = "/var/lib/bit";
    Bun.env.LODE_DATA_DIR = "/srv/lode";

    const config = await loadConfigStrict(() => {});

    expect(config.DATA_DIR).toBe("/var/lib/bit");
    expect(config.DB_PATH).toBe("/var/lib/bit/db/app.db");
  });

  test("resolves relative mutable overrides under DATA_DIR", async () => {
    Bun.env.DATA_DIR = "/var/lib/bit";
    Bun.env.DB_PATH = "custom/app.db";
    Bun.env.FILE_STORAGE_LOCAL_ROOT = "custom/uploads";
    Bun.env.LOG_FILE = "custom/app.log";

    const config = await loadConfigStrict(() => {});

    expect(config.DB_PATH).toBe("/var/lib/bit/custom/app.db");
    expect(config.FILE_STORAGE_LOCAL_ROOT).toBe("/var/lib/bit/custom/uploads");
    expect(config.LOG_FILE).toBe("/var/lib/bit/custom/app.log");
  });

  test("honours explicit absolute path overrides", async () => {
    Bun.env.DATA_DIR = "/var/lib/bit";
    Bun.env.DB_PATH = "/data/db/app.db";
    Bun.env.FILE_STORAGE_LOCAL_ROOT = "/data/uploads";
    Bun.env.LOG_FILE = "/logs/app.log";

    const config = await loadConfigStrict(() => {});

    expect(config.DB_PATH).toBe("/data/db/app.db");
    expect(config.FILE_STORAGE_LOCAL_ROOT).toBe("/data/uploads");
    expect(config.LOG_FILE).toBe("/logs/app.log");
  });

  test("falls back to ROOT_DIR without DATA_DIR or lode", async () => {
    const config = await loadConfigStrict(() => {});

    expect(config.DATA_DIR).toBeUndefined();
    expect(config.DB_PATH).toBe(resolve(ROOT_DIR, "data/db/app.db"));
    expect(config.FILE_STORAGE_LOCAL_ROOT).toBe(resolve(ROOT_DIR, "data/uploads/files"));
    expect(config.LOG_FILE).toBe(resolve(ROOT_DIR, "data/logs/app.log"));
  });
});
