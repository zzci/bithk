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

## Outcome

Three of the four items were applied and one was deferred with a recorded
reason. Nothing was dropped silently. Every item passed a full unrestricted
`bun run check` at EXIT 0, and `osv-scanner` on `bun.lock` reported "No issues
found" at each step, holding the zero-findings baseline.

### Item 1 — `jsdom` -> `undici` nested override: done

Added `"jsdom": { "undici": "^8.10.0" }` to the root `overrides`, keeping the
root `"undici": "^7.29.0"` entry. All three undici consumers now resolve inside
their own declared ranges: `jsdom@30.0.1` (`^8.9.0`) -> 8.10.0, `shadcn@4.19.0`
(`^7.27.2`) -> 7.29.0, `@dotenvx/dotenvx@1.75.1` (`^7.11.0`) -> 7.29.0. Resolved
`undici` entries in `bun.lock` went 1 -> 3 and the scanned package count
1332 -> 1334.

Bun encoded the override as the mirror image of what was expected: it hoisted
8.10.0 to the bare `"undici"` key and demoted the two 7.x consumers to scoped
keys (`shadcn/undici`, `@dotenvx/dotenvx/undici`). The root `"undici":
"^7.29.0"` override therefore no longer governs the hoisted slot, so a future
undici consumer added without its own constraint would land on 8.10.0 rather
than 7.29.0. Not a regression — 8.10.0 is above the fix version for
GHSA-v3r7-h72x-cjcm (fixed in 6.28.0 / 7.29.0 / 8.9.0), the advisory the
override exists for — but a real semantic change, recorded rather than left to
be rediscovered.

### Item 2 — `@types/tar-stream` 3.1.4 removed: done

`tar-stream` 3.2.1 ships its own `index.d.ts`, confirmed at the registry via
both the top-level `types` field and the `"."` exports condition. A
`tsc --traceResolution` run taken before the deletion proved the bundled
declaration was already winning: resolution landed on Package ID
`tar-stream/index.d.ts@3.2.1`, pulling `streamx@2.28.1` — what CHORE-009's
streamx-based type fixes were written against — and `@types/tar-stream`
appeared zero times in the entire trace, never even probed, because
`apps/api/tsconfig.json` sets `"types": ["bun"]` and so auto-includes no
`@types` package. Zero source change was needed under
`apps/api/src/modules/backup`. Scanned package count 1334 -> 1333.

### Item 3 — Node engine alignment: done

The four declarations disagreed with each other and none satisfied
`jsdom@30.0.1`'s `^22.22.2 || ^24.15.0 || >=26.0.0`:

| Declaration | Before | After |
| --- | --- | --- |
| `package.json` `engines.node` | `24.14.x` | `^24.15.0` |
| `.github/workflows/ci.yml` `NODE_VERSION` | `22.13.0` | `24.20.0` |
| `.github/workflows/release.yml` `NODE_VERSION` | `24.14.x` | `24.20.0` |
| `AGENTS.md` prose | `Node 24.14` | `Node 24.20` |

The Node 24 line won: three of the four declarations were already there — only
CI sat on 22 — and 24 is the current Active LTS ("Krypton") while 22 ("Jod") is
older. `^24.15.0` mirrors jsdom's own 24-line clause exactly, so the declared
floor and the requirement are the same statement; the caret rather than `>=`
keeps the declaration inside the 24 LTS line instead of silently admitting
odd-numbered non-LTS releases. CI and release keep an exact pin at 24.20.0 —
the newest 24.x at the registry, verified during this task — because ci.yml's
own comment requires a node minor upgrade to be a deliberate PR; an exact pin
sitting inside a caret floor cannot contradict that floor, which is what
removes the lie. Declaration fix only: the suites run under Bun and nothing
sets engine-strict. `CLAUDE.md` is a symlink to `AGENTS.md`, so the prose was
edited once.

### Item 4 — `esbuild` floor: deferred, checked and left alone

Re-verified at the registry: `drizzle-kit` `latest` is 0.31.10 and still
declares `esbuild` `^0.25.4` — it has not widened. `vite@8.2.2`
(`^0.27.0 || ^0.28.0`) and `tsx@4.23.12` (`~0.28.0`) therefore still resolve at
the overridden 0.25.12. The constraint is pre-existing rather than introduced
here. It was deliberately not forced: the floor was left where it is and no
papering-over override was added. Unblock condition: a `drizzle-kit` release
declaring an esbuild 0.27 or 0.28 range, at which point the floor moves as its
own separately verified change.
