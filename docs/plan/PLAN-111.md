# PLAN-111 - Remediate the 2026-09-01 repository audit findings

- Status: Completed
- Approved: 2026-09-01
- Task: [FIX-072](../task/FIX-072.md), [FIX-073](../task/FIX-073.md), [FIX-074](../task/FIX-074.md), [CHORE-011](../task/CHORE-011.md), [CHORE-012](../task/CHORE-012.md)
- Campaign: local
- Created: 2026-09-01

## Context

A full repository audit (pma-cr audit mode) ran on 2026-09-01 against local
`main @85bc5e15` (114 commits ahead of `origin/main`, never pushed, so CI has
not seen them). `bun run check` passes locally: 2220 api tests, api coverage
92.92 % lines / 87.48 % functions, web 52.49 % lines / 46.71 % branches, every
drift check up to date. No P0 was found; the auth, CSRF, policy-engine,
module-gate, PAT-scope, file-download, public-share, backup-v2 archive and
cron SSRF / shell boundaries all held up under file-by-file review.

Findings that survived verification, with the evidence behind each:

1. **v1 JSON backup routes (P1).** `backup.routes.ts:19` still mounts
   `restore.routes.ts`; `export.routes.ts` still serves `POST /backup/export`
   and `POST /backup/export-via-token`. `docs/modules/backup.md:151` deprecated
   them on 2026-06-10 for one release; twelve tags have shipped since.
   `restore.service.ts:315` keeps delete-then-insert; `validateBackupData`
   checks only `version <= 1`, so a pre-PLAN-108 dump of an unchanged module
   imports wholesale. Web uses v2 only; `GET /backup/modules` (same file) is
   still read by the backup tab. The v2 token route imports the per-token
   gate state from `export.routes.ts`. `export.service.ts` and the v1 half of
   `restore.service.ts` are also the round-trip harness of five test files
   (contact / procurement / ship / project backup tests, archive.service.test).
2. **OIDC calls without timeout (P2).** `oidc.ts` builds an options bag that
   only carries `allowInsecureRequests`; oauth4webapi 3.8.7 accepts
   `signal?: AbortSignal | (() => AbortSignal)` on every request.
   `auth.service.ts` `oauthSessionAuthProvider` awaits
   `refreshSessionWithMutex` inline (the comment says background). The
   revocation fallback in the same file uses `AbortSignal.timeout(5_000)`.
3. **Body cap mismatch (P2).** `index.ts:29` `maxRequestBodySize =
   MAX_UPLOAD_BYTES + 64 KiB`; `BACKUP_IMPORT_MAX_ARCHIVE_BYTES` defaults to
   2 GiB (`config/schema.ts`, `.env.example`, `env-reference.md`, PLAN-075).
   `import-v2.routes.ts` and `blob-restore.routes.ts:67` check the route cap
   only after `c.req.formData()`, which Bun never reaches above the server cap.
4. **Dead settings tabs (P2).** `-settings-smtp.tsx` / `-settings-webhook.tsx`
   write `smtp.*` / `webhook.endpoints`; a grep of `apps/api/src` finds no
   reader of either prefix (only the cron http-request action's tag list
   mentions "webhook"). `apps/api/src/dev.ts` needs `@hono/vite-dev-server`,
   absent from every manifest and from `bun.lock`; no script references it.
5. **P3.** `examples/compose/` is referenced from three docs and the
   sentinels comment but does not exist. `listProjects(..., { limit: 100 })`
   in `drive/index.ts:41` and `drive.routes.ts:335` (the latter followed by a
   per-project `resolveProjectId` loop). Web coverage floor 38 / 33 vs actual
   52 / 46.

