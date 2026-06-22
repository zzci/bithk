import { z } from "zod";

const RE_APP_NAME = /^[a-z][a-z0-9-]*$/;

/**
 * Single source of truth for env-derived config. Keep this file
 * focused on the *shape* — the runtime validators (single-user
 * password hash format, OIDC discovery, production sentinels) live in
 * sibling files under `apps/api/src/config/` and are orchestrated by
 * `apps/api/src/config.ts::loadConfig()`.
 *
 * Adding a new variable: declare it here, add a row to
 * `.env.example` (with a description comment so `gen-env-docs`
 * surfaces it), then run `bun run gen:env-docs` to refresh
 * `docs/reference/env-reference.md`. CI's `check:env-docs` will fail if either
 * side is forgotten.
 */
export const configSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default("0.0.0.0"),
  // Base directory for mutable app data. Relative DB/log/upload defaults are
  // anchored here when set. If omitted under lode, LODE_DATA_DIR/data is used
  // by the config loader.
  DATA_DIR: z.string().optional(),
  DB_PATH: z.string().default("data/db/app.db"),
  // Application slug — lowercase letters, digits, dashes. Used as the
  // backup filename prefix, localStorage namespace, etc.
  APP_NAME: z.string().regex(RE_APP_NAME, "APP_NAME must match /^[a-z][a-z0-9-]*$/").default("bit"),
  // Human-readable display name. Server fallback and initial seed for
  // app.display_name; the frontend reads runtime branding from
  // /api/system/branding after startup.
  APP_DISPLAY_NAME: z.string().min(1).default("bit"),
  // URL prefix the app is mounted under. Empty (default) means the app is
  // served at root: SPA at "/" and API at "/api". When set, the value is
  // normalised so "app", "/app", and "/app/" all resolve to "/app".
  BASE_PATH: z.string().default(""),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  LOG_FILE: z.string().default("data/logs/app.log"),
  // When true, write logs to stdout instead of LOG_FILE — preferred for
  // container deployments that capture stdout/stderr at the runtime level.
  LOG_TO_STDOUT: z.enum(["true", "false"]).default("false").transform(v => v === "true"),
  // Level of the per-request "request completed" access line for successful
  // (2xx/3xx) responses. `debug` hides them under the default LOG_LEVEL=info;
  // `silent` drops them entirely. Failure responses always log regardless:
  // 5xx at `error`, 4xx at `warn`.
  HTTP_LOG_LEVEL: z.enum(["debug", "info", "silent"]).default("info"),
  CORS_ORIGIN: z.string().optional(),

  // When true, honour the rightmost `X-Forwarded-For` entry (and, as a
  // fallback only, `X-Real-IP`) for client-IP resolution. Default is false:
  // forwarding headers are ignored and the connection peer IP is used.
  // Only enable behind a sanitising proxy that strips client-supplied
  // forwarding headers. `TRUSTED_PROXY_IPS` further restricts which hop
  // addresses are allowed to set those headers.
  TRUST_PROXY: z.enum(["true", "false"]).default("false").transform(v => v === "true"),

  // Comma-separated CIDR allow-list of proxy peer addresses. Forwarding
  // headers are honoured only when the immediate TCP peer matches one of
  // these ranges. Empty (default) means "any peer is trusted" — equivalent
  // to the pre-`TRUSTED_PROXY_IPS` behaviour. Recommended in production:
  // set this to the load-balancer / ingress subnet (e.g.
  // `10.0.0.0/8,fd00::/8`).
  TRUSTED_PROXY_IPS: z.string().default(""),

  // Cron scheduler gate. When false (default) the Baker timer is NOT
  // allocated and the built-in `log-cleanup` default is NOT auto-seeded.
  // The `/api/cron/*` routes stay mounted in either state — admins can
  // browse, create, edit, and manually trigger jobs while the scheduler
  // is off — and the SPA reads `schedulerEnabled` from
  // `/api/cron/actions` to render a status banner. See
  // `docs/modules/cron.md` § Enabling for the runtime model.
  CRON_ENABLED: z.enum(["true", "false"]).default("false").transform(v => v === "true"),

  // Opt-in list (comma-separated) of cron actions whose `spec.defaultEnabled`
  // is `false`. Each entry is matched against an action's `spec.name`; any
  // listed action is registered and surfaced in the catalog, otherwise it
  // stays unregistered (and existing jobs referencing it fail with
  // `UNKNOWN_ACTION`). Actions that ship with `defaultEnabled: true` (the
  // common case) are always registered regardless of this list.
  //
  // The built-in `shell` action ships with `defaultEnabled: false` because
  // it runs `sh -c <command>` with the API process's UID and has no
  // sandbox — a compromise of one admin account would otherwise pivot to
  // host RCE without operator opt-in. To enable: set
  // `CRON_ACTIONS_ENABLED=shell` (add more names comma-separated as you
  // ship custom actions that follow the same opt-in pattern).
  CRON_ACTIONS_ENABLED: z.string().default("").transform(s =>
    s.split(",").map(x => x.trim()).filter(Boolean),
  ),

  // Allow the `http-request` cron action to reach private / loopback / link-
  // local destinations (`127/8`, `10/8`, `172.16/12`, `192.168/16`,
  // `169.254/16`, `::1`, `fc00::/7`). Default false to block SSRF-style
  // pivots into cloud metadata endpoints and internal services from a
  // compromised admin session. Enable for legitimate internal pings
  // (e.g. talking to a sidecar on `localhost`).
  HTTP_ACTION_ALLOW_PRIVATE: z.enum(["true", "false"]).default("false").transform(v => v === "true"),

  // Per-execution timeout for the `http-request` cron action, in seconds.
  // The fetch is aborted via `AbortSignal.timeout()` after this many
  // seconds — the job log records the abort and the scheduler reclaims
  // the slot. Default 30s mirrors a typical reverse-proxy idle timeout.
  HTTP_ACTION_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(30),

  // Per-execution timeout for the `shell` cron action, in seconds. The
  // child process is killed via `SIGTERM` (then `SIGKILL` after a 5s
  // grace) when exceeded. Default 300s = 5 minutes.
  SHELL_ACTION_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(300),

  // OAuth / OIDC is **runtime config**, not stored in the settings DB —
  // operators set these as env vars (or `OAUTH_ISSUER` + the discovery
  // cache) and the API reads them at boot. `seedSettingsFromEnv` does
  // mirror a subset into the settings table for the admin UI to display,
  // but the runtime path never reads from there.
  OAUTH_CLIENT_ID: z.string().min(1).optional(),
  OAUTH_CLIENT_SECRET: z.string().min(1).optional(),
  OAUTH_ISSUER: z.string().url().optional(),
  OAUTH_AUTHORIZE_URL: z.string().url().optional(),
  OAUTH_TOKEN_URL: z.string().url().optional(),
  OAUTH_USERINFO_URL: z.string().url().optional(),
  OAUTH_PKCE: z.enum(["true", "false"]).default("true").transform(v => v === "true"),

  SESSION_MAX_AGE: z.coerce.number().int().positive().default(86400),

  // Audit retention. 0 = keep forever (default). Otherwise the audit module
  // runs an hourly sweep that drops events older than this many days.
  AUDIT_RETENTION_DAYS: z.coerce.number().int().nonnegative().default(0),

  // Attachment limits — apply to every upload-capable module (documents,
  // issues, …). Single source so per-file caps stay consistent. Expressed in
  // MB for ease of editing; `loadConfig` derives the byte value
  // `MAX_UPLOAD_BYTES` (MB × 1024²) that the rest of the app reads.
  MAX_UPLOAD_MB: z.coerce.number().int().positive().default(200),
  MAX_ATTACHMENTS_PER_RESOURCE: z.coerce.number().int().positive().default(20),
  // Total disk quota across all attachment tables. 0 = unlimited (default).
  // When set and an upload would push usage past this, the request returns
  // 413 PAYLOAD_TOO_LARGE.
  UPLOADS_TOTAL_BYTES: z.coerce.number().int().nonnegative().default(0),

  // ─── File module ─────────────────────────────────────────────────────
  // Storage backend selector. Built-in: `local`. Downstream projects can
  // register additional drivers (e.g. `s3`, `azure-blob`) and switch by
  // changing this value — no fork of the file module required.
  FILE_STORAGE_DRIVER: z.string().min(1).default("local"),
  // On-disk root for the local driver. Resolved against the project root
  // when relative.
  FILE_STORAGE_LOCAL_ROOT: z.string().default("data/uploads/files"),
  // GC mode. `async` (default): `releaseReference` only decrements
  // `ref_count`; a background sweep deletes the blob + the `files` row
  // once a minute. `sync`: the foreground request also performs the
  // driver delete — used by tests and local-only deployments that want
  // immediate disk reclamation.
  FILE_GC_MODE: z.enum(["async", "sync"]).default("async"),
  // Sweep interval for the GC. Set to 0 to disable the periodic sweep
  // entirely (orphans accumulate; admin runs a manual sweep).
  FILE_GC_INTERVAL_SECONDS: z.coerce.number().int().nonnegative().default(3600),
  // When true and the active driver implements `presignDownload`, file
  // downloads 302 to a short-lived signed URL rather than streaming
  // through the API. Per-deployment toggle; setting false forces every
  // download to flow through the API (easier audit / firewall).
  FILE_PRESIGN_ENABLED: z.enum(["true", "false"]).default("true").transform(v => v === "true"),
  // TTL for signed URLs in seconds. Short by design: a leaked URL stays
  // valid only briefly; re-issuing requires the consumer permission hook
  // to pass again.
  FILE_PRESIGN_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  // ─── S3-compatible driver (FILE_STORAGE_DRIVER=s3) ───────────────────
  // Default target is Cloudflare R2. These are read by Bun's native S3 client
  // only when the driver is `s3`; the driver's `setup` validates the required
  // ones (bucket + credentials) and fails fast if missing. Credentials are
  // secrets — never log them.
  // All optional so they don't enlarge the required `Config` shape; the driver
  // applies `region` (default `auto`) and `prefix` (default empty) itself.
  FILE_S3_BUCKET: z.string().optional(),
  // R2 uses the literal region `auto` (the driver's default); set a real region
  // for AWS S3.
  FILE_S3_REGION: z.string().optional(),
  // Account endpoint, e.g. https://<account>.r2.cloudflarestorage.com for R2,
  // or a MinIO URL. Omit for AWS S3 (derived from the region).
  FILE_S3_ENDPOINT: z.string().optional(),
  FILE_S3_ACCESS_KEY_ID: z.string().optional(),
  FILE_S3_SECRET_ACCESS_KEY: z.string().optional(),
  // Optional key prefix applied to every object (a folder within the bucket).
  FILE_S3_PREFIX: z.string().optional(),
  // Grace period (hours) before the S3 orphan sweep deletes an object that has
  // no `files` row — i.e. a presigned direct upload that never confirmed.
  // Default 24h (applied in the sweep); keep it well above a realistic upload
  // time so an in-flight confirm is never raced.
  FILE_S3_ORPHAN_TTL_HOURS: z.coerce.number().int().positive().optional(),
  // ─── Image preview cache (FEAT-044, Part C) ───
  // Inline image requests with `?thumb=<w>` are served as cached WebP
  // thumbnails (generated by Bun.Image), same-origin and immutable — so the
  // file grid doesn't refetch full-resolution images, and S3 isn't hit per
  // preview. Set to "false" to disable; default on. Content-addressed cache
  // keys never invalidate.
  FILE_PREVIEW_CACHE_ENABLED: z.enum(["true", "false"]).optional(),
  // On-disk root for the thumbnail cache; default `data/uploads/preview-cache`.
  // It is just a cache — safe to clear.
  FILE_PREVIEW_CACHE_DIR: z.string().optional(),

  DEFAULT_ADMIN: z.string().default(""),

  // ─── Single-user mode (OAuth bypass) ─────────────────────────────────
  // When true the app stops requiring an OIDC provider and authenticates
  // against the SINGLE_USER_USERNAME / SINGLE_USER_PASSWORD_HASH pair set
  // here. Registration and password change are not exposed. Generate the
  // hash with `bun run hash-password`.
  SINGLE_USER_MODE: z.enum(["true", "false"]).default("false").transform(v => v === "true"),
  SINGLE_USER_USERNAME: z.string().min(1).optional(),
  // Inline hash. Bun dotenv expands `$VAR` (even in single quotes), so the
  // `$` separators in argon2id / bcrypt / pbkdf2 hashes must be escaped.
  // Prefer SINGLE_USER_PASSWORD_HASH_FILE for the common case — that path
  // avoids the dotenv parser entirely.
  SINGLE_USER_PASSWORD_HASH: z.string().min(1).optional(),
  // Path to a file containing the hash. First non-blank line wins. If the
  // line is in htpasswd `user:hash` form, the prefix up to and including
  // the first `:` is stripped — so `htpasswd -B -n admin > file` works
  // without any post-processing.
  SINGLE_USER_PASSWORD_HASH_FILE: z.string().min(1).optional(),
  SINGLE_USER_NAME: z.string().min(1).optional(),
  SINGLE_USER_EMAIL: z.string().email().optional(),

  APP_URL: z.string().url().optional(),
  OIDC_LOGOUT_URL: z.string().url().optional(),

  // Bearer tokens for non-interactive tooling. Each scope is independent so
  // a leaked metrics scraper credential cannot also dump the database.
  // Constant-time compare; min length forces a real value.
  SERVICE_TOKEN_METRICS: z.string().min(32).optional(),
  SERVICE_TOKEN_BACKUP: z.string().min(32).optional(),

  // Minimum seconds between consecutive successful
  // `/api/backup/export-via-token` calls. Throttles a leaked backup token
  // from being turned into a DOS lever (repeated full-DB reads amplify
  // WAL pressure). Default 300s = 5 minutes; pair with a per-token
  // in-flight semaphore enforced at the route layer.
  BACKUP_EXPORT_MIN_INTERVAL_SECONDS: z.coerce.number().int().nonnegative().default(300),

  // TTL for server-side backup staging entries under
  // `${DATA_DIR}/backup-staging/` (v2 export archives never downloaded,
  // staged imports never applied, tmp debris from crashed jobs). A sweep
  // runs on boot and hourly, deleting entries whose mtime is older than
  // this many hours.
  BACKUP_STAGING_TTL_HOURS: z.coerce.number().int().positive().default(24),

  // Compressed-size cap for backup v2 import uploads, enforced on
  // Content-Length and on counted bytes while streaming (the header can
  // lie). Default 2 GiB.
  BACKUP_IMPORT_MAX_ARCHIVE_BYTES: z.coerce.number().int().positive().default(2 * 1024 * 1024 * 1024),

  // Per-blob-entry cap inside an imported backup v2 archive. Keep at or
  // above MAX_UPLOAD_BYTES so any legitimately uploaded blob re-imports.
  // Default 256 MiB.
  BACKUP_IMPORT_MAX_BLOB_BYTES: z.coerce.number().int().positive().default(256 * 1024 * 1024),
});

type ParsedEnv = z.infer<typeof configSchema>;

// The MB-denominated `MAX_UPLOAD_MB` env knob is converted by `loadConfig` into
// the derived `MAX_UPLOAD_BYTES` (in bytes) that the rest of the app consumes.
export type Config = Omit<ParsedEnv, "MAX_UPLOAD_MB"> & { readonly MAX_UPLOAD_BYTES: number };
