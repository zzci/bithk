import type { CliScript } from "./types";
import { rekeyLegacyBlobs } from "./rekey-legacy-blobs";

/**
 * The bundled script library (FEAT-051), surfaced by `app script:list` /
 * `app script:run <name>`. Scripts version with the release: add an entry
 * to ship one, remove it to retire it. Keep names kebab-case and unique.
 */
export const cliScripts: readonly CliScript[] = [
  rekeyLegacyBlobs,
];

export function findCliScript(name: string): CliScript | undefined {
  return cliScripts.find(s => s.name === name);
}
