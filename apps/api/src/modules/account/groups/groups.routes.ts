import type { ProtectedEnv } from "@/shared/lib/types";
import { Hono } from "hono";
import { z } from "zod";
import { getUserById } from "@/modules/account/users/users.service";
import { audit } from "@/modules/audit/audit.service";
import { getClientIp } from "@/shared/lib/client-ip";
import { AppError, NotFoundError } from "@/shared/lib/errors";
import { describeRoute, ErrorEnvelope, onValidationFailure, resolver, validator } from "@/shared/lib/openapi";
import { adminRequired, authRequired } from "@/shared/middleware/auth";
import {
  addGroupMember,
  createGroup,
  deleteGroup,
  getGroupById,
  getGroupByName,
  getGroupMembers,
  listGroups,
  removeGroupMember,
  updateGroup,
} from "./groups.service";
import { parseModules } from "./module-gate";

const createGroupSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  // Module grants (FEAT-032); keys validated against MODULE_KEYS in the service.
  modules: z.array(z.string()).optional(),
});

const updateGroupSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  modules: z.array(z.string()).optional(),
}).refine(d => d.name !== undefined || d.description !== undefined || d.modules !== undefined, {
  message: "At least one of name, description or modules must be provided",
});

const addMemberSchema = z.object({
  userId: z.string().min(1),
});

const idParamSchema = z.object({ id: z.string() });

// Response `data` shapes for the OpenAPI spec (routes wrap rows with
// `parseModules`, so `modules` is always a string array on the wire).
const groupSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  modules: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
  memberCount: z.number().optional(),
});
const groupMemberSchema = z.object({
  id: z.string(),
  username: z.string(),
  name: z.string(),
  email: z.string(),
  avatar: z.string().nullable(),
  role: z.string(),
  status: z.string(),
  joinedAt: z.string(),
});

// `{ success:true, data }` response doc for `schema`.
function okJson(schema: z.ZodType, description = "Success") {
  return { description, content: { "application/json": { schema: resolver(z.object({ success: z.literal(true), data: schema })) } } };
}
const errorJson = { content: { "application/json": { schema: resolver(ErrorEnvelope) } } };

