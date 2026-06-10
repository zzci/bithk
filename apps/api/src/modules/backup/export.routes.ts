import type { ProtectedEnv } from "@/shared/lib/types";
import { Hono } from "hono";
import { z } from "zod";
import { audit } from "@/modules/audit/audit.service";
import { getClientIp } from "@/shared/lib/client-ip";
import { buildContentDisposition } from "@/shared/lib/content-disposition";
import { AppError } from "@/shared/lib/errors";
import { adminRequired, authRequired } from "@/shared/middleware/auth";
import { serviceTokenRequired } from "@/shared/middleware/service-token";
import { streamJsonBackup } from "./export.service";
import { getDataModules, getModuleNames } from "./registry";
import { redactSecretFields } from "./secret-fields";

// Per-token in-flight semaphore + minimum-interval gate. A leaked
// backup token must not double as a DOS lever: each token can have
// at most one streaming export in progress at a time, and successive
// successful exports are spaced at least `BACKUP_EXPORT_MIN_INTERVAL_SECONDS`
// apart. State is process-local — for HA pairs, set the env var on every
// replica. Exported because the v2 token job trigger
// (`export-v2-token.routes.ts`) shares the SAME gates: one token, one
// export pipeline, regardless of format version.
export const backupExportInFlight = new Set<string>();
export const backupExportLastSuccess = new Map<string, number>();
const RE_NON_ALNUM = /\W+/g;

export function tokenBucketKey(token: string): string {
  return `t:${token.slice(0, 8).replace(RE_NON_ALNUM, "_")}`;
}

const RE_TIMESTAMP_CHARS = /[:.]/g;

// `streamJsonBackup` enqueues each row as one complete chunk — `JSON.stringify(row)`,
// optionally prefixed with a `,` separator — and emits the structural scaffolding
// (`{...,"tables":{`, `"name":[`, `]`, `}}`) as its own chunks. A default stream
// reader preserves those enqueue boundaries, so we redact one chunk at a time:
// strip the optional leading separator, require a complete `{...}` object, redact,
// and re-serialize. Non-object (structural) chunks pass through untouched.
function redactBackupChunk(chunk: string): string {
  const sep = chunk.startsWith(",") ? "," : "";
  const body = sep ? chunk.slice(1) : chunk;
  if (!body.startsWith("{") || !body.endsWith("}"))
    return chunk;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  }
  catch {
    return chunk;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
    return chunk;
  return sep + JSON.stringify(redactSecretFields(parsed));
}

