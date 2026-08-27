# PLAN-109 - Dependabot catch-up and CI security-scan baseline fix

- Status: Completed
- Task: [CHORE-005](../task/CHORE-005.md)
- Campaign: local
- Created: 2026-08-27

## Context

- `main` == `origin/main` @ `85e3ccc6`; 7 open dependabot PRs. Re-running the
  `main` CI on 2026-08-27 shows `security scans` and `docker build` failing on
  `main` itself; `check` and `e2e` pass.
- osv-scanner (`bun.lock`): 37 vulns / 15 packages, all transitive
  (`nanoid`, `brace-expansion`, `undici`, `js-yaml`, `postcss`, `fast-uri`,
  `ip-address`, `dompurify`, `protobufjs`, `body-parser`,
  `@hono/node-server`, `hono`). `hono` and `vite` stay old even on the
  dependabot branches because root `overrides` (`hono: ^4.12.25`,
  `vite: ^8.0.16`) keep the already-satisfying lock entry; the bumps in
  `apps/*/package.json` never reach `bun.lock`.
- trivy: `docker/build-push-action` uses `cache-from/cache-to: type=gha`; the
  `RUN apt-get upgrade` layer is restored from cache (main re-run log shows
  the layer served from cache in 1.6s), leaving Debian 13.5 packages with
  available fixes. A local `docker build --no-cache --pull` yields Debian
  13.6 with 0 HIGH/CRITICAL findings under the same trivy flags.
- PR #36 also fails typecheck: dependabot's lock keeps 27 nested copies of
  `@codemirror/language@6.12.3` next to the bumped 6.12.4, so two
  `LanguageDescription` types collide. `bun update @codemirror/language`
  dedupes it.
- PR #14 / #23-#26 are single-commit action bumps on stale June/July bases;
  cherry-picking the commits onto current `main` applies cleanly.
- Verified in a throwaway worktree: overrides raised + nested override +
  `bun update` -> osv 0 vulns and `bun run check` EXIT 0.

## Approach

1. Worktree from `main`; cherry-pick the five action-bump commits.
2. Cherry-pick #36; apply #35's `package.json` diff on top; `bun install`.
3. Root `overrides`: `hono ^4.13.3`, `dompurify ^3.4.13`, `js-yaml ^4.3.1`,
   `protobufjs ^7.6.5`, `undici ^7.29.0`, `vite ^8.2.2`; add
   `"@univerjs/core": { "nanoid": "5.1.16" }` (Bun honours nested
   overrides; a global `nanoid ^5` would break `postcss`, which needs
   `nanoid@3`). `apps/api` `nanoid` 5.1.14 -> 5.1.16.
4. `bun update` (transitive refresh within declared ranges; direct deps are
   exact-pinned so only transitive entries move) and
   `bun update @codemirror/language` to dedupe.
5. `ci.yml` docker job: remove `cache-from` / `cache-to` (the image is a
   base pull + one apt layer; caching that layer is exactly what makes the
   scan stale).
6. Verify: frozen install, osv-scanner via docker sibling on `bun.lock`,
   `bun run check`, local image build + trivy. Commit as
   `chore(ci)` + `chore(deps)`; fast-forward local `main`. No push.

### Follow-up (2026-08-27, after push)

CI `Install dependencies` failed on `main`: the lockfile was written by the
local Bun 1.4.0 (`lockfileVersion: 3`) and CI pins 1.3.14, which rejects it.
Regenerating with 1.3.14 also drops the nested `@univerjs/core -> nanoid`
override (unsupported before 1.4), so `nanoid@5.1.11` returns. Decision:
bump Bun to 1.4.0 in `ci.yml` / `release.yml` `BUN_VERSION`, `engines.bun`,
`Dockerfile` `BUN_IMAGE`, `deploy/lode.toml` runtime, and the runtime note in
`AGENTS.md` / `docs/develop/deployment.md`.

## Risks

- `bun update` moves transitive packages beyond what dependabot proposed;
  covered by the full `check` gate, e2e runs in CI after push.
- `vite` 8.0.16 -> 8.2.2 and `@vitejs/plugin-react` 6.0.2 -> 6.1.0 are the
  largest jumps; build + vitest are in `check`.
- After push, dependabot closes the seven PRs as superseded.

## Scope

In: `package.json`, `apps/*/package.json`, `bun.lock`,
`.github/workflows/ci.yml`, `.github/workflows/release.yml`, docs
bookkeeping. Out: any `src/` change, Dockerfile base image bump.
