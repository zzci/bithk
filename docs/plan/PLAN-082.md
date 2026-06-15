# PLAN-082 - Realign lode upgrade integration with breaking lode spec

- Status: Completed
- Task: [FIX-040](../task/FIX-040.md)
- Campaign: local
- Created: 2026-06-15

## Context

The upgrade path is lode-managed (PLAN-070 introduced lode releases, PLAN-071
flattened the artifact). The integration assumed an older lode in which a
release asset declared its launch via an `entry` field and the app reported
readiness by writing the bare `LODE_INSTANCE` to `state.ready`.

The current lode `lode/v1` spec (verified verbatim from `docs/architecture.md`
§7-§8, `docs/manifest.example.json`, `docs/lode.example.toml`) made breaking
changes:

1. `entry` no longer exists. A version is launched via `[command].run`/`exec`,
   or a manifest asset's own `run`/`exec` (which override and are signature
   bound). With `[command].run = "bun"` and an `entry`-only asset, the new lode
   has no usable launch command — the app cannot start.
2. `state.ready` is now a three-phase control field, `{LODE_INSTANCE}-{phase}`:
   `-0` = serving, `-1` = lode's staged-update prepare prompt, `-2` = the app's
   "prepared" ack. Writing `-0` opts into the prepare handshake; the bare
   `LODE_INSTANCE` is the legacy opt-out (immediate cut-over). Our `markLodeReady`
   writes the bare token and the summary reader does a strict `=== LODE_INSTANCE`
   equality that does not understand the phased token at all.

Already-correct (no change): the manifest `channels: { stable: { latest } }`
nested shape, the mandatory SIGTERM graceful-drain (present in `index.ts`), and
the `[update]`/`[supervise]`/`[trust]` keys we already set.

The user asked to (a) fix per the recommended approach (atomic temp+rename, no
flock; prepare work = WAL checkpoint + log flush) and (b) extract the
integration into an independent, reusable upgrade module.

## Proposal

1. Release artifact + config (breaking-fix):
   - `scripts/package.ts`: asset `entry: "index.js"` -> `run: "bun index.js"`,
     `exec: "bun run"`; drop `min_lode` (absent from the authoritative schema).
   - `deploy/lode.toml`: remove `[update].entry`; `[command].run = "bun"` ->
     `run = "bun index.js"` (keep `exec = "bun run"` so `lode migrate` maps to
     the packaged `bun run migrate` script); add `[supervise].prepare_timeout`
     (finite, = 25s) as a deadlock safety net.
   - `.github/workflows/release.yml`: replace the `asset.entry` assertion with
     `asset.run === "bun index.js"` and `asset.exec === "bun run"`, and assert
     `entry` is absent; keep the `platform`/`format`/integrity assertions.

2. Reusable `apps/api/src/lode/` module (replaces `lode-state.ts`):
   - `types.ts` — `LodeSummary` (+ `readiness.phase`), env and enum types.
   - `state.ts` — env/path resolution, `readState`, atomic `patchState`
     (read-merge temp+rename, preserves lode's fields), `composeReady` and
     `parseReadyPhase` (anchors on the full `LODE_INSTANCE` prefix because the
     instance id itself contains `-`; never split on `-`).
   - `readiness.ts` — `markLodeReady({ probe?, logger?, env? })`: writes
     `{INSTANCE}-0` only if the injected `probe` resolves truthy; no-op off-lode.
   - `prepare.ts` — `startLodePrepareWatcher({ onPrepare, intervalMs?, ... })`:
     polls `state.json` (file-is-the-notification; ~1s), on `{INSTANCE}-1` runs
     `onPrepare` then acks `{INSTANCE}-2`; `stop()` for teardown; single-ack
     guard; timer `unref`'d so it never holds the process open.
   - `summary.ts` — `getLodeSummary`: config + state reader, readiness derived
     from `parseReadyPhase`, exposes `{ ready, phase }`.
   - `index.ts` — barrel.
   - Decoupling: the module imports no app DB/cron internals; the caller injects
     the DB probe and the prepare callback.

3. Wire-up:
   - `app.ts`: add `db` to `BootstrapResult` so the entrypoint can build the
     probe/checkpoint callbacks.
   - `index.ts`: `await markLodeReady({ logger, probe: () => db.run(SELECT 1) })`;
     `startLodePrepareWatcher({ logger, onPrepare: wal_checkpoint(TRUNCATE) +
     logger.flush })`; stop the watcher in `closeServices` teardown.
   - `system.routes.ts`: import path `@/lode-state` -> `@/lode` (no behaviour
     change; `phase` is additive in the JSON).

4. Tests + docs:
   - Port and extend the old `lode-state.test.ts` into the module: phase parsing
     (bare/-0/-1/-2/foreign-instance/malformed), probe-gated readiness (probe
     false -> no write), prepare watcher (sees `-1` -> runs onPrepare -> writes
     `-2`), summary phase reporting.
   - Changelog entry.

## Risks

- Writing `-0` opts into the prepare handshake; if the app never acked `-2` and
  `prepare_timeout=0` (default), lode would wait forever. Mitigated by
  implementing the `-1`->`-2` ack and setting a finite `prepare_timeout`.
- Manifest asset `run`/`exec` override `[command]`; they are kept byte-identical
  to `deploy/lode.toml` to avoid an override mismatch.
- No native `flock` in Bun/Node; rely on atomic temp+rename (the mechanism the
  spec itself uses, and lode is not concurrently mutating `ready` while it waits
  on the ack), accepted per user direction.
- `bun run package` regenerates `dist/manifest.json`; the committed sample under
  `dist/` is a build output, not hand-edited.

## Verification

- `bun run package`, then inspect `dist/manifest.json`: asset has `run`/`exec`,
  no `entry`/`min_lode`; run the release workflow's validation node snippet.
- `bun run check` (lint + typecheck + test + routes + build + i18n + docs).
