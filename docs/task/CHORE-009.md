# CHORE-009 - Dependency refresh: 14 minor bumps and 5 majors

- Status: Completed (2026-08-30)
- Plan: -
- Created: 2026-08-29

## Goal

`bun outdated --filter '*'` reports 19 packages behind. Every one has its
`Update` column equal to `Current`, i.e. the manifests pin exact versions, so
each bump is a deliberate manifest edit rather than a lockfile refresh.

### Low risk — one batch

`zod` 4.4.3→4.5.4, `tar-stream` 3.2.0→3.2.1, `@tanstack/react-query`
5.101.4→5.102.8, `@tanstack/react-router` 1.170.31→1.170.32,
`@tanstack/router-plugin` 1.168.34→1.168.35, `lucide-react` 1.33.0→1.37.0,
`eslint` 10.8.1→10.9.1, `eslint-plugin-react-refresh` 0.5.4→0.5.5,
`@testing-library/react` 16.3.2→16.3.3, `@testing-library/user-event`
14.6.5→14.6.6, `@types/react-dom` 19.2.4→19.2.5, `@vitejs/plugin-react`
6.1.0→6.1.1, `shadcn` 4.18.0→4.19.0, `vitest` 4.1.8→4.1.11.

`zod` is minor but validates every API boundary, and `lucide-react` crosses
four minors — neither is a blind bump.

### Majors — one at a time, each independently revertible

- `nanoid` 5.1.16 → 6.0.1 (`@app/api`). **Blocked on an override**: root
  `package.json` carries `"@univerjs/core": { "nanoid": "5.1.16" }`. Resolve
  what that pin is for before bumping — raising the app while leaving the
  override pins two nanoid copies in the bundle.
- `jsdom` 29.1.1 → 30.0.1 (web test env).
- `@testing-library/jest-dom` 6.9.1 → 7.0.1.
- `pdfjs-dist` 5.4.296 → 6.3.289 — the drive preview stack, see ADR-001.
- `typescript` 6.0.3 → 7.0.2, catalog-wide (all three workspaces). The largest
  by far. Verify the lint toolchain supports it **before** attempting; if it
  does not, record the reason and leave TypeScript pinned rather than forcing
  it.

### Also

Re-check the eight security floor overrides (`esbuild`, `@babel/core`,
`dompurify`, `hono`, `js-yaml`, `protobufjs`, `undici`, `vite`) against current
latest and raise the floors that have moved.

## Scope

Version bumps and whatever code changes each bump requires. No opportunistic
refactors riding along.

## Verification

- Per bump: `bun run check` EXIT 0, recorded to a file and read back.
- `bun run seed` EXIT 0 after the `zod` and `nanoid` bumps specifically — both
  sit on paths the seed exercises.
- Any deferred bump is recorded with its reason in the changelog entry, not
  dropped silently.

## Outcome

17 of the 19 packages were bumped; 2 were deferred with a recorded reason.
Nothing was dropped silently. `bun outdated --filter '*'` on the finished
branch reports exactly the two deferrals and nothing else.

### Low risk — 14 of 14 bumped

| Package | From | To | Manifest |
| --- | --- | --- | --- |
| `zod` | 4.4.3 | 4.5.4 | `apps/api` dependencies |
| `tar-stream` | 3.2.0 | 3.2.1 | `apps/api` dependencies |
| `@tanstack/react-query` | 5.101.4 | 5.102.8 | `apps/web` dependencies |
| `@tanstack/react-router` | 1.170.31 | 1.170.32 | `apps/web` dependencies |
| `lucide-react` | 1.33.0 | 1.37.0 | `apps/web` dependencies |
| `@tanstack/router-plugin` | 1.168.34 | 1.168.35 | `apps/web` devDependencies |
| `@testing-library/react` | 16.3.2 | 16.3.3 | `apps/web` devDependencies |
| `@testing-library/user-event` | 14.6.5 | 14.6.6 | `apps/web` devDependencies |
| `@types/react-dom` | 19.2.4 | 19.2.5 | `apps/web` devDependencies |
| `@vitejs/plugin-react` | 6.1.0 | 6.1.1 | `apps/web` devDependencies |
| `shadcn` | 4.18.0 | 4.19.0 | `apps/web` devDependencies |
| `eslint` | 10.8.1 | 10.9.1 | root devDependencies |
| `eslint-plugin-react-refresh` | 0.5.4 | 0.5.5 | root devDependencies |
| `vitest` | 4.1.8 | 4.1.11 | root catalog |

