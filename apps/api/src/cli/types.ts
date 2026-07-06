/**
 * One CLI command (FEAT-051). The whole CLI is a registry of these — every
 * subcommand (long-lived operator tooling AND one-shot operational scripts)
 * lives in its own file under `src/cli/` and is wired into `registry.ts`.
 * Commands version with the release: add a file + registry entry to ship
 * one, drop the entry to retire it.
 *
 * One-shot scripts use the `script:` name prefix (e.g.
 * `script:rekey-legacy-blobs`), must be idempotent/resumable, and should
 * offer `--dry-run`. Exit codes: 0 = success, 1 = failed / completed with
 * failures, 2 = bad usage.
 */
export interface CliCommand {
  /** cac command signature, e.g. `backup:export <out>` or `healthcheck`. */
  readonly command: string;
  /** Help text shown by `--help`. */
  readonly description: string;
  /** Optional flags, passed to cac verbatim. */
  readonly options?: readonly { readonly flag: string; readonly description: string }[];
  /**
   * Execute with the command's positional args (in signature order) and the
   * cac-parsed options object. Returns the process exit code.
   */
  readonly run: (args: readonly string[], opts: Record<string, unknown>) => Promise<number>;
}
