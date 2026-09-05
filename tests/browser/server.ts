import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import process from "node:process";

async function main() {
  const root = resolve(import.meta.dir, "../..");
  if (!existsSync(resolve(root, "apps/web/dist/index.html")))
    throw new Error("Build the web app before running browser acceptance tests.");

  const base = new URL(process.env.BROWSER_BASE_URL ?? "http://127.0.0.1:3419");
  const data = mkdtempSync(resolve(tmpdir(), "bithk-browser-"));
  try {
    const child = Bun.spawn(["bun", "--env-file=/dev/null", "src/index.ts"], {
      cwd: resolve(root, "apps/api"),
      env: {
        PATH: process.env.PATH,
        NODE_ENV: "production",
        ROOT_DIR: root,
        HOST: process.env.BROWSER_HOST ?? base.hostname,
        PORT: base.port,
        BASE_PATH: "",
        APP_URL: base.origin,
        CORS_ORIGIN: base.origin,
        DATA_DIR: data,
        DB_PATH: resolve(data, "app.db"),
        SINGLE_USER_MODE: "true",
        SINGLE_USER_USERNAME: "acceptance",
        SINGLE_USER_NAME: "Acceptance User",
        SINGLE_USER_EMAIL: "acceptance@example.test",
        SINGLE_USER_PASSWORD_HASH: await Bun.password.hash("acceptance-local-fixture"),
        LOG_LEVEL: "warn",
        LOG_TO_STDOUT: "true",
        HTTP_LOG_LEVEL: "silent",
      },
      stdio: ["ignore", "inherit", "inherit"],
    });
    for (const signal of ["SIGINT", "SIGTERM"] as const)
      process.on(signal, () => child.kill("SIGTERM"));
    process.exitCode = await child.exited;
  }
  finally {
    rmSync(data, { recursive: true, force: true });
  }
}

void main();