Every target was verified against `registry.npmjs.org` before pinning; no
registry version deviated from the planned target. Three carry more than a
version pair:

- **`zod` 4.5.4 tightens a request-side API contract.** `z.iso.datetime` now
  requires the seconds field, which 4.4.3 treated as optional; the new
  behaviour is the RFC 3339-correct one. Two request inputs are affected —
  `installedAt` in `ship.routes.ts` and `expiresAt` in `share.routes.ts`. The
  SPA feeds both through `toISOString()`, which always emits seconds, so there
  is no in-app breakage, but an external client (for example a
  PAT-authenticated one) sending a second-less timestamp is now rejected. The
  bump also required regenerating `skills/bithk/references/api-spec.json`; the
  large line count is almost entirely a representation change, with nullable
  unions now emitted as the JSON Schema type-array form `["string","null"]`
  instead of `anyOf` — equivalent under the OpenAPI 3.1.0 the document
  declares.
- **`tar-stream` 3.2.1 is a types-only release that forced 8 source files.**
  Every runtime `.js` file is byte-identical to 3.2.0; the release only adds a
  bundled `index.d.ts` plus an exports map. Those bundled types shadow the
  `@types/tar-stream` 3.1.4 devDependency and are built on `streamx` rather
  than node streams, which forced changes across `apps/api/src/modules/backup`:
  `Headers` renamed to `Header`; `Pack.entry` taking `Partial<Header>` needed
  `?? ""` for `linkname` (behaviour-preserving — `headers.js` gates on
  `if (opts.linkname)`, so `""` and `undefined` both mean no linkname);
  `end()` became `end(undefined)` because streamx declares no zero-arg overload
  (an identical no-op); and two `"data"` handlers plus the `Pack`
  async-iterable needed explicit `Buffer`/`Uint8Array` casts because streamx
  types payloads as `unknown`. The bump was kept rather than reverted:
  tar-stream 3.x genuinely runs on streamx, so the bundled types describe
  reality while `@types/tar-stream` described an idealised node-stream API, and
  the added casts make an already-implicit assumption explicit rather than
  losing precision. Staying on 3.2.0 would pin the repo to a version with no
  maintained types.
- **`lucide-react` 1.37.0** crossed four minors with no icon renamed or
  removed, so no code change was needed.

### Majors — 3 bumped, 2 deferred

- **`nanoid` 5.1.16 -> 6.0.1 (`@app/api`) — bumped.** The root nested override
  `"@univerjs/core": { "nanoid": "5.1.16" }` was deliberately kept: it exists
  because `@univerjs/core` exact-pins nanoid 5.1.11, which carries an OSV
  advisory, and the override force-raises Univer's private copy to a patched
  5.x. It cannot become a global `nanoid ^5` override because `postcss`
  requires nanoid 3, and Univer is pinned to the 5.x line and cannot take 6.
  The bump removed a lockfile entry rather than adding one — 4 entries across 3
  distinct versions before, 3 entries across 3 distinct versions after.
  `@app/api`, `@milkdown/components` and `@milkdown/utils` now fold onto the
  hoisted `nanoid@6.0.1`; `@univerjs/core` keeps 5.1.16 and `postcss` keeps
  3.3.18. No code change: the only nanoid API used anywhere in the repo is
  `customAlphabet`, whose signature and exports map are identical between
  5.1.16 and 6.0.1.
- **`jsdom` 29.1.1 -> 30.0.1 (`apps/web` devDependencies) — bumped.** No code
  change forced. The `apps/web/src/test/setup.ts` polyfills are all
  feature-guarded, so nothing became stale or newly required, and
  `vitest.config.ts` was untouched; the diff was the manifest and lockfile
  only.