The repository tracks tasks and plans in Markdown tables (a long-standing
local divergence from the skill's checkbox format), so `task-state.sh` does
not apply; status is edited in place as previous sessions did.

## Approach

### FIX-072 — retire the v1 routes

1. `export.routes.ts` keeps only `GET /backup/modules`; the per-token gate
   state and `tokenBucketKey` move into `export-v2-token.routes.ts` (sole
   consumer; test import updated). Delete `restore.routes.ts` and
   `restore.routes.test.ts`; trim `export.routes.test.ts` to the modules
   route. Unmount from `backup.routes.ts`.
2. `export.service.ts` and `validateBackupData` / `importJsonBackup` /
   `validateFileSize` stay, with a header comment stating they are the
   v1-format round-trip harness for the module backup tests and have no
   route. Porting those tests onto `writeArchiveV2` + `prepareImport` /
   `startImportApply` and deleting the harness is a separate CHORE (see
   Alternatives).
3. e2e: delete `export.test.ts`; port `restore.test.ts` to
   `POST /backup/v2/imports` + `/apply { wipeExisting: true }` so the
   "wipe restore keeps the importing admin's session" coverage survives.
4. Docs and generated artefacts: backup.md route table + deprecation
   section, api.md rows and the service-token row, operations.md
   service-token table (v2 trio), `.env.example` SERVICE_TOKEN_BACKUP notes
   (regen env-reference), `config/schema.ts` comment, architecture.md /
   README wording ("JSON backup" -> "backup"), regen api-routes / openapi /
   api-types. Changelog: `### Removed` under Unreleased.

### FIX-073 — bounded OIDC requests, non-blocking refresh

1. `oidc.ts`: `const OIDC_REQUEST_TIMEOUT_MS = 10_000;` and
   `requestOptions(appConfig, oauth)` returning
   `{ signal: () => AbortSignal.timeout(OIDC_REQUEST_TIMEOUT_MS), ...(insecure ? { [allowInsecureRequests]: true } : {}) }`,
   passed to `authorizationCodeGrantRequest`, `userInfoRequest`,
   `refreshTokenGrantRequest`, `revocationRequest`.
2. `auth.service.ts`: replace the awaited refresh with
   `void refreshSessionWithMutex(...).catch(() => {})`; fix the comment. The
   session ceiling check above it is unchanged, so an expired session still
   tears down synchronously.

### FIX-074 — request-body cap

1. `shared/lib/upload-limits.ts`:
   `requestBodyLimitBytes(config) = Math.max(MAX_UPLOAD_BYTES, BACKUP_IMPORT_MAX_ARCHIVE_BYTES) + 64 * 1024`.
2. `index.ts` uses it; `.env.example` notes on `MAX_UPLOAD_MB` and
   `BACKUP_IMPORT_MAX_ARCHIVE_BYTES` say the server body cap is the larger of
   the two (regen env-reference).

### CHORE-011 — orphan Vite API entry (re-scoped 2026-09-01)

The SMTP / Webhook tabs are NOT removed: the user wants both features built
(see Annotations; work filed as FEAT-059 / FEAT-060 under PLAN-112). What
remains here:

1. Delete `apps/api/src/dev.ts`; drop the `src/dev.ts` line from
   `apps/api/bunfig.toml`.

### CHORE-012 — P3 batch

1. `project.service.ts`: `listMemberProjects(db, userId)` — the existing
   member sub-select joined to `projects` (`deletedAt IS NULL`), returning
   `{ id, name }` with no page cap. `drive/index.ts` `resolveDriveOwners` and
   the `trash/all` route use it; the trash route drops its per-project
   `resolveProjectId` loop.
2. Docs: rewrite the `examples/compose/` passages around the real
   `docker-compose.yml` / `deploy/lode.toml` / `.env.docker` stack after
   reading those files; fix the sentinels comment.
3. `apps/web/vitest.config.ts` thresholds: lines / statements 48,
   functions 47, branches 42.

### Order and delivery

One worktree branch, one commit per task in the order FIX-072, FIX-073,
FIX-074, CHORE-011, CHORE-012, each RED -> GREEN -> IMPROVE with
`bun run check` before the commit. Fast-forward local `main`; no push
(operator policy).

## Risks

- FIX-072 removes an API surface. Any external automation still calling the
  v1 token export breaks; the v2 token trio is the documented replacement and
  has been available since 2026-06-10. Mitigation: changelog `Removed`
  entry names the replacement routes.
- FIX-073 changes refresh from synchronous to background. A refresh that
  completes after the response only affects the stored tokens (used at
  logout revocation and nowhere per request). A refresh in flight at
  shutdown is dropped; the next request retries within the ceiling.
- FIX-074 raises the server body cap to 2 GiB by default; Bun buffers
  multipart bodies in memory, so an admin-triggered import can use that much
  RAM. That is the behaviour PLAN-075 documented; operators who cannot afford
  it lower `BACKUP_IMPORT_MAX_ARCHIVE_BYTES`.
- CHORE-011 is now a file deletion with no runtime reference.
- CHORE-012 touches only docs, a read helper and a config file.

## Scope

- API: `modules/backup/{backup.routes,export.routes,export-v2-token.routes,restore.routes,restore.service,export.service}.ts` + tests,
  `modules/account/auth/{oidc,auth.service}.ts` + tests,
  `shared/lib/upload-limits.ts` + test, `index.ts`, `config/schema.ts`,
  `config/sentinels.ts`, `modules/project/project.service.ts` + test,
  `modules/drive/{index,drive.routes}.ts`, `src/dev.ts` (deleted),
  `bunfig.toml`.
- Web: `vitest.config.ts` (the settings-tab removal was dropped from scope).
- e2e: `tests/e2e/modules/backup/{export,restore}.test.ts`.
- Docs and generated: backup.md, api.md, api-routes.md, openapi spec,
  api-types, env-reference.md, `.env.example`, architecture.md, README.md,
  deployment.md, forking.md, operations.md, changelog.

## Alternatives

- **FIX-072 keep v1 import behind the epoch gate** instead of removing it:
  smaller diff, but it keeps the delete-then-insert engine alive one more
  release against a documented deprecation. Not recommended.
- **FIX-072 also port the five harness tests and delete the v1 services**
  now: the thorough version (about 900 lines of tests to rewrite onto the v2
  archive services). Recommended as a follow-up CHORE so this lane stays
  reviewable; say so and it folds in.
- **FIX-074 lower the documented cap to MAX_UPLOAD instead of raising the
  server cap**: avoids the RAM exposure but breaks the PLAN-075 contract and
  makes DB-heavy backups (spreadsheets on the db driver) un-importable.
- **FIX-073 env-configurable timeout**: not needed today; a constant mirrors
  the discovery timeout and can be lifted into config if an operator asks.

## Annotations

- 2026-09-01 (user): `proceed`, recommended options taken — delete the v1
  `export-via-token` route too; keep the v1 services as the test harness and
  file the harness port as a separate CHORE.
- 2026-09-01 (user): SMTP and webhook must be completed as real features, not
  removed. CHORE-011 is re-scoped: only the orphan `apps/api/src/dev.ts`
  removal stays; the two tabs become the front end of new FEAT work (see the
  revised proposal appended below once investigated).

## Status Notes

- 2026-09-01: FIX-072 (`ffcfa54c`), FIX-073 (`1ca112e4`), FIX-074
  (`b1846729`), CHORE-011 (`8c16335f`), CHORE-012 (`fe0729a4`) landed on
  local `main`, each with `bun run check` EXIT 0. The closing full e2e run
  first failed in the harness itself: `tests/e2e/lib/grant.ts` still granted
  the `ships` module key removed by PLAN-108 (a pre-existing drift on `main`).
  Filed and fixed as TEST-003 together with the other stale specs the run
  surfaced (`search.test.ts` ships bucket, `ship/main-flow.test.ts` on
  `/api/ships`, `drive/backup.test.ts` on the retired v1 export): final run
  105 / 105 pass. Plan complete.
