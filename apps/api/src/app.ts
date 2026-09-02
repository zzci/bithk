import type { Config } from "./config";
import type { AppDatabase } from "./db";
import type { Logger } from "./shared/lib/logger";
import type { AppEnv } from "./shared/lib/types";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";
import { loadConfig } from "./config";
import { createDb } from "./db";
import { logDefaultAdmins } from "./modules/account/auth/auth.service";
import { startAuditRetentionSweep } from "./modules/audit";
import { startBackupStagingSweep } from "./modules/backup";
import { initCronActions, startCron } from "./modules/cron";
import { initFileModule, repairEmptyFileMimetypes, startFileGcSweep } from "./modules/file";
import { s3PublicOrigin } from "./modules/file/storage/s3";
import { startNotificationConsumers } from "./modules/notification";
import { getAllRouteBindings, policyMiddleware } from "./modules/policy";
import { backfillProjectRoles } from "./modules/project/project.roles";
import { protectedRoutes, publicRoutes } from "./routes";
import { getAuthConfig, seedSettingsFromEnv } from "./shared/lib/app-config";
import { createLogger } from "./shared/lib/logger";
import { csrfGuard } from "./shared/middleware/csrf";
import { errorHandler } from "./shared/middleware/error-handler";
import { loggingMiddleware } from "./shared/middleware/logging";
import { propagateRequestId } from "./shared/middleware/request-id";
import { hasStaticAssets, serveStaticAssets } from "./shared/middleware/static";

// ─── Types ───

interface AppDeps {
  readonly config: Config;
  readonly db: AppDatabase;
  readonly logger: Logger;
}

export interface BootstrapResult {
  readonly fetch: (req: Request, env?: Record<string, unknown>) => Response | Promise<Response>;
  readonly config: Config;
  readonly logger: Logger;
  /** Open database handle. Used for the lode readiness probe and checkpoint. */
  readonly db: AppDatabase;
  /** Close DB connection. Call on shutdown. */
  readonly closeDb: () => Promise<void>;
}

// ─── Bootstrap ───

/**
 * Bootstrap the application: load config, open the database, build the
 * fetch handler. Used by both index.ts (production) and dev.ts (Vite).
 */
export async function bootstrap(): Promise<BootstrapResult> {
  const config = await loadConfig();
  const logger = createLogger(config);
  const db = await createDb(config.DB_PATH);
  const backfill = await backfillProjectRoles(db);
  logger.info(`backfillProjectRoles: scanned=${backfill.projectsScanned} touched=${backfill.projectsTouched} inserted=${backfill.rolesInserted}`);
  const app = await buildFullApp({ config, db, logger });
  logDefaultAdmins(await getAuthConfig(db, config), logger);
  logger.info("system fully operational");

  return {
    fetch: (req, env) => app.fetch(req, env),
    config,
    logger,
    db,
    closeDb: () => Promise.resolve(db.close()),
  };
}

// ─── Offline runtime ───

/**
 * Wire the minimal runtime the CLI needs for offline backup import/export:
 * an open, migrated database and a selected file-storage driver. No
 * background workers (audit/backup-staging/file-GC sweeps, cron) and no HTTP
 * server are started, so the offline commands cannot race those sweeps.
 *
 * Module backup-registrations (`registerBackupContribution`) are an import
 * side-effect of this file's barrel imports, so importing `app.ts` already
 * populates every module's contribution — no explicit registration here.
 */
export async function wireRuntime(
  config: Config,
  logger: Logger,
): Promise<{ db: AppDatabase; close: () => Promise<void> }> {
  const db = await createDb(config.DB_PATH); // createDb migrates
  await initFileModule(config, db); // wires storage drivers from DB config (needed even with 0 blobs)
  logger.debug("wireRuntime: offline runtime initialized (no workers, no server)");
  return { db, close: () => Promise.resolve(db.close()) };
}

// ─── Shared installers ───

// CORS_ORIGIN may be a comma-separated list. In development with no value,
// allow same-origin requests (any host) — dev usually goes through nsl which
// proxies to the SPA's vite port and the API's bun port under one host.
function resolveCorsOrigin(config: Config): string | string[] {
  if (config.CORS_ORIGIN) {
    const list = config.CORS_ORIGIN.split(",").map(s => s.trim()).filter(Boolean);
    return list.length === 1 ? list[0]! : list;
  }
  return config.NODE_ENV === "production" ? "" : "*";
}

function installCommonMiddleware(
  api: Hono<AppEnv>,
  { config, logger, db }: { config: Config; logger: Logger; db: AppDatabase },
): void {
  // Hono's `requestId()` accepts an inbound `X-Request-Id` (when present
  // and well-formed) and otherwise mints a UUID. `propagateRequestId`
  // echoes that value as an outgoing `X-Request-Id` response header so a
  // user-reported failure can be matched against the log line. Outbound
  // service callers (OIDC discovery, cron http-request) read the value
  // from `c.get("requestId")` and forward it as their own header.
  api.use("*", requestId());
  api.use("*", propagateRequestId);
  api.use("*", cors({ origin: resolveCorsOrigin(config) }));
  api.use("*", (c, next) => {
    c.set("db", db);
    c.set("config", config);
    c.set("logger", logger);
    return next();
  });
  api.use("*", loggingMiddleware(config.HTTP_LOG_LEVEL));
  api.use("*", csrfGuard);
  // Global policy enforcement: every route declared in any module's
  // `defineResource.routes` is auto-gated. Undeclared routes pass
  // through; admin actors bypass before any DB query. See
  // docs/develop/module/policy-standard.md.
  api.use("*", policyMiddleware({ basePath: `${config.BASE_PATH}/api` }));
}

