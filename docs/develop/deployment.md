# Deployment

> Examples assume `BASE_PATH=/app`. The app is mounted at root (`/`) by default; set `BASE_PATH` to serve under a URL prefix (e.g. behind a reverse-proxy mount).

Production startup and updates are managed by [lode](https://github.com/dotns/lode). The app is published as a versioned `tar.gz` artifact that contains the built API bundle, built SPA assets, and Drizzle migrations. Production typically pairs lode with a reverse proxy and one persistent volume for lode state plus app data.

## Build options

```bash
# lode artifact
bun run package
# → dist/bit-<version>-<platform>.tar.gz
# → dist/manifest.json
# → dist/checksums.txt

# lode runtime image
docker build -t myapp .
```

`bun run package` builds:

- `apps/api/dist/index.js`
- `apps/web/dist/**`
- `apps/api/drizzle/**`
- `bin/<APP_NAME>` launcher

The launcher sets `ROOT_DIR` to the installed artifact directory and runs the API bundle with Bun. Mutable app paths resolve under `DATA_DIR` when set. If `DATA_DIR` is omitted but `LODE_DATA_DIR` exists, the app uses `${LODE_DATA_DIR}/data` so operators do not have to configure each path separately.

The Dockerfile is a generic `lode + Bun` runtime image. It does not bake the application into the image; lode downloads the artifact declared by `/srv/lode/lode.toml`, then supervises and updates it.

Verified lode layout after first boot:

```text
/srv/lode/
  lode.toml
  lode.pid
  state.json
  current -> versions/<version>
  downloads/
  versions/<version>/
    .lode.json
    bin/bit
    apps/api/dist/index.js
    apps/api/drizzle/
    apps/web/dist/
/srv/lode/data/
  db/app.db
  uploads/files/
  logs/app.log
```

Keep `/srv/lode/versions` as immutable downloaded releases. Keep mutable application data under `/srv/lode/data`; this is the default whenever `DATA_DIR=/srv/lode/data`, or when `LODE_DATA_DIR=/srv/lode` and `DATA_DIR` is omitted.

## lode configuration

Start from [`../../deploy/lode.toml`](../../deploy/lode.toml):

```bash
mkdir -p /srv/lode
cp deploy/lode.toml /srv/lode/lode.toml
# Edit [update].manifest to the published manifest.json URL.
```

The default release workflow uploads `manifest.json` and the artifact to the GitHub Release. For production, sign artifacts and the manifest with `lode-cli`, then set `[trust].require_signature = "enforce"` and configure trusted keys in the deployment environment.

## Required environment

The complete env reference (every variable, its type, default, and
description) is generated from the zod schema in `apps/api/src/config.ts`
and the comments in `.env.example`. See [`env-reference.md`](../reference/env-reference.md);
CI rejects PRs that leave it out of sync.

Highlights for a production deploy:

| Variable | Why |
|---|---|
| `APP_NAME`, `APP_DISPLAY_NAME` | Branding (see [`forking.md`](forking.md)) |
| `APP_URL` | Production redirect-URI base; forwarded headers are not trusted in prod |
| `CORS_ORIGIN` | Comma-separated allow-list; fail-closed in prod when unset |
| `BASE_PATH` | URL prefix the app is mounted under. Leave unset for root mount; set to the reverse-proxy mount (e.g. `/app`) when serving under a prefix |
| `DATA_DIR` | Base directory for mutable app data; defaults can be anchored here for lode and non-lode runs |
| `DB_PATH` | SQLite DB path; relative paths resolve under `DATA_DIR`, or `${LODE_DATA_DIR}/data` when lode provides the fallback |
| `OAUTH_*` | OIDC issuer or full endpoint set, plus client id/secret |
| `DEFAULT_ADMIN` | Comma-separated emails that get admin role on first login (no-op if users exist) |
| `LOG_FILE` / `LOG_TO_STDOUT` | Either rotates on disk under `DATA_DIR` or hands lines to the runtime |
| `AUDIT_RETENTION_DAYS` | `0` (keep forever) by default; set to a finite value in long-running deployments to bound `audit_events` size |
| `SERVICE_TOKEN_METRICS`, `SERVICE_TOKEN_BACKUP` | Scoped bearers for `/api/metrics` and `/api/backup/export-via-token` |

## Volumes

The container declares `VOLUME /srv/lode`. The runtime writes:

| Path | Derived from | Holds | Backup priority |
|---|---|---|---|
| `${DB_PATH}` (container default `/srv/lode/data/db/app.db`) | `DB_PATH` | `app.db`, `app.db-wal`, `app.db-shm` | Critical |
| `${FILE_STORAGE_LOCAL_ROOT}` (container default `/srv/lode/data/uploads/files/`) | `FILE_STORAGE_LOCAL_ROOT` | All attachments (documents, issues, …); content-addressable blobs under the `file` module | Critical |
| `${LOG_FILE}` (container default `/srv/lode/data/logs/app.log`) | `LOG_FILE` | Runtime logs when `LOG_TO_STDOUT=false` | Operational |
| `${DATA_DIR}` (container default `/srv/lode/data`) | `DATA_DIR` | Default anchor for DB, uploads, and file logs | Critical |
| `${LODE_DATA_DIR}` (container default `/srv/lode`) | `LODE_DATA_DIR` | `lode.toml`, `state.json`, downloaded versions, runtime cache | Operational |

**Watch out — the upload and log paths are *not* re-rooted by `DB_PATH`.** Overriding `DB_PATH` does **not** relocate uploads or logs; set `FILE_STORAGE_LOCAL_ROOT` and `LOG_FILE` only when intentionally splitting storage. The recommended production mode is:

1. Mount one persistent volume at `/srv/lode`.
2. Let lode keep versions and state directly under `/srv/lode`.
3. Set `DATA_DIR=/srv/lode/data`, or omit it and let `LODE_DATA_DIR=/srv/lode` derive the same path.

## Health checks

The API exposes two distinct probes:

- `GET /<base>/api/health` → `200 {status:"ok"}` whenever the process is alive. Use for **liveness** — restart-on-failure semantics.
- `GET /<base>/api/health/ready` → `200 {status:"ready"}` when the DB is reachable; `503 {status:"db_unavailable"}` otherwise. Use for **readiness** — load-balancer pool membership.

Recommended Kubernetes / docker-compose probes:

```yaml
livenessProbe:
  httpGet:
    path: /app/api/health
    port: 3000
readinessProbe:
  httpGet:
    path: /app/api/health/ready
    port: 3000
  # 200 = ready (db reachable); 503 = drain traffic
```

## Reference compose stack (local dev / smoke test)

`examples/compose/` holds a reference docker-compose stack — app + a bundled `dex` IdP + a Caddy proxy — meant for local-development and smoke-test use. It is **not** a production deployable: dex ships with hardcoded test users, the proxy terminates plain HTTP, and the app runs against a self-signed IdP issuer. Treat it as the starting point you adapt for production: real IdP, real TLS, real secrets store.

```bash
cd examples/compose
cp .env.example .env                # populate APP_NAME, secrets, APP_URL, etc.
docker compose up --build
```

Required env (in `.env` next to the compose file): `APP_NAME`, `APP_DISPLAY_NAME`, `OAUTH_CLIENT_ID`, `OAUTH_CLIENT_SECRET`, `APP_URL`. Strip the `dex` service and replace it with your real IdP for any non-toy deploy.

## Reverse proxy

Mount the app at `BASE_PATH` and pass the host header. Caddy example:

```caddy
your-domain.com {
  reverse_proxy /app/* localhost:3000 {
    header_up Host {host}
    header_up X-Forwarded-Proto {scheme}
  }
  redir /app /app/  # trailing slash
}
```

Set `APP_URL=https://your-domain.com` in the app's env so OAuth callback URLs are stable.

### TLS via Caddy automatic HTTPS

For a public-internet deployment, Caddy will auto-issue a Let's Encrypt certificate when you give it a domain and a contact email:

```caddy
your-domain.com {
  tls you@example.com
  reverse_proxy /app/* app:3000 {
    header_up Host {host}
    header_up X-Forwarded-Proto {scheme}
    header_up X-Forwarded-For {remote_host}
  }
  redir /app /app/  # trailing slash
}
```

The reference `examples/compose/Caddyfile` ships with plain `:80` for local smoke-testing — replace the site block with the form above (and forward 80/443 from the host) before pointing it at a real domain.

## Trust Proxy

`TRUST_PROXY` controls whether the app reads `X-Forwarded-For` (and, as a
fallback, `X-Real-IP`) to determine the client IP used for rate limits,
lockouts, and audit logs.

- **Default (`TRUST_PROXY=false`)** — the app uses the connection peer IP only. Safe everywhere; appropriate when the app is reachable directly or behind a single trusted proxy that does not need to attribute per-client IPs.
- **`TRUST_PROXY=true`** — the app honours the **rightmost** `X-Forwarded-For` entry (the hop closest to our process — the one set by the trusted proxy). `X-Real-IP` is read only when XFF is absent. Set this **only** when every request reaches the app through a proxy that **overwrites** both headers with the verified client IP.

### Mandatory proxy header rewrites

The proxy must **replace** any client-supplied `X-Forwarded-For` /
`X-Real-IP` so an attacker cannot forge a header to bypass per-IP gates.
Reference snippets:

**nginx**

```nginx
location / {
    proxy_pass http://app:3000;
    # `proxy_set_header` overwrites the value rather than appending.
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Host $host;
}
```

**Caddy** — `reverse_proxy` already overwrites these headers by default.

**Traefik** — set `forwardedHeaders.trustedIPs` to the load balancer
subnet and Traefik will drop client-supplied forwarding headers.

### `TRUSTED_PROXY_IPS` allow-list

Defence-in-depth against a misconfigured proxy: set
`TRUSTED_PROXY_IPS` to a comma-separated CIDR list of the immediate
peer addresses you accept forwarding headers from. Requests whose peer
IP is outside the list are still served, but their forwarding headers
are ignored (the connection peer IP is used). Empty (default) preserves
the pre-flag behaviour. Example:

```ini
TRUST_PROXY=true
TRUSTED_PROXY_IPS=10.0.0.0/8,172.16.0.0/12
```

> **Security warning.** If you set `TRUST_PROXY=true` while the API is also reachable directly (port exposed on the host, alternate ingress, etc.) without `TRUSTED_PROXY_IPS`, an attacker can spoof `X-Forwarded-For` to bypass per-IP rate limits and poison audit log attribution. Either keep the API exclusively behind the proxy (no direct exposure), set `TRUSTED_PROXY_IPS` to the proxy subnet, or leave `TRUST_PROXY` at the default.

## Production compose addendum

The reference stack under `examples/compose/` is local-dev grade. For a production deployment, layer the items below on top of it (or maintain a separate `compose.prod.yml`).

### Secrets

Treat the following env vars as secrets and inject them via your platform's secret manager rather than committing them in `.env`:

- `OAUTH_CLIENT_SECRET` — IdP client secret.
- `SERVICE_TOKEN_METRICS` / `SERVICE_TOKEN_BACKUP` — bearer tokens for scrape / sidecar callers. Each min 32 chars; rotate independently.

In compose, prefer `secrets:` files over `environment:` for the values that *are* secrets, so they do not show up in `docker inspect`:

```yaml
services:
  app:
    secrets:
      - oauth_client_secret
    environment:
      OAUTH_CLIENT_SECRET_FILE: /run/secrets/oauth_client_secret

secrets:
  oauth_client_secret:
    file: ./secrets/oauth_client_secret
```

(Wire `*_FILE` reading into your entrypoint, or use Docker Swarm / Kubernetes which read secret files natively.)

### Resource limits and lifecycle

```yaml
services:
  app:
    restart: unless-stopped
    mem_limit: 512m
    cpus: "1.0"
    pids_limit: 256
    healthcheck:
      test: ["CMD", "curl", "-fsS", "http://127.0.0.1:3000/app/api/health"]
      interval: 30s
      timeout: 5s
      start_period: 15s
      retries: 3
    depends_on:
      dex:
        condition: service_healthy
```

Pair `restart: unless-stopped` with the in-image `HEALTHCHECK` and use `depends_on: condition: service_healthy` so the app starts only after dependent services pass their checks.

### Database snapshots

Run an at-least-hourly snapshot sidecar — either `litestream` for continuous replication, or a simple `sqlite3 .backup` cron container that writes to a snapshot volume. Example sidecar:

```yaml
services:
  db-snapshot:
    image: alpine:3
    restart: unless-stopped
    volumes:
      - lode-data:/srv/lode:ro
      - app-snapshots:/snapshots
    entrypoint:
      - /bin/sh
      - -c
      - |
        apk add --no-cache sqlite tini
        while true; do
          ts=$(date -u +%Y%m%dT%H%M%SZ)
          sqlite3 /srv/lode/data/db/app.db ".backup '/snapshots/app-${ts}.db'"
          find /snapshots -name 'app-*.db' -mtime +7 -delete
          sleep 3600
        done
```

For anything past a single-tenant tool, prefer [litestream](https://litestream.io/) replicating to S3-compatible storage.

### Logs volume

Container deployments should normally keep `LOG_TO_STDOUT=true` and let the orchestrator collect logs. If file logs are required, `LOG_FILE` defaults under `DATA_DIR/logs/`; mount separate storage only when log retention must not share space with DB snapshots.

## Logging

Two output modes are supported:

- **File (default)** — `LOG_FILE` controls the destination. Pino writes JSON lines. Rotate with logrotate or your platform's log shipper.
- **Stdout** — set `LOG_TO_STDOUT=true` to write JSON lines to stdout instead of a file. **Recommended for container deployments**: the orchestrator (Docker, Kubernetes) collects stdout, attaches metadata, and ships it onward — no rotate-on-disk required.

Logrotate snippet (for the `LOG_FILE` case). The API holds the log fd open
for its process lifetime; the `SIGHUP` handler in
[`apps/api/src/index.ts`](../../apps/api/src/index.ts) calls
`logger.reopen()` so logrotate's `postrotate` is the correct signal
(`copytruncate` would race with pino's async buffer and lose lines):

```
/srv/lode/data/logs/app.log {
  hourly
  rotate 168
  size 50M
  compress
  delaycompress
  missingok
  notifempty
  create 0600 app app
  postrotate
      pkill -SIGHUP -x app >/dev/null 2>&1 || true
  endscript
}
```

A ready-to-drop example lives at
[`examples/logrotate.d/app`](../../examples/logrotate.d/app); copy it into
`/etc/logrotate.d/app` and adjust paths/user if needed.

## Operations runbook

Day-2 procedures (snapshot restore, audit-log investigation) live in [`operations.md`](operations.md). Bookmark it before you cut over to production.

## Backup & restore

### Database

The DB is a single SQLite file with WAL. Two viable strategies:

1. **`sqlite3 .backup`** — atomic, doesn't block writers. Run out-of-band via cron; pair with `gpg --encrypt` (and a separately-managed key) for off-host snapshots.
2. **[litestream](https://litestream.io/)** — continuous WAL replication to S3-compatible storage. Recommended for anything past a single-tenant tool.

### Application-level export

The `/api/backup/export` admin endpoint produces a JSON dump of selected modules. Import is **schema-version-locked** — see "Upgrade" below.

### Uploaded files

`${FILE_STORAGE_LOCAL_ROOT}` (default `data/uploads/files/`) is plain filesystem storage. Snapshot it together with the DB; orphaned blobs will eventually be reclaimed by the cleanup job, but mismatched DB+disk states will produce dangling references.

## Upgrade playbook

SQLite migrations are embedded in the binary and run on boot. The risky cases:

| Change | Path |
|---|---|
| Add table / add nullable column | Drop in. Bring up new binary; migration auto-runs. |
| Add NOT NULL column with default | Same — defaults apply during migration. |
| Drop or rename column | Stop traffic, snapshot DB, deploy new binary. Drizzle's "create new table + copy + swap" runs at boot; verify size and row count after. |
| Major schema reshuffle | Use `/api/backup/export` (still on old binary), deploy new binary, `/api/backup/import` to a fresh DB. Skip in-place migration entirely. |

Always run a restore drill (export → import on a scratch DB) before a production upgrade — it's the only way to know the schema-version locked import path is still intact.
