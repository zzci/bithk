import type { ProtectedEnv } from "@/shared/lib/types";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { sessions } from "@/modules/account/auth/schema";
import { getRequestUserModules } from "@/modules/account/groups/module-gate";
import { userPreferences, users } from "@/modules/account/users/schema";
import { audit } from "@/modules/audit/audit.service";
import { getClientIp } from "@/shared/lib/client-ip";
import { AppError, NotFoundError, UnauthorizedError } from "@/shared/lib/errors";
import { describeRoute, ErrorEnvelope, onValidationFailure, resolver, validator } from "@/shared/lib/openapi";
import { adminRequired, authRequired } from "@/shared/middleware/auth";
import { rateLimit } from "@/shared/middleware/rate-limit";
import {
  confirmTotpDevice,
  createTotpDevice,
  deleteTotpDevice,
  hasVerifiedTotp,
  issueStepUpToken,
  listTotpDevices,
  validateStepUpToken,
  verifyTotpCode,
} from "./totp.service";
import {
  assertNotLastActiveAdmin,
  createVirtualUser,
  deleteVirtualUser,
  getUserById,
  getUserGroups,
  listActiveUsers,
  listAssignableUsers,
  listUsers,
  updateUser,
  updateVirtualUser,
} from "./users.service";

const listQuerySchema = z.object({
  q: z.string().max(200).optional(),
  role: z.enum(["admin", "user"]).optional(),
  status: z.enum(["active", "disabled"]).optional(),
  group_id: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// `username` matches the virtual-user create rule: lowercase handle of
// [a-z0-9_.-]. `name` is editable for every user; `username`/`email` are only
// honoured for virtual targets (the handler rejects them for real users, whose
// identity is owned by the IdP).
const usernameSchema = z.string().min(1).max(100).regex(/^[a-z0-9_.-]+$/);

const updateBodySchema = z.object({
  role: z.enum(["admin", "user"]).optional(),
  status: z.enum(["active", "disabled"]).optional(),
  name: z.string().min(1).max(255).optional(),
  username: usernameSchema.optional(),
  email: z.string().email().max(255).optional(),
}).refine(
  d => d.role !== undefined || d.status !== undefined || d.name !== undefined || d.username !== undefined || d.email !== undefined,
  { message: "At least one of role, status, name, username or email must be provided" },
);

const createVirtualUserSchema = z.object({
  username: usernameSchema,
  name: z.string().min(1).max(255),
  email: z.string().email().max(255).optional(),
});

const idParamSchema = z.object({ id: z.string() });
const deviceIdParamSchema = z.object({ deviceId: z.string() });

// Response `data` shapes for the OpenAPI spec.
const userColumnsSchema = z.object({
  id: z.string(),
  username: z.string(),
  name: z.string(),
  email: z.string(),
  avatar: z.string().nullable(),
  role: z.string(),
  status: z.string(),
  isVirtual: z.boolean(),
  lastLoginAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const userGroupSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  createdAt: z.string(),
  joinedAt: z.string(),
});
const meSchema = z.object({
  id: z.string(),
  username: z.string(),
  name: z.string(),
  email: z.string(),
  avatar: z.string().nullable(),
  role: z.string(),
  status: z.string(),
  lastLoginAt: z.string().nullable(),
  createdAt: z.string(),
  groups: z.array(userGroupSchema),
  modules: z.array(z.string()),
});
const pickerUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  username: z.string(),
  isVirtual: z.boolean().optional(),
});
const totpDeviceSchema = z.object({
  id: z.string(),
  name: z.string(),
  verified: z.boolean(),
  createdAt: z.string(),
});
const preferenceSchema = z.object({ key: z.string(), value: z.unknown() }).nullable();

// `{ success:true, data }` response doc for `schema`.
function okJson(schema: z.ZodType, description = "Success") {
  return { description, content: { "application/json": { schema: resolver(z.object({ success: z.literal(true), data: schema })) } } };
}
const errorJson = { content: { "application/json": { schema: resolver(ErrorEnvelope) } } };

