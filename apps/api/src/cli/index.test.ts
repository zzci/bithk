import { describe, expect, test } from "bun:test";
import { dispatchCliSubcommand } from "./index";

// argv shape mirrors `bun index.js <args>` — cac slices the first two.
function argv(...args: string[]): string[] {
  return ["bun", "/app/index.js", ...args];
}

describe("dispatchCliSubcommand", () => {
  test("no positional → null (fall through to boot the server)", async () => {
    expect(await dispatchCliSubcommand(argv())).toBeNull();
  });

  test("--help / --version are handled (exit 0), never boot", async () => {
    expect(await dispatchCliSubcommand(argv("--help"))).toBe(0);
    expect(await dispatchCliSubcommand(argv("--version"))).toBe(0);
  });

  test("an unknown command exits 2 instead of falling through to boot (FIX-066)", async () => {
    // The bug: an unrecognised subcommand returned null → index.ts booted the
    // server → "Failed to start server. Is port 3000 in use?" against a live
    // instance. It must be a clean non-null error code instead.
    expect(await dispatchCliSubcommand(argv("script:does-not-exist"))).toBe(2);
    expect(await dispatchCliSubcommand(argv("totally-bogus"))).toBe(2);
  });

  test("a known runtime-free command dispatches (migrate --check, exit 0)", async () => {
    expect(await dispatchCliSubcommand(argv("migrate", "--check"))).toBe(0);
  });
});
