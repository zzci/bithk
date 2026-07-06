import type { CliCommand } from "./types";
import { consola } from "consola";
import { withRuntime } from "./runtime";

/**
 * Offline `backup:import` — reuses prepareImport + startImportApply against a
 * minimal runtime (merge is the only mode; FIX-062 removed replace). With
 * `--wipe` the archive must contain an active admin, otherwise the apply
 * refuses with a lock-out error.
 */
export const backupImportCommand: CliCommand = {
  command: "backup:import <archive>",
  description: "Import a backup archive (merge). --wipe deletes ALL existing rows first (same transaction; the archive must contain an active admin), --actor-id <id>.",
  options: [
    { flag: "--wipe", description: "Delete ALL existing rows before importing (same transaction; the archive must contain an active admin)" },
    { flag: "--actor-id <id>", description: "Synthetic actor id recorded in the audit log" },
  ],
  async run(args, opts) {
    // FIX-062: replace mode removed — point old invocations at --wipe.
    if (opts.mode === "replace") {
      consola.error("--mode replace has been removed: use --wipe (wipe-before-merge) for a conflict-free full restore");
      return 2;
    }
    if (opts.mode !== undefined)
      consola.warn("--mode is deprecated and ignored: merge is the only import mode");
    if (opts.includeUsers !== undefined)
      consola.warn("--include-users is deprecated and ignored: merge always inserts what it can");

    const archive = args[0]!;
    return withRuntime(async ({ db, config, logger }) => {
      const { prepareImport } = await import("../modules/backup/import.service");
      const job = await prepareImport(db, config, Bun.file(archive));
      const { startImportApply } = await import("../modules/backup/import-apply");
      const actor = { id: typeof opts.actorId === "string" ? opts.actorId : "cli", name: "cli-import", ip: "127.0.0.1", userAgent: "cli" };
      await startImportApply(db, job, { wipeExisting: opts.wipe === true, actor }, logger);
      await job.done;
      if (job.state === "completed") {
        const t = job.result!.totals;
        const wiped = job.result!.wipe ? ` wiped=${job.result!.wipe.total}` : "";
        consola.success(
          `import complete:${wiped} inserted=${t.inserted} skippedDuplicate=${t.skippedDuplicate} failed=${t.failed} transformed=${t.transformed}`,
        );
        return 0;
      }
      consola.error(job.error ?? "import failed");
      return 1;
    });
  },
};
