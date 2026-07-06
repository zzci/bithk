import cac from "cac";
import { consola } from "consola";
import { BUILD_INFO } from "../build-info";
import { cliCommands } from "./registry";

/**
 * Lightweight CLI dispatcher built on `cac`. Every subcommand lives in its
 * own file under `src/cli/` and is wired via `registry.ts` (FEAT-051) — this
 * file only translates the registry into cac and runs the match. Handles
 * non-bootstrap subcommands (healthcheck, migrate --check, backup:*,
 * script:*) so a container can run the same binary for both `app` (boot the
 * server) and e.g. `app healthcheck`.
 *
 * Returns the requested exit code, or `null` when no subcommand matched and
 * the caller should fall through to the normal boot path.
 */
export async function dispatchCliSubcommand(argv: readonly string[]): Promise<number | null> {
  const cli = cac("app");

  let exitCode: number | null = null;

  for (const command of cliCommands) {
    const registered = cli.command(command.command, command.description);
    for (const opt of command.options ?? [])
      registered.option(opt.flag, opt.description);
    registered.action(async (...params: unknown[]) => {
      // cac passes positionals in signature order with the parsed options
      // object last.
      const opts = params.pop() as Record<string, unknown>;
      exitCode = await command.run(params as string[], opts);
    });
  }

  cli.help();
  cli.version(`${BUILD_INFO.version} (${BUILD_INFO.commit}) built ${BUILD_INFO.buildTime}`);

  // Parse without auto-running so we can await async actions and decide
  // whether to fall through to the normal boot path.
  let parsed;
  try {
    parsed = cli.parse([...argv], { run: false });
  }
  catch (err) {
    consola.error(err instanceof Error ? err.message : String(err));
    return 2;
  }

  // cac prints help/version itself and unsets matchedCommand for us.
  if (parsed.options.help || parsed.options.version) {
    return 0;
  }

  if (!cli.matchedCommand) {
    return null;
  }

  try {
    await cli.runMatchedCommand();
  }
  catch (err) {
    consola.error(err instanceof Error ? err.message : String(err));
    return 2;
  }
  return exitCode;
}