export function userRoutes() {
  const router = new Hono<ProtectedEnv>();

  router.use("*", authRequired);

  // ── /me — current user endpoints ──

  router.get(
    "/account/me",
    describeRoute({
      tags: ["account"],
      summary: "Current user profile, groups and visible modules",
      responses: { 200: okJson(meSchema), 401: { description: "Unauthenticated", ...errorJson } },
    }),
    async (c) => {
      const db = c.get("db");
      const user = c.get("user");
      const [userGroupsList, modules] = await Promise.all([
        getUserGroups(db, user.id),
        getRequestUserModules(c, user),
      ]);

      return c.json({
        success: true,
        data: {
          id: user.id,
          username: user.username,
          name: user.name,
          email: user.email,
          avatar: user.avatar,
          role: user.role,
          status: user.status,
          lastLoginAt: user.lastLoginAt,
          createdAt: user.createdAt,
          groups: userGroupsList,
          // Visible modules (PLAN-076): admins get every key, everyone else
          // their global role's set. The web shell derives nav from this.
          modules,
        },
      });
    },
  );

  router.get(
    "/account/me/groups",
    describeRoute({
      tags: ["account"],
      summary: "Current user's groups",
      responses: { 200: okJson(z.array(userGroupSchema)), 401: { description: "Unauthenticated", ...errorJson } },
    }),
    async (c) => {
      const db = c.get("db");
      const user = c.get("user");
      const userGroupsList = await getUserGroups(db, user.id);
      return c.json({ success: true, data: userGroupsList });
    },
  );

  router.get(
    "/account/me/preferences/:key",
    describeRoute({
      tags: ["account"],
      summary: "Read a preference value",
      responses: { 200: okJson(preferenceSchema), 401: { description: "Unauthenticated", ...errorJson } },
    }),
    validator("param", z.object({ key: z.string() }), onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const user = c.get("user");
      const { key } = c.req.valid("param");

      const row = await db.select()
        .from(userPreferences)
        .where(and(eq(userPreferences.userId, user.id), eq(userPreferences.key, key)))
        .get();

      return c.json({ success: true, data: row ? { key: row.key, value: row.value } : null });
    },
  );

  const preferenceBodySchema = z.object({
    // value may be any JSON-serialisable shape; we only require an object body
    // with a `value` field — null/array/scalar root bodies are rejected.
    value: z.unknown(),
  }).strict();

  // Storage-abuse bounds for `PUT /account/me/preferences/:key`: cap the key
  // length and the serialized value size before the upsert so an authenticated
  // user cannot write unbounded preference blobs.
  const MAX_PREFERENCE_KEY_LENGTH = 200;
  const MAX_PREFERENCE_VALUE_BYTES = 64 * 1024;
  const preferenceKeySchema = z.string().min(1).max(MAX_PREFERENCE_KEY_LENGTH);

  router.put(
    "/account/me/preferences/:key",
    describeRoute({
      tags: ["account"],
      summary: "Upsert a preference value",
      responses: { 200: okJson(z.null()), 401: { description: "Unauthenticated", ...errorJson }, 413: { description: "Value too large", ...errorJson }, 422: { description: "Validation error", ...errorJson } },
    }),
    validator("param", z.object({ key: preferenceKeySchema }), onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const user = c.get("user");
      const { key } = c.req.valid("param");

      let raw: unknown;
      try {
        raw = await c.req.json();
      }
      catch {
        throw new AppError("Invalid JSON body", 422, "VALIDATION_ERROR");
      }
      if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
        throw new AppError("Body must be a JSON object with a `value` field", 422, "VALIDATION_ERROR");
      }
      const body = preferenceBodySchema.parse(raw);
      const value = typeof body.value === "string" ? body.value : JSON.stringify(body.value);
      if (new TextEncoder().encode(value).length > MAX_PREFERENCE_VALUE_BYTES)
        throw new AppError("Preference value too large", 413, "PREFERENCE_TOO_LARGE");

      await db.insert(userPreferences).values({
        userId: user.id,
        key,
        value,
        updatedAt: new Date().toISOString(),
      }).onConflictDoUpdate({
        target: [userPreferences.userId, userPreferences.key],
        set: { value, updatedAt: new Date().toISOString() },
      }).run();

      return c.json({ success: true, data: null });
    },
  );

  // ── /me/totp — TOTP device management ──

  router.get(
    "/account/me/totp",
    describeRoute({
      tags: ["account"],
      summary: "List the caller's TOTP devices",
      responses: { 200: okJson(z.array(totpDeviceSchema)), 401: { description: "Unauthenticated", ...errorJson } },
    }),
    async (c) => {
      const db = c.get("db");
      const user = c.get("user");
      const devices = await listTotpDevices(db, user.id);
      return c.json({ success: true, data: devices });
    },
  );

  router.post(
    "/account/me/totp",
    describeRoute({
      tags: ["account"],
      summary: "Enroll a new TOTP device",
      responses: { 201: okJson(z.object({ id: z.string(), name: z.string(), secret: z.string(), uri: z.string(), qrCode: z.string() }), "Created"), 401: { description: "Unauthenticated", ...errorJson }, 422: { description: "Validation error", ...errorJson } },
    }),
    validator("json", z.object({ name: z.string().min(1).max(100) }), onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const config = c.get("config");
      const user = c.get("user");
      const body = c.req.valid("json");
      const result = await createTotpDevice(db, user.id, body.name, user.username, config.APP_DISPLAY_NAME);
      await audit(db, c.get("logger"), {
        actorId: user.id,
        actorName: user.name,
        action: "totp.device.created",
        resourceType: "totp_device",
        resourceId: result.id,
        resourceName: body.name,
        ip: getClientIp(c),
        userAgent: c.req.header("user-agent") ?? "unknown",
        result: "success",
      });
      return c.json({ success: true, data: result }, 201);
    },
  );

  router.post(
    "/account/me/totp/:deviceId/confirm",
    describeRoute({
      tags: ["account"],
      summary: "Confirm (verify) a TOTP device",
      responses: { 200: okJson(z.null()), 400: { description: "Invalid code or device", ...errorJson }, 401: { description: "Step-up required", ...errorJson }, 422: { description: "Validation error", ...errorJson }, 429: { description: "Rate limited", ...errorJson } },
    }),
    rateLimit({ windowMs: 5 * 60 * 1000, max: 10, bucket: "totp-stepup" }),
    validator("param", deviceIdParamSchema, onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const user = c.get("user");
      const { deviceId } = c.req.valid("param");

      // Bootstrap exception: if the user has no verified device yet, the very
      // first confirm has nothing to step up against. Once any device is
      // verified, every subsequent confirm requires a fresh step-up token so an
      // attacker who hijacks a session cannot enroll their own device.
      const alreadyHasTotp = await hasVerifiedTotp(db, user.id);
      if (alreadyHasTotp) {
        const header = c.req.header("x-totp-token");
        if (!header || !validateStepUpToken(header, user.id)) {
          throw new UnauthorizedError("STEP_UP_REQUIRED");
        }
      }

      const body = z.object({ code: z.string().length(6) }).parse(await c.req.json());
      const ok = await confirmTotpDevice(db, deviceId, user.id, body.code);
      if (!ok) {
        await audit(db, c.get("logger"), {
          actorId: user.id,
          actorName: user.name,
          action: "totp.device.confirm",
          resourceType: "totp_device",
          resourceId: deviceId,
          resourceName: deviceId,
          ip: getClientIp(c),
          userAgent: c.req.header("user-agent") ?? "unknown",
          result: "failure",
        });
        throw new AppError("Invalid TOTP code or device", 400, "TOTP_VERIFY_FAILED");
      }
      await audit(db, c.get("logger"), {
        actorId: user.id,
        actorName: user.name,
        action: "totp.device.confirmed",
        resourceType: "totp_device",
        resourceId: deviceId,
        resourceName: deviceId,
        ip: getClientIp(c),
        userAgent: c.req.header("user-agent") ?? "unknown",
        result: "success",
      });
      return c.json({ success: true, data: null });
    },
  );

  router.delete(
    "/account/me/totp/:deviceId",
    describeRoute({
      tags: ["account"],
      summary: "Delete a TOTP device",
      responses: { 200: okJson(z.null()), 401: { description: "Step-up required", ...errorJson }, 404: { description: "Not found", ...errorJson }, 429: { description: "Rate limited", ...errorJson } },
    }),
    rateLimit({ windowMs: 5 * 60 * 1000, max: 10, bucket: "totp-stepup" }),
    validator("param", deviceIdParamSchema, onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const user = c.get("user");
      const { deviceId } = c.req.valid("param");

      // Once any device is verified, deletion is a sensitive op and must be
      // gated by a fresh step-up token. Pre-bootstrap (no verified device) we
      // allow plain deletion so a botched setup can be cleaned up.
      if (await hasVerifiedTotp(db, user.id)) {
        const header = c.req.header("x-totp-token");
        if (!header || !validateStepUpToken(header, user.id)) {
          throw new UnauthorizedError("STEP_UP_REQUIRED");
        }
      }

      const ok = await deleteTotpDevice(db, deviceId, user.id);
      if (!ok)
        throw new NotFoundError("TOTP device", deviceId);
      await audit(db, c.get("logger"), {
        actorId: user.id,
        actorName: user.name,
        action: "totp.device.deleted",
        resourceType: "totp_device",
        resourceId: deviceId,
        resourceName: deviceId,
        ip: getClientIp(c),
        userAgent: c.req.header("user-agent") ?? "unknown",
        result: "success",
      });
      return c.json({ success: true, data: null });
    },
  );

  router.post(
    "/account/me/totp/verify",
    describeRoute({
      tags: ["account"],
      summary: "Verify a TOTP code and mint a step-up token",
      responses: { 200: okJson(z.object({ token: z.string() })), 400: { description: "Invalid code", ...errorJson }, 401: { description: "Unauthenticated", ...errorJson }, 422: { description: "Validation error", ...errorJson }, 429: { description: "Rate limited", ...errorJson } },
    }),
    rateLimit({ windowMs: 5 * 60 * 1000, max: 10, bucket: "totp-stepup" }),
    validator("json", z.object({ code: z.string().length(6) }), onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const user = c.get("user");
      const body = c.req.valid("json");
      const ok = await verifyTotpCode(db, user.id, body.code);
      if (!ok)
        throw new AppError("Invalid TOTP code", 400, "TOTP_VERIFY_FAILED");
      const token = issueStepUpToken(user.id);
      return c.json({ success: true, data: { token } });
    },
  );

  // GET /account/visible-users — directory of active users exposed to every
  // authenticated caller. Intentionally NOT admin-gated: the document /
  // issue sharing and assignment pickers need it on the user-facing UI.
  // Lives outside the `/account/users/*` namespace (which is admin-only)
  // so the public-vs-admin boundary is legible from the URL alone.
  router.get(
    "/account/visible-users",
    describeRoute({
      tags: ["account"],
      summary: "List active real users (sharing/assignment picker)",
      responses: { 200: okJson(z.array(pickerUserSchema)), 401: { description: "Unauthenticated", ...errorJson } },
    }),
    async (c) => {
      const db = c.get("db");
      const data = await listActiveUsers(db);
      return c.json({ success: true, data, meta: { total: data.length } });
    },
  );

  // GET /account/assignable-users — active real AND virtual users, the source
  // for the project member-add picker. Authenticated (NOT admin-gated) like
  // /visible-users; differs only by including virtual users.
  router.get(
    "/account/assignable-users",
    describeRoute({
      tags: ["account"],
      summary: "List active real and virtual users (member-add picker)",
      responses: { 200: okJson(z.array(pickerUserSchema)), 401: { description: "Unauthenticated", ...errorJson } },
    }),
    async (c) => {
      const db = c.get("db");
      const data = await listAssignableUsers(db);
      return c.json({ success: true, data, meta: { total: data.length } });
    },
  );

  // ── /account/users — admin endpoints ──

  // POST /users — create a virtual user (no login identity)
  router.post(
    "/account/users",
    describeRoute({
      tags: ["account"],
      summary: "Create a virtual user (admin)",
      responses: { 201: okJson(userColumnsSchema, "Created"), 401: { description: "Unauthenticated", ...errorJson }, 403: { description: "Admin only", ...errorJson }, 409: { description: "Username taken", ...errorJson }, 422: { description: "Validation error", ...errorJson } },
    }),
    adminRequired,
    validator("json", createVirtualUserSchema, onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const currentUser = c.get("user");
      const body = c.req.valid("json");
      const created = await createVirtualUser(db, body);
      await audit(db, c.get("logger"), {
        actorId: currentUser.id,
        actorName: currentUser.name,
        action: "user.virtual_created",
        resourceType: "user",
        resourceId: created!.id,
        resourceName: created!.username,
        ip: getClientIp(c),
        userAgent: c.req.header("user-agent") ?? "unknown",
        result: "success",
      });
      return c.json({ success: true, data: created }, 201);
    },
  );

  // GET /users — list with pagination, search, filter
  router.get(
    "/account/users",
    describeRoute({
      tags: ["account"],
      summary: "List users with pagination, search and filters (admin)",
      responses: { 200: okJson(z.array(userColumnsSchema)), 401: { description: "Unauthenticated", ...errorJson }, 403: { description: "Admin only", ...errorJson }, 422: { description: "Validation error", ...errorJson } },
    }),
    adminRequired,
    validator("query", listQuerySchema, onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const query = c.req.valid("query");
      const result = await listUsers(db, {
        ...query.q ? { q: query.q } : {},
        ...query.role ? { role: query.role } : {},
        ...query.status ? { status: query.status } : {},
        ...query.group_id ? { groupId: query.group_id } : {},
        page: query.page,
        limit: query.limit,
      });

      return c.json({
        success: true,
        data: result.data,
        meta: {
          total: result.total,
          page: result.page,
          limit: result.limit,
          totalPages: result.totalPages,
        },
      });
    },
  );

  // GET /users/:id — user detail
  router.get(
    "/account/users/:id",
    describeRoute({
      tags: ["account"],
      summary: "Get user detail (admin)",
      responses: { 200: okJson(userColumnsSchema), 401: { description: "Unauthenticated", ...errorJson }, 403: { description: "Admin only", ...errorJson }, 404: { description: "Not found", ...errorJson } },
    }),
    adminRequired,
    validator("param", idParamSchema, onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const { id } = c.req.valid("param");
      const user = await getUserById(db, id);
      if (!user) {
        throw new NotFoundError("User", id);
      }
      return c.json({ success: true, data: user });
    },
  );

  // PATCH /users/:id — update role/status (any user) and, for VIRTUAL users,
  // their display name / username (with global username-uniqueness on rename).
  router.patch(
    "/account/users/:id",
    describeRoute({
      tags: ["account"],
      summary: "Update a user's role/status, or rename a virtual user (admin)",
      responses: { 200: okJson(userColumnsSchema), 400: { description: "Bad request", ...errorJson }, 401: { description: "Unauthenticated", ...errorJson }, 403: { description: "Forbidden", ...errorJson }, 404: { description: "Not found", ...errorJson }, 409: { description: "Conflict", ...errorJson }, 422: { description: "Validation error", ...errorJson } },
    }),
    adminRequired,
    validator("param", idParamSchema, onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const { id } = c.req.valid("param");

      const currentUser = c.get("user");
      if (id === currentUser.id) {
        throw new AppError("Cannot modify your own account", 403, "FORBIDDEN");
      }

      const existing = await getUserById(db, id);
      if (!existing) {
        throw new NotFoundError("User", id);
      }

      const body = updateBodySchema.parse(await c.req.json());

      // `name` is locally editable for every user (login no longer overwrites
      // it). `username`/`email` are identity fields owned by the IdP for real
      // users, so they are only honoured for virtual targets.
      const editsIdentity = body.username !== undefined || body.email !== undefined;
      if (editsIdentity && !existing.isVirtual) {
        throw new AppError("Only virtual users can change username or email", 400, "BAD_REQUEST");
      }
      const editsProfile = body.name !== undefined || editsIdentity;

      const roleChanged = body.role !== undefined && body.role !== existing.role;
      const statusChanged = body.status !== undefined && body.status !== existing.status;

      // Does this patch strip the target of active-admin standing?
      const losesAdmin = existing.role === "admin" && existing.status === "active"
        && ((body.role !== undefined && body.role !== "admin")
          || (body.status !== undefined && body.status !== "active"));

      if (body.role !== undefined || body.status !== undefined) {
      // Atomic: either both the user mutation AND the session purge land, or
      // neither does. Without a tx an admin demote could persist while the
      // user keeps an existing admin session live.
        db.transaction((tx) => {
        // Last-admin guard (FEAT-031), inside the tx so two admins demoting
        // each other concurrently cannot both pass the count.
          if (losesAdmin)
            assertNotLastActiveAdmin(tx, id);

          const now = new Date().toISOString();
          const setData: Record<string, unknown> = { updatedAt: now };
          if (body.role !== undefined)
            setData.role = body.role;
          if (body.status !== undefined)
            setData.status = body.status;

          tx.update(users).set(setData).where(eq(users.id, id)).run();

          if (roleChanged || statusChanged) {
            tx.delete(sessions).where(eq(sessions.userId, id)).run();
          }
        });

        // Re-validate the acting admin's authority post-commit. If their role was
        // revoked concurrently we must not report success on a privileged op.
        const refreshedActor = await getUserById(db, currentUser.id);
        if (!refreshedActor || refreshedActor.role !== "admin") {
          throw new AppError("Admin privileges revoked during operation", 403, "FORBIDDEN");
        }
      }

      const ip = getClientIp(c);
      const userAgent = c.req.header("user-agent") ?? "unknown";

      if (editsProfile) {
        // Virtual rows carry editable identity fields; real rows only accept a
        // local name change (identity stays IdP-owned).
        if (existing.isVirtual)
          await updateVirtualUser(db, id, { name: body.name, username: body.username, email: body.email });
        else
          await updateUser(db, id, { name: body.name });
        await audit(db, c.get("logger"), {
          actorId: currentUser.id,
          actorName: currentUser.name,
          action: existing.isVirtual ? "user.virtual_updated" : "user.profile_updated",
          resourceType: "user",
          resourceId: id,
          resourceName: body.username ?? existing.username,
          ip,
          userAgent,
          result: "success",
        });
      }

      if (roleChanged) {
        await audit(db, c.get("logger"), {
          actorId: currentUser.id,
          actorName: currentUser.name,
          action: "user.role_changed",
          resourceType: "user",
          resourceId: id,
          resourceName: existing.username,
          detail: { previousRole: existing.role, newRole: body.role },
          ip,
          userAgent,
          result: "success",
        });
      }
      if (statusChanged) {
        const action = body.status === "disabled" ? "user.disabled" : "user.enabled";
        await audit(db, c.get("logger"), {
          actorId: currentUser.id,
          actorName: currentUser.name,
          action,
          resourceType: "user",
          resourceId: id,
          resourceName: existing.username,
          ip,
          userAgent,
          result: "success",
        });
      }

      const updated = await getUserById(db, id);
      return c.json({ success: true, data: updated });
    },
  );

  // GET /users/:id/groups — user's groups
  router.get(
    "/account/users/:id/groups",
    describeRoute({
      tags: ["account"],
      summary: "List a user's groups (admin)",
      responses: { 200: okJson(z.array(userGroupSchema)), 401: { description: "Unauthenticated", ...errorJson }, 403: { description: "Admin only", ...errorJson }, 404: { description: "Not found", ...errorJson } },
    }),
    adminRequired,
    validator("param", idParamSchema, onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const { id } = c.req.valid("param");

      const user = await getUserById(db, id);
      if (!user) {
        throw new NotFoundError("User", id);
      }

      const userGroupsList = await getUserGroups(db, id);
      return c.json({ success: true, data: userGroupsList });
    },
  );

  // DELETE /users/:id — hard-delete a virtual user (real users are rejected)
  router.delete(
    "/account/users/:id",
    describeRoute({
      tags: ["account"],
      summary: "Delete a virtual user (admin)",
      responses: { 200: okJson(z.null()), 401: { description: "Unauthenticated", ...errorJson }, 403: { description: "Forbidden", ...errorJson }, 409: { description: "Cannot delete a real user", ...errorJson } },
    }),
    adminRequired,
    validator("param", idParamSchema, onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const { id } = c.req.valid("param");

      const currentUser = c.get("user");
      if (id === currentUser.id) {
        throw new AppError("Cannot modify your own account", 403, "FORBIDDEN");
      }

      const existing = await getUserById(db, id);
      await deleteVirtualUser(db, id);
      await audit(db, c.get("logger"), {
        actorId: currentUser.id,
        actorName: currentUser.name,
        action: "user.virtual_deleted",
        resourceType: "user",
        resourceId: id,
        resourceName: existing?.username ?? id,
        ip: getClientIp(c),
        userAgent: c.req.header("user-agent") ?? "unknown",
        result: "success",
      });
      return c.json({ success: true, data: null });
    },
  );

  return router;
}