export function backupExportRoutes() {
  const router = new Hono<ProtectedEnv>();

  // Service-token export — for automated sidecar / cron jobs. Skips the
  // session-cookie + DEK-challenge dance (the sidecar has no master
  // password) and instead trusts a long-lived bearer issued out-of-band.
  //
  // BLAST RADIUS: this bearer is a single static secret with NO per-request
  // identity. Whoever holds it can call this route, so it is hardened two ways:
  //   1. The export is REDACTED — secret-typed fields (cron task config,
  //      share/session/TOTP/PKCE credentials; see `SECRET_FIELD_NAMES`) are
  //      stripped, so a leaked token cannot exfiltrate live credentials.
  //   2. The request MUST name an explicit module scope; an unscoped request
  //      FAILS CLOSED (403). There is no implicit "export everything" default.
  // The session-authed `/backup/export` below stays UNREDACTED — it is the
  // restore-complete path, gated by an admin session + DEK challenge.
  // REMAINING: binding the allowed module scope to the token itself (so the
  // sidecar token cannot request modules it was never granted) needs a config
  // schema change (per-token scope storage) and is out of this lane.
  router.post("/backup/export-via-token", serviceTokenRequired("backup"), async (c) => {
    const db = c.get("db");
    const config = c.get("config");

    const authz = c.req.header("authorization") ?? "";
    const token = authz.startsWith("Bearer ") ? authz.slice(7) : "";
    const bucket = tokenBucketKey(token);

    // Scope enforcement — FAIL CLOSED. The caller must name the modules to
    // export; a missing/empty/invalid-JSON body is treated as "no scope" and
    // rejected so a token can never trigger a blanket full-DB dump.
    let requestedModules: string[] | undefined;
    try {
      const parsed = z.object({ modules: z.array(z.string()).min(1) }).safeParse(await c.req.json());
      if (parsed.success)
        requestedModules = parsed.data.modules;
    }
    catch {
      // No body / non-JSON body → unscoped.
    }
    if (!requestedModules) {
      await audit(db, c.get("logger"), {
        actorId: "system",
        actorName: "system:backup-sidecar",
        action: "backup.export",
        resourceType: "system",
        resourceId: "database",
        resourceName: "database-backup-export",
        detail: { reason: "unscoped" },
        ip: getClientIp(c),
        userAgent: c.req.header("user-agent") ?? "service-token",
        result: "failure",
      });
      return c.json({ success: false, error: { code: "SCOPE_REQUIRED", message: "A non-empty module scope is required for token export." } }, 403);
    }

    const known = new Set(getModuleNames());
    const invalidModules = requestedModules.filter(m => !known.has(m));
    if (invalidModules.length > 0) {
      return c.json({ success: false, error: { code: "INVALID_MODULES", message: `Unknown modules: ${invalidModules.join(", ")}` } }, 400);
    }

    // Already streaming for this token → reject loudly so a misbehaving
    // sidecar cannot run 10 exports in parallel and pin the WAL.
    if (backupExportInFlight.has(bucket)) {
      c.header("Retry-After", "60");
      await audit(db, c.get("logger"), {
        actorId: "system",
        actorName: "system:backup-sidecar",
        action: "backup.export",
        resourceType: "system",
        resourceId: "database",
        resourceName: "database-backup-export",
        detail: { reason: "in-flight" },
        ip: getClientIp(c),
        userAgent: c.req.header("user-agent") ?? "service-token",
        result: "failure",
      });
      return c.json({ success: false, error: { code: "RATE_LIMITED", message: "Another export is in progress for this token." } }, 429);
    }

    // Min-interval gate. Counted from the moment the previous export
    // returned a response — leaves the WAL room to be reclaimed.
    const minIntervalMs = config.BACKUP_EXPORT_MIN_INTERVAL_SECONDS * 1000;
    if (minIntervalMs > 0) {
      const last = backupExportLastSuccess.get(bucket);
      if (last !== undefined) {
        const elapsed = Date.now() - last;
        if (elapsed < minIntervalMs) {
          const retryAfter = Math.ceil((minIntervalMs - elapsed) / 1000);
          c.header("Retry-After", String(retryAfter));
          await audit(db, c.get("logger"), {
            actorId: "system",
            actorName: "system:backup-sidecar",
            action: "backup.export",
            resourceType: "system",
            resourceId: "database",
            resourceName: "database-backup-export",
            detail: { reason: "min-interval", retryAfter },
            ip: getClientIp(c),
            userAgent: c.req.header("user-agent") ?? "service-token",
            result: "failure",
          });
          return c.json({ success: false, error: { code: "RATE_LIMITED", message: `Backup export throttled. Retry after ${retryAfter}s.` } }, 429);
        }
      }
    }

    const { modules, body } = streamJsonBackup(db, requestedModules);
    const timestamp = new Date().toISOString().replace(RE_TIMESTAMP_CHARS, "-").slice(0, 19);
    // Audit is critical for this data-exfiltrating action: a failed write
    // re-throws. Mark in-flight only after it succeeds so a thrown audit
    // never leaks the semaphore (the marker is released when the stream
    // below drains, which would never start on a throw here).
    await audit(db, c.get("logger"), {
      actorId: "system",
      actorName: "system:backup-sidecar",
      action: "backup.export",
      resourceType: "system",
      resourceId: "database",
      resourceName: "database-backup-export",
      detail: { modules, via: "service-token", redacted: true },
      ip: getClientIp(c),
      userAgent: c.req.header("user-agent") ?? "service-token",
      result: "success",
    }, { critical: true });
    backupExportInFlight.add(bucket);
    backupExportLastSuccess.set(bucket, Date.now());
    // Clear the in-flight marker after the stream actually drains. We
    // wrap the underlying ReadableStream so a client disconnect mid-
    // stream still releases the semaphore — and redact secret-typed
    // fields chunk-by-chunk as the rows stream out.
    const released = new ReadableStream({
      async start(controller) {
        const reader = body.getReader();
        const dec = new TextDecoder();
        const enc = new TextEncoder();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done)
              break;
            controller.enqueue(enc.encode(redactBackupChunk(dec.decode(value))));
          }
          controller.close();
        }
        catch (err) {
          controller.error(err);
        }
        finally {
          backupExportInFlight.delete(bucket);
        }
      },
      cancel() {
        backupExportInFlight.delete(bucket);
      },
    });
    return new Response(released, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": buildContentDisposition("attachment", `${c.get("config").APP_NAME}-backup-${timestamp}.json`),
        "Cache-Control": "no-store",
        "Pragma": "no-cache",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });

  // Everything else under this router is session-auth gated.
  router.use("*", authRequired);

  router.get("/backup/modules", adminRequired, (c) => {
    const registry = getDataModules();
    return c.json({
      modules: getModuleNames().map(name => ({
        name,
        deps: registry[name]!.deps,
      })),
    });
  });

  router.post("/backup/export", adminRequired, async (c) => {
    const db = c.get("db");
    const user = c.get("user");

    const bodySchema = z.object({
      modules: z.array(z.string()).min(1),
    });
    const body = bodySchema.parse(await c.req.json());

    const known = new Set(getModuleNames());
    const invalidModules = body.modules.filter(m => !known.has(m));
    if (invalidModules.length > 0) {
      throw new AppError(`Unknown modules: ${invalidModules.join(", ")}`, 400, "INVALID_MODULES");
    }

    const { modules, body: stream } = streamJsonBackup(db, body.modules);
    const timestamp = new Date().toISOString().replace(RE_TIMESTAMP_CHARS, "-").slice(0, 19);

    // Emit the audit row before the stream starts — once the response body
    // begins flowing, the request is committed; failure mid-stream still
    // wants the "export attempted" row in the audit log.
    await audit(db, c.get("logger"), {
      actorId: user.id,
      actorName: user.name,
      action: "backup.export",
      resourceType: "system",
      resourceId: "database",
      resourceName: "database-backup-export",
      detail: { modules },
      ip: getClientIp(c),
      userAgent: c.req.header("user-agent") ?? "unknown",
      result: "success",
    }, { critical: true });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": buildContentDisposition("attachment", `${c.get("config").APP_NAME}-backup-${timestamp}.json`),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });

  return router;
}