- **`@testing-library/jest-dom` 6.9.1 -> 7.0.1 (`apps/web` devDependencies) —
  bumped.** v7 is a packaging major, not a matcher major: its only two breaking
  changes are that `@testing-library/dom` becomes a required peer and that the
  minimum Node is 22. No matcher was renamed, removed or changed semantics, the
  entry point is unchanged, and `setup.ts` already imported
  `@testing-library/jest-dom/vitest`, so no setup or assertion edit was needed
  and no assertion was weakened.
- **`pdfjs-dist` 5.4.296 -> 6.3.289 — DEFERRED.** Blocked by
  [ADR-001](../decisions/001-drive-preview-stack.md), which forbids bumping
  `pdfjs-dist` independently of `react-pdf`, and no react-pdf release bundles
  pdfjs 6. All 156 published react-pdf versions were swept and zero declare
  `pdfjs-dist` 6.x; the dist-tags contain only `latest: 10.5.0`, with no
  `next`/`beta`/`canary`; and `react-pdf@10.5.0` declares
  `dependencies["pdfjs-dist"]` as the exact string `5.4.296`, not a range, so
  it cannot float. The current pin is correct and current, not drifted.
  **Unblock condition:** a stable react-pdf release declaring
  `pdfjs-dist ^6.x`, at which point both move together and the Vite `?url`
  worker import in
  `apps/web/src/shared/components/file/file-preview-dialog.tsx` must be
  re-verified against the pdfjs 6 build layout. Recheck at the ADR-001 review
  date 2026-11-22, or sooner if react-pdf publishes a major.
- **`typescript` 6.0.3 -> 7.0.2, catalog-wide — DEFERRED.** No stable lint
  stack admits TypeScript 7. The repo resolves
  `@typescript-eslint/typescript-estree` 8.68.0, whose declared
  `peerDependencies.typescript` is `>=4.8.4 <6.1.0`. A sweep of that field
  across every published typescript-eslint version yields the complete distinct
  set `{>=4.8.4 <5.8.0, >=4.8.4 <5.9.0, >=4.8.4 <6.0.0, >=4.8.4 <6.1.0}` — no
  release of any kind, stable or prerelease, admits 7.x. The cap is binding
  rather than avoidable because `eslint.config.ts` sets `typescript: true`,
  routing lint through `@typescript-eslint/parser` into `typescript-estree`,
  which loads the typescript package directly, and `@antfu/eslint-config` 9.3.0
  (the latest release) depends on `@typescript-eslint/*` `^8.66.0`, resolving
  into that same 8.68.0 line. The bump was **not** forced: no `--force`, no
  peer-dependency override, and no disabling of type-aware linting, so the type
  gate is unweakened. **Unblock condition:** a stable typescript-eslint release
  whose `peerDependencies.typescript` extends past `<6.1.0` (expected to be the
  9.x line tracking the TS 7 native-compiler API), together with an
  `@antfu/eslint-config` release depending on that line so it is reachable from
  this repo's lint entry point. Re-evaluate on the next dependency-refresh pass
  rather than on a date.

### Security floor overrides — 6 raised, 2 unchanged

| Override | From | To | Note |
| --- | --- | --- | --- |
| `esbuild` | `^0.25.0` | `^0.25.12` | latest in 0.25.x; 0.28.2 not taken |
| `@babel/core` | `^7.29.6` | `^7.29.7` | latest in 7.x; 8.0.1 not taken |
| `dompurify` | `^3.4.13` | `^3.4.14` | also the absolute latest |
| `hono` | `^4.13.3` | `^4.13.5` | 4.13.5 is the absolute latest |
| `js-yaml` | `^4.3.1` | `^4.3.2` | latest in 4.x; 5.4.1 not taken |
| `protobufjs` | `^7.6.5` | `^7.6.6` | latest in 7.x; 8.8.0 not taken |
| `undici` | `^7.29.0` | unchanged | deferred — see below |
| `vite` | `^8.2.2` | unchanged | already the absolute latest |

