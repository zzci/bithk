# CHORE-005 - Dependabot catch-up: apply open bumps, unpin overrides, fix CI cache staleness

- Status: Completed (2026-08-27)
- Plan: [PLAN-109](../plan/PLAN-109.md)
- Created: 2026-08-27

## Goal

Land the seven open dependabot PRs (#36 runtime x26, #35 tooling x14,
#14/#23/#24/#25/#26 GitHub Actions bumps) as local commits on `main`, and
fix the two reasons `main` CI is red independent of those PRs:

- `security scans` (osv-scanner): 37 transitive vulnerabilities, several of
  which stay because root `package.json` `overrides` pin `hono` / `vite` below
  the versions dependabot bumps in the workspace `package.json`.
- `docker build` (trivy): the `apt-get upgrade` layer is restored from the
  GitHub Actions layer cache, so the image never picks up newer Debian
  security fixes.

## Scope

- `package.json` overrides raised to fixed versions; nested override for
  `@univerjs/core -> nanoid`; `apps/api` `nanoid` 5.1.16; transitive refresh
  via `bun update`; `@codemirror/language` dedupe.
- `.github/workflows/ci.yml`: action bumps from the dependabot branches;
  drop the GHA layer cache on the docker job.
- No source code changes. No push (local `main` only).

## Verification

- `bun install --frozen-lockfile` clean; osv-scanner on `bun.lock` reports
  0 vulnerabilities; local `--no-cache` image build scans 0 HIGH/CRITICAL.
- `bun run check` EXIT 0.
