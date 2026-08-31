# CHORE-010 - Dependency follow-ups left by CHORE-009

- Status: In Progress
- Plan: -
- Created: 2026-08-30

## Goal

CHORE-009 bumped 17 of 19 packages and recorded four items it deliberately did
not act on. The first is the one that matters: it is a mismatch **this
repository introduced**, not an inherited one.

1. **`jsdom` 30 needs an `undici` override.** jsdom 30.0.1 wants
   `undici ^8.9.0`; the root floor pins `undici ^7.29.0` because shadcn
   (`^7.27.2`) and dotenvx (`^7.11.0`) cannot take 8. The fix is a nested
   override — `"jsdom": { "undici": "^8.10.0" }`, the same mechanism already
   used for `"@univerjs/core": { "nanoid": "5.1.16" }`. CHORE-009 left it out
   on purpose: unlike the six floor raises, which were pure declaration
   changes with an unmoved resolution set, this one really does change what
   gets installed (a second undici copy) and needs its own verification.
2. **Remove `@types/tar-stream` 3.1.4.** `tar-stream` 3.2.1 ships its own
   types; the `@types` package is now inert.
3. **Align the Node engine with CI.** `engines.node` says `24.14.x`, CI
   `NODE_VERSION` is `22.13.0` — those already contradicted each other before
   this campaign. jsdom 30 additionally wants
   `^22.22.2 || ^24.15.0 || >=26.0.0`, so neither current value satisfies it.
   Not a runtime risk today (tests run under Bun), but the declaration should
   stop lying.
4. **`esbuild` floor is held down by drizzle-kit** (`^0.25.4`) while vite 8.2.2
   declares `^0.27.0 || ^0.28.0` and tsx declares `~0.28.0`. Pre-existing, not
   introduced here. Resolves itself when drizzle-kit widens; verify rather than
   force.

## Scope

Items 1-3. Item 4 is a watch item: check whether drizzle-kit has widened, and
if it has not, leave it and say so.

## Verification

- After item 1: `bun install` resolves, `bun run check` EXIT 0, and the
  installed tree is inspected to confirm jsdom resolves undici 8 while shadcn
  and dotenvx still resolve 7.
- After item 2: `bun run check` EXIT 0 with no type regression in the backup
  archive code that consumes `tar-stream`.
- After item 3: the declared engine range, the CI matrix and jsdom's
  requirement agree; state which value won and why.
- `osv-scanner` stays at zero findings.