No floor crossed a major boundary, and all eight query clean at OSV for the
version this branch pins. The six raises carry zero resolution risk because the
lockfile diff is declaration-only: `esbuild@0.25.12`, `@babel/core@7.29.7`,
`dompurify@3.4.14`, `hono@4.13.5`, `js-yaml@4.3.2`, `protobufjs@7.6.6`,
`undici@7.29.0` and `vite@8.2.2` were already what the old carets resolved to.
The floors had lagged behind reality; raising them pins the declarations so a
future install cannot regress below the advisory fix versions.

`hono` also required a consistency fix: `apps/api/package.json` `hono` was
raised 4.13.3 -> 4.13.5 to match the floor, correcting a pre-existing mismatch
in which the lockfile already resolved `hono@4.13.5` while the api manifest
still claimed 4.13.3.

**`undici` deferred.** Three consumers declare undici and no single tree-wide
floor satisfies all three: `jsdom@30.0.1` requires `^8.9.0`, while
`shadcn@4.19.0` requires `^7.27.2` and `@dotenvx/dotenvx@1.75.1` requires
`^7.11.0`. Raising the floor to 8.x would only invert the mismatch onto shadcn
and dotenvx. `undici` 7.29.0 is additionally the fix version for
GHSA-v3r7-h72x-cjcm (fixed in 6.28.0 / 7.29.0 / 8.9.0) — the advisory this
override exists for — and is OSV-clean, so nothing forces the crossing. The
consequence to record is that jsdom 30 currently resolves below its own
declared range. That is latent, not breaking: all four undici symbols jsdom 30
imports (`getGlobalDispatcher`, `WebSocket`, `DecoratorHandler`, `Dispatcher`)
exist in 7.29.0 and jsdom instantiates and parses fine, but it will surface on
a jsdom patch that touches the undici 8 API.

### Verification

Every subtask passed a full unrestricted `bun run check` at EXIT 0, recorded to
a file and read back rather than taken from console output. `bun run seed`
additionally passed EXIT 0 after the `zod` batch and after the `nanoid`
decision, since both sit on paths the seed exercises and seed is not part of
`check`. The pre-change baseline `bun run check` was also EXIT 0, so every
result is attributable. `osv-scanner` (`ghcr.io/google/osv-scanner:latest`)
against `bun.lock` reports "No issues found" over 1332 packages scanned, so the
PLAN-109 baseline of 0 findings holds and did not increase.

### Recommended follow-up work (out of scope here)

1. **A `jsdom` -> `undici` nested override (highest priority).** Adding
   `"jsdom": { "undici": "^8.10.0" }` to root `overrides` would give jsdom its
   declared 8.x while leaving shadcn and dotenvx on the 7.29.0 floor — the same
   mechanism already used for `@univerjs/core` -> `nanoid`. It was deliberately
   not done here because, unlike the six floor raises, it would actually change
   the installed set by adding a second undici copy, so it needs its own
   verification pass. This campaign's jsdom 30 bump is what introduced the
   mismatch.
2. **`@types/tar-stream` 3.1.4 is now inert.** tar-stream 3.2.1's bundled types
   always win, so this devDependency no longer supplies anything. It was left
   in place deliberately rather than removed as a drive-by.
3. **Node engine floor drift.** jsdom 30 requires Node
   `^22.22.2 || ^24.15.0 || >=26.0.0`, but root `engines.node` says `24.14.x`
   and `.github/workflows/ci.yml` pins `NODE_VERSION` 22.13.0 — both below the
   floor, and already inconsistent with each other beforehand. Not a runtime
   hazard today, since the web suite runs under Bun and nothing sets
   engine-strict, but the manifests understate the requirement.
4. **The `esbuild` floor holds two consumers below their declared ranges.**
   `vite@8.2.2` declares `^0.27.0 || ^0.28.0` and `tsx@4.23.12` declares
   `~0.28.0`, but both resolve at 0.25.12 because `drizzle-kit@0.31.10`
   declares `^0.25.4`. Same class as the undici/jsdom case, but pre-existing
   rather than introduced by this campaign, and it resolves itself once
   drizzle-kit ships an esbuild 0.28 range.
