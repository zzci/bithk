# PLAN-070 — lode-managed release packaging

- Status: Completed
- Task: [REFACTOR-027](../task/REFACTOR-027.md)
- Campaign: local
- Created: 2026-06-07

## Problem

The current production build is optimized around a single Bun executable:

- `scripts/compile.ts` builds the frontend, scans `apps/web/dist`, temporarily
  rewrites `apps/api/src/shared/static-assets.ts`, temporarily rewrites
  `apps/api/src/db/embedded-migrations.ts`, runs `bun build --compile`, restores
  the stubs, and writes `dist/checksums.txt`.
- `Dockerfile` copies only `dist/app` into the runtime image and uses `tini` as
  the process supervisor.
- Static serving and migration fallback have code branches that exist only to
  support a compiled binary without adjacent files.
- Release CI builds and pushes an app-specific image instead of publishing a
  `lode` artifact/manifest.

`dotns/lode` changes the packaging model: it installs a verified artifact into a
version directory, runs the configured entry, supervises the child process, and
can update/rollback by switching versions. Keeping the single-binary embed path
would leave most of the current packaging complexity in place.

## Investigation Findings

- `lode` expects three integration surfaces:
  - local `lode.toml` owned by the operator;
  - local `state.json` for status/readiness/update requests;
  - remote `manifest.json` owned by the publisher.
- The latest upstream release checked during investigation is `v0.0.1`
  published on 2026-06-06, with prebuilt Linux/macOS x64/arm64 tarballs.
- It can run either a self-contained binary (`run = "{entry}"`) or a script under
  a runtime (`run = "bun"` / `[runtime] runtime = "bun"`).
- The best simplification for this repo is a `tar.gz` artifact containing:
  - `apps/api/dist/index.js`;
  - `apps/web/dist/**`;
  - `apps/api/drizzle/**`;
  - minimal package metadata needed by runtime path detection and version info.
- `ROOT_DIR` currently resolves three levels above `apps/api/src/root.ts` in
  source mode and `process.cwd()` only for compiled binaries. A bundled
  `dist/index.js` inside a version directory needs an explicit
  `ROOT_DIR=${dir}` in `lode.toml` or a small runtime detection change.
- `bun run --filter @app/api build` currently succeeds and emits a bundled
  `apps/api/dist/index.js` around 1.1 MB, so the script-under-Bun artifact path
  is viable enough to prototype first.
- `createDb()` already prefers the on-disk `apps/api/drizzle` folder. Once the
  artifact ships that folder, the embedded migration fallback can be deleted.
- Static serving currently depends on a generated map. In a version-directory
  artifact it can serve directly from `${ROOT_DIR}/apps/web/dist`, removing
  `static-assets.ts` and the source rewrite.
- Existing graceful `SIGTERM` handling is compatible with `lode` supervision.
  Readiness via `state.json` is optional but useful if `[supervise].readiness =
  "state"` is used.

## Proposal

1. Replace `scripts/compile.ts` with a simpler release-pack script.
   - Build web via `bun run --filter @app/web build`.
   - Build API via `bun run --filter @app/api build`.
   - Stage the release directory under `dist/app/` with `apps/api/dist`,
     `apps/web/dist`, and `apps/api/drizzle`.
   - Produce `dist/app-<version>-linux-x86_64.tar.gz` plus checksum metadata.

2. Update runtime code for file-based packaged artifacts.
   - Serve static files from `${ROOT_DIR}/apps/web/dist`.
   - Remove `apps/api/src/shared/static-assets.ts` and generated-map logic.
   - Remove `embedded-migrations.ts` and its fallback path; fail if the packaged
     `apps/api/drizzle/meta/_journal.json` is missing.
   - Ensure the API entry works when launched from the packaged `dist/index.js`
     with `ROOT_DIR` set to the version directory.

3. Add `lode` runtime integration files.
   - Add an example `deploy/lode.toml` with `app = "bit"`, `run = "{entry}"` or
     `run = "bun"`, `exec = "bun"`, `workdir = "{dir}"`, and
     `ROOT_DIR={dir}` passed via command/env if needed.
   - Add release manifest guidance, but do not commit private signing keys.
   - Prefer `require_signature = "enforce"` in docs/examples.

4. Simplify container/release flow.
   - Change `Dockerfile` to use the `dotns/lode` binary/image as the entrypoint
     and keep only runtime dependencies needed by the app.
   - Update GitHub release workflow from app-image publishing to artifact
     packaging and manifest/signing placeholders, unless the chosen release host
     still needs a container image.
   - Update README/deployment/architecture/forking docs to describe
     `lode`-managed startup and updates.

## Risks

- `lode` is currently at `v0.0.1`; the integration surface is young. Keep the
  first change conservative and close to the documented contract.
- `bun build src/index.ts --outdir dist --target bun --minify` must be verified
  against path aliases and runtime file access after packaging.
- Release signing needs operator secrets. The repo can provide scripts and docs,
  but not a usable private key.
- Switching from app-specific image updates to artifact updates changes
  deployment operations and rollback expectations.

## Scope

Non-trivial cross-cutting refactor across packaging scripts, runtime asset and
migration loading, Docker/release configuration, and deployment docs. No product
feature or schema change is intended.

## Alternatives

- Minimal integration: keep `bun run compile`, publish `dist/app` as a `lode`
  raw artifact, and set `run = "{entry}"`. This is lower risk but preserves the
  static/migration embed complexity the user asked to remove.
- Runtime-script artifact: ship source/TS and `node_modules` and run `bun
  src/index.ts`. This is simple to reason about but larger and less controlled
  than shipping a built API bundle plus file assets.

## Annotations

- 2026-06-07: User approved the recommended version-directory artifact
  approach and explicitly requested removal of the single Bun binary compile
  path.
- 2026-06-07: Implemented. Final scope uses `scripts/package.ts`, artifact
  launcher `bin/bit`, filesystem static assets, filesystem Drizzle migrations,
  `deploy/lode.toml`, lode+Bun Docker runtime, and GitHub Release artifact
  upload. Verification passed: `bun run package`, artifact launcher
  `--version`, `bun run check`, `docker build -t bit:lode-test .`, and
  `docker run --rm bit:lode-test --version`.
- 2026-06-07: Verified with the upstream `lode` binary (`v0.0.1`) downloading a
  local manifest/artifact. Adjusted mutable path defaults so `DATA_DIR` anchors
  DB, uploads, and file logs, with `${LODE_DATA_DIR}/data` as the lode fallback,
  enabling a single `/srv/lode` persistent volume.
