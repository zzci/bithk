import type { Config } from "@/config";
import type { AppDatabase } from "@/db";
import type { Logger } from "@/shared/lib/logger";

/**
 * Bundled operational script (FEAT-051). The CLI script library ships inside
 * the release binary, so scripts version with the app: add a file +
 * registry entry to introduce one, edit it to change behaviour, drop the
 * entry to retire it. Run via `app script:run <name>` against the same
 * offline runtime the backup CLI uses.
 *
 * Contract: scripts must be idempotent and resumable (safe to re-run after a
 * partial failure), honour `dryRun`, and report progress through `logger` /
 * their exit code (0 = success, 1 = completed with failures, 2 = bad usage).
 */
export interface CliScriptContext {
  readonly db: AppDatabase;
  readonly config: Config;
  readonly logger: Logger;
  /** Report what would change without writing anything. */
  readonly dryRun: boolean;
}

export interface CliScript {
  /** Kebab-case identifier used by `script:run <name>`. */
  readonly name: string;
  /** One-line summary shown by `script:list`. */
  readonly description: string;
  readonly run: (ctx: CliScriptContext) => Promise<number>;
}
