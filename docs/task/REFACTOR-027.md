# REFACTOR-027 — Replace single-binary packaging with lode-managed releases

- Status: Completed
- Plan: [PLAN-070](../plan/PLAN-070.md)
- Campaign: local
- Owner: local
- Created: 2026-06-07

## Summary

Introduce `dotns/lode` as the production launcher and update supervisor, then
remove the packaging complexity that only exists for the current standalone Bun
binary path.

Acceptance criteria:

- Production startup runs through `lode`.
- Release assets are version directories or archives suitable for `lode`
  manifests.
- Static web assets and Drizzle migrations are shipped as files in the asset
  instead of being embedded by temporary source rewrites.
- Obsolete single-binary compile paths, docs, and CI/release references are
  removed or renamed.
- `bun run check` remains the quality gate.

## Files in scope

- `package.json`
- `scripts/compile.ts` or its replacement
- `apps/api/src/root.ts`
- `apps/api/src/db/index.ts`
- `apps/api/src/db/embedded-migrations.ts`
- `apps/api/src/shared/static-assets.ts`
- `apps/api/src/shared/middleware/static.ts`
- `Dockerfile`
- `.github/workflows/release.yml`
- `README.md`
- `docs/develop/deployment.md`
- `docs/architecture.md`
- `docs/develop/forking.md`
- `docs/reference/env-reference.md` / `.env.example` if runtime paths change

## Dependencies

- `dotns/lode` release assets and Docker image availability.
- A publisher key and release hosting choice are operator/release concerns; this
  task should wire the app and packaging surface, not commit private keys.

## Status notes

- 2026-06-07: Investigation started. Current package path is a Bun compiled
  binary that temporarily rewrites `static-assets.ts` and
  `embedded-migrations.ts`, then restores stubs. `lode` supports running an app
  from an installed version directory, so those embeds should be replaceable
  with plain files inside a tarball asset.
- 2026-06-07: Completed. Removed the single-binary compile path and replaced it
  with `bun run package`, which emits a lode `tar.gz` asset, manifest, and
  checksum file. Runtime static assets and migrations now load from packaged
  filesystem paths. Verification: `bun run package`, `bun run check`,
  `docker build -t bit:lode-test .`, and `docker run --rm bit:lode-test --version`.
- 2026-06-07: Simplified deployment paths after lode runtime testing. Mutable
  app paths now resolve from `DATA_DIR` when set, with `${LODE_DATA_DIR}/data`
  as the lode fallback, so container deploys can mount only `/srv/lode`.
- 2026-06-07: Aligned with upstream lode docs for Bun apps. The manifest
  entry now points at the packaged `app.js` file, `deploy/lode.toml`
  uses `github`, `entry = "app.js"`, `run = "bun"`, `exec = "bun run"`, and
  `readiness = "state"`, and the API reports
  `state.ready = LODE_INSTANCE`.

- 2026-06-07: Updated the GitHub release workflow to build the lode asset
  from a tag or manual dispatch, validate the current lode/v1 manifest contract,
  create the release when needed, and upload the tarball, `manifest.json`, and
  `checksums.txt` as release assets.