export function groupRoutes() {
  const router = new Hono<ProtectedEnv>();

  router.use("*", authRequired);

  // GET /groups — list all groups
  router.get(
    "/account/groups",
    describeRoute({
      tags: ["account"],
      summary: "List all groups",
      responses: { 200: okJson(z.array(groupSchema)), 401: { description: "Unauthenticated", ...errorJson }, 403: { description: "Admin only", ...errorJson } },
    }),
    adminRequired,
    async (c) => {
      const db = c.get("db");
      const data = await listGroups(db);
      return c.json({ success: true, data });
    },
  );

  // POST /groups — create group
  router.post(
    "/account/groups",
    describeRoute({
      tags: ["account"],
      summary: "Create a group",
      responses: { 201: okJson(groupSchema, "Created"), 401: { description: "Unauthenticated", ...errorJson }, 403: { description: "Admin only", ...errorJson }, 409: { description: "Name conflict", ...errorJson }, 422: { description: "Validation error", ...errorJson } },
    }),
    adminRequired,
    validator("json", createGroupSchema, onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const body = c.req.valid("json");

      const existing = await getGroupByName(db, body.name);
      if (existing) {
        throw new AppError(`Group name "${body.name}" already exists`, 409, "CONFLICT");
      }

      const group = await createGroup(db, {
        name: body.name,
        ...body.description ? { description: body.description } : {},
        ...body.modules ? { modules: body.modules } : {},
      });
      const actor = c.get("user");
      await audit(db, c.get("logger"), {
        actorId: actor.id,
        actorName: actor.name,
        action: "group.created",
        resourceType: "group",
        resourceId: group.id,
        resourceName: group.name,
        ip: getClientIp(c),
        userAgent: c.req.header("user-agent") ?? "unknown",
        result: "success",
      });
      return c.json({ success: true, data: { ...group, modules: parseModules(group.modules) } }, 201);
    },
  );

  // GET /groups/:id — group detail
  router.get(
    "/account/groups/:id",
    describeRoute({
      tags: ["account"],
      summary: "Get group detail",
      responses: { 200: okJson(groupSchema), 401: { description: "Unauthenticated", ...errorJson }, 403: { description: "Admin only", ...errorJson }, 404: { description: "Not found", ...errorJson } },
    }),
    adminRequired,
    validator("param", idParamSchema, onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const { id } = c.req.valid("param");
      const group = await getGroupById(db, id);
      if (!group) {
        throw new NotFoundError("Group", id);
      }
      return c.json({ success: true, data: { ...group, modules: parseModules(group.modules) } });
    },
  );

  // PATCH /groups/:id — update group
  router.patch(
    "/account/groups/:id",
    describeRoute({
      tags: ["account"],
      summary: "Update a group",
      responses: { 200: okJson(groupSchema), 401: { description: "Unauthenticated", ...errorJson }, 403: { description: "Admin only", ...errorJson }, 404: { description: "Not found", ...errorJson }, 409: { description: "Name conflict", ...errorJson }, 422: { description: "Validation error", ...errorJson } },
    }),
    adminRequired,
    validator("param", idParamSchema, onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const { id } = c.req.valid("param");

      const existing = await getGroupById(db, id);
      if (!existing) {
        throw new NotFoundError("Group", id);
      }

      const body = updateGroupSchema.parse(await c.req.json());

      if (body.name && body.name !== existing.name) {
        const nameConflict = await getGroupByName(db, body.name);
        if (nameConflict) {
          throw new AppError(`Group name "${body.name}" already exists`, 409, "CONFLICT");
        }
      }

      const updated = await updateGroup(db, id, {
        ...body.name ? { name: body.name } : {},
        ...body.description !== undefined ? { description: body.description } : {},
        ...body.modules !== undefined ? { modules: body.modules } : {},
      });
      const actor = c.get("user");
      await audit(db, c.get("logger"), {
        actorId: actor.id,
        actorName: actor.name,
        action: "group.updated",
        resourceType: "group",
        resourceId: id,
        resourceName: existing.name,
        ip: getClientIp(c),
        userAgent: c.req.header("user-agent") ?? "unknown",
        result: "success",
      });
      return c.json({ success: true, data: updated ? { ...updated, modules: parseModules(updated.modules) } : updated });
    },
  );

  // DELETE /groups/:id — delete group
  router.delete(
    "/account/groups/:id",
    describeRoute({
      tags: ["account"],
      summary: "Delete a group",
      responses: { 200: okJson(z.null()), 401: { description: "Unauthenticated", ...errorJson }, 403: { description: "Admin only", ...errorJson }, 404: { description: "Not found", ...errorJson } },
    }),
    adminRequired,
    validator("param", idParamSchema, onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const { id } = c.req.valid("param");

      const existing = await getGroupById(db, id);
      if (!existing) {
        throw new NotFoundError("Group", id);
      }

      await deleteGroup(db, id);
      const actor = c.get("user");
      await audit(db, c.get("logger"), {
        actorId: actor.id,
        actorName: actor.name,
        action: "group.deleted",
        resourceType: "group",
        resourceId: id,
        resourceName: existing.name,
        ip: getClientIp(c),
        userAgent: c.req.header("user-agent") ?? "unknown",
        result: "success",
      });
      return c.json({ success: true, data: null });
    },
  );

  // GET /groups/:id/members — member list
  router.get(
    "/account/groups/:id/members",
    describeRoute({
      tags: ["account"],
      summary: "List group members",
      responses: { 200: okJson(z.array(groupMemberSchema)), 401: { description: "Unauthenticated", ...errorJson }, 403: { description: "Admin only", ...errorJson }, 404: { description: "Not found", ...errorJson } },
    }),
    adminRequired,
    validator("param", idParamSchema, onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const { id } = c.req.valid("param");

      const group = await getGroupById(db, id);
      if (!group) {
        throw new NotFoundError("Group", id);
      }

      const members = await getGroupMembers(db, id);
      return c.json({ success: true, data: members });
    },
  );

  // POST /groups/:id/members — add member
  router.post(
    "/account/groups/:id/members",
    describeRoute({
      tags: ["account"],
      summary: "Add a member to a group",
      responses: { 201: okJson(z.null(), "Created"), 401: { description: "Unauthenticated", ...errorJson }, 403: { description: "Admin only", ...errorJson }, 404: { description: "Not found", ...errorJson }, 409: { description: "Already a member", ...errorJson }, 422: { description: "Validation error", ...errorJson } },
    }),
    adminRequired,
    validator("param", idParamSchema, onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const { id } = c.req.valid("param");

      const group = await getGroupById(db, id);
      if (!group) {
        throw new NotFoundError("Group", id);
      }

      const body = addMemberSchema.parse(await c.req.json());
      const user = await getUserById(db, body.userId);
      if (!user) {
        throw new NotFoundError("User", body.userId);
      }

      const added = await addGroupMember(db, id, body.userId);
      if (!added) {
        throw new AppError("User is already a member of this group", 409, "CONFLICT");
      }

      const actor = c.get("user");
      await audit(db, c.get("logger"), {
        actorId: actor.id,
        actorName: actor.name,
        action: "group.member_added",
        resourceType: "group",
        resourceId: id,
        resourceName: group.name,
        detail: { userId: body.userId, userName: user.name },
        ip: getClientIp(c),
        userAgent: c.req.header("user-agent") ?? "unknown",
        result: "success",
      });
      return c.json({ success: true, data: null }, 201);
    },
  );

  // DELETE /groups/:id/members/:userId — remove member
  router.delete(
    "/account/groups/:id/members/:userId",
    describeRoute({
      tags: ["account"],
      summary: "Remove a member from a group",
      responses: { 200: okJson(z.null()), 401: { description: "Unauthenticated", ...errorJson }, 403: { description: "Admin only", ...errorJson }, 404: { description: "Not found", ...errorJson } },
    }),
    adminRequired,
    validator("param", z.object({ id: z.string(), userId: z.string() }), onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const { id, userId } = c.req.valid("param");

      const group = await getGroupById(db, id);
      if (!group) {
        throw new NotFoundError("Group", id);
      }

      const removed = await removeGroupMember(db, id, userId);
      if (!removed) {
        throw new NotFoundError("Member", userId);
      }

      const actor = c.get("user");
      await audit(db, c.get("logger"), {
        actorId: actor.id,
        actorName: actor.name,
        action: "group.member_removed",
        resourceType: "group",
        resourceId: id,
        resourceName: group.name,
        detail: { userId },
        ip: getClientIp(c),
        userAgent: c.req.header("user-agent") ?? "unknown",
        result: "success",
      });
      return c.json({ success: true, data: null });
    },
  );

  return router;
}
