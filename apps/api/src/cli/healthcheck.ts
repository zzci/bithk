import type { CliCommand } from "./types";
import process from "node:process";

/**
 * In-process probe against `/api/health` so a container can healthcheck the
 * same binary it booted — no curl/wget required in the image. Resolves to
 * whatever HOST/PORT/BASE_PATH the running server is using; the probe goes
 * through the public route so it also exercises the secureHeaders + CORS +
 * request-id stack.
 */
export const healthcheckCommand: CliCommand = {
  command: "healthcheck",
  description: "Run an in-process probe against /api/health",
  async run() {
    const port = Number(process.env.PORT ?? "3000");
    const basePath = (process.env.BASE_PATH ?? "").replace(/^\/+|\/+$/g, "");
    const path = basePath ? `/${basePath}/api/health` : "/api/health";
    const url = `http://127.0.0.1:${port}${path}`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
      return res.ok ? 0 : 1;
    }
    catch {
      return 1;
    }
  },
};
