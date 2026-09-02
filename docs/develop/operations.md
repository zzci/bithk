# Operations Runbook

Day-2 procedures for operators. Examples assume `BASE_PATH=/app`. The app is mounted at root (`/`) by default; drop the `/app` prefix from the paths below if you have not set `BASE_PATH`. Endpoints are described in [`api.md`](../reference/api.md); deployment context in [`deployment.md`](deployment.md).

---

## Restore from snapshot

When the database has been corrupted, accidentally truncated, or you need to roll back to a known-good state.

### Procedure

1. **Stop the container.** Do not attempt a hot copy.
   ```bash
   docker compose stop app
   ```
2. Identify the snapshot you want to restore. The snapshot sidecar (see `deployment.md`) writes timestamped `app-YYYYMMDDTHHMMSSZ.db` files.
3. Replace the DB files in the data volume:
   - `app.db`
   - `app.db-wal`
   - `app.db-shm`

   The simplest safe sequence:
   ```bash
   # working in the host-side mount of the data volume
   mv data/db/app.db data/db/app.db.broken
   rm -f data/db/app.db-wal data/db/app.db-shm
   cp /snapshots/app-20260510T120000Z.db data/db/app.db
   ```

   If your snapshot only captured `app.db` (the SQLite online backup API merges WAL into the file), removing the stale `-wal` / `-shm` is correct — SQLite recreates them on next open.
4. **Start the container.**
   ```bash
   docker compose up -d app
   ```
5. Verify:
   - `GET /app/api/health/ready` returns `200 {status:"ready"}`.
   - Spot-check the most recently created document/issue from before the incident.
   - `GET /app/api/audit?limit=20` shows recent entries.
6. Once verified, retain `app.db.broken` for at least 24 hours, then delete. For deployments that perform restores frequently, rename to `app.db.broken-$(date -u +%Y%m%dT%H%M%SZ)` so successive incidents do not clobber each other, and add a host-level cron to prune older than 7 days:
   ```bash
   find /path/to/data/db -name 'app.db.broken-*' -mtime +7 -delete
   ```

---

## Audit log investigation

Use during an incident response — abnormal logins, suspected privilege escalation, attachment exfiltration, etc. All endpoints below require admin access.

### Endpoints

- `GET /app/api/audit` — paginated list. Supports filters:
  - `actor` — username or user id
  - `action` — e.g. `auth.login`, `auth.logout`, `totp.verify`, `users.update`, `groups.add_member`, `tuples.create`, `documents.update`, `documents.share.add`, `attachments.upload`, `attachments.download`, `attachments.delete`, `settings.update`, `backup.export`, `backup.import`
  - `resource` — `documents:<id>`, `issues:<id>`, `users:<id>`, etc.
  - `result` — `success` | `failure`
  - `from`, `to` — ISO timestamps
  - `ip` — exact client IP
- `GET /app/api/audit/:id` — full event detail (includes the JSON `detail` payload).

### Suggested incident playbook

1. **Scope by time.** Start with `from=<incident_start_minus_1h>&to=<incident_end_plus_1h>`.
2. **Pivot on actor.** If a user account is suspect, filter by `actor=<id>` and review **every** action in the window — not just the suspicious one.
3. **Pivot on IP.** Use the IP from a suspicious entry to find every other action from the same IP across all actors. Look for credential-stuffing patterns (many `auth.login` `failure` rows then a `success`).
4. **Check backup events.** `backup.export` and `backup.import` are the highest-leverage actions; any unexplained occurrence is a hard incident.
5. **Cross-reference with the application log** (`LOG_FILE` or stdout). The audit table records intent and outcome; the application log records request-level detail (request id, headers, latency).

### Retention

`AUDIT_RETENTION_DAYS` defaults to `0` (keep forever). Long-lived deployments should set a finite value (e.g. `90` or `365`) so `audit_events` does not grow unbounded. The retention sweep runs hourly.

---

## Service-token automation

Two endpoints accept a bearer instead of a session cookie. Each scope is gated by its own env var (≥ 32 chars). Splitting the surfaces means a leaked metrics scraper credential cannot also dump the database.

