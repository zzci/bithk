import type { Config } from "@/config";
import type { AppDatabase } from "@/db";
import type { Logger } from "@/shared/lib/logger";
import { consola } from "consola";

/** Offline runtime handed to runtime-backed commands: open DB + storage drivers, no server. */
export interface CliRuntimeContext {
  readonly db: AppDatabase;
  readonly config: Config;
  readonly logger: Logger;
}

/**
 * Run `fn` against the same offline runtime the backup CLI established
 * (FEAT-033): load config, wire the DB + storage drivers via `wireRuntime`,
 * and always close afterwards. Errors are printed and map to exit code 1.
 * All imports stay dynamic so the normal boot path is unaffected.
 */
export async function withRuntime(fn: (ctx: CliRuntimeContext) => Promise<number>): Promise<number> {
  const { loadConfig } = await import("../config");
  const { createLogger } = await import("../shared/lib/logger");
  const config = await loadConfig();
  // Sync destination: a CLI subcommand process.exit()s right after finishing,
  // and pino's on-exit auto-flush would otherwise throw "sonic boom is not
  // ready yet" against a not-yet-open async fd.
  const logger = createLogger(config, { sync: true });

  const { wireRuntime } = await import("../app");
  const { db, close } = await wireRuntime(config, logger);
  try {
    return await fn({ db, config, logger });
  }
  catch (err) {
    consola.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
  finally {
    await close();
  }
}
