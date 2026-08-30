# CHORE-009 - Dependency refresh: 14 minor bumps and 5 majors

- Status: In Progress
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