| Endpoint | Env |
|---|---|
| `POST /app/api/backup/v2/exports-via-token` — starts a redacted archive export job; poll `GET .../exports/:jobId/status-via-token`, download `GET .../exports/:jobId/download-via-token?artifact=data`. (The v1 `/backup/export-via-token` JSON route was removed in FIX-072.) | `SERVICE_TOKEN_BACKUP` |
| `GET /app/api/metrics` — Prometheus exposition (HTTP request counter + duration histogram). Configure Prometheus to send `Authorization: Bearer ${SERVICE_TOKEN_METRICS}`. | `SERVICE_TOKEN_METRICS` |

Operators that don't need a surface should leave its env var unset; the endpoint then returns `503 SERVICE_TOKEN_DISABLED`. Rotate by changing the env var on both the API and any caller, then restarting the API. Constant-time comparison; no length oracle.

Treat each token like an OAuth client secret: store in your secrets manager, never commit to git. The audit row for a token-triggered `backup.export` records `actor:"system"` / `actorName:"system:backup-sidecar"` so you can distinguish automated dumps from operator-driven ones.

---

## Log handling

- Container deployments: keep `LOG_TO_STDOUT=true` (the Dockerfile default). Logs go to docker / journald / k8s and survive container churn. No on-host rotation needed.
- Bare-metal deployments: write to `LOG_FILE` and rotate externally. The example config at `examples/logrotate.d/app` ships a daily rotation with 14-day retention. The `postrotate` hook sends `SIGHUP`; the API responds by reopening the log fd in place (`apps/api/src/index.ts`'s SIGHUP handler), so the next write goes to the freshly-rotated file without process restart.

---

## OIDC discovery cache

`bootstrap` calls the IdP's `/.well-known/openid-configuration` once at startup and persists a copy as `<DB_PATH minus .db>-oidc.json` (e.g. `data/db/app-oidc.json`). On subsequent boots, if the IdP is unreachable we fall back to the cached endpoints — the API still serves traffic with last-known-good URLs. A successful refresh updates the cache; switching `OAUTH_ISSUER` invalidates by issuer mismatch.

Operationally: this cache file contains URLs only (no secrets). It is safe to back up alongside the DB. Delete it to force a fresh discovery on next boot.

---

## Service health and on-call response

### SLOs and alert thresholds

Suggested defaults to alert on (Prometheus exposition):

| Symptom | Query / signal | Threshold |
|---|---|---|
| Readiness flapping | `up{job="app"}` or HTTP 503 from `/api/health/ready` | warn after 2m, page after 5m |
| Error-rate elevated | `rate(http_requests_total{status=~"5.."}[5m]) / rate(http_requests_total[5m])` | warn > 1%, page > 5% |
| Latency p95 | `histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))` | warn > 1s, page > 3s |
| Backup stale | last successful audit row for `system:backup-sidecar` | warn > 26h |

Tune the warn / page thresholds to your traffic shape. The metric names
are the ones emitted by `apps/api/src/shared/lib/metrics.ts`.

### Decision tree: `/api/health/ready` returns 503

1. Check `GET /api/health` (liveness): if it is also failing, the
   process is wedged — restart the container.
2. If liveness is healthy but ready returns 503, the DB handle is gone.
   Common causes: disk pressure (check `df -h ${ROOT_DIR}/data/`),
   SQLite corruption (see "DB will not open after restart"), or a
   half-applied migration. Take a snapshot of `data/db/` before
   restarting so a postmortem still has the on-disk state.
3. While in 503, drain LB / k8s readiness so traffic does not pile up.

### DB will not open after restart

Symptom: post-restart logs show `SQLITE_CORRUPT` or `unable to open database file` and `/api/health/ready` stays at 503.

Recovery:

1. Stop the application. Snapshot `data/db/app.db*` for post-mortem
   (corruption is rare; preserving evidence helps).
2. Restore the most recent good snapshot (see "Restore from snapshot").
3. Resume the application; verify `/api/health/ready` returns 200.

Production deploys must run a snapshot sidecar or `litestream` (see
[`deployment.md`](deployment.md) § Backup & restore). The single-SQLite
topology has no built-in failover; the snapshot is the only recovery path.