// ─── Full App ───

export async function buildFullApp({ config, db, logger }: AppDeps) {
  const api = new Hono<AppEnv>();
  installCommonMiddleware(api, { config, logger, db });

  await seedSettingsFromEnv(db, config);
  startAuditRetentionSweep(db, config, logger);
  startBackupStagingSweep(config, logger);
  await initFileModule(config, db);
  // Heal pre-FIX-063 rows whose multipart upload lost its Content-Type —
  // idempotent, and a no-op single query once history is repaired.
  const mimeRepair = await repairEmptyFileMimetypes(db);
  logger.info(`repairEmptyFileMimetypes: scanned=${mimeRepair.scanned} repaired=${mimeRepair.repaired}`);
  startFileGcSweep(db, config, logger);
  // Actions catalog is always populated so admins can plan jobs even
  // with the scheduler off. `startCron` allocates Baker and starts
  // firing ticks — only run it when the operator opts in. Actions whose
  // `spec.defaultEnabled` is `false` (e.g. `shell` — sh -c, no sandbox;
  // treat the registry as a host root crontab) need an explicit opt-in
  // via `CRON_ACTIONS_ENABLED`.
  initCronActions({ enabledActions: config.CRON_ACTIONS_ENABLED });
  if (config.CRON_ENABLED) {
    await startCron({ db, logger, config });
  }
  // Notification emails ride the audit stream (FEAT-059); mail itself is
  // gated by the `smtp.enabled` setting, so subscribing is always safe.
  startNotificationConsumers(config);

  api.route("/", publicRoutes());
  api.route("/", protectedRoutes());

  // Fail closed at boot: protected modules register their object-level
  // policy bindings as an import side-effect of the `protectedRoutes()`
  // mount above. An empty registry means `policyMiddleware` would fall
  // through every request unauthorized — a catastrophic silent bypass.
  // Assert here (before serving) rather than letting it degrade at runtime.
  if (getAllRouteBindings().length === 0) {
    throw new Error(
      "[policy] no route bindings registered after mounting protectedRoutes() — "
      + "policy enforcement would fail open. This is a wiring bug (a module's "
      + "defineResource() side-effect did not run).",
    );
  }

  api.onError(errorHandler);

  return buildOuterApp(api, config);
}

// ─── Outer shell ───

export function buildOuterApp(api: Hono<AppEnv>, config: Config) {
  const app = new Hono<AppEnv>();
  const base = config.BASE_PATH;

  // Security headers for every response (API JSON + static SPA HTML/JS/CSS).
  // SPA bundles are hashed under BASE_PATH; styles need 'unsafe-inline' for
  // Tailwind v4 + base-ui runtime style injection. img data:/blob: covers
  // QR codes and inline SVGs. frame-ancestors 'self' lets the SPA preview
  // PDFs via same-origin <iframe>. HSTS auto-enables when APP_URL is
  // https — a direct deployment without a reverse proxy still gets it.
  const hstsEnabled = config.APP_URL?.startsWith("https://") ?? false;
  // Presigned direct uploads (browser PUT) and presigned-GET previews point
  // the browser at the S3 endpoint, so its origin must be a valid CSP source
  // (FIX-065). Storage config is DB-held and hot-reloadable, so the origin is
  // resolved PER REQUEST from the live driver state; while S3 is unconfigured
  // it degrades to a harmless duplicate 'self'.
  const s3Origin = (): string => s3PublicOrigin() ?? "'self'";
  app.use("*", secureHeaders({
    referrerPolicy: "strict-origin-when-cross-origin",
    crossOriginOpenerPolicy: "same-origin",
    crossOriginResourcePolicy: "same-origin",
    xFrameOptions: "SAMEORIGIN",
    xContentTypeOptions: "nosniff",
    xDownloadOptions: "noopen",
    permissionsPolicy: {
      camera: [],
      microphone: [],
      geolocation: [],
      payment: [],
    },
    strictTransportSecurity: hstsEnabled ? "max-age=15552000; includeSubDomains" : false,
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      // tally.so: anonymous feedback widget (script + popup iframe) wired to
      // the sidebar feedback button.
      scriptSrc: ["'self'", "https://tally.so"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:", s3Origin],
      fontSrc: ["'self'", "data:"],
      // blob: lets pdf.js fetch the PDF preview's object URL (react-pdf hands
      // it a blob: URL, which pdf.js loads via fetch()). CSP3 does not match
      // blob: against 'self', so it must be listed explicitly — same reason
      // img-src already enumerates blob:.
      connectSrc: ["'self'", "blob:", s3Origin],
      mediaSrc: ["'self'", "blob:", s3Origin],
      frameAncestors: ["'self'"],
      frameSrc: ["'self'", "blob:", "https://tally.so", s3Origin],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      objectSrc: ["'none'"],
    },
  }));

  // When BASE_PATH is set, redirect bare "/" to "${base}/" so a request to the
  // origin lands on the SPA. With no base the SPA already owns "/" — skip the
  // redirect to avoid a self-loop.
  if (base !== "") {
    app.get("/", (c) => {
      return c.html(`<meta http-equiv="refresh" content="0;url=${base}/">`);
    });
  }

  app.route(`${base}/api`, api);
  if (hasStaticAssets()) {
    app.get(`${base}/*`, serveStaticAssets(base));
  }

  return app;
}
